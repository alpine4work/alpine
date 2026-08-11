import {
    type AccessLevel,
    LocalAccessPolicySchema,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import type {
    DatabaseActionContext,
    DatabaseActionServerContext,
} from "~/shared/databases/database_action_context.js";
import {DatabaseActionRequiresServerError} from "~/shared/databases/database_action_requires_server_error.js";
import {DatabaseTableAccessPolicyRevisionSchema} from "~/shared/databases/database_table_access_policy_revision.js";
import {executeSqliteTransaction} from "~/shared/databases/execute_sqlite_transaction.js";
import {
    DatabaseFieldConfigSchema,
    assertDatabaseFieldConfigChangeValid,
    databaseFieldColumn,
    databaseFieldSqlValueSchema,
    databaseFieldValueToSql,
    databaseFieldValueToString,
    parseDatabaseFieldValueString,
    selectDatabaseFieldColumn,
    unknownDatabaseFieldValueToSql,
} from "~/shared/databases/fields/all_database_field_providers.js";
import {resolveDatabaseRelation} from "~/shared/databases/fields/database_relation_field.js";
import {formatUniqueTableName} from "~/shared/databases/format_unique_table_name.js";
import {insertJoinLink} from "~/shared/databases/insert_join_link.js";
import {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import {SqlBooleanSchema} from "~/shared/databases/model/sqlite_schema.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {runJoinTableMigrations, runTableMigrations} from "~/shared/databases/sqlite_migrations.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {
    type ObjectSchema,
    Schema,
    type SchemaSerializedValue,
    type SchemaType,
} from "~/shared/schema/schema.open_source.js";

export function createDatabaseActionContext(
    db: SqliteDatabase,
    server: DatabaseActionServerContext | null,
    getTableAccessLevel: (tableId: DatabaseTableId) => AccessLevel | null,
): DatabaseActionContext {
    return new DatabaseModel(db, server, getTableAccessLevel).ctx;
}

/**
 * Defines a database action with typed input/output schemas, a write level, and a
 * shared `run()` function that executes on both client and server.
 *
 * `internalOnly` actions may only be executed by internal server code. Public
 * client transports must reject them.
 */
function defineDatabaseAction<Input, Output>(def: {
    input: ObjectSchema<Input>;
    output: ObjectSchema<Output>;
    writeLevel: SqliteWriteLevel;
    internalOnly?: boolean;
    run: (ctx: DatabaseActionContext, input: Input) => Output;
}): {
    input: ObjectSchema<Input>;
    output: ObjectSchema<Output>;
    writeLevel: SqliteWriteLevel;
    internalOnly: boolean;
    run: (ctx: DatabaseActionContext, input: Input) => Output;
} {
    return {
        internalOnly: false,
        ...def,
    };
}

function now() {
    if (typeof performance === "undefined") {
        return Date.now();
    }
    return performance.now();
}

export function executeDatabaseAction<N extends DatabaseActionName>(
    actionObject: DatabaseActionObject<N>,
    ctx: DatabaseActionContext,
): DatabaseActionOutput<N>;
export function executeDatabaseAction(
    actionObject: DatabaseActionObject,
    ctx: DatabaseActionContext,
): DatabaseActionOutput<DatabaseActionName> {
    const action = databaseActions[actionObject.name];

    const start = now();
    try {
        // eslint-disable-next-line no-console
        console.group(`[executeDatabaseAction] ${actionObject.name}`);
        const run = () => runDatabaseAction(actionObject, ctx);
        // Read-only actions run bare — each statement is its own implicit transaction.
        // Write actions commit atomically. Anything an action calls mid-run (`ATTACH`,
        // migrations) must therefore not open a transaction of its own.
        if (action.writeLevel === "none") {
            return run();
        }
        return executeSqliteTransaction(ctx.db, run);
    } catch (error) {
        if (error instanceof DatabaseActionRequiresServerError) {
            // eslint-disable-next-line no-console
            console.log(`[executeDatabaseAction] Falling back to server: ${error.reason}`);
        } else {
            // eslint-disable-next-line no-console
            console.log(
                `[executeDatabaseAction] Error: ${String((error as any).message ?? error)}`,
            );
        }
        throw error;
    } finally {
        // eslint-disable-next-line no-console
        console.log(`[executeDatabaseAction] Time: ${(now() - start).toFixed(2)}ms`);
        // eslint-disable-next-line no-console
        console.groupEnd();
    }
}

function runDatabaseAction(
    actionObject: DatabaseActionObject,
    ctx: DatabaseActionContext,
): DatabaseActionOutput<DatabaseActionName> {
    switch (actionObject.name) {
        case "rawSql":
            return databaseActions.rawSql.run(ctx, actionObject.input);
        case "readonlyRawSql":
            return databaseActions.readonlyRawSql.run(ctx, actionObject.input);
        case "createTable":
            return databaseActions.createTable.run(ctx, actionObject.input);
        case "syncTableMetadata":
            return databaseActions.syncTableMetadata.run(ctx, actionObject.input);
        case "listTableIds":
            return databaseActions.listTableIds.run(ctx, actionObject.input);
        case "listTables":
            return databaseActions.listTables.run(ctx, actionObject.input);
        case "getTableMetadata":
            return databaseActions.getTableMetadata.run(ctx, actionObject.input);
        case "getViewSchema":
            return databaseActions.getViewSchema.run(ctx, actionObject.input);
        case "getViewRowsPageCursor":
            return databaseActions.getViewRowsPageCursor.run(ctx, actionObject.input);
        case "getViewRowsPage":
            return databaseActions.getViewRowsPage.run(ctx, actionObject.input);
        case "updateCellValue":
            return databaseActions.updateCellValue.run(ctx, actionObject.input);
        case "createRow":
            return databaseActions.createRow.run(ctx, actionObject.input);
        case "createField":
            return databaseActions.createField.run(ctx, actionObject.input);
        case "createRelationField":
            return databaseActions.createRelationField.run(ctx, actionObject.input);
        case "addLink":
            return databaseActions.addLink.run(ctx, actionObject.input);
        case "removeLink":
            return databaseActions.removeLink.run(ctx, actionObject.input);
        case "listLinkableRows":
            return databaseActions.listLinkableRows.run(ctx, actionObject.input);
        case "listLinkedRows":
            return databaseActions.listLinkedRows.run(ctx, actionObject.input);
        case "moveLink":
            return databaseActions.moveLink.run(ctx, actionObject.input);
        case "createAndLinkRow":
            return databaseActions.createAndLinkRow.run(ctx, actionObject.input);
        case "updateFieldConfig":
            return databaseActions.updateFieldConfig.run(ctx, actionObject.input);
        case "resizeField":
            return databaseActions.resizeField.run(ctx, actionObject.input);
        case "updateFieldViewVisibility":
            return databaseActions.updateFieldViewVisibility.run(ctx, actionObject.input);
        case "renameField":
            return databaseActions.renameField.run(ctx, actionObject.input);
        default:
            throw exhaustive(actionObject);
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
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            name: LabelStringSchema,
            accessPolicy: LocalAccessPolicySchema,
            policyRevision: DatabaseTableAccessPolicyRevisionSchema,
        }),
        output: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            tableName: Schema.string,
            viewId: Schema.id<DatabaseViewId>(),
        }),
        writeLevel: "schema+data",
        internalOnly: true,
        run({db, server, model}, {tableId, name, accessPolicy, policyRevision}) {
            // Resolve the unique SQLite table name before registering the new table.
            const tableName = formatUniqueTableName({model, name});

            // Register the table, then attach + migrate its per-db file before writing any of
            // the table's data or metadata into it. `attach` is a no-op if already attached.
            model.registerTable(tableId, {kind: "table", tableName, accessPolicy});
            server().tables.setTableAccessPolicy(tableId, accessPolicy, policyRevision);
            server().attach(tableId);
            runTableMigrations(db, tableId);

            const {table, defaultView} = model.createTable(tableId, {name, tableName});

            return {tableId: table.id, tableName: table.tableName, viewId: defaultView.id};
        },
    }),

    syncTableMetadata: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            name: LabelStringSchema,
            accessPolicy: LocalAccessPolicySchema,
            policyRevision: DatabaseTableAccessPolicyRevisionSchema,
        }),
        output: Schema.object({
            tableName: Schema.string,
            viewId: Schema.id<DatabaseViewId>(),
        }),
        writeLevel: "schema+data",
        internalOnly: true,
        run({server, model}, {tableId, name, accessPolicy, policyRevision}) {
            const applied = server().tables.setTableAccessPolicy(
                tableId,
                accessPolicy,
                policyRevision,
            );
            const existingTable = model.getTable(tableId);
            if (!applied) {
                return {
                    tableName: existingTable.tableName,
                    viewId: existingTable.getFirstView().id,
                };
            }
            // Resolve the unique SQLite table name before renaming, excluding this table so a
            // rename to a slug variant of its current name resolves to that name.
            const tableName = formatUniqueTableName({
                model,
                name,
                excludeTableId: tableId,
            });
            const table = existingTable.updateName(name, {tableName});
            return {tableName: model.getTable(tableId).tableName, viewId: table.getFirstView().id};
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

    getTableMetadata: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
        }),
        output: Schema.object({
            table: Schema.object({
                id: Schema.id<DatabaseTableId>(),
                name: Schema.string,
                tableName: Schema.string,
                nameFieldId: Schema.id<DatabaseFieldId>(),
            }).nullable(),
        }),
        writeLevel: "none",
        run({model}, {tableId}) {
            const table = model.getTableIfExists(tableId);
            if (table === null) return {table: null};
            return {
                table: {
                    id: table.id,
                    name: table.name,
                    tableName: table.tableName,
                    nameFieldId: table.nameFieldId,
                },
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
                    linkedTableReadAccess: Schema.boolean.nullable(),
                }),
            ),
        }),
        writeLevel: "none",
        run({model, getTableAccessLevel}, {tableOrViewId}) {
            const {table, view} = model.resolveTableOrViewId(tableOrViewId);
            const fields = view.getFieldsWithViewMetadata().map(field => {
                const linkedTableReadAccess =
                    field.config.type === "relation"
                        ? hasAccessLevel(getTableAccessLevel(field.config.linkedTableId), "View")
                        : null;
                return {...field, linkedTableReadAccess};
            });

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
            const columnSchemas: Array<Pick<Schema<SchemaSerializedValue>, "deserialize">> = [
                Schema.id<DatabaseRowId>(),
            ];
            const fieldIndexes = new Map<DatabaseFieldId, number>();
            const dataRow = sql.identifier("_alpine_data_row");

            for (let i = 0; i < fields.length; i++) {
                const fieldIndex = i + 1;
                const field = assertExists(fields[i]);
                fieldIndexes.set(field.id, fieldIndex);

                selectColumns.push(selectDatabaseFieldColumn(field, dataRow));
                columnSchemas.push(databaseFieldSqlValueSchema(field.config.type));
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
            assert(
                databaseFieldColumn(field.config.type) != null,
                `cannot update virtual field ${fieldId} with updateCellValue`,
            );
            const valueSql = unknownDatabaseFieldValueToSql(field.config.type, value);
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
            joinTableId: Schema.id<DatabaseTableId>(),
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
        run(
            {db, model, server},
            {joinTableId, sourceTableId, sourceFieldName, targetTableId, cardinality},
        ) {
            const sourceTable = model.getTable(sourceTableId);
            const targetTable = model.getTable(targetTableId);

            const sourceFieldId = generateChronologicalId<DatabaseFieldId>();
            const targetFieldId = generateChronologicalId<DatabaseFieldId>();

            // The join table is named after its two relation fields, created below as
            // `sourceFieldName` and the source table's name. Resolved before the join table is
            // registered so the uniqueness probe doesn't see its own row.
            const joinTableName = formatUniqueTableName({
                model,
                name: `${sourceFieldName} ${sourceTable.name}`,
            });

            // Registering the topology first lets the authorizer derive the join schema's
            // access from its two sides while this action's own statements (migrations, the
            // `_alpine_join_table` insert) touch it.
            model.registerTable(joinTableId, {
                kind: "join",
                tableName: joinTableName,
                sourceTableId,
                targetTableId,
            });
            server().attach(joinTableId);
            runJoinTableMigrations(db, joinTableId);

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

            const joinTable = model.createJoinTable(sourceField, targetField, {
                tableName: joinTableName,
            });

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
            const relation = resolveDatabaseRelation(field);
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

            insertJoinLink({db, relation, rowId, linkedRowId});

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
            const relation = resolveDatabaseRelation(field);

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
            /**
             * Optional case-insensitive substring filter on the linked table's name field.
             * Wildcard characters are matched literally.
             */
            search: Schema.string.optional(),
        }),
        output: Schema.object({
            /** Display name of the linked table, shown in the picker header. */
            linkedTableName: Schema.string,
            rows: Schema.array(
                Schema.object({
                    id: Schema.id<DatabaseRowId>(),
                    name: Schema.string.nullable(),
                }),
            ),
        }),
        writeLevel: "none",
        run({db, model, getTableAccessLevel}, {tableId, fieldId, rowId, search}) {
            const table = model.getTable(tableId);
            const field = table.getField(fieldId);
            assert(field.isType("relation"));
            const relation = resolveDatabaseRelation(field);

            assert(table.rowExists(rowId), "row not found");

            if (!hasAccessLevel(getTableAccessLevel(relation.linkedTableId), "View")) {
                return {linkedTableName: "No access", rows: []};
            }
            const linkedTable = model.getTable(relation.linkedTableId);
            const linkedNameField = linkedTable.getNameField();
            const linkedNameColumn = selectDatabaseFieldColumn(
                linkedNameField,
                sql.identifier("linked_row"),
            );

            // Escape LIKE wildcards so the query is a literal substring match rather than
            // letting user input like `50%` behave as a pattern.
            const escapedSearch = search?.replace(/[\\%_]/g, char => `\\${char}`);
            const searchFilter =
                escapedSearch != null && escapedSearch !== ""
                    ? sql`AND ${linkedNameColumn} LIKE('%' || ${escapedSearch} || '%') ESCAPE '\\'`
                    : sql``;

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
                    ) ${searchFilter}
                ORDER BY
                    linked_row._created_at DESC,
                    linked_row._id DESC
            `.selectAll(db, {
                id: Schema.id<DatabaseRowId>(),
                name: databaseFieldSqlValueSchema(linkedNameField.config.type),
            });

            return {
                linkedTableName: linkedTable.name,
                rows: rows.map(row => ({
                    id: row.id,
                    name: databaseFieldValueToString(linkedNameField.config, row.name),
                })),
            };
        },
    }),

    listLinkedRows: defineDatabaseAction({
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
                    position: OrderKeySchema,
                }),
            ),
        }),
        writeLevel: "none",
        run({db, model, getTableAccessLevel}, {tableId, fieldId, rowId}) {
            const table = model.getTable(tableId);
            const field = table.getField(fieldId);
            assert(field.isType("relation"));
            const relation = resolveDatabaseRelation(field);

            assert(table.rowExists(rowId), "row not found");

            if (!hasAccessLevel(getTableAccessLevel(relation.linkedTableId), "View")) {
                const rows = sql`
                    SELECT
                        link_row.${relation.their.rowIdColumn} AS id,
                        link_row.${relation.our.positionColumn} AS position
                    FROM
                        ${relation.joinTable.tableRef} AS link_row
                    WHERE
                        link_row.${relation.our.rowIdColumn} = ${rowId}
                    ORDER BY
                        link_row.${relation.our.positionColumn}
                `.selectAll(db, {
                    id: Schema.id<DatabaseRowId>(),
                    position: OrderKeySchema,
                });
                return {rows: rows.map(row => ({...row, name: null}))};
            }
            const linkedTable = model.getTable(relation.linkedTableId);
            const linkedNameField = linkedTable.getNameField();
            const linkedNameColumn = selectDatabaseFieldColumn(
                linkedNameField,
                sql.identifier("linked_row"),
            );

            const rows = sql`
                SELECT
                    linked_row._id AS id,
                    ${linkedNameColumn} AS name,
                    link_row.${relation.our.positionColumn} AS position
                FROM
                    ${relation.joinTable.tableRef} AS link_row
                    JOIN ${linkedTable.tableRef} AS linked_row ON linked_row._id = link_row.${relation
                    .their.rowIdColumn}
                WHERE
                    link_row.${relation.our.rowIdColumn} = ${rowId}
                ORDER BY
                    link_row.${relation.our.positionColumn}
            `.selectAll(db, {
                id: Schema.id<DatabaseRowId>(),
                name: databaseFieldSqlValueSchema(linkedNameField.config.type),
                position: OrderKeySchema,
            });

            return {
                rows: rows.map(row => ({
                    id: row.id,
                    name: databaseFieldValueToString(linkedNameField.config, row.name),
                    position: row.position,
                })),
            };
        },
    }),

    moveLink: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            rowId: Schema.id<DatabaseRowId>(),
            linkedRowId: Schema.id<DatabaseRowId>(),
            /** New order key for this link on the edited row's side of the relation. */
            position: OrderKeySchema,
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({db, model}, {tableId, fieldId, rowId, linkedRowId, position}) {
            const table = model.getTable(tableId);
            const field = table.getField(fieldId);
            assert(field.isType("relation"));
            const relation = resolveDatabaseRelation(field);

            sql`
                UPDATE ${relation.joinTable.tableRef}
                SET
                    ${relation.our.positionColumn} = ${position}
                WHERE
                    ${relation.our.rowIdColumn} = ${rowId}
                    AND ${relation.their.rowIdColumn} = ${linkedRowId}
            `.exec(db);

            return {};
        },
    }),

    createAndLinkRow: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            rowId: Schema.id<DatabaseRowId>(),
            /** Id to assign the newly created row in the linked table. */
            linkedRowId: Schema.id<DatabaseRowId>(),
            /** Name to store in the linked table's name field for the new row. */
            name: Schema.string,
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({db, model}, {tableId, fieldId, rowId, linkedRowId, name}) {
            const table = model.getTable(tableId);
            const field = table.getField(fieldId);
            assert(field.isType("relation"));
            const relation = resolveDatabaseRelation(field);
            const linkedTable = model.getTable(relation.linkedTableId);

            assert(table.rowExists(rowId), "row not found");

            const linkedNameField = linkedTable.getNameField();
            const linkedNameColumn = databaseFieldColumn(linkedNameField.config.type);
            assert(
                linkedNameColumn != null,
                "linked table name field must be column-backed to create a row by name",
            );
            const parsedName = parseDatabaseFieldValueString(linkedNameField.config, name);
            const nameSql = parsedName.ok
                ? databaseFieldValueToSql(linkedNameField.config.type, parsedName.value)
                : linkedNameColumn.defaultValue;

            sql`
                INSERT INTO
                    ${linkedTable.tableRef} (_id, ${sql.identifier(linkedNameField.columnName)})
                VALUES
                    (
                        ${linkedRowId},
                        ${nameSql}
                    )
            `.exec(db);

            if (relation.config.cardinality === "one") {
                sql`
                    DELETE FROM ${relation.joinTable.tableRef}
                    WHERE
                        ${relation.our.rowIdColumn} = ${rowId}
                `.exec(db);
            }

            insertJoinLink({db, relation, rowId, linkedRowId});

            return {};
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
            assertDatabaseFieldConfigChangeValid(field.config, config);

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
