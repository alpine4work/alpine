import {
    DatabaseFieldConfigSchema,
    getDatabaseFieldProvider,
    getUnknownDatabaseFieldProvider,
} from "~/shared/databases/fields/all_database_field_providers.js";
import {ColumnBackedDatabaseFieldProvider} from "~/shared/databases/fields/base/database_field_provider_base.js";
import {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import {SqlBooleanSchema} from "~/shared/databases/model/sqlite_schema.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {runJoinTableMigrations, runTableMigrations} from "~/shared/databases/sqlite_migrations.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {type ObjectSchema, Schema, type SchemaType} from "~/shared/schema/schema.js";

/**
 * Server-only capabilities. Present on the server, `null` on the client — so
 * client-side actions can't attach per-table files.
 */
export interface DatabaseActionServerContext {
    /**
     * Attach a per-table database file (no-op if already attached) so the action can
     * create or write to it. Used by server-only schema actions like {@link
     * databaseActions.createTable}.
     */
    attach(tableId: DatabaseTableId): void;
}

/** Context handed to a database action's `run()`. */
export interface DatabaseActionContext {
    /** The SQLite handle the action runs against. */
    db: SqliteDatabase;
    /** Server-only capabilities, or `null` on the client. */
    server: DatabaseActionServerContext | null;
    /** The database schema */
    model: DatabaseModel;
}

/**
 * Defines a database action with typed input/output schemas, a write level, and a
 * shared `run()` function that executes on both client and server.
 *
 * `serverOnly` actions never run optimistically on the client; the client routes
 * them straight to the server. This lets them generate ids internally and attach
 * new per-table files without client/server divergence.
 */
function defineDatabaseAction<Input, Output>(def: {
    input: ObjectSchema<Input>;
    output: ObjectSchema<Output>;
    writeLevel: SqliteWriteLevel;
    transactionMode?: "automatic" | "manual";
    /**
     * When `true`, the client skips optimistic local execution and routes the action
     * straight to the server. Use for actions whose `run()` is non-deterministic in a
     * way that would diverge between client and server — e.g. allocating IDs via
     * `generateChronologicalId()` — making optimistic execution unsafe.
     */
    serverOnly?: boolean;
    run: (ctx: DatabaseActionContext, input: Input) => any;
}): {
    input: ObjectSchema<Input>;
    output: ObjectSchema<Output>;
    writeLevel: SqliteWriteLevel;
    transactionMode: "automatic" | "manual";
    serverOnly: boolean;
    run: (ctx: DatabaseActionContext, input: Input) => Output;
} {
    return {serverOnly: false, transactionMode: "automatic", ...def};
}

function executeDatabaseActionTransaction<T>(db: SqliteDatabase, fn: () => T): T {
    sql`BEGIN`.exec(db);
    const result = fn();
    sql`COMMIT`.exec(db);
    return result;
}

export function executeDatabaseAction<N extends DatabaseActionName>(
    actionObject: DatabaseActionObject<N>,
    ctx: DatabaseActionContext,
): DatabaseActionOutput<N> {
    const action = databaseActions[actionObject.name];

    if (action.serverOnly) {
        assert(ctx.server !== null, "action is server-only");
    }

    try {
        // eslint-disable-next-line no-console
        console.group(`[executeDatabaseAction] ${actionObject.name}`);
        const run = () => action.run(ctx, actionObject.input as any) as DatabaseActionOutput<N>;
        if (action.writeLevel === "none" || action.transactionMode === "manual") {
            return run();
        }
        return executeDatabaseActionTransaction(ctx.db, run);
    } finally {
        // eslint-disable-next-line no-console
        console.groupEnd();
    }
}

export const databaseActions = {
    rawSql: defineDatabaseAction({
        input: Schema.object({sql: Schema.string}),
        output: Schema.object({rows: Schema.array(Schema.unknown())}),
        writeLevel: "data",
        run({db}, input) {
            const rows = sql.raw(input.sql).selectAllUnknown(db);
            return {rows};
        },
    }),

    readonlyRawSql: defineDatabaseAction({
        input: Schema.object({sql: Schema.string}),
        output: Schema.object({rows: Schema.array(Schema.unknown())}),
        writeLevel: "none",
        run({db}, input) {
            const rows = sql.raw(input.sql).selectAllUnknown(db);
            return {rows};
        },
    }),

    createTable: defineDatabaseAction({
        input: Schema.object({name: LabelStringSchema}),
        output: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            tableName: Schema.string,
            viewId: Schema.id<DatabaseViewId>(),
        }),
        writeLevel: "schema+data",
        transactionMode: "manual",
        serverOnly: true,
        run({db, server, model}, {name}) {
            assert(server !== null, "createTable is server-only");
            const tableId = generateChronologicalId<DatabaseTableId>();

            // Attach + migrate the new per-db file before writing any of the table's data or
            // metadata into it. `attach` is a no-op if already attached.
            server.attach(tableId);
            runTableMigrations(db, tableId);

            const {table, defaultView} = executeDatabaseActionTransaction(db, () =>
                model.createTable(tableId, name),
            );

            return {tableId: table.id, tableName: table.tableName, viewId: defaultView.id};
        },
    }),

    renameTable: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            name: LabelStringSchema,
        }),
        output: Schema.object({
            tableName: Schema.string,
        }),
        writeLevel: "schema+data",
        run({model}, {tableId, name}) {
            const table = model.getTable(tableId);
            const updated = table.updateName(name);

            return {tableName: updated.tableName};
        },
    }),

    listTableIds: defineDatabaseAction({
        input: Schema.object({}),
        output: Schema.object({
            tableIds: Schema.array(Schema.id<DatabaseTableId>()),
        }),
        writeLevel: "none",
        run({model}) {
            return {tableIds: model.getTableIds("table")};
        },
    }),

    listTables: defineDatabaseAction({
        input: Schema.object({}),
        output: Schema.object({
            tables: Schema.array(
                Schema.object({
                    id: Schema.id<DatabaseTableId>(),
                    name: Schema.string,
                }),
            ),
        }),
        writeLevel: "none",
        run({model}) {
            return {
                tables: model.getTableIds("table").map(tableId => ({
                    id: tableId,
                    name: model.getTable(tableId).name,
                })),
            };
        },
    }),

    getViewSchema: defineDatabaseAction({
        input: Schema.object({tableOrViewId: Schema.string}),
        output: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            viewId: Schema.id<DatabaseViewId>(),
            tableName: Schema.string,
            fields: Schema.array(
                Schema.object({
                    id: Schema.id<DatabaseFieldId>(),
                    name: Schema.string,
                    columnName: Schema.string.originalPropertyKey("column_name"),
                    config: DatabaseFieldConfigSchema,
                    position: OrderKeySchema,
                    width: Schema.integer,
                    hidden: SqlBooleanSchema,
                }),
            ),
        }),
        writeLevel: "none",
        run({model}, {tableOrViewId}) {
            const {table, view} = model.resolveTableOrViewId(tableOrViewId);
            const fields = view.getFieldsWithViewMetadata();

            return {
                tableId: table.id,
                viewId: view.id,
                tableName: table.name,
                fields,
            };
        },
    }),

    getViewRowsPageCursor: defineDatabaseAction({
        input: Schema.object({
            tableOrViewId: Schema.string,
            afterCursor: Schema.id<DatabaseRowId>().nullable(),
            limit: Schema.integer,
        }),
        output: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            viewId: Schema.id<DatabaseViewId>(),
            tableName: Schema.string,
            endCursor: Schema.id<DatabaseRowId>().nullable(),
        }),
        writeLevel: "none",
        run({db, model}, {tableOrViewId, afterCursor, limit}) {
            const {table, view} = model.resolveTableOrViewId(tableOrViewId);

            const whereClause =
                afterCursor != null
                    ? sql`
                          WHERE
                              _id > ${afterCursor}
                      `
                    : sql``;

            const rows = sql`
                SELECT
                    _id
                FROM
                    ${table.tableRef} ${whereClause}
                ORDER BY
                    _id
                LIMIT
                    ${limit}
            `.selectValues(db, Schema.id<DatabaseRowId>());

            const endCursor = rows.length === limit ? rows[rows.length - 1]! : null;

            return {tableId: table.id, viewId: view.id, tableName: table.tableName, endCursor};
        },
    }),

    getViewRowsPage: defineDatabaseAction({
        input: Schema.object({
            tableOrViewId: Schema.string,
            afterCursor: Schema.id<DatabaseRowId>().nullable(),
            endCursor: Schema.id<DatabaseRowId>().nullable(),
        }),
        output: Schema.object({
            fieldIndexes: Schema.map(Schema.id<DatabaseFieldId>(), Schema.integer),
            rows: Schema.array(Schema.array(Schema.unknown())),
        }),
        writeLevel: "none",
        run({db, model}, {tableOrViewId, afterCursor, endCursor}) {
            const {table, view} = model.resolveTableOrViewId(tableOrViewId);

            const fields = view.getFields();

            // \_id is always at index 0; view fields start at 1.
            const selectColumns = [sql.identifier("_alpine_data_row", "_id")];
            const columnSchemas: Array<Schema<any>> = [Schema.id<DatabaseRowId>()];
            const fieldIndexes = new Map<DatabaseFieldId, number>();
            const dataRow = sql.identifier("_alpine_data_row");

            for (let i = 0; i < fields.length; i++) {
                const fieldIndex = i + 1;
                fieldIndexes.set(fields[i]!.id, fieldIndex);
                const field = fields[i]!;

                const provider = getDatabaseFieldProvider(field.config.type);
                selectColumns.push(provider.selectColumn(field, dataRow));
                columnSchemas.push(provider.sqlValueSchema ?? provider.valueSchema);
            }

            const selectList = sql.join(selectColumns, ", ");

            let whereClause: SqlQuery;
            if (afterCursor != null && endCursor != null) {
                whereClause = sql`
                    WHERE
                        ${sql.identifier("_alpine_data_row", "_id")} > ${afterCursor}
                        AND ${sql.identifier("_alpine_data_row", "_id")} <= ${endCursor}
                `;
            } else if (afterCursor != null) {
                whereClause = sql`
                    WHERE
                        ${sql.identifier("_alpine_data_row", "_id")} > ${afterCursor}
                `;
            } else if (endCursor != null) {
                whereClause = sql`
                    WHERE
                        ${sql.identifier("_alpine_data_row", "_id")} <= ${endCursor}
                `;
            } else {
                whereClause = sql``;
            }

            const rows = sql`
                SELECT
                    ${selectList}
                FROM
                    ${table.tableRef} AS _alpine_data_row ${whereClause}
                ORDER BY
                    ${sql.identifier("_alpine_data_row", "_id")}
            `.selectAllArrays(db, columnSchemas);

            return {fieldIndexes, rows};
        },
    }),

    updateCellValue: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            rowId: Schema.id<DatabaseRowId>(),
            value: Schema.unknown(),
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({db, model}, {tableId, fieldId, rowId, value}) {
            const table = model.getTable(tableId);
            const field = table.getField(fieldId);
            const provider = getDatabaseFieldProvider(field.config.type);
            assert(
                provider instanceof ColumnBackedDatabaseFieldProvider,
                `cannot update virtual field ${fieldId} with updateCellValue`,
            );
            const valueSql = provider.unknownValueToSql(value);
            sql`
                UPDATE ${table.tableRef}
                SET
                    ${sql.identifier(field.columnName)} = ${valueSql}
                WHERE
                    _id = ${rowId}
            `.exec(db);
            return {};
        },
    }),

    createRow: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            rowId: Schema.id<DatabaseRowId>(),
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({db, model}, {tableId, rowId}) {
            const table = model.getTable(tableId);
            sql`
                INSERT INTO
                    ${table.tableRef} (_id)
                VALUES
                    (${rowId})
            `.exec(db);
            return {};
        },
    }),

    createField: defineDatabaseAction({
        input: Schema.object({
            fieldId: Schema.id<DatabaseFieldId>(),
            tableId: Schema.id<DatabaseTableId>(),
            name: LabelStringSchema,
            config: DatabaseFieldConfigSchema,
        }),
        output: Schema.object({}),
        writeLevel: "schema+data",
        run({model}, {fieldId, tableId, name, config}) {
            assert(config.type !== "relation", "use createRelationField to create relation fields");

            const table = model.getTable(tableId);
            const field = table.createField(fieldId, name, config);
            table.appendFieldToAllViews(field);

            return {};
        },
    }),

    createRelationField: defineDatabaseAction({
        input: Schema.object({
            sourceTableId: Schema.id<DatabaseTableId>(),
            sourceFieldName: LabelStringSchema,
            targetTableId: Schema.id<DatabaseTableId>(),
            cardinality: Schema.enum(["one", "many"]),
        }),
        output: Schema.object({
            joinTableId: Schema.id<DatabaseTableId>(),
            sourceFieldId: Schema.id<DatabaseFieldId>(),
            targetFieldId: Schema.id<DatabaseFieldId>(),
        }),
        writeLevel: "schema+data",
        transactionMode: "manual",
        serverOnly: true,
        run({db, model, server}, {sourceTableId, sourceFieldName, targetTableId, cardinality}) {
            assert(server !== null, "createRelationField is server-only");
            const sourceTable = model.getTable(sourceTableId);
            const targetTable = model.getTable(targetTableId);

            const joinTableId = generateChronologicalId<DatabaseTableId>();
            const sourceFieldId = generateChronologicalId<DatabaseFieldId>();
            const targetFieldId = generateChronologicalId<DatabaseFieldId>();

            server.attach(joinTableId);
            runJoinTableMigrations(db, joinTableId);

            const {sourceField, targetField, joinTable} = executeDatabaseActionTransaction(
                db,
                () => {
                    const sourceField = sourceTable.createField(sourceFieldId, sourceFieldName, {
                        type: "relation",
                        joinTableId,
                        side: "source",
                        cardinality,
                        linkedTableId: targetTable.id,
                    });
                    sourceTable.appendFieldToAllViews(sourceField);

                    const targetField = targetTable.createField(targetFieldId, sourceTable.name, {
                        type: "relation",
                        joinTableId,
                        side: "target",
                        cardinality: "many",
                        linkedTableId: sourceTable.id,
                    });
                    targetTable.appendFieldToAllViews(targetField);

                    const joinTable = model.createJoinTable(sourceField, targetField);
                    return {sourceField, targetField, joinTable};
                },
            );

            return {
                joinTableId: joinTable.id,
                sourceFieldId: sourceField.id,
                targetFieldId: targetField.id,
            };
        },
    }),

    addLink: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            rowId: Schema.id<DatabaseRowId>(),
            linkedRowId: Schema.id<DatabaseRowId>(),
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({db, model}, {tableId, fieldId, rowId, linkedRowId}) {
            const table = model.getTable(tableId);
            const field = table.getField(fieldId);
            assert(field.isType("relation"));
            const provider = getDatabaseFieldProvider(field.config.type);
            const relation = provider.resolveRelation(field);
            const linkedTable = model.getTable(relation.linkedTableId);
            const joinTable = relation.joinTable;

            assert(table.rowExists(rowId), "row not found");
            assert(linkedTable.rowExists(linkedRowId), "linked row not found");

            if (relation.config.cardinality === "one") {
                sql`
                    DELETE FROM ${joinTable.tableRef}
                    WHERE
                        ${relation.our.rowIdColumn} = ${rowId}
                `.exec(db);
            }

            const ourPosition = sql`
                SELECT
                    generate_order_key (MAX(${relation.our.positionColumn}), NULL)
                FROM
                    ${joinTable.tableRef}
                WHERE
                    ${relation.our.rowIdColumn} = ${rowId}
                ORDER BY
                    ${relation.our.positionColumn} DESC
                LIMIT
                    1
            `.selectValue(db, Schema.string);

            const theirPosition = sql`
                SELECT
                    generate_order_key (MAX(${relation.their.positionColumn}), NULL)
                FROM
                    ${joinTable.tableRef}
                WHERE
                    ${relation.their.rowIdColumn} = ${linkedRowId}
                ORDER BY
                    ${relation.their.positionColumn} DESC
                LIMIT
                    1
            `.selectValue(db, Schema.string);

            sql`
                INSERT OR IGNORE INTO
                    ${joinTable.tableRef} (
                        ${relation.our.rowIdColumn},
                        ${relation.their.rowIdColumn},
                        ${relation.our.positionColumn},
                        ${relation.their.positionColumn}
                    )
                VALUES
                    (
                        ${rowId},
                        ${linkedRowId},
                        ${ourPosition},
                        ${theirPosition}
                    )
            `.exec(db);

            return {};
        },
    }),

    removeLink: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            rowId: Schema.id<DatabaseRowId>(),
            linkedRowId: Schema.id<DatabaseRowId>(),
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({db, model}, {tableId, fieldId, rowId, linkedRowId}) {
            const table = model.getTable(tableId);
            const field = table.getField(fieldId);
            assert(field.isType("relation"));
            const provider = getDatabaseFieldProvider(field.config.type);
            const relation = provider.resolveRelation(field);

            sql`
                DELETE FROM ${relation.joinTable.tableRef}
                WHERE
                    ${relation.our.rowIdColumn} = ${rowId}
                    AND ${relation.their.rowIdColumn} = ${linkedRowId}
            `.exec(db);

            return {};
        },
    }),

    listLinkableRows: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            rowId: Schema.id<DatabaseRowId>(),
        }),
        output: Schema.object({
            rows: Schema.array(
                Schema.object({
                    id: Schema.id<DatabaseRowId>(),
                    name: Schema.string.nullable(),
                }),
            ),
        }),
        writeLevel: "none",
        run({db, model}, {tableId, fieldId, rowId}) {
            const table = model.getTable(tableId);
            const field = table.getField(fieldId);
            assert(field.isType("relation"));
            const provider = getDatabaseFieldProvider(field.config.type);
            const relation = provider.resolveRelation(field);

            assert(table.rowExists(rowId), "row not found");

            const linkedTable = model.getTable(relation.linkedTableId);
            const linkedNameField = linkedTable.getNameField();
            const linkedNameProvider = getUnknownDatabaseFieldProvider(linkedNameField.config.type);
            const linkedNameColumn = linkedNameProvider.selectColumn(
                linkedNameField,
                sql.identifier("linked_row"),
            );

            const rows = sql`
                SELECT
                    linked_row._id AS id,
                    ${linkedNameColumn} AS name
                FROM
                    ${linkedTable.tableRef} AS linked_row
                WHERE
                    NOT EXISTS (
                        SELECT
                            1
                        FROM
                            ${relation.joinTable.tableRef} link_row
                        WHERE
                            link_row.${relation.our.rowIdColumn} = ${rowId}
                            AND link_row.${relation.their.rowIdColumn} = linked_row._id
                    )
                ORDER BY
                    linked_row._created_at DESC,
                    linked_row._id DESC
            `.selectAll(db, {
                id: Schema.id<DatabaseRowId>(),
                name: linkedNameProvider.sqlValueSchema ?? linkedNameProvider.valueSchema,
            });

            return {
                rows: rows.map(row => ({
                    id: row.id,
                    name: linkedNameProvider.valueToString(row.name, linkedNameField.config),
                })),
            };
        },
    }),

    updateFieldConfig: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            config: DatabaseFieldConfigSchema,
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({model}, {tableId, fieldId, config}) {
            const table = model.getTable(tableId);
            const field = table.getField(fieldId);

            assert(
                field.config.type === config.type,
                `cannot change field type from ${field.config.type} to ${config.type}`,
            );
            const provider = getUnknownDatabaseFieldProvider(field.config.type);
            provider.assertConfigChangeValid?.(field.config, config);

            field.updateConfig(config);

            return {};
        },
    }),

    resizeField: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            viewId: Schema.id<DatabaseViewId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            width: Schema.integer,
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({model}, {tableId, viewId, fieldId, width}) {
            const table = model.getTable(tableId);
            const view = table.getView(viewId);
            const field = table.getField(fieldId);
            view.updateFieldWidth(field, width);
            return {};
        },
    }),

    updateFieldViewVisibility: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            viewId: Schema.id<DatabaseViewId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            position: OrderKeySchema,
            isVisible: Schema.boolean,
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({model}, {tableId, viewId, fieldId, position, isVisible}) {
            const table = model.getTable(tableId);
            const view = table.getView(viewId);
            const field = table.getField(fieldId);
            view.updateFieldVisibility(field, isVisible, position);
            return {};
        },
    }),

    renameField: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            name: LabelStringSchema,
        }),
        output: Schema.object({}),
        writeLevel: "schema+data",
        run({model}, {tableId, fieldId, name}) {
            const table = model.getTable(tableId);
            const existingField = table.getField(fieldId);
            existingField.updateName(name);

            return {};
        },
    }),
};

// -- Derived types -----------------------------------------------------------

export type DatabaseActionName = keyof typeof databaseActions;

export type DatabaseActionInput<N extends DatabaseActionName> = SchemaType<
    (typeof databaseActions)[N]["input"]
>;

export type DatabaseActionOutput<N extends DatabaseActionName> = SchemaType<
    (typeof databaseActions)[N]["output"]
>;

export type DatabaseActionObject<N extends DatabaseActionName = DatabaseActionName> = {
    [K in DatabaseActionName]: {name: K; input: DatabaseActionInput<K>};
}[N];

export type DatabaseActionResult<N extends DatabaseActionName = DatabaseActionName> = {
    [K in DatabaseActionName]: {name: K; output: DatabaseActionOutput<K>};
}[N];

// -- Derived schemas ---------------------------------------------------------

/**
 * Schema for action request objects: `{name, input}`. Discriminated union keyed on
 * `name`.
 */
export const DatabaseActionObjectSchema = Schema.unionWithKey(
    "name",
    Object.fromEntries(
        Object.entries(databaseActions).map(([name, def]) => [
            name,
            Schema.object({name: Schema.value(name), input: def.input}),
        ]),
    ) as {
        [K in DatabaseActionName]: ObjectSchema<{
            readonly name: K;
            readonly input: DatabaseActionInput<K>;
        }>;
    },
);

/**
 * Schema for action result objects: `{name, output}`. Discriminated union keyed on
 * `name`.
 */
export const DatabaseActionResultSchema = Schema.unionWithKey(
    "name",
    Object.fromEntries(
        Object.entries(databaseActions).map(([name, def]) => [
            name,
            Schema.object({name: Schema.value(name), output: def.output}),
        ]),
    ) as {
        [K in DatabaseActionName]: ObjectSchema<{
            readonly name: K;
            readonly output: DatabaseActionOutput<K>;
        }>;
    },
);
