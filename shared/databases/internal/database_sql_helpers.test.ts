/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import {
    alpineFieldTypeToSqliteType,
    checkConstraintForColumn,
    formatUniqueSqlName,
} from "~/shared/databases/internal/database_sql_helpers.js";

const empty = new Set<string>();

// -- formatUniqueSqlName ------------------------------------------------------

describe("formatUniqueSqlName", () => {
    test("slugifies a simple name", () => {
        expect(formatUniqueSqlName("My Table", empty)).toBe("my_table");
    });

    test("collapses runs of underscores", () => {
        expect(formatUniqueSqlName("a---b___c", empty)).toBe("a_b_c");
    });

    test("strips leading underscores", () => {
        expect(formatUniqueSqlName("_alpine_foo", empty)).toBe("alpine_foo");
    });

    test("rewrites sqlite_ prefix to x_sqlite_", () => {
        expect(formatUniqueSqlName("sqlite_master", empty)).toBe("x_sqlite_master");
    });

    test("prefixes x_ when starts with digit", () => {
        expect(formatUniqueSqlName("123abc", empty)).toBe("x_123abc");
    });

    test("prefixes x_ when empty after slugification", () => {
        expect(formatUniqueSqlName("!!!", empty)).toBe("x");
    });

    test("strips trailing underscores", () => {
        expect(formatUniqueSqlName("foo___", empty)).toBe("foo");
    });

    test("appends _2, _3 for uniqueness", () => {
        expect(formatUniqueSqlName("Tasks", new Set(["tasks"]))).toBe("tasks_2");
        expect(formatUniqueSqlName("Tasks", new Set(["tasks", "tasks_2"]))).toBe("tasks_3");
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
