/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {serializeDatabaseFieldType} from "~/shared/databases/database_field_type.js";
import {
    alpineFieldTypeToSqliteType,
    checkConstraintForColumn,
    toSqlName,
} from "~/shared/databases/internal/database_sql_helpers.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseFieldId, DatabaseTableId, DatabaseViewId} from "~/shared/id/types/id_types.js";
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
            tableId: Schema.id<DatabaseTableId>(),
            tableName: Schema.string,
            viewId: Schema.id<DatabaseViewId>(),
        }),
        writeLevel: "schema+data",
        run(db, {name}) {
            const tableName = toSqlName(db, name);
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
