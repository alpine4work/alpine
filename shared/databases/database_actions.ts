/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {serializeDatabaseFieldType} from "~/shared/databases/database_field_type.js";
import {
    alpineFieldTypeToSqliteType,
    checkConstraintForColumn,
    formatUniqueSqlName,
} from "~/shared/databases/internal/database_sql_helpers.js";
import {SqliteRowFormatter} from "~/shared/databases/internal/sqlite_row_formatter.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
import {type ObjectSchema, Schema, type SchemaType} from "~/shared/schema/schema.js";

// -- Row formatters ----------------------------------------------------------

const alpineTableRow = new SqliteRowFormatter(
    Schema.object({
        id: Schema.id<DatabaseTableId>(),
        name: Schema.string,
        tableName: Schema.string.originalPropertyKey("table_name"),
    }),
);

const alpineViewRow = new SqliteRowFormatter(
    Schema.object({
        id: Schema.id<DatabaseViewId>(),
        tableId: Schema.id<DatabaseTableId>().originalPropertyKey("table_id"),
        name: Schema.string,
    }),
);

const alpineViewFieldRow = new SqliteRowFormatter(
    Schema.object({
        id: Schema.id<DatabaseFieldId>(),
        name: Schema.string,
        columnName: Schema.string.originalPropertyKey("column_name"),
        width: Schema.integer,
    }),
);

const alpineFieldRow = new SqliteRowFormatter(
    Schema.object({
        id: Schema.id<DatabaseFieldId>(),
        tableId: Schema.id<DatabaseTableId>().originalPropertyKey("table_id"),
        columnName: Schema.string.originalPropertyKey("column_name"),
    }),
);

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
        run(db, {sql}) {
            const rows = db.exec(sql, {
                returnValue: "resultRows",
                rowMode: "object",
            }) as Array<Record<string, unknown>>;
            return {rows};
        },
    }),

    readonlyRawSql: defineDatabaseAction({
        input: Schema.object({sql: Schema.string}),
        output: Schema.object({rows: Schema.array(Schema.unknown())}),
        writeLevel: "none",
        run(db, {sql}) {
            const rows = db.exec(sql, {
                returnValue: "resultRows",
                rowMode: "object",
            }) as Array<Record<string, unknown>>;
            return {rows};
        },
    }),

    ensureSchemaPagesLoaded: defineDatabaseAction({
        input: Schema.object({}),
        output: Schema.object({}),
        writeLevel: "none",
        run(db) {
            db.exec("SELECT * FROM _alpine_tables", {returnValue: "resultRows"});
            db.exec("SELECT * FROM _alpine_fields", {returnValue: "resultRows"});
            db.exec("SELECT * FROM _alpine_views", {returnValue: "resultRows"});
            db.exec("SELECT * FROM _alpine_view_fields", {returnValue: "resultRows"});
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
                (
                    db.exec("SELECT table_name FROM _alpine_tables", {
                        returnValue: "resultRows",
                        rowMode: "array",
                    }) as Array<[string]>
                ).map(row => row[0]),
            );
            const tableName = formatUniqueSqlName(name, existingTableNames);
            const tableId = generateChronologicalId<DatabaseTableId>();

            db.exec(`INSERT INTO _alpine_tables (id, name, table_name) VALUES (?, ?, ?)`, {
                bind: [tableId, name, tableName],
            });

            const fieldType = serializeDatabaseFieldType({type: "plainText"});
            const fieldId = generateChronologicalId<DatabaseFieldId>();
            db.exec(
                `INSERT INTO _alpine_fields (id, table_id, name, column_name, type)
                 VALUES (?, ?, ?, ?, ?)`,
                {bind: [fieldId, tableId, "Name", "name", fieldType]},
            );

            const sqliteType = alpineFieldTypeToSqliteType("plainText");
            const nameCheck = checkConstraintForColumn("name", sqliteType, true);

            db.exec(
                `CREATE TABLE "${tableName}" (
                    _id TEXT PRIMARY KEY DEFAULT (generate_id()),
                    _created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    name ${sqliteType}_alpine_${fieldId} NOT NULL DEFAULT '',
                    CHECK(is_id(_id)),
                    CHECK(datetime(_created_at) IS NOT NULL),
                    ${nameCheck}
                ) WITHOUT ROWID`,
            );
            db.exec(`CREATE INDEX "${tableName}__created_at" ON "${tableName}"(_created_at)`);

            const viewId = generateChronologicalId<DatabaseViewId>();
            db.exec(`INSERT INTO _alpine_views (id, table_id, name) VALUES (?, ?, ?)`, {
                bind: [viewId, tableId, "Grid view"],
            });

            db.exec(
                `INSERT INTO _alpine_view_fields (view_id, field_id, position, width)
                 VALUES (?, ?, ?, ?)`,
                {bind: [viewId, fieldId, 0, 200]},
            );

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
            const rows = alpineTableRow.all(db, "SELECT * FROM _alpine_tables ORDER BY id");
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
            const tableResult = alpineTableRow.oneOrNone(
                db,
                "SELECT * FROM _alpine_tables WHERE id = ?",
                [tableOrViewId],
            );

            if (tableResult !== null) {
                tableId = tableResult.id;
                tableName = tableResult.tableName;

                // Pick the first view for this table.
                const view = alpineViewRow.one(
                    db,
                    "SELECT * FROM _alpine_views WHERE table_id = ? ORDER BY id LIMIT 1",
                    [tableId],
                );
                viewId = view.id;
            } else {
                // Try as a view ID.
                const view = alpineViewRow.one(db, "SELECT * FROM _alpine_views WHERE id = ?", [
                    tableOrViewId,
                ]);
                viewId = view.id;
                tableId = view.tableId;

                const table = alpineTableRow.one(db, "SELECT * FROM _alpine_tables WHERE id = ?", [
                    tableId,
                ]);
                tableName = table.tableName;
            }

            const fields = alpineViewFieldRow.all(
                db,
                `SELECT f.id, f.name, f.column_name, vf.width
                 FROM _alpine_view_fields vf
                 JOIN _alpine_fields f ON f.id = vf.field_id
                 WHERE vf.view_id = ?
                 ORDER BY vf.position`,
                [viewId],
            );

            const rows = db.exec(`SELECT * FROM "${tableName}"`, {
                returnValue: "resultRows",
                rowMode: "object",
            }) as Array<Record<string, unknown>>;
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
            const field = alpineFieldRow.one(
                db,
                "SELECT id, table_id, column_name FROM _alpine_fields WHERE id = ?",
                [fieldId],
            );
            const table = alpineTableRow.one(db, "SELECT * FROM _alpine_tables WHERE id = ?", [
                field.tableId,
            ]);
            db.exec(`UPDATE "${table.tableName}" SET "${field.columnName}" = ? WHERE _id = ?`, {
                bind: [value, rowId],
            });
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
            const table = alpineTableRow.one(db, "SELECT * FROM _alpine_tables WHERE id = ?", [
                tableId,
            ]);

            const existingColumnNames = new Set(
                (
                    db.exec("SELECT column_name FROM _alpine_fields WHERE table_id = ?", {
                        returnValue: "resultRows",
                        rowMode: "array",
                        bind: [tableId],
                    }) as Array<[string]>
                ).map(row => row[0]),
            );
            const columnName = formatUniqueSqlName(name, existingColumnNames);
            const fieldType = serializeDatabaseFieldType({type: "plainText"});

            db.exec(
                `INSERT INTO _alpine_fields (id, table_id, name, column_name, type)
                 VALUES (?, ?, ?, ?, ?)`,
                {bind: [fieldId, tableId, name, columnName, fieldType]},
            );

            const sqliteType = alpineFieldTypeToSqliteType("plainText");
            const check = checkConstraintForColumn(columnName, sqliteType, true);

            db.exec(
                `ALTER TABLE "${table.tableName}"
                 ADD COLUMN "${columnName}" ${sqliteType}_alpine_${fieldId} NOT NULL DEFAULT ''
                 ${check}`,
            );

            const maxPos = (
                db.exec("SELECT MAX(position) FROM _alpine_view_fields WHERE view_id = ?", {
                    returnValue: "resultRows",
                    rowMode: "array",
                    bind: [viewId],
                }) as Array<[number | null]>
            )[0]![0];

            db.exec(
                `INSERT INTO _alpine_view_fields (view_id, field_id, position, width)
                 VALUES (?, ?, ?, ?)`,
                {bind: [viewId, fieldId, (maxPos ?? -1) + 1, 200]},
            );

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
