/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {databaseActions} from "~/shared/databases/database_actions.js";
import {serializeDatabaseFieldType} from "~/shared/databases/database_field_type.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {runSqliteMigrations} from "~/shared/databases/sqlite_migrations.js";
import {isId} from "~/shared/id/id.js";

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

        const tables = db.exec("SELECT * FROM _alpine_tables", {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;
        expect(tables).toMatchObject([{id: tableId, name: "Tasks", table_name: "tasks"}]);

        const fields = db.exec("SELECT * FROM _alpine_fields", {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;
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

        db.exec(`INSERT INTO ${tableName} (name) VALUES ('Do laundry')`);
        const rows = db.exec(`SELECT * FROM ${tableName}`, {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;

        expect(isId(rows[0]!._id as string)).toBe(true);
        expect(rows).toMatchObject([{name: "Do laundry"}]);
        expect(rows[0]!._created_at).toBeDefined();
    });

    test("_id auto-generates a ChronologicalId", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        db.exec(`INSERT INTO ${tableName} (name) VALUES ('a')`);
        db.exec(`INSERT INTO ${tableName} (name) VALUES ('b')`);
        const rows = db.exec(`SELECT _id FROM ${tableName} ORDER BY _id`, {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;

        expect(rows).toHaveLength(2);
        expect(isId(rows[0]!._id as string)).toBe(true);
        expect(isId(rows[1]!._id as string)).toBe(true);
        expect(rows[0]!._id).not.toBe(rows[1]!._id);
    });

    test("_created_at auto-populates with datetime", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        db.exec(`INSERT INTO ${tableName} (name) VALUES ('x')`);
        const createdAt = db.selectValue(`SELECT _created_at FROM ${tableName}`) as string;

        // Matches YYYY-MM-DD HH:MM:SS format.
        expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    test("_created_at CHECK rejects unparseable values", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        expect(() => {
            db.exec(`INSERT INTO ${tableName} (_created_at, name) VALUES ('not-a-date', 'x')`);
        }).toThrow("CHECK");
    });

    test("name column defaults to empty string", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        db.exec(`INSERT INTO ${tableName} DEFAULT VALUES`);
        const name = db.selectValue(`SELECT name FROM ${tableName}`) as string;
        expect(name).toBe("");
    });

    test("name column CHECK rejects blobs", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        expect(() => {
            db.exec(`INSERT INTO ${tableName} (name) VALUES (x'00')`);
        }).toThrow("CHECK");
    });

    test("column type is encoded in type name", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        const colInfo = db.exec(`PRAGMA table_info(${tableName})`, {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;

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

        const indexes = db.exec(`PRAGMA index_list(${tableName})`, {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;

        expect(indexes.some(idx => (idx.name as string).includes("_created_at"))).toBe(true);
        db.close();
    });

    test("creates a default view", async () => {
        const db = await createDb();
        const {tableId} = databaseActions.createTable.run(db, {name: "Tasks"});

        const views = db.exec("SELECT * FROM _alpine_views WHERE table_id = ?", {
            bind: [tableId],
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;

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

        const viewFields = db.exec("SELECT * FROM _alpine_view_fields WHERE view_id = ?", {
            bind: [viewId],
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;

        expect(viewFields).toMatchObject([{view_id: viewId, position: 0, width: 200}]);
        db.close();
    });

    test("multiple tables get independent views", async () => {
        const db = await createDb();
        const first = databaseActions.createTable.run(db, {name: "Tasks"});
        const second = databaseActions.createTable.run(db, {name: "Projects"});

        const views = db.exec("SELECT * FROM _alpine_views ORDER BY id", {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;

        expect(views).toMatchObject([
            {table_id: first.tableId, name: "Grid view"},
            {table_id: second.tableId, name: "Grid view"},
        ]);

        const firstFields = db.exec("SELECT * FROM _alpine_view_fields WHERE view_id = ?", {
            bind: [first.viewId],
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;
        const secondFields = db.exec("SELECT * FROM _alpine_view_fields WHERE view_id = ?", {
            bind: [second.viewId],
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;

        expect(firstFields).toHaveLength(1);
        expect(secondFields).toHaveLength(1);
        expect(firstFields[0]!.field_id).not.toBe(secondFields[0]!.field_id);
        db.close();
    });
});
