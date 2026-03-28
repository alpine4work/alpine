/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {databaseActions} from "~/shared/databases/database_actions.js";
import {serializeDatabaseFieldType} from "~/shared/databases/database_field_type.js";
import {sql} from "~/shared/databases/sql.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {runSqliteMigrations} from "~/shared/databases/sqlite_migrations.js";
import {isId} from "~/shared/id/id.js";
import {Schema} from "~/shared/schema/schema.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDb(): Promise<Database> {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-actions-${dbCounter++}.sqlite3`, "ct");
    registerSqliteCustomFunctions(db);
    runSqliteMigrations(db);
    return db;
}

describe("createTable", () => {
    test("inserts metadata into _alpine_tables and _alpine_fields", async () => {
        const db = await createDb();
        const {tableId, tableName} = databaseActions.createTable.run(db, {name: "Tasks"});

        expect(isId(tableId)).toBe(true);
        expect(tableName).toBe("tasks");

        const tables = sql`
            SELECT
                *
            FROM
                _alpine_tables
        `.selectAllUnknown(db);
        expect(tables).toMatchObject([{id: tableId, name: "Tasks", table_name: "tasks"}]);

        const fields = sql`
            SELECT
                *
            FROM
                _alpine_fields
        `.selectAllUnknown(db);
        expect(fields).toMatchObject([
            {
                table_id: tableId,
                name: "Name",
                column_name: "name",
                type: serializeDatabaseFieldType({type: "plainText"}),
            },
        ]);
        db.close();
    });

    test("creates a queryable table with system columns", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "Tasks"});

        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('Do laundry')
        `.exec(db);
        const rows = sql`
            SELECT
                *
            FROM
                ${sql.identifier(tableName)}
        `.selectAllUnknown(db);

        expect(isId(rows[0]!._id as string)).toBe(true);
        expect(rows).toMatchObject([{name: "Do laundry"}]);
        expect(rows[0]!._created_at).toBeDefined();
    });

    test("_id auto-generates a ChronologicalId", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('a')
        `.exec(db);
        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('b')
        `.exec(db);
        const rows = sql`
            SELECT
                _id
            FROM
                ${sql.identifier(tableName)}
            ORDER BY
                _id
        `.selectAllUnknown(db);

        expect(rows).toHaveLength(2);
        expect(isId(rows[0]!._id as string)).toBe(true);
        expect(isId(rows[1]!._id as string)).toBe(true);
        expect(rows[0]!._id).not.toBe(rows[1]!._id);
    });

    test("_created_at auto-populates with datetime", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        sql`
            INSERT INTO
                ${sql.identifier(tableName)} (name)
            VALUES
                ('x')
        `.exec(db);
        const createdAt = sql`
            SELECT
                _created_at
            FROM
                ${sql.identifier(tableName)}
        `.selectOne(db, {
            createdAt: Schema.string.originalPropertyKey("_created_at"),
        }).createdAt;

        // Matches YYYY-MM-DD HH:MM:SS format.
        expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    test("_created_at CHECK rejects unparseable values", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        expect(() => {
            sql`
                INSERT INTO
                    ${sql.identifier(tableName)} (_created_at, name)
                VALUES
                    ('not-a-date', 'x')
            `.exec(db);
        }).toThrow("CHECK");
    });

    test("name column defaults to empty string", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        sql`
            INSERT INTO
                ${sql.identifier(tableName)} DEFAULT
            VALUES
        `.exec(db);
        const name = sql`
            SELECT
                name
            FROM
                ${sql.identifier(tableName)}
        `.selectOne(db, {
            name: Schema.string,
        }).name;
        expect(name).toBe("");
    });

    test("name column CHECK rejects blobs", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        expect(() => {
            sql`
                INSERT INTO
                    ${sql.identifier(tableName)} (name)
                VALUES
                    (${sql.raw("x'00'")})
            `.exec(db);
        }).toThrow("CHECK");
    });

    test("column type is encoded in type name", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        const colInfo = sql`PRAGMA table_info (${sql.identifier(tableName)})`.selectAllUnknown(db);

        const nameCol = colInfo.find(c => c.name === "name");
        expect(nameCol!.type).toMatch(/^TEXT_alpine_[0-9a-z]{26}$/);
    });

    test("duplicate name gets unique suffix", async () => {
        const db = await createDb();
        const first = databaseActions.createTable.run(db, {name: "Tasks"});
        const second = databaseActions.createTable.run(db, {name: "Tasks"});

        expect(first.tableName).toBe("tasks");
        expect(second.tableName).toBe("tasks_2");
    });

    test("index exists on _created_at", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        const indexes = sql`PRAGMA index_list (${sql.identifier(tableName)})`.selectAllUnknown(db);

        expect(indexes.some(idx => (idx.name as string).includes("_created_at"))).toBe(true);
        db.close();
    });

    test("creates a default view", async () => {
        const db = await createDb();
        const {tableId} = databaseActions.createTable.run(db, {name: "Tasks"});

        const views = sql`
            SELECT
                *
            FROM
                _alpine_views
            WHERE
                table_id = ${tableId}
        `.selectAllUnknown(db);

        expect(views).toMatchObject([{table_id: tableId, name: "Grid view"}]);
        db.close();
    });

    test("returns viewId", async () => {
        const db = await createDb();
        const {viewId} = databaseActions.createTable.run(db, {name: "Tasks"});

        expect(isId(viewId)).toBe(true);
        db.close();
    });

    test("default view contains the Name field", async () => {
        const db = await createDb();
        const {viewId} = databaseActions.createTable.run(db, {name: "Tasks"});

        const viewFields = sql`
            SELECT
                *
            FROM
                _alpine_view_fields
            WHERE
                view_id = ${viewId}
        `.selectAllUnknown(db);

        expect(viewFields).toMatchObject([{view_id: viewId, position: 0, width: 200}]);
        db.close();
    });

    test("multiple tables get independent views", async () => {
        const db = await createDb();
        const first = databaseActions.createTable.run(db, {name: "Tasks"});
        const second = databaseActions.createTable.run(db, {name: "Projects"});

        const views = sql`
            SELECT
                *
            FROM
                _alpine_views
            ORDER BY
                id
        `.selectAllUnknown(db);

        expect(views).toMatchObject([
            {table_id: first.tableId, name: "Grid view"},
            {table_id: second.tableId, name: "Grid view"},
        ]);

        const firstFields = sql`
            SELECT
                *
            FROM
                _alpine_view_fields
            WHERE
                view_id = ${first.viewId}
        `.selectAllUnknown(db);
        const secondFields = sql`
            SELECT
                *
            FROM
                _alpine_view_fields
            WHERE
                view_id = ${second.viewId}
        `.selectAllUnknown(db);

        expect(firstFields).toHaveLength(1);
        expect(secondFields).toHaveLength(1);
        expect(firstFields[0]!.field_id).not.toBe(secondFields[0]!.field_id);
        db.close();
    });
});
