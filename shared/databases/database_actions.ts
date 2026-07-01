import {DatabaseFieldSchema, DatabaseSchema} from "~/shared/databases/database_schema.js";
import {
    type DatabaseFieldConfig,
    DatabaseFieldConfigSchema,
    DatabaseFieldConfigSqlSchema,
    type DatabaseFieldType,
    DatabaseFieldTypeSchema,
    getDatabaseFieldProvider,
} from "~/shared/databases/fields/database_field_providers.js";
import {DatabaseRelationValueSchema} from "~/shared/databases/fields/database_relation_field.js";
import {formatUniqueSqlName} from "~/shared/databases/internal/format_unique_sql_name.js";
import {
    DatabaseFieldRow,
    DatabaseViewFieldRow,
} from "~/shared/databases/schema/database_row_schemas.js";
import {SqlBooleanSchema, SqlJsonSchema} from "~/shared/databases/schema/sqlite_schema.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
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
    schema: DatabaseSchema;
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
    serverOnly: boolean;
    run: (ctx: DatabaseActionContext, input: Input) => Output;
} {
    return {serverOnly: false, ...def};
}

/**
 * Add a field to an existing table: resolves the table name, generates a unique
 * column name, computes the next view position, inserts metadata into
 * `_alpine_fields` and `_alpine_view_fields`, then runs `ALTER TABLE ADD COLUMN`
 * with the appropriate type affinity and CHECK constraint.
 */
function createField(
    schema: DatabaseSchema,
    {
        fieldId,
        tableId,
        viewId,
        name,
        type,
    }: {
        fieldId: DatabaseFieldId;
        tableId: DatabaseTableId;
        viewId: DatabaseViewId;
        name: string;
        type: DatabaseFieldType;
    },
): void {
    const provider = getDatabaseFieldProvider(type);
    const fieldConfig = provider.getDefaultConfig();
    const columnName = createFieldMetadata(schema, {
        fieldId,
        tableId,
        viewIds: [viewId],
        name,
        config: fieldConfig,
    });
    if (provider.storage === "virtual") return;

    const tableName = schema.getTable(tableId).name;

    const {sqliteType, defaultValue, nullable, generateCheckConstraint} = provider;
    const notNullClause = nullable ? sql.raw("") : sql.raw("NOT NULL");

    sql`
        ALTER TABLE ${sql.tableRef(tableId, tableName)}
        ADD COLUMN ${sql.identifier(columnName)} ${sql.raw(sqliteType)}_alpine_${sql.raw(
            fieldId,
        )} ${notNullClause} DEFAULT ${sql.raw(defaultValue)} ${generateCheckConstraint(columnName)}
    `.exec(schema.db);
}

function createFieldMetadata(
    schema: DatabaseSchema,
    {
        fieldId,
        tableId,
        viewIds,
        name,
        config,
    }: {
        fieldId: DatabaseFieldId;
        tableId: DatabaseTableId;
        viewIds: ReadonlyArray<DatabaseViewId>;
        name: string;
        config: DatabaseFieldConfig;
    },
): string {
    const existingColumnNames = new Set(
        sql`
            SELECT
                column_name
            FROM
                ${sql.tableRef(tableId, "_alpine_fields")}
            WHERE
                table_id = ${tableId}
        `
            .selectAll(schema.db, {columnName: Schema.string.originalPropertyKey("column_name")})
            .map(row => row.columnName),
    );
    const columnName = formatUniqueSqlName(name, existingColumnNames);

    const fieldConfig = DatabaseFieldConfigSqlSchema.serialize(config);

    sql`
        INSERT INTO
            ${sql.tableRef(tableId, "_alpine_fields")} (id, table_id, name, column_name, config)
        VALUES
            (
                ${fieldId},
                ${tableId},
                ${name},
                ${columnName},
                jsonb (${fieldConfig})
            )
    `.exec(schema.db);

    for (const viewId of viewIds) {
        insertFieldIntoView(schema, {tableId, viewId, fieldId});
    }

    return columnName;
}

function insertFieldIntoView(
    schema: DatabaseSchema,
    {
        tableId,
        viewId,
        fieldId,
    }: {
        tableId: DatabaseTableId;
        viewId: DatabaseViewId;
        fieldId: DatabaseFieldId;
    },
): void {
    const maxPosition = sql`
        SELECT
            MAX(position)
        FROM
            ${sql.tableRef(tableId, "_alpine_view_fields")}
        WHERE
            view_id = ${viewId}
    `.selectValue(schema.db, Schema.string.nullable());

    sql`
        INSERT INTO
            ${sql.tableRef(tableId, "_alpine_view_fields")} (view_id, field_id, position, width)
        VALUES
            (
                ${viewId},
                ${fieldId},
                generate_order_key (${maxPosition}, NULL),
                ${databaseViewDefaultColumnWidth}
            )
    `.exec(schema.db);
}

function formatUniqueFieldName(name: string, existing: ReadonlySet<string>): string {
    if (!existing.has(name)) return name;
    for (let i = 2; ; i++) {
        const candidate = `${name} ${i}`;
        if (!existing.has(candidate)) return candidate;
    }
}

type DatabaseNameFieldReference = {
    tableName: string;
    columnName: string;
    config: DatabaseFieldConfig;
};

function readNameFieldReference(
    db: SqliteDatabase,
    tableId: DatabaseTableId,
): DatabaseNameFieldReference {
    const table = sql`
        SELECT
            table_name,
            name_field_id
        FROM
            ${sql.tableRef(tableId, "_alpine_table")}
        WHERE
            id = ${tableId}
    `.selectOne(db, {
        tableName: Schema.string.originalPropertyKey("table_name"),
        nameFieldId: Schema.id<DatabaseFieldId>().nullable().originalPropertyKey("name_field_id"),
    });
    assert(table.nameFieldId !== null, "table has no name field");

    const field = sql`
        SELECT
            column_name,
            config
        FROM
            ${sql.tableRef(tableId, "_alpine_fields")}
        WHERE
            id = ${table.nameFieldId}
    `.selectOne(db, {
        columnName: Schema.string.originalPropertyKey("column_name"),
        config: DatabaseFieldConfigSqlSchema,
    });

    return {tableName: table.tableName, columnName: field.columnName, config: field.config};
}

type DatabaseRelationProjection = {
    fieldIndex: number;
    nameFieldConfig: DatabaseFieldConfig;
};

function createRelationProjection(
    field: DatabaseFieldSchema,
    {
        rowAlias,
        fieldIndex,
    }: {
        rowAlias: string;
        fieldIndex: number;
    },
): {sql: SqlQuery; projection: DatabaseRelationProjection} {
    assert(field.config.type === "relation", "field is not a relation field");
    const relation = field.resolveRelation();
    const linkedTable = field.schema.getTable(relation.linkedTableId);
    const linkedNameField = linkedTable.getNameField();
    assert(
        linkedNameField.getProvider().storage === "column",
        "record-name field must be column-backed",
    );

    const projectionSql = sql`
        (
            SELECT
                COALESCE(
                    JSONB_GROUP_ARRAY (
                        JSONB_OBJECT (
                            'id',
                            linked_row._id,
                            'name',
                            ${sql.identifier("linked_row", linkedNameField.columnName)}
                        )
                        ORDER BY
                            link_row._created_at,
                            link_row.rowid
                    ),
                    '[]'
                )
            FROM
                ${sql.tableRef(relation.joinTable.id, "_alpine_links")} link_row
                JOIN ${linkedTable.identifier()} linked_row ON linked_row._id = ${sql.identifier(
            "link_row",
            relation.theirColumnName,
        )}
            WHERE
                ${sql.identifier("link_row", relation.ourColumnName)} = ${sql.identifier(
            rowAlias,
            "_id",
        )}
        )
    `;

    return {
        sql: projectionSql,
        projection: {fieldIndex, nameFieldConfig: linkedNameField.config},
    };
}

function assertRelationFieldConfigUpdate(
    existingConfig: DatabaseFieldConfig,
    nextConfig: DatabaseFieldConfig,
): void {
    if (existingConfig.type !== "relation") return;
    assert(nextConfig.type === "relation", "relation field config type must stay relation");
    assert(
        nextConfig.joinTableId === existingConfig.joinTableId,
        "cannot update relation field joinTableId",
    );
    assert(nextConfig.side === existingConfig.side, "cannot update relation field side");
    assert(
        nextConfig.linkedTableId === existingConfig.linkedTableId,
        "cannot update relation field linkedTableId",
    );
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
        // Server-only so it can mint ids internally and attach a brand-new per-db file
        // without client/server divergence; the client routes this to the server.
        serverOnly: true,
        run({db, server, schema}, {name}) {
            assert(server !== null, "createTable is server-only");
            const tableId = generateChronologicalId<DatabaseTableId>();
            const viewId = generateChronologicalId<DatabaseViewId>();
            const fieldId = generateChronologicalId<DatabaseFieldId>();

            // Attach + migrate the new per-db file before writing any of the table's data or
            // metadata into it. `attach` is a no-op if already attached.
            server.attach(tableId);
            runTableMigrations(db, tableId);

            // Public main database: ID-only registry + routing.
            sql`
                INSERT INTO
                    _alpine_tables (id)
                VALUES
                    (${tableId})
            `.exec(db);
            sql`
                INSERT INTO
                    _alpine_views (id, table_id)
                VALUES
                    (
                        ${viewId},
                        ${tableId}
                    )
            `.exec(db);

            // SQLite identifier for the data table. It only has to be unique within this
            // table's own file, and `formatUniqueSqlName` strips leading underscores so it can
            // never collide with the `_alpine_*` metadata tables.
            const tableName = formatUniqueSqlName(name, new Set());

            // Real, table-scoped metadata lives in the per-db file, never in the public main
            // database.
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, "_alpine_table")} (id, name, table_name, name_field_id)
                VALUES
                    (
                        ${tableId},
                        ${name},
                        ${tableName},
                        ${fieldId}
                    )
            `.exec(db);
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, "_alpine_views")} (id, table_id, name)
                VALUES
                    (
                        ${viewId},
                        ${tableId},
                        ${"Grid view"}
                    )
            `.exec(db);

            sql`
                CREATE TABLE ${sql.tableRef(tableId, tableName)} (
                    _id TEXT PRIMARY KEY DEFAULT (generate_id ()),
                    _created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
                    CHECK (is_id (_id)),
                    CHECK (DATETIME(_created_at) IS NOT NULL)
                ) WITHOUT ROWID
            `.exec(db);

            createField(schema, {fieldId, tableId, viewId, name: "Name", type: "plainText"});

            sql`
                CREATE INDEX ${sql.tableRef(
                    tableId,
                    `_alpine_index_${tableId}_created_at`,
                )} ON ${sql.identifier(tableName)} (_created_at)
            `.exec(db);

            return {tableId, tableName, viewId};
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
        run({db, schema}, {tableId, name}) {
            const existing = schema.getTable(tableId);

            // The identifier only has to be unique within this table's own file, so there are
            // no other names to avoid.
            const tableName = formatUniqueSqlName(name, new Set());

            if (tableName !== existing.tableName) {
                sql`
                    ALTER TABLE ${sql.tableRef(tableId, existing.tableName)}
                    RENAME TO ${sql.identifier(tableName)}
                `.exec(db);
            }

            sql`
                UPDATE ${sql.tableRef(tableId, "_alpine_table")}
                SET
                    name = ${name},
                    table_name = ${tableName}
                WHERE
                    id = ${tableId}
            `.exec(db);

            return {tableName};
        },
    }),

    listTableIds: defineDatabaseAction({
        input: Schema.object({}),
        output: Schema.object({
            tableIds: Schema.array(Schema.id<DatabaseTableId>()),
        }),
        writeLevel: "none",
        run({schema}) {
            return {tableIds: schema.getTableIds()};
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
        run({schema}) {
            return {
                tables: schema.getTableIds().map(tableId => ({
                    id: tableId,
                    name: schema.getTable(tableId).name,
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
        run({db, schema}, {tableOrViewId}) {
            const {table, view} = schema.resolveTableOrViewId(tableOrViewId);

            const fields = sql`
                SELECT
                    f.id,
                    f.name,
                    f.column_name,
                    f.config,
                    vf.position,
                    vf.width,
                    vf.hidden
                FROM
                    ${sql.tableRef(table.id, "_alpine_view_fields")} vf
                    JOIN ${sql.tableRef(table.id, "_alpine_fields")} f ON f.id = vf.field_id
                WHERE
                    vf.view_id = ${view.id}
                ORDER BY
                    vf.position
            `.selectAll(db, {
                id: DatabaseFieldRow.id,
                name: DatabaseFieldRow.name,
                columnName: DatabaseFieldRow.columnName,
                config: DatabaseFieldRow.config,
                position: DatabaseViewFieldRow.position,
                width: DatabaseViewFieldRow.width,
                hidden: DatabaseViewFieldRow.hidden,
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
        run({db, schema}, {tableOrViewId, afterCursor, limit}) {
            const {table, view} = schema.resolveTableOrViewId(tableOrViewId);

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
                    ${table.identifier()} ${whereClause}
                ORDER BY
                    _id
                LIMIT
                    ${limit}
            `.selectAll(db, {
                id: Schema.id<DatabaseRowId>().originalPropertyKey("_id"),
            });
            const endCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;

            return {tableId: table.id, viewId: view.id, tableName: table.name, endCursor};
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
        run({db, schema}, {tableOrViewId, afterCursor, endCursor}) {
            const {table, view} = schema.resolveTableOrViewId(tableOrViewId);

            const fields = view.getFields();

            // \_id is always at index 0; view fields start at 1.
            const selectColumns = [sql.identifier("_alpine_data_row", "_id")];
            const fieldIndexes = new Map<DatabaseFieldId, number>();
            for (let i = 0; i < fields.length; i++) {
                const fieldIndex = i + 1;
                fieldIndexes.set(fields[i]!.id, fieldIndex);
                const field = fields[i]!;
                if (field.config.type === "relation") {
                    const {sql: projectionSql} = createRelationProjection(field, {
                        rowAlias: "_alpine_data_row",
                        fieldIndex,
                    });
                    return projectionSql;
                }
                return sql.identifier("_alpine_data_row", field.columnName);
            }
            const selectList = sql.raw(selectColumns.map(c => c.query).join(", "));

            // Build a schema tuple matching the SELECT list so raw SQL values are deserialized
            // through each field's sqlValueSchema (e.g. INTEGER → boolean for checkboxes).
            const columnSchemas: Array<Schema<any>> = [
                Schema.id<DatabaseRowId>(),
                ...fields.map(f => {
                    const provider = getDatabaseFieldProvider(f.config.type);
                    if (f.config.type === "relation")
                        return SqlJsonSchema(DatabaseRelationValueSchema);
                    assert(
                        provider.storage === "column",
                        `virtual field ${f.id} is not implemented in getViewRowsPage`,
                    );
                    return provider.sqlValueSchema;
                }),
            ];

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
                    ${table.identifier()} AS ${sql.identifier("_alpine_data_row")} ${whereClause}
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
        run({db, schema}, {tableId, fieldId, rowId, value}) {
            const table = schema.getTable(tableId);
            const field = table.getField(fieldId);
            const provider = field.getProvider();
            assert(
                provider.storage === "column",
                `cannot update virtual field ${fieldId} with updateCellValue`,
            );
            sql`
                UPDATE ${table.identifier()}
                SET
                    ${sql.identifier(field.columnName)} = ${provider.sqlValueSchema.serialize(
                    value,
                )}
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
        run({db, schema}, {tableId, rowId}) {
            const table = schema.getTable(tableId);
            sql`
                INSERT INTO
                    ${table.identifier()} (_id)
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
            viewId: Schema.id<DatabaseViewId>(),
            name: LabelStringSchema,
            type: DatabaseFieldTypeSchema,
        }),
        output: Schema.object({}),
        writeLevel: "schema+data",
        run({schema}, {fieldId, tableId, viewId, name, type}) {
            assert(type !== "relation", "use createRelationField to create relation fields");
            createField(schema, {fieldId, tableId, viewId, name, type});
            return {};
        },
    }),

    createRelationField: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            viewId: Schema.id<DatabaseViewId>(),
            name: LabelStringSchema,
            linkedTableId: Schema.id<DatabaseTableId>(),
            cardinality: Schema.enum(["one", "many"]),
        }),
        output: Schema.object({
            joinTableId: Schema.id<DatabaseTableId>(),
            sourceFieldId: Schema.id<DatabaseFieldId>(),
            targetFieldId: Schema.id<DatabaseFieldId>(),
        }),
        writeLevel: "schema+data",
        serverOnly: true,
        run({db, schema, server}, {tableId, viewId, name, linkedTableId, cardinality}) {
            assert(server !== null, "createRelationField is server-only");
            const sourceTable = schema.getTable(tableId);
            const linkedTable = schema.getTable(linkedTableId);

            const joinTableId = generateChronologicalId<DatabaseTableId>();
            const sourceFieldId = generateChronologicalId<DatabaseFieldId>();
            const targetFieldId = generateChronologicalId<DatabaseFieldId>();

            server.attach(joinTableId);
            runJoinTableMigrations(db, joinTableId);

            sql`
                INSERT INTO
                    _alpine_tables (id, kind)
                VALUES
                    (${joinTableId}, 'join')
            `.exec(db);
            sql`
                INSERT INTO
                    ${sql.tableRef(joinTableId, "_alpine_join_table")} (
                        id,
                        source_table_id,
                        source_field_id,
                        target_table_id,
                        target_field_id
                    )
                VALUES
                    (
                        ${joinTableId},
                        ${tableId},
                        ${sourceFieldId},
                        ${linkedTableId},
                        ${targetFieldId}
                    )
            `.exec(db);

            createFieldMetadata(schema, {
                fieldId: sourceFieldId,
                tableId,
                viewIds: [viewId],
                name,
                config: {
                    type: "relation",
                    joinTableId,
                    side: "source",
                    cardinality,
                    linkedTableId,
                },
            });

            const existingTargetFieldNames = new Set(
                sql`
                    SELECT
                        name
                    FROM
                        ${sql.tableRef(linkedTableId, "_alpine_fields")}
                `.selectValues(db, Schema.string),
            );
            const targetName = formatUniqueFieldName(sourceTable.name, existingTargetFieldNames);
            const targetViewIds = sql`
                SELECT
                    id
                FROM
                    ${sql.tableRef(linkedTableId, "_alpine_views")}
                ORDER BY
                    id
            `.selectValues(db, Schema.id<DatabaseViewId>());

            createFieldMetadata(schema, {
                fieldId: targetFieldId,
                tableId: linkedTableId,
                viewIds: targetViewIds,
                name: targetName,
                config: {
                    type: "relation",
                    joinTableId,
                    side: "target",
                    cardinality: "many",
                    linkedTableId: tableId,
                },
            });

            return {joinTableId, sourceFieldId, targetFieldId};
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
        run({db, schema}, {tableId, fieldId, rowId, linkedRowId}) {
            const table = schema.getTable(tableId);
            const relation = table.getField(fieldId).resolveRelation();
            const linkedTable = schema.getTable(relation.linkedTableId);

            assert(table.rowExists(rowId), "row not found");
            assert(linkedTable.rowExists(linkedRowId), "linked row not found");

            if (relation.config.cardinality === "one") {
                sql`
                    DELETE FROM ${sql.tableRef(relation.joinTable.id, "_alpine_links")}
                    WHERE
                        ${sql.identifier("_alpine_links", relation.ourColumnName)} = ${rowId}
                        AND ${sql.identifier(
                        "_alpine_links",
                        relation.theirColumnName,
                    )} != ${linkedRowId}
                `.exec(db);
            }

            sql`
                INSERT OR IGNORE INTO
                    ${sql.tableRef(relation.joinTable.id, "_alpine_links")} (
                        ${sql.identifier(relation.ourColumnName)},
                        ${sql.identifier(relation.theirColumnName)}
                    )
                VALUES
                    (
                        ${rowId},
                        ${linkedRowId}
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
        run({db, schema}, {tableId, fieldId, rowId, linkedRowId}) {
            const table = schema.getTable(tableId);
            const relation = table.getField(fieldId).resolveRelation();

            sql`
                DELETE FROM ${sql.tableRef(relation.joinTable.id, "_alpine_links")}
                WHERE
                    ${sql.identifier("_alpine_links", relation.ourColumnName)} = ${rowId}
                    AND ${sql.identifier(
                    "_alpine_links",
                    relation.theirColumnName,
                )} = ${linkedRowId}
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
        run({db, schema}, {tableId, fieldId, rowId}) {
            const table = schema.getTable(tableId);
            const relation = table.getField(fieldId).resolveRelation();

            assert(table.rowExists(rowId), "row not found");

            const linkedTable = schema.getTable(relation.linkedTableId);
            const linkedNameField = readNameFieldReference(db, relation.linkedTableId);
            const linkedNameProvider = linkedTable.getNameField().getProvider();
            assert(
                linkedNameProvider.storage === "column",
                "record-name field must be column-backed",
            );

            const rows = sql`
                SELECT
                    linked_row._id,
                    ${sql.identifier("linked_row", linkedNameField.columnName)} AS name_value
                FROM
                    ${sql.tableRef(
                    relation.linkedTableId,
                    linkedNameField.tableName,
                )} AS ${sql.identifier("linked_row")}
                WHERE
                    NOT EXISTS (
                        SELECT
                            1
                        FROM
                            ${sql.tableRef(relation.joinTable.id, "_alpine_links")} link_row
                        WHERE
                            ${sql.identifier("link_row", relation.ourColumnName)} = ${rowId}
                            AND ${sql.identifier(
                    "link_row",
                    relation.theirColumnName,
                )} = linked_row._id
                    )
                ORDER BY
                    linked_row._created_at DESC,
                    linked_row._id DESC
            `.selectAll(db, {
                id: Schema.id<DatabaseRowId>().originalPropertyKey("_id"),
                nameValue: linkedNameProvider.sqlValueSchema.originalPropertyKey("name_value"),
            });

            return {
                rows: rows.map(row => ({
                    id: row.id,
                    name: linkedNameProvider.formatString(row.nameValue, linkedNameField.config),
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
        run({db, schema}, {tableId, fieldId, config}) {
            const table = schema.getTable(tableId);
            const existing = table.getField(fieldId);

            assert(
                existing.config.type === config.type,
                `cannot change field type from ${existing.config.type} to ${config.type}`,
            );

            assertRelationFieldConfigUpdate(existing.config, config);

            sql`
                UPDATE ${sql.tableRef(tableId, "_alpine_fields")}
                SET
                    config = jsonb (${DatabaseFieldConfigSqlSchema.serialize(config)})
                WHERE
                    id = ${fieldId}
            `.exec(db);
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
        run({db, schema}, {tableId, viewId, fieldId, width}) {
            schema.getTable(tableId).getField(fieldId);
            sql`
                UPDATE ${sql.tableRef(tableId, "_alpine_view_fields")}
                SET
                    width = ${width}
                WHERE
                    view_id = ${viewId}
                    AND field_id = ${fieldId}
            `.exec(db);
            return {};
        },
    }),

    updateFieldViewVisibility: defineDatabaseAction({
        input: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            viewId: Schema.id<DatabaseViewId>(),
            fieldId: Schema.id<DatabaseFieldId>(),
            position: OrderKeySchema,
            isHidden: Schema.boolean,
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({db, schema}, {tableId, viewId, fieldId, position, isHidden}) {
            schema.getTable(tableId).getField(fieldId);
            sql`
                INSERT INTO
                    ${sql.tableRef(
                    tableId,
                    "_alpine_view_fields",
                )} (view_id, field_id, position, width, hidden)
                VALUES
                    (
                        ${viewId},
                        ${fieldId},
                        ${position},
                        ${databaseViewDefaultColumnWidth},
                        ${isHidden}
                    )
                ON CONFLICT (view_id, field_id) DO UPDATE
                SET
                    position = ${position},
                    hidden = ${isHidden}
            `.exec(db);
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
        run({db, schema}, {tableId, fieldId, name}) {
            const table = schema.getTable(tableId);
            const existingField = table.getField(fieldId);
            const provider = existingField.getProvider();

            const existingColumnNames = new Set(
                sql`
                    SELECT
                        column_name
                    FROM
                        ${sql.tableRef(tableId, "_alpine_fields")}
                    WHERE
                        id != ${fieldId}
                `.selectValues(db, Schema.string),
            );
            const newColumnName = formatUniqueSqlName(name, existingColumnNames);

            sql`
                UPDATE ${sql.tableRef(tableId, "_alpine_fields")}
                SET
                    name = ${name},
                    column_name = ${newColumnName}
                WHERE
                    id = ${fieldId}
            `.exec(db);

            if (provider.storage === "virtual") return {};

            sql`
                ALTER TABLE ${table.identifier()}
                RENAME COLUMN ${sql.identifier(existingField.columnName)} TO ${sql.identifier(
                    newColumnName,
                )}
            `.exec(db);

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
