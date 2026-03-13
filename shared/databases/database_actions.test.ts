import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {_testHelpers, databaseActions} from "~/shared/databases/database_actions.js";
import {runSqliteMigrations} from "~/shared/databases/sqlite_migrations.js";

const {toSqlName, alpineFieldTypeToSqliteType, checkConstraintForColumn} = _testHelpers;

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDb(): Promise<Database> {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-actions-${dbCounter++}.sqlite3`, "ct");
    runSqliteMigrations(db);
    return db;
}

// -- toSqlName ---------------------------------------------------------------

describe("toSqlName", () => {
    test("slugifies a simple name", async () => {
        const db = await createDb();
        expect(toSqlName(db, "My Table")).toBe("my_table");
        db.close();
    });

    test("collapses runs of underscores", async () => {
        const db = await createDb();
        expect(toSqlName(db, "a---b___c")).toBe("a_b_c");
        db.close();
    });

    test("strips leading underscores", async () => {
        const db = await createDb();
        expect(toSqlName(db, "_alpine_foo")).toBe("alpine_foo");
        db.close();
    });

    test("rewrites sqlite_ prefix to x_sqlite_", async () => {
        const db = await createDb();
        expect(toSqlName(db, "sqlite_master")).toBe("x_sqlite_master");
        db.close();
    });

    test("prefixes x_ when starts with digit", async () => {
        const db = await createDb();
        expect(toSqlName(db, "123abc")).toBe("x_123abc");
        db.close();
    });

    test("prefixes x_ when empty after slugification", async () => {
        const db = await createDb();
        expect(toSqlName(db, "!!!")).toBe("x");
        db.close();
    });

    test("strips trailing underscores", async () => {
        const db = await createDb();
        expect(toSqlName(db, "foo___")).toBe("foo");
        db.close();
    });

    test("appends _2, _3 for uniqueness", async () => {
        const db = await createDb();
        // eslint-disable-next-line cyberworlds/string-quotes
        db.exec(`INSERT INTO _alpine_tables (name, table_name) VALUES ('t', 'tasks')`);
        expect(toSqlName(db, "Tasks")).toBe("tasks_2");

        // eslint-disable-next-line cyberworlds/string-quotes
        db.exec(`INSERT INTO _alpine_tables (name, table_name) VALUES ('t', 'tasks_2')`);
        expect(toSqlName(db, "Tasks")).toBe("tasks_3");
        db.close();
    });
});

// -- createTable -------------------------------------------------------------

describe("createTable", () => {
    test("inserts metadata into _alpine_tables and _alpine_fields", async () => {
        const db = await createDb();
        const {tableId, tableName} = databaseActions.createTable.run(db, {name: "Tasks"});

        expect(tableId).toBe(1);
        expect(tableName).toBe("tasks");

        const tables = db.exec("SELECT * FROM _alpine_tables", {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;
        expect(tables).toMatchObject([{id: 1, name: "Tasks", table_name: "tasks"}]);

        const fields = db.exec("SELECT * FROM _alpine_fields", {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;
        expect(fields).toMatchObject([
            {
                table_id: 1,
                name: "Name",
                column_name: "name",
                // eslint-disable-next-line cyberworlds/string-quotes
                type: '{"type":"plainText"}',
            },
        ]);
        db.close();
    });

    test("creates a queryable table with system columns", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "Tasks"});

        // eslint-disable-next-line cyberworlds/string-quotes
        db.exec(`INSERT INTO ${tableName} (name) VALUES ('Do laundry')`);
        const rows = db.exec(`SELECT * FROM ${tableName}`, {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;

        expect(rows).toMatchObject([{_id: 1, name: "Do laundry"}]);
        expect(rows[0]!._created_at).toBeDefined();
    });

    test("_id is an alias for rowid", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        // eslint-disable-next-line cyberworlds/string-quotes
        db.exec(`INSERT INTO ${tableName} (name) VALUES ('a')`);
        const row = db.exec(`SELECT _id, rowid AS rid FROM ${tableName}`, {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<Record<string, unknown>>;

        expect(row[0]!._id).toBe(row[0]!.rid);
    });

    test("_created_at auto-populates with datetime", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        // eslint-disable-next-line cyberworlds/string-quotes
        db.exec(`INSERT INTO ${tableName} (name) VALUES ('x')`);
        const createdAt = db.selectValue(`SELECT _created_at FROM ${tableName}`) as string;

        // Matches YYYY-MM-DD HH:MM:SS format.
        expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    test("_created_at CHECK rejects unparseable values", async () => {
        const db = await createDb();
        const {tableName} = databaseActions.createTable.run(db, {name: "T"});

        expect(() => {
            // eslint-disable-next-line cyberworlds/string-quotes
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
            // eslint-disable-next-line cyberworlds/string-quotes
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
        expect(nameCol!.type).toMatch(/^TEXT_alpine_\d+$/);
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
});

// -- alpineFieldTypeToSqliteType ---------------------------------------------

describe("alpineFieldTypeToSqliteType", () => {
    test("maps plainText to TEXT", () => {
        expect(alpineFieldTypeToSqliteType("plainText")).toBe("TEXT");
    });

    test("maps number to REAL", () => {
        expect(alpineFieldTypeToSqliteType("number")).toBe("REAL");
    });

    test("maps boolean to INTEGER", () => {
        expect(alpineFieldTypeToSqliteType("boolean")).toBe("INTEGER");
    });
});

// -- checkConstraintForColumn ------------------------------------------------

/* eslint-disable cyberworlds/string-quotes */
describe("checkConstraintForColumn", () => {
    test("TEXT NOT NULL", () => {
        expect(checkConstraintForColumn("col", "TEXT", true)).toBe("CHECK(typeof(col) = 'text')");
    });

    test("TEXT nullable", () => {
        expect(checkConstraintForColumn("col", "TEXT", false)).toBe(
            "CHECK(typeof(col) = 'text' OR col IS NULL)",
        );
    });

    test("REAL NOT NULL", () => {
        expect(checkConstraintForColumn("col", "REAL", true)).toBe(
            "CHECK(typeof(col) IN ('real', 'integer'))",
        );
    });

    test("INTEGER NOT NULL", () => {
        expect(checkConstraintForColumn("col", "INTEGER", true)).toBe(
            "CHECK(typeof(col) = 'integer')",
        );
    });
});
/* eslint-enable cyberworlds/string-quotes */
