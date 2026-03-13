/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {serializeDatabaseFieldType} from "~/shared/databases/database_field_type.js";
import {
    alpineFieldTypeToSqliteType,
    checkConstraintForColumn,
    toSqlName,
} from "~/shared/databases/internal/database_sql_helpers.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {type ObjectSchema, Schema, type SchemaType} from "~/shared/schema/schema.js";

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

    createTable: defineDatabaseAction({
        input: Schema.object({name: Schema.string}),
        output: Schema.object({
            tableId: Schema.integer,
            tableName: Schema.string,
            viewId: Schema.integer,
        }),
        writeLevel: "schema+data",
        run(db, {name}) {
            const tableName = toSqlName(db, name);

            db.exec(`INSERT INTO _alpine_tables (name, table_name) VALUES (?, ?)`, {
                bind: [name, tableName],
            });
            const tableId = db.selectValue("SELECT last_insert_rowid()") as number;

            const fieldType = serializeDatabaseFieldType({type: "plainText"});
            db.exec(
                `INSERT INTO _alpine_fields (table_id, name, column_name, type)
                 VALUES (?, ?, ?, ?)`,
                {bind: [tableId, "Name", "name", fieldType]},
            );
            const fieldId = db.selectValue("SELECT last_insert_rowid()") as number;

            const sqliteType = alpineFieldTypeToSqliteType("plainText");
            const nameCheck = checkConstraintForColumn("name", sqliteType, true);

            db.exec(
                `CREATE TABLE "${tableName}" (
                    _id INTEGER PRIMARY KEY,
                    _created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    name ${sqliteType}_alpine_${fieldId} NOT NULL DEFAULT '',
                    CHECK(datetime(_created_at) IS NOT NULL),
                    ${nameCheck}
                )`,
            );
            db.exec(`CREATE INDEX "${tableName}__created_at" ON "${tableName}"(_created_at)`);

            db.exec(`INSERT INTO _alpine_views (table_id, name) VALUES (?, ?)`, {
                bind: [tableId, "Grid view"],
            });
            const viewId = db.selectValue("SELECT last_insert_rowid()") as number;

            db.exec(
                `INSERT INTO _alpine_view_fields (view_id, field_id, position, width)
                 VALUES (?, ?, ?, ?)`,
                {bind: [viewId, fieldId, 0, 200]},
            );

            return {tableId, tableName, viewId};
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
