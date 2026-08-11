import {formatUniqueSqlName} from "~/shared/databases/internal/format_unique_sql_name.js";

const empty = new Set<string>();

// -- formatUniqueSqlName ------------------------------------------------------

describe("formatUniqueSqlName", () => {
    test("slugifies a simple name", () => {
        expect(formatUniqueSqlName("My Table", empty)).toBe("my_table");
    });

    test("uses URL slug accent normalization", () => {
        expect(formatUniqueSqlName("Crème brûlée", empty)).toBe("creme_brulee");
    });

    test("uses URL slug ampersand normalization", () => {
        expect(formatUniqueSqlName("Research & Development", empty)).toBe(
            "research_and_development",
        );
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
