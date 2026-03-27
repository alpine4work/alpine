/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {serializeDatabaseFieldType} from "~/shared/databases/database_field_type.js";
import {
    alpineFieldTypeToSqliteType,
    checkConstraintForColumn,
    formatUniqueSqlName,
} from "~/shared/databases/internal/database_sql_helpers.js";
import {sql} from "~/shared/databases/sql.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
import {type ObjectSchema, Schema, type SchemaType} from "~/shared/schema/schema.js";

// -- Row schema configs -------------------------------------------------------

const alpineTableConfig = {
    id: Schema.id<DatabaseTableId>(),
    name: Schema.string,
    tableName: Schema.string.originalPropertyKey("table_name"),
};

const alpineViewConfig = {
    id: Schema.id<DatabaseViewId>(),
    tableId: Schema.id<DatabaseTableId>().originalPropertyKey("table_id"),
    name: Schema.string,
};

const alpineViewFieldConfig = {
    id: Schema.id<DatabaseFieldId>(),
    name: Schema.string,
    columnName: Schema.string.originalPropertyKey("column_name"),
    width: Schema.integer,
};

const alpineFieldConfig = {
    id: Schema.id<DatabaseFieldId>(),
    tableId: Schema.id<DatabaseTableId>().originalPropertyKey("table_id"),
    columnName: Schema.string.originalPropertyKey("column_name"),
};

/**
 * Defines a database action with typed input/output
 * schemas, a write level, and a shared `run()` function
 * that executes on both client and server.
 */
function defineDatabaseAction<Input, Output>(def: {
    input: ObjectSchema<Input>;
    output: ObjectSchema<Output>;
    writeLevel: SqliteWriteLevel;
    run: (db: Database, input: Input) => any;
}): {
    input: ObjectSchema<Input>;
    output: ObjectSchema<Output>;
    writeLevel: SqliteWriteLevel;
    run: (db: Database, input: Input) => Output;
} {
    return def;
}

export const databaseActions = {
    rawSql: defineDatabaseAction({
        input: Schema.object({sql: Schema.string}),
        output: Schema.object({rows: Schema.array(Schema.unknown())}),
        writeLevel: "data",
        run(db, input) {
            const rows = sql.raw(input.sql).selectAllUnknown(db);
            return {rows};
        },
    }),

    readonlyRawSql: defineDatabaseAction({
        input: Schema.object({sql: Schema.string}),
        output: Schema.object({rows: Schema.array(Schema.unknown())}),
        writeLevel: "none",
        run(db, input) {
            const rows = sql.raw(input.sql).selectAllUnknown(db);
            return {rows};
        },
    }),

    ensureSchemaPagesLoaded: defineDatabaseAction({
        input: Schema.object({}),
        output: Schema.object({}),
        writeLevel: "none",
        run(db) {
            sql`SELECT * FROM _alpine_tables`.selectAllUnknown(db);
            sql`SELECT * FROM _alpine_fields`.selectAllUnknown(db);
            sql`SELECT * FROM _alpine_views`.selectAllUnknown(db);
            sql`SELECT * FROM _alpine_view_fields`.selectAllUnknown(db);
            return {};
        },
    }),

    createTable: defineDatabaseAction({
        input: Schema.object({name: Schema.string}),
        output: Schema.object({
            tableId: Schema.id<DatabaseTableId>(),
            tableName: Schema.string,
            viewId: Schema.id<DatabaseViewId>(),
        }),
        writeLevel: "schema+data",
        run(db, {name}) {
            const existingTableNames = new Set(
                sql`SELECT table_name FROM _alpine_tables`
                    .selectAll(db, {tableName: Schema.string.originalPropertyKey("table_name")})
                    .map(row => row.tableName),
            );
            const tableName = formatUniqueSqlName(name, existingTableNames);
            const tableId = generateChronologicalId<DatabaseTableId>();

            sql`INSERT INTO _alpine_tables (id, name, table_name) VALUES (${tableId}, ${name}, ${tableName})`.exec(
                db,
            );

            const fieldType = serializeDatabaseFieldType({type: "plainText"});
            const fieldId = generateChronologicalId<DatabaseFieldId>();
            sql`INSERT INTO _alpine_fields (id, table_id, name, column_name, type)
                VALUES (${fieldId}, ${tableId}, ${"Name"}, ${"name"}, ${fieldType})`.exec(db);

            const sqliteType = alpineFieldTypeToSqliteType("plainText");
            const nameCheck = checkConstraintForColumn("name", sqliteType, true);

            sql`CREATE TABLE ${sql.identifier(tableName)} (
                _id TEXT PRIMARY KEY DEFAULT (generate_id()),
                _created_at TEXT NOT NULL DEFAULT (datetime('now')),
                name ${sql.raw(sqliteType)}_alpine_${sql.raw(fieldId)} NOT NULL DEFAULT '',
                CHECK(is_id(_id)),
                CHECK(datetime(_created_at) IS NOT NULL),
                ${nameCheck}
            ) WITHOUT ROWID`.exec(db);

            sql`CREATE INDEX ${sql.identifier(tableName + "__created_at")} ON ${sql.identifier(tableName)}(_created_at)`.exec(
                db,
            );

            const viewId = generateChronologicalId<DatabaseViewId>();
            sql`INSERT INTO _alpine_views (id, table_id, name) VALUES (${viewId}, ${tableId}, ${"Grid view"})`.exec(
                db,
            );

            sql`INSERT INTO _alpine_view_fields (view_id, field_id, position, width)
                VALUES (${viewId}, ${fieldId}, ${0}, ${200})`.exec(db);

            return {tableId, tableName, viewId};
        },
    }),

    getTables: defineDatabaseAction({
        input: Schema.object({}),
        output: Schema.object({
            tables: Schema.map(
                Schema.id<DatabaseTableId>(),
                Schema.object({
                    name: Schema.string,
                    tableName: Schema.string,
                }),
            ),
        }),
        writeLevel: "none",
        run(db) {
            const rows = sql`SELECT * FROM _alpine_tables ORDER BY id`.selectAll(
                db,
                alpineTableConfig,
            );
            const tables = new Map<DatabaseTableId, {name: string; tableName: string}>();
            for (const row of rows) {
                tables.set(row.id, {name: row.name, tableName: row.tableName});
            }
            return {tables};
        },
    }),

    getViewData: defineDatabaseAction({
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
                    width: Schema.integer,
                }),
            ),
            rows: Schema.array(Schema.unknown()),
        }),
        writeLevel: "none",
        run(db, {tableOrViewId}) {
            let tableId: DatabaseTableId;
            let viewId: DatabaseViewId;
            let tableName: string;

            // Try to resolve as a table ID first.
            const tableResult =
                sql`SELECT * FROM _alpine_tables WHERE id = ${tableOrViewId}`.selectOneOrNone(
                    db,
                    alpineTableConfig,
                );

            if (tableResult !== null) {
                tableId = tableResult.id;
                tableName = tableResult.tableName;

                // Pick the first view for this table.
                const view =
                    sql`SELECT * FROM _alpine_views WHERE table_id = ${tableId} ORDER BY id LIMIT 1`.selectOne(
                        db,
                        alpineViewConfig,
                    );
                viewId = view.id;
            } else {
                // Try as a view ID.
                const view = sql`SELECT * FROM _alpine_views WHERE id = ${tableOrViewId}`.selectOne(
                    db,
                    alpineViewConfig,
                );
                viewId = view.id;
                tableId = view.tableId;

                const table = sql`SELECT * FROM _alpine_tables WHERE id = ${tableId}`.selectOne(
                    db,
                    alpineTableConfig,
                );
                tableName = table.tableName;
            }

            const fields = sql`SELECT f.id, f.name, f.column_name, vf.width
                FROM _alpine_view_fields vf
                JOIN _alpine_fields f ON f.id = vf.field_id
                WHERE vf.view_id = ${viewId}
                ORDER BY vf.position`.selectAll(db, alpineViewFieldConfig);

            const rows = sql`SELECT * FROM ${sql.identifier(tableName)}`.selectAllUnknown(db);
            return {tableId, viewId, tableName, fields, rows};
        },
    }),

    updateCellValue: defineDatabaseAction({
        input: Schema.object({
            fieldId: Schema.id<DatabaseFieldId>(),
            rowId: Schema.id<DatabaseRowId>(),
            value: Schema.string,
        }),
        output: Schema.object({}),
        writeLevel: "data",
        run(db, {fieldId, rowId, value}) {
            const field =
                sql`SELECT id, table_id, column_name FROM _alpine_fields WHERE id = ${fieldId}`.selectOne(
                    db,
                    alpineFieldConfig,
                );
            const table = sql`SELECT * FROM _alpine_tables WHERE id = ${field.tableId}`.selectOne(
                db,
                alpineTableConfig,
            );
            sql`UPDATE ${sql.identifier(table.tableName)} SET ${sql.identifier(field.columnName)} = ${value} WHERE _id = ${rowId}`.exec(
                db,
            );
            return {};
        },
    }),

    addField: defineDatabaseAction({
        input: Schema.object({
            fieldId: Schema.id<DatabaseFieldId>(),
            tableId: Schema.id<DatabaseTableId>(),
            viewId: Schema.id<DatabaseViewId>(),
            name: Schema.string,
        }),
        output: Schema.object({}),
        writeLevel: "schema+data",
        run(db, {fieldId, tableId, viewId, name}) {
            const table = sql`SELECT * FROM _alpine_tables WHERE id = ${tableId}`.selectOne(
                db,
                alpineTableConfig,
            );

            const existingColumnNames = new Set(
                sql`SELECT column_name FROM _alpine_fields WHERE table_id = ${tableId}`
                    .selectAll(db, {columnName: Schema.string.originalPropertyKey("column_name")})
                    .map(row => row.columnName),
            );
            const columnName = formatUniqueSqlName(name, existingColumnNames);
            const fieldType = serializeDatabaseFieldType({type: "plainText"});

            sql`INSERT INTO _alpine_fields (id, table_id, name, column_name, type)
                VALUES (${fieldId}, ${tableId}, ${name}, ${columnName}, ${fieldType})`.exec(db);

            const sqliteType = alpineFieldTypeToSqliteType("plainText");
            const check = checkConstraintForColumn(columnName, sqliteType, true);

            sql`ALTER TABLE ${sql.identifier(table.tableName)}
                ADD COLUMN ${sql.identifier(columnName)} ${sql.raw(sqliteType)}_alpine_${sql.raw(fieldId)} NOT NULL DEFAULT ''
                ${check}`.exec(db);

            const maxPos =
                sql`SELECT MAX(position) FROM _alpine_view_fields WHERE view_id = ${viewId}`.selectValue(
                    db,
                    Schema.integer.nullable(),
                );

            sql`INSERT INTO _alpine_view_fields (view_id, field_id, position, width)
                VALUES (${viewId}, ${fieldId}, ${(maxPos ?? -1) + 1}, ${200})`.exec(db);

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

const readPagesSchema = Schema.map(
    Schema.integer,
    Schema.object({
        timestamp: Schema.integer,
        data: Schema.bytes,
    }),
);

type ReadPages = ReadonlyMap<number, {readonly timestamp: number; readonly data: Uint8Array}>;

/**
 * Schema for loader-serialized action results. Includes
 * the action name, input, output, and the pages read
 * during execution. Used to pass initial data from SSR
 * loaders to client-side reactive action hooks.
 */
export const LoaderDatabaseActionResultSchema = Schema.unionWithKey(
    "name",
    Object.fromEntries(
        Object.entries(databaseActions).map(([name, def]) => [
            name,
            Schema.object({
                name: Schema.value(name),
                input: def.input,
                output: def.output,
                readPages: readPagesSchema,
            }),
        ]),
    ) as {
        [K in DatabaseActionName]: ObjectSchema<{
            readonly name: K;
            readonly input: DatabaseActionInput<K>;
            readonly output: DatabaseActionOutput<K>;
            readonly readPages: ReadPages;
        }>;
    },
);

export type LoaderDatabaseActionResult<N extends DatabaseActionName = DatabaseActionName> = {
    [K in DatabaseActionName]: {
        name: K;
        input: DatabaseActionInput<K>;
        output: DatabaseActionOutput<K>;
        readPages: ReadPages;
    };
}[N];
