/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {
    alpineFieldTypeToSqliteType,
    checkConstraintForColumn,
    toSqlName,
} from "~/shared/databases/internal/database_sql_helpers.js";
import {runSqliteMigrations} from "~/shared/databases/sqlite_migrations.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDb(): Promise<Database> {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-helpers-${dbCounter++}.sqlite3`, "ct");
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
        db.exec(`INSERT INTO _alpine_tables (name, table_name) VALUES ('t', 'tasks')`);
        expect(toSqlName(db, "Tasks")).toBe("tasks_2");

        db.exec(`INSERT INTO _alpine_tables (name, table_name) VALUES ('t', 'tasks_2')`);
        expect(toSqlName(db, "Tasks")).toBe("tasks_3");
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
