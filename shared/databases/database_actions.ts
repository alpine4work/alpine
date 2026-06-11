import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {
    type DatabaseFieldConfig,
    DatabaseFieldConfigSchema,
    DatabaseFieldConfigSqlSchema,
    type DatabaseFieldType,
    DatabaseFieldTypeSchema,
    getDatabaseFieldProvider,
} from "~/shared/databases/fields/database_field_providers.js";
import type {DatabaseRelationValue} from "~/shared/databases/fields/database_relation_field.js";
import {formatUniqueSqlName} from "~/shared/databases/internal/database_sql_helpers.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
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
import {
    type ObjectSchema,
    Schema,
    type SchemaSerializedValue,
    type SchemaType,
} from "~/shared/schema/schema.js";

// -- Helpers ------------------------------------------------------------------

/**
 * SQLite stores booleans as INTEGER 0/1 but `Schema.boolean` expects a real
 * boolean. This schema migrates 0/1 on read and relies on the SQLite binding layer
 * converting `true`/`false` back to 1/0 on write.
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
    nameFieldId: Schema.id<DatabaseFieldId>().nullable().originalPropertyKey("name_field_id"),
};

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
    db: Database;
    /** Server-only capabilities, or `null` on the client. */
    server: DatabaseActionServerContext | null;
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
 * Reads a table's SQLite identifier (`table_name`) from its own per-db file. The
 * display name and identifier are private and never live in the public main
 * database.
 */
function readTableName(db: Database, tableId: DatabaseTableId): string {
    return sql`
        SELECT
            table_name
        FROM
            ${sql.tableRef(tableId, "_alpine_table")}
    `.selectValue(db, Schema.string);
}

function readTableDisplayName(db: Database, tableId: DatabaseTableId): string {
    return sql`
        SELECT
            name
        FROM
            ${sql.tableRef(tableId, "_alpine_table")}
    `.selectValue(db, Schema.string);
}

function listUserTableIds(db: Database): ReadonlyArray<DatabaseTableId> {
    return sql`
        SELECT
            id
        FROM
            _alpine_tables
        WHERE
            kind = 'table'
        ORDER BY
            id
    `.selectValues(db, Schema.id<DatabaseTableId>());
}

/**
 * Stable name for a table's `_created_at` index. Keyed by the immutable table id
 * (not the mutable SQL table name), so renaming the table leaves the index in
 * place rather than dropping and rebuilding it.
 */
function createdAtIndexName(tableId: DatabaseTableId): string {
    return `_alpine_index_${tableId}_created_at`;
}

/**
 * Resolves a `tableOrViewId` (which may be either a table ID or a view ID) into
 * the canonical triple of `{tableId, viewId, tableName}`.
 *
 * A bare view ID is routed to its owning table through the main database's ID-only
 * `_alpine_views(id, table_id)` routing index (the happy path after URL
 * canonicalization); the table's name then comes from its per-db file. A bare
 * table ID falls back to picking its first view from that table's per-db file.
 */
function resolveTableOrViewId(
    db: Database,
    tableOrViewId: string,
): {tableId: DatabaseTableId; viewId: DatabaseViewId; tableName: string} {
    // Happy path: route the view ID to its table via the main routing index (URLs
    // canonicalize to view IDs).
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

    // Fallback: resolve as a table ID and pick its first view from that table's per-db
    // file.
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
 * Add a field to an existing table: resolves the table name, generates a unique
 * column name, computes the next view position, inserts metadata into
 * `_alpine_fields` and `_alpine_view_fields`, then runs `ALTER TABLE ADD COLUMN`
 * with the appropriate type affinity and CHECK constraint.
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
    const provider = getDatabaseFieldProvider(type);
    const fieldConfig = provider.getDefaultConfig();
    const columnName = createFieldMetadata(db, {
        fieldId,
        tableId,
        viewIds: [viewId],
        name,
        config: fieldConfig,
    });
    if (provider.storage === "virtual") return;

    const tableName = readTableName(db, tableId);

    const {sqliteType, defaultValue, nullable, generateCheckConstraint} = provider;
    const notNullClause = nullable ? sql.raw("") : sql.raw("NOT NULL");

    sql`
        ALTER TABLE ${sql.tableRef(tableId, tableName)}
        ADD COLUMN ${sql.identifier(columnName)} ${sql.raw(sqliteType)}_alpine_${sql.raw(
            fieldId,
        )} ${notNullClause} DEFAULT ${sql.raw(defaultValue)} ${generateCheckConstraint(columnName)}
    `.exec(db);
}

function createFieldMetadata(
    db: Database,
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
            .selectAll(db, {columnName: Schema.string.originalPropertyKey("column_name")})
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
                ${fieldConfig}
            )
    `.exec(db);

    for (const viewId of viewIds) {
        insertFieldIntoView(db, {tableId, viewId, fieldId});
    }

    return columnName;
}

function insertFieldIntoView(
    db: Database,
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
    `.selectValue(db, Schema.string.nullable());

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
}

function formatUniqueFieldName(name: string, existing: ReadonlySet<string>): string {
    if (!existing.has(name)) return name;
    for (let i = 2; ; i++) {
        const candidate = `${name} ${i}`;
        if (!existing.has(candidate)) return candidate;
    }
}

type DatabaseRelationFieldConfig = Extract<DatabaseFieldConfig, {type: "relation"}>;

type DatabaseRelationFieldSide = DatabaseRelationFieldConfig["side"];

type DatabaseJoinTableMeta = {
    id: DatabaseTableId;
    sourceTableId: DatabaseTableId;
    sourceFieldId: DatabaseFieldId;
    targetTableId: DatabaseTableId;
    targetFieldId: DatabaseFieldId;
};

function readJoinTableMeta(db: Database, joinTableId: DatabaseTableId): DatabaseJoinTableMeta {
    return sql`
        SELECT
            id,
            source_table_id,
            source_field_id,
            target_table_id,
            target_field_id
        FROM
            ${sql.tableRef(joinTableId, "_alpine_join_table")}
        WHERE
            id = ${joinTableId}
    `.selectOne(db, {
        id: Schema.id<DatabaseTableId>(),
        sourceTableId: Schema.id<DatabaseTableId>().originalPropertyKey("source_table_id"),
        sourceFieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("source_field_id"),
        targetTableId: Schema.id<DatabaseTableId>().originalPropertyKey("target_table_id"),
        targetFieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("target_field_id"),
    });
}

function qualifiedIdentifier(tableAlias: string, columnName: string): SqlQuery {
    return sql.raw(`${sql.identifier(tableAlias).query}.${sql.identifier(columnName).query}`);
}

function readRelationFieldConfig(
    db: Database,
    {
        tableId,
        fieldId,
    }: {
        tableId: DatabaseTableId;
        fieldId: DatabaseFieldId;
    },
): DatabaseRelationFieldConfig {
    const field = sql`
        SELECT
            config
        FROM
            ${sql.tableRef(tableId, "_alpine_fields")}
        WHERE
            id = ${fieldId}
    `.selectOne(db, {config: DatabaseFieldConfigSqlSchema});
    assert(field.config.type === "relation", "field is not a relation field");
    return field.config;
}

function assertRelationEndpointExists(
    db: Database,
    {
        tableId,
        rowId,
        message,
    }: {
        tableId: DatabaseTableId;
        rowId: DatabaseRowId;
        message: string;
    },
): void {
    const tableName = readTableName(db, tableId);
    const row = sql`
        SELECT
            _id
        FROM
            ${sql.tableRef(tableId, tableName)}
        WHERE
            _id = ${rowId}
    `.selectOneOrNone(db, {id: Schema.id<DatabaseRowId>().originalPropertyKey("_id")});
    assert(row !== null, message);
}

function resolveRelationField(
    db: Database,
    {
        tableId,
        fieldId,
    }: {
        tableId: DatabaseTableId;
        fieldId: DatabaseFieldId;
    },
): {
    config: DatabaseRelationFieldConfig;
    joinTableId: DatabaseTableId;
    linkedTableId: DatabaseTableId;
    mineColumnName: "source_row_id" | "target_row_id";
    theirsColumnName: "source_row_id" | "target_row_id";
} {
    const config = readRelationFieldConfig(db, {tableId, fieldId});
    const joinTable = readJoinTableMeta(db, config.joinTableId);

    let linkedTableId: DatabaseTableId;
    switch (config.side) {
        case "source":
            assert(joinTable.sourceTableId === tableId, "relation source table mismatch");
            assert(joinTable.sourceFieldId === fieldId, "relation source field mismatch");
            linkedTableId = joinTable.targetTableId;
            break;
        case "target":
            assert(joinTable.targetTableId === tableId, "relation target table mismatch");
            assert(joinTable.targetFieldId === fieldId, "relation target field mismatch");
            linkedTableId = joinTable.sourceTableId;
            break;
    }
    assert(config.linkedTableId === linkedTableId, "relation linked table mismatch");

    return {
        config,
        joinTableId: config.joinTableId,
        linkedTableId,
        mineColumnName: relationSideColumnName(config.side),
        theirsColumnName: relationSideColumnName(oppositeRelationSide(config.side)),
    };
}

function resolveRelationEndpoints(
    db: Database,
    {
        tableId,
        fieldId,
        rowId,
        linkedRowId,
    }: {
        tableId: DatabaseTableId;
        fieldId: DatabaseFieldId;
        rowId: DatabaseRowId;
        linkedRowId: DatabaseRowId;
    },
): {
    config: DatabaseRelationFieldConfig;
    joinTableId: DatabaseTableId;
    mineColumnName: "source_row_id" | "target_row_id";
    theirsColumnName: "source_row_id" | "target_row_id";
    sourceRowId: DatabaseRowId;
    targetRowId: DatabaseRowId;
} {
    const relation = resolveRelationField(db, {tableId, fieldId});

    assertRelationEndpointExists(db, {tableId, rowId, message: "row not found"});
    assertRelationEndpointExists(db, {
        tableId: relation.linkedTableId,
        rowId: linkedRowId,
        message: "linked row not found",
    });

    return {
        config: relation.config,
        joinTableId: relation.joinTableId,
        mineColumnName: relation.mineColumnName,
        theirsColumnName: relation.theirsColumnName,
        sourceRowId: relation.config.side === "source" ? rowId : linkedRowId,
        targetRowId: relation.config.side === "source" ? linkedRowId : rowId,
    };
}

function relationSideColumnName(
    side: DatabaseRelationFieldSide,
): "source_row_id" | "target_row_id" {
    switch (side) {
        case "source":
            return "source_row_id";
        case "target":
            return "target_row_id";
    }
}

function oppositeRelationSide(side: DatabaseRelationFieldSide): DatabaseRelationFieldSide {
    switch (side) {
        case "source":
            return "target";
        case "target":
            return "source";
    }
}

type DatabaseNameFieldReference = {
    tableName: string;
    columnName: string;
    config: DatabaseFieldConfig;
};

function readNameFieldReference(
    db: Database,
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

function formatNameFieldValue(config: DatabaseFieldConfig, rawValue: unknown): string | null {
    if (rawValue == null) return null;
    const provider = getDatabaseFieldProvider(config.type);
    assert(provider.storage === "column", "record-name field must be column-backed");
    const value = provider.sqlValueSchema.deserialize(rawValue as SchemaSerializedValue);
    return formatNameFieldValueFromValue(config, value);
}

function formatNameFieldValueFromValue(config: DatabaseFieldConfig, value: unknown): string | null {
    const provider = getDatabaseFieldProvider(config.type);
    assert(provider.storage === "column", "record-name field must be column-backed");
    const formatted = provider.formatString(value, config);
    return formatted === "" ? null : formatted;
}

type DatabaseRelationProjection = {
    fieldIndex: number;
    nameFieldConfig: DatabaseFieldConfig;
};

const DatabaseRelationProjectionValueSchema = Schema.array(
    Schema.object({
        id: Schema.id<DatabaseRowId>(),
        name: Schema.unknown(),
    }),
);

function parseRelationProjectionValue(
    rawJson: unknown,
    nameFieldConfig: DatabaseFieldConfig,
): DatabaseRelationValue {
    assert(typeof rawJson === "string", "relation projection must be JSON text");
    const links = DatabaseRelationProjectionValueSchema.deserialize(JSON.parse(rawJson));
    return links.map(link => ({
        id: link.id,
        name: formatNameFieldValue(nameFieldConfig, link.name),
    }));
}

function createRelationProjection(
    db: Database,
    {
        tableId,
        fieldId,
        rowAlias,
        fieldIndex,
    }: {
        tableId: DatabaseTableId;
        fieldId: DatabaseFieldId;
        rowAlias: string;
        fieldIndex: number;
    },
): {sql: SqlQuery; projection: DatabaseRelationProjection} {
    const relation = resolveRelationField(db, {tableId, fieldId});
    const linkedNameField = readNameFieldReference(db, relation.linkedTableId);
    const linkedNameProvider = getDatabaseFieldProvider(linkedNameField.config.type);
    assert(linkedNameProvider.storage === "column", "record-name field must be column-backed");

    const projectionSql = sql`
        (
            SELECT
                COALESCE(
                    JSON_GROUP_ARRAY(
                        JSON_OBJECT(
                            'id',
                            linked_row._id,
                            'name',
                            ${qualifiedIdentifier("linked_row", linkedNameField.columnName)}
                        )
                        ORDER BY
                            link_row._created_at,
                            link_row.rowid
                    ),
                    '[]'
                )
            FROM
                ${sql.tableRef(relation.joinTableId, "_alpine_links")} link_row
                JOIN ${sql.tableRef(
            relation.linkedTableId,
            linkedNameField.tableName,
        )} linked_row ON linked_row._id = ${qualifiedIdentifier(
            "link_row",
            relation.theirsColumnName,
        )}
            WHERE
                ${qualifiedIdentifier("link_row", relation.mineColumnName)} = ${qualifiedIdentifier(
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
        run({db, server}, {name}) {
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

            createField(db, {fieldId, tableId, viewId, name: "Name", type: "plainText"});

            sql`
                CREATE INDEX ${sql.tableRef(
                    tableId,
                    createdAtIndexName(tableId),
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
        run({db}) {
            return {tableIds: listUserTableIds(db)};
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
        run({db}) {
            const tableIds = listUserTableIds(db);
            return {
                tables: tableIds.map(tableId => ({
                    id: tableId,
                    name: readTableDisplayName(db, tableId),
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
                    : sql``;

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

            // Get the view's fields in position order so we can build a deterministic SELECT
            // list and a per-page field-index mapping.
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

            // SQLite version prerequisite for relation projection: WORKSPACE pins
            // sqlite-src-3510200 (SQLite 3.51.2), so `json_group_array(... ORDER BY ...)` is
            // available when the relation subquery is added.
            //
            // \_id is always at index 0; view fields start at 1.
            const relationProjections: Array<DatabaseRelationProjection> = [];
            const selectColumns = [
                qualifiedIdentifier("data_row", "_id"),
                ...viewFields.map((f, i) => {
                    const fieldIndex = i + 1;
                    if (f.config.type === "relation") {
                        const {sql: projectionSql, projection} = createRelationProjection(db, {
                            tableId,
                            fieldId: f.id,
                            rowAlias: "data_row",
                            fieldIndex,
                        });
                        relationProjections.push(projection);
                        return projectionSql;
                    }
                    return qualifiedIdentifier("data_row", f.columnName);
                }),
            ];
            const selectList = sql.raw(selectColumns.map(c => c.query).join(", "));

            const fieldIndexes = new Map<DatabaseFieldId, number>();
            for (let i = 0; i < viewFields.length; i++) {
                fieldIndexes.set(viewFields[i]!.id, i + 1);
            }

            // Build a schema tuple matching the SELECT list so raw SQL values are deserialized
            // through each field's sqlValueSchema (e.g. INTEGER → boolean for checkboxes).
            const columnSchemas: Array<Schema<any>> = [
                Schema.id<DatabaseRowId>(),
                ...viewFields.map(f => {
                    const provider = getDatabaseFieldProvider(f.config.type);
                    if (f.config.type === "relation") return Schema.string;
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
                        ${qualifiedIdentifier("data_row", "_id")} > ${afterCursor}
                        AND ${qualifiedIdentifier("data_row", "_id")} <= ${endCursor}
                `;
            } else if (afterCursor != null) {
                whereClause = sql`
                    WHERE
                        ${qualifiedIdentifier("data_row", "_id")} > ${afterCursor}
                `;
            } else if (endCursor != null) {
                whereClause = sql`
                    WHERE
                        ${qualifiedIdentifier("data_row", "_id")} <= ${endCursor}
                `;
            } else {
                whereClause = sql``;
            }

            const rows = sql`
                SELECT
                    ${selectList}
                FROM
                    ${sql.tableRef(tableId, tableName)} AS ${sql.identifier(
                    "data_row",
                )} ${whereClause}
                ORDER BY
                    ${qualifiedIdentifier("data_row", "_id")}
            `.selectAllArrays(db, columnSchemas);

            for (const row of rows) {
                for (const projection of relationProjections) {
                    row[projection.fieldIndex] = parseRelationProjectionValue(
                        row[projection.fieldIndex],
                        projection.nameFieldConfig,
                    );
                }
            }

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
            assert(
                provider.storage === "column",
                `cannot update virtual field ${fieldId} with updateCellValue`,
            );
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
            assert(type !== "relation", "use createRelationField to create relation fields");
            createField(db, {fieldId, tableId, viewId, name, type});
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
        run({db, server}, {tableId, viewId, name, linkedTableId, cardinality}) {
            assert(server !== null, "createRelationField is server-only");
            const sourceTable = sql`
                SELECT
                    id
                FROM
                    _alpine_tables
                WHERE
                    id = ${tableId}
                    AND kind = 'table'
            `.selectOneOrNone(db, {id: Schema.id<DatabaseTableId>()});
            assert(sourceTable !== null, "source table not found");

            const linkedTable = sql`
                SELECT
                    id
                FROM
                    _alpine_tables
                WHERE
                    id = ${linkedTableId}
                    AND kind = 'table'
            `.selectOneOrNone(db, {id: Schema.id<DatabaseTableId>()});
            assert(linkedTable !== null, "linked table not found");

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

            createFieldMetadata(db, {
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
            const targetName = formatUniqueFieldName(
                readTableDisplayName(db, tableId),
                existingTargetFieldNames,
            );
            const targetViewIds = sql`
                SELECT
                    id
                FROM
                    ${sql.tableRef(linkedTableId, "_alpine_views")}
                ORDER BY
                    id
            `.selectValues(db, Schema.id<DatabaseViewId>());

            createFieldMetadata(db, {
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
        run({db}, {tableId, fieldId, rowId, linkedRowId}) {
            const relation = resolveRelationEndpoints(db, {tableId, fieldId, rowId, linkedRowId});

            if (relation.config.cardinality === "one") {
                sql`
                    DELETE FROM ${sql.tableRef(relation.joinTableId, "_alpine_links")}
                    WHERE
                        ${qualifiedIdentifier("_alpine_links", relation.mineColumnName)} = ${rowId}
                        AND ${qualifiedIdentifier(
                        "_alpine_links",
                        relation.theirsColumnName,
                    )} != ${linkedRowId}
                `.exec(db);
            }

            sql`
                INSERT OR IGNORE INTO
                    ${sql.tableRef(
                    relation.joinTableId,
                    "_alpine_links",
                )} (source_row_id, target_row_id)
                VALUES
                    (
                        ${relation.sourceRowId},
                        ${relation.targetRowId}
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
        run({db}, {tableId, fieldId, rowId, linkedRowId}) {
            const relation = resolveRelationEndpoints(db, {tableId, fieldId, rowId, linkedRowId});

            sql`
                DELETE FROM ${sql.tableRef(relation.joinTableId, "_alpine_links")}
                WHERE
                    ${qualifiedIdentifier("_alpine_links", relation.mineColumnName)} = ${rowId}
                    AND ${qualifiedIdentifier(
                    "_alpine_links",
                    relation.theirsColumnName,
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
        run({db}, {tableId, fieldId, rowId}) {
            const relation = resolveRelationField(db, {tableId, fieldId});
            assertRelationEndpointExists(db, {tableId, rowId, message: "row not found"});
            const linkedNameField = readNameFieldReference(db, relation.linkedTableId);
            const linkedNameProvider = getDatabaseFieldProvider(linkedNameField.config.type);
            assert(
                linkedNameProvider.storage === "column",
                "record-name field must be column-backed",
            );
            const rows = sql`
                SELECT
                    linked_row._id,
                    ${qualifiedIdentifier("linked_row", linkedNameField.columnName)} AS name_value
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
                            ${sql.tableRef(relation.joinTableId, "_alpine_links")} link_row
                        WHERE
                            ${qualifiedIdentifier("link_row", relation.mineColumnName)} = ${rowId}
                            AND ${qualifiedIdentifier(
                    "link_row",
                    relation.theirsColumnName,
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
                    name: formatNameFieldValueFromValue(linkedNameField.config, row.nameValue),
                })),
            };
        },
    }),

    updateFieldConfig: defineDatabaseAction({
        input: Schema.object({
            fieldId: Schema.id<DatabaseFieldId>(),
            config: DatabaseFieldConfigSchema,
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run({db}, {fieldId, config}) {
            const existing = sql`
                SELECT
                    config
                FROM
                    _alpine_fields
                WHERE
                    id = ${fieldId}
            `.selectOne(db, {config: Schema.string});
            const existingConfig = DatabaseFieldConfigSqlSchema.deserialize(existing.config);
            assert(
                existingConfig.type === config.type,
                `cannot change field type from ${existingConfig.type} to ${config.type}`,
            );
            assertRelationFieldConfigUpdate(existingConfig, config);
            const serialized = DatabaseFieldConfigSqlSchema.serialize(config);
            sql`
                UPDATE _alpine_fields
                SET
                    config = ${serialized}
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

            if (provider.storage === "virtual") return {};

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
