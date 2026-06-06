import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {
    DatabaseFieldConfigSchema,
    DatabaseFieldConfigSqlSchema,
    DatabaseFieldTypeSchema,
    getDatabaseFieldProvider,
} from "~/shared/databases/fields/database_field_providers.js";
import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_providers.js";
import {formatUniqueSqlName} from "~/shared/databases/internal/database_sql_helpers.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {runTableMigrations} from "~/shared/databases/sqlite_migrations.js";
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

// -- Helpers ------------------------------------------------------------------

/**
 * SQLite stores booleans as INTEGER 0/1 but
 * `Schema.boolean` expects a real boolean. This schema
 * migrates 0/1 on read and relies on the SQLite binding
 * layer converting `true`/`false` back to 1/0 on write.
 */
const sqlBoolean = Schema.boolean.migration({
    serialize: value => value,
    deserialize: value => (value === 1 ? true : value === 0 ? false : value),
});

// -- Row schema configs -------------------------------------------------------

/** Row config for a per-db file's singleton `_alpine_table`. */
const alpineTableConfig = {
    id: Schema.id<DatabaseTableId>(),
    name: Schema.string,
    tableName: Schema.string.originalPropertyKey("table_name"),
};

/**
 * Server-only capabilities. Present on the server, `null`
 * on the client — so client-side actions can't attach
 * per-table files.
 */
export interface DatabaseActionServerContext {
    /**
     * Attach a per-table database file (no-op if already
     * attached) so the action can create or write to it.
     * Used by server-only schema actions like
     * {@link databaseActions.createTable}.
     */
    attach(tableId: DatabaseTableId): void;
}

/** Context handed to a database action's `run()`. */
export interface DatabaseActionContext {
    /** The SQLite handle the action runs against. */
    db: Database;
    /** Server-only capabilities, or `null` on the client. */
    server: DatabaseActionServerContext | null;
}

/**
 * Defines a database action with typed input/output
 * schemas, a write level, and a shared `run()` function
 * that executes on both client and server.
 *
 * `serverOnly` actions never run optimistically on the
 * client; the client routes them straight to the server.
 * This lets them generate ids internally and attach new
 * per-table files without client/server divergence.
 */
function defineDatabaseAction<Input, Output>(def: {
    input: ObjectSchema<Input>;
    output: ObjectSchema<Output>;
    writeLevel: SqliteWriteLevel;
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
 * Reads a table's SQLite identifier (`table_name`) from its
 * own per-db file. The display name and identifier are
 * private and never live in the public main database.
 */
function readTableName(db: Database, tableId: DatabaseTableId): string {
    return sql`
        SELECT
            table_name
        FROM
            ${sql.tableRef(tableId, "_alpine_table")}
    `.selectValue(db, Schema.string);
}

/**
 * Resolves a `tableOrViewId` (which may be either a
 * table ID or a view ID) into the canonical triple of
 * `{tableId, viewId, tableName}`.
 *
 * A bare view ID is routed to its owning table through the
 * main database's ID-only `_alpine_views(id, table_id)`
 * routing index (the happy path after URL canonicalization);
 * the table's name then comes from its per-db file. A bare
 * table ID falls back to picking its first view from that
 * table's per-db file.
 */
function resolveTableOrViewId(
    db: Database,
    tableOrViewId: string,
): {tableId: DatabaseTableId; viewId: DatabaseViewId; tableName: string} {
    // Happy path: route the view ID to its table via the
    // main routing index (URLs canonicalize to view IDs).
    const routing = sql`
        SELECT
            table_id
        FROM
            _alpine_views
        WHERE
            id = ${tableOrViewId}
    `.selectOneOrNone(db, {
        tableId: Schema.id<DatabaseTableId>().originalPropertyKey("table_id"),
    });

    if (routing !== null) {
        return {
            tableId: routing.tableId,
            viewId: tableOrViewId as DatabaseViewId,
            tableName: readTableName(db, routing.tableId),
        };
    }

    // Fallback: resolve as a table ID and pick its first
    // view from that table's per-db file.
    const table = sql`
        SELECT
            id
        FROM
            _alpine_tables
        WHERE
            id = ${tableOrViewId}
    `.selectOne(db, {id: Schema.id<DatabaseTableId>()});

    const view = sql`
        SELECT
            id
        FROM
            ${sql.tableRef(table.id, "_alpine_views")}
        ORDER BY
            id
        LIMIT
            1
    `.selectOne(db, {id: Schema.id<DatabaseViewId>()});

    return {tableId: table.id, viewId: view.id, tableName: readTableName(db, table.id)};
}

/**
 * Add a field to an existing table: resolves the table
 * name, generates a unique column name, computes the
 * next view position, inserts metadata into
 * `_alpine_fields` and `_alpine_view_fields`, then runs
 * `ALTER TABLE ADD COLUMN` with the appropriate type
 * affinity and CHECK constraint.
 */
function createField(
    db: Database,
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
    const tableName = readTableName(db, tableId);

    const existingColumnNames = new Set(
        sql`
            SELECT
                column_name
            FROM
                ${sql.tableRef(tableId, "_alpine_fields")}
            WHERE
                table_id = ${tableId}
        `
            .selectAll(db, {columnName: Schema.string.originalPropertyKey("column_name")})
            .map(row => row.columnName),
    );
    const columnName = formatUniqueSqlName(name, existingColumnNames);

    const maxPosition = sql`
        SELECT
            MAX(position)
        FROM
            ${sql.tableRef(tableId, "_alpine_view_fields")}
        WHERE
            view_id = ${viewId}
    `.selectValue(db, Schema.string.nullable());

    const provider = getDatabaseFieldProvider(type);
    const fieldConfig = DatabaseFieldConfigSqlSchema.serialize({type});

    sql`
        INSERT INTO
            ${sql.tableRef(tableId, "_alpine_fields")} (id, table_id, name, column_name, config)
        VALUES
            (
                ${fieldId},
                ${tableId},
                ${name},
                ${columnName},
                ${fieldConfig}
            )
    `.exec(db);

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
    `.exec(db);

    const {sqliteType, defaultValue, generateCheckConstraint} = provider;

    sql`
        ALTER TABLE ${sql.tableRef(tableId, tableName)}
        ADD COLUMN ${sql.identifier(columnName)} ${sql.raw(sqliteType)}_alpine_${sql.raw(
            fieldId,
        )} NOT NULL DEFAULT ${sql.raw(defaultValue)} ${generateCheckConstraint(columnName)}
    `.exec(db);
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

    ensureSchemaPagesLoaded: defineDatabaseAction({
        input: Schema.object({}),
        output: Schema.object({}),
        writeLevel: "none",
        run({db}) {
            // Pull the main registry's pages into the read set
            // (and cache). Per-table metadata is fetched on
            // demand for now.
            sql`
                SELECT
                    id
                FROM
                    _alpine_tables
            `.selectValues(db, Schema.id<DatabaseTableId>());
            return {};
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
        // Server-only so it can mint ids internally and attach
        // a brand-new per-db file without client/server
        // divergence; the client routes this to the server.
        serverOnly: true,
        run({db, server}, {name}) {
            assert(server !== null, "createTable is server-only");
            const tableId = generateChronologicalId<DatabaseTableId>();
            const viewId = generateChronologicalId<DatabaseViewId>();

            // Attach + migrate the new per-db file before
            // writing any of the table's data or metadata into
            // it. `attach` is a no-op if already attached.
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

            // SQLite identifier for the data table. It only has
            // to be unique within this table's own file, and
            // `formatUniqueSqlName` strips leading underscores
            // so it can never collide with the `_alpine_*`
            // metadata tables.
            const tableName = formatUniqueSqlName(name, new Set());

            // Real, table-scoped metadata lives in the per-db
            // file, never in the public main database.
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, "_alpine_table")} (id, name, table_name)
                VALUES
                    (
                        ${tableId},
                        ${name},
                        ${tableName}
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

            const fieldId = generateChronologicalId<DatabaseFieldId>();
            createField(db, {fieldId, tableId, viewId, name: "Name", type: "plainText"});

            sql`
                CREATE INDEX ${sql.tableRef(
                    tableId,
                    tableName + "__created_at",
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
        run({db}, {tableId, name}) {
            const existing = sql`
                SELECT
                    *
                FROM
                    ${sql.tableRef(tableId, "_alpine_table")}
            `.selectOne(db, alpineTableConfig);

            // The identifier only has to be unique within this
            // table's own file, so there are no other names to
            // avoid.
            const tableName = formatUniqueSqlName(name, new Set());

            if (tableName !== existing.tableName) {
                // Index names are schema-qualified; the renamed
                // table stays in its own schema so the RENAME TO
                // target is unqualified.
                sql`
                    DROP INDEX ${sql.tableRef(tableId, existing.tableName + "__created_at")}
                `.exec(db);
                sql`
                    ALTER TABLE ${sql.tableRef(tableId, existing.tableName)}
                    RENAME TO ${sql.identifier(tableName)}
                `.exec(db);
                sql`
                    CREATE INDEX ${sql.tableRef(
                        tableId,
                        tableName + "__created_at",
                    )} ON ${sql.identifier(tableName)} (_created_at)
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
        run({db}) {
            const tableIds = sql`
                SELECT
                    id
                FROM
                    _alpine_tables
                ORDER BY
                    id
            `.selectValues(db, Schema.id<DatabaseTableId>());
            return {tableIds};
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
                    hidden: sqlBoolean,
                }),
            ),
        }),
        writeLevel: "none",
        run({db}, {tableOrViewId}) {
            const {tableId, viewId, tableName} = resolveTableOrViewId(db, tableOrViewId);

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
                    ${sql.tableRef(tableId, "_alpine_view_fields")} vf
                    JOIN ${sql.tableRef(tableId, "_alpine_fields")} f ON f.id = vf.field_id
                WHERE
                    vf.view_id = ${viewId}
                ORDER BY
                    vf.position
            `.selectAll(db, {
                id: Schema.id<DatabaseFieldId>(),
                name: Schema.string,
                columnName: Schema.string.originalPropertyKey("column_name"),
                config: DatabaseFieldConfigSqlSchema,
                position: OrderKeySchema,
                width: Schema.integer,
                hidden: sqlBoolean,
            });

            return {
                tableId,
                viewId,
                tableName,
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
        run({db}, {tableOrViewId, afterCursor, limit}) {
            const {tableId, viewId, tableName} = resolveTableOrViewId(db, tableOrViewId);

            const whereClause =
                afterCursor != null
                    ? sql`
                          WHERE
                              _id > ${afterCursor}
                      `
                    : sql.raw("");

            const rows = sql`
                SELECT
                    _id
                FROM
                    ${sql.tableRef(tableId, tableName)} ${whereClause}
                ORDER BY
                    _id
                LIMIT
                    ${limit}
            `.selectAll(db, {
                id: Schema.id<DatabaseRowId>().originalPropertyKey("_id"),
            });
            const endCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;

            return {tableId, viewId, tableName, endCursor};
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
        run({db}, {tableOrViewId, afterCursor, endCursor}) {
            const {tableId, viewId, tableName} = resolveTableOrViewId(db, tableOrViewId);

            // Get the view's fields in position order so we
            // can build a deterministic SELECT list and a
            // per-page field-index mapping.
            const viewFields = sql`
                SELECT
                    f.id,
                    f.column_name,
                    f.config
                FROM
                    ${sql.tableRef(tableId, "_alpine_view_fields")} vf
                    JOIN ${sql.tableRef(tableId, "_alpine_fields")} f ON f.id = vf.field_id
                WHERE
                    vf.view_id = ${viewId}
                ORDER BY
                    vf.position
            `.selectAll(db, {
                id: Schema.id<DatabaseFieldId>(),
                columnName: Schema.string.originalPropertyKey("column_name"),
                config: DatabaseFieldConfigSqlSchema,
            });

            // _id is always at index 0; view fields start at 1.
            const selectColumns = [
                sql.raw("_id"),
                ...viewFields.map(f => sql.identifier(f.columnName)),
            ];
            const selectList = sql.raw(selectColumns.map(c => c.query).join(", "));

            const fieldIndexes = new Map<DatabaseFieldId, number>();
            for (let i = 0; i < viewFields.length; i++) {
                fieldIndexes.set(viewFields[i]!.id, i + 1);
            }

            // Build a schema tuple matching the SELECT list so
            // raw SQL values are deserialized through each
            // field's sqlValueSchema (e.g. INTEGER → boolean
            // for checkboxes).
            const columnSchemas: Array<Schema<any>> = [
                Schema.id<DatabaseRowId>(),
                ...viewFields.map(f => getDatabaseFieldProvider(f.config.type).sqlValueSchema),
            ];

            let whereClause: SqlQuery;
            if (afterCursor != null && endCursor != null) {
                whereClause = sql`
                    WHERE
                        _id > ${afterCursor}
                        AND _id <= ${endCursor}
                `;
            } else if (afterCursor != null) {
                whereClause = sql`
                    WHERE
                        _id > ${afterCursor}
                `;
            } else if (endCursor != null) {
                whereClause = sql`
                    WHERE
                        _id <= ${endCursor}
                `;
            } else {
                whereClause = sql.raw("");
            }

            const rows = sql`
                SELECT
                    ${selectList}
                FROM
                    ${sql.tableRef(tableId, tableName)} ${whereClause}
                ORDER BY
                    _id
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
        run({db}, {tableId, fieldId, rowId, value}) {
            const field = sql`
                SELECT
                    column_name,
                    config
                FROM
                    ${sql.tableRef(tableId, "_alpine_fields")}
                WHERE
                    id = ${fieldId}
            `.selectOne(db, {
                columnName: Schema.string.originalPropertyKey("column_name"),
                config: DatabaseFieldConfigSqlSchema,
            });
            const provider = getDatabaseFieldProvider(field.config.type);
            const tableName = readTableName(db, tableId);
            sql`
                UPDATE ${sql.tableRef(tableId, tableName)}
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
        run({db}, {tableId, rowId}) {
            const tableName = readTableName(db, tableId);
            sql`
                INSERT INTO
                    ${sql.tableRef(tableId, tableName)} (_id)
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
        run({db}, {fieldId, tableId, viewId, name, type}) {
            createField(db, {fieldId, tableId, viewId, name, type});
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
        run({db}, {tableId, viewId, fieldId, width}) {
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
        run({db}, {tableId, viewId, fieldId, position, isHidden}) {
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
        run({db}, {tableId, fieldId, name}) {
            const field = sql`
                SELECT
                    column_name
                FROM
                    ${sql.tableRef(tableId, "_alpine_fields")}
                WHERE
                    id = ${fieldId}
            `.selectOne(db, {
                columnName: Schema.string.originalPropertyKey("column_name"),
            });

            const tableName = readTableName(db, tableId);

            const existingColumnNames = new Set(
                sql`
                    SELECT
                        column_name
                    FROM
                        ${sql.tableRef(tableId, "_alpine_fields")}
                    WHERE
                        id != ${fieldId}
                `
                    .selectAll(db, {
                        columnName: Schema.string.originalPropertyKey("column_name"),
                    })
                    .map(row => row.columnName),
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

            sql`
                ALTER TABLE ${sql.tableRef(tableId, tableName)}
                RENAME COLUMN ${sql.identifier(field.columnName)} TO ${sql.identifier(
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
 * Schema for action request objects: `{name, input}`.
 * Discriminated union keyed on `name`.
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
 * Schema for action result objects: `{name, output}`.
 * Discriminated union keyed on `name`.
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
