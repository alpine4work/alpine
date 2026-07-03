import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {SqlQuery, sql} from "~/shared/databases/sql.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
import {JsonStringifiableUint8Array, Schema} from "~/shared/schema/schema.js";

const sqlite3Promise = sqlite3InitModule();
const sqliteDoubleQuote = String.fromCharCode(34);

let db: Database;

beforeEach(async () => {
    const sqlite3 = await sqlite3Promise;
    db = new sqlite3.oo1.DB(":memory:", "ct");
    db.exec(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)`.query);
    db.exec(sql`
        INSERT INTO
            t
        VALUES
            (1, 'alice', 10)
    `.query);
    db.exec(sql`
        INSERT INTO
            t
        VALUES
            (2, 'bob', 20)
    `.query);
    db.exec(sql`
        INSERT INTO
            t
        VALUES
            (3, 'carol', 30)
    `.query);
});

afterEach(() => {
    db.close();
});

// The SQL-tag formatter rewrites `sql` template bodies into multi-line, indented
// SQL, and the template no longer collapses whitespace. Assert on structure
// (whitespace flattened) rather than the formatter's exact text.
function structure(query: string): string {
    return query.replace(/\s+/g, " ").trim();
}

describe("sql tagged template", () => {
    test("interpolates bind parameters as ?", () => {
        const q = sql`
            SELECT
                *
            FROM
                t
            WHERE
                id = ${1}
        `;
        expect(structure(q.query)).toBe("SELECT * FROM t WHERE id = ?");
        expect(q.bind).toEqual([1]);
    });

    test("handles multiple bind parameters", () => {
        const q = sql`
            SELECT
                *
            FROM
                t
            WHERE
                id = ${1}
                AND name = ${"alice"}
        `;
        expect(structure(q.query)).toBe("SELECT * FROM t WHERE id = ? AND name = ?");
        expect(q.bind).toEqual([1, "alice"]);
    });

    test("handles no interpolations", () => {
        const q = sql`
            SELECT
                1
        `;
        expect(structure(q.query)).toBe("SELECT 1");
        expect(q.bind).toEqual([]);
    });

    test("returns a SqlQuery instance", () => {
        expect(sql`
            SELECT
                1
        `).toBeInstanceOf(SqlQuery);
    });

    test("inlines SqlQuery values verbatim", () => {
        const q = sql`
            SELECT
                *
            FROM
                t ${sql.raw("ORDER BY id DESC")}
        `;
        expect(structure(q.query)).toBe("SELECT * FROM t ORDER BY id DESC");
        expect(q.bind).toEqual([]);
    });

    test("inlines subquery and merges bindings", () => {
        const sub = sql`
            SELECT
                id
            FROM
                other
            WHERE
                x = ${42}
        `;
        const q = sql`
            SELECT
                *
            FROM
                t
            WHERE
                id IN (${sub})
        `;
        expect(structure(q.query)).toBe(
            "SELECT * FROM t WHERE id IN ( SELECT id FROM other WHERE x = ? )",
        );
        expect(q.bind).toEqual([42]);
    });

    test("mixes raw and bound values", () => {
        const q = sql`
            SELECT
                *
            FROM
                ${sql.identifier("t")}
            WHERE
                id = ${1}
        `;
        expect(structure(q.query)).toBe(
            `SELECT * FROM ${sqliteDoubleQuote}t${sqliteDoubleQuote} WHERE id = ?`,
        );
        expect(q.bind).toEqual([1]);
    });

    test("binds a Uint8Array as a BLOB rather than JSON text", () => {
        const blob = new JsonStringifiableUint8Array([0, 1, 2, 255]);
        const q = sql`
            SELECT
                ${blob}
        `;
        // The value must reach the binding untouched, not stringified.
        expect(q.bind).toEqual([blob]);
    });
});

describe("sql.raw", () => {
    test("returns a SqlQuery instance", () => {
        expect(sql.raw("ORDER BY id")).toBeInstanceOf(SqlQuery);
    });

    test("has the raw text as query", () => {
        const q = sql.raw("ORDER BY id");
        expect(q.query).toBe("ORDER BY id");
        expect(q.bind).toEqual([]);
    });
});

describe("sql.identifier", () => {
    test("quotes a simple name", () => {
        const q = sql.identifier("my_table");
        expect(q.query).toBe(`${sqliteDoubleQuote}my_table${sqliteDoubleQuote}`);
    });

    test("escapes double quotes", () => {
        const q = sql.identifier(["my ", "table"].join(sqliteDoubleQuote));
        expect(q.query).toBe(
            `${sqliteDoubleQuote}my ${sqliteDoubleQuote}${sqliteDoubleQuote}table${sqliteDoubleQuote}${sqliteDoubleQuote}${sqliteDoubleQuote}`,
        );
    });

    test("qualifies multiple names", () => {
        const q = sql.identifier("table_alias", "column_name");
        expect(q.query).toBe(
            `${sqliteDoubleQuote}table_alias${sqliteDoubleQuote}.${sqliteDoubleQuote}column_name${sqliteDoubleQuote}`,
        );
    });
});

describe("sql.tableRef", () => {
    test("qualifies a name with the table prefixed schema", () => {
        const q = sql.tableRef("abc123" as DatabaseTableId, "my_table");
        expect(q.query).toBe(
            `${sqliteDoubleQuote}_alpine_schema_abc123${sqliteDoubleQuote}.${sqliteDoubleQuote}my_table${sqliteDoubleQuote}`,
        );
    });

    test("escapes double quotes in the name", () => {
        const q = sql.tableRef("abc123" as DatabaseTableId, ["c ", "d"].join(sqliteDoubleQuote));
        expect(q.query).toBe(
            `${sqliteDoubleQuote}_alpine_schema_abc123${sqliteDoubleQuote}.${sqliteDoubleQuote}c ${sqliteDoubleQuote}${sqliteDoubleQuote}d${sqliteDoubleQuote}${sqliteDoubleQuote}${sqliteDoubleQuote}`,
        );
    });
});

describe("sql.raw execution", () => {
    test("executes a raw SQL string", () => {
        const rows = sql.raw("SELECT id, name FROM t ORDER BY id").selectAll(db, {
            id: Schema.integer,
            name: Schema.string,
        });
        expect(rows).toEqual([
            {id: 1, name: "alice"},
            {id: 2, name: "bob"},
            {id: 3, name: "carol"},
        ]);
    });
});

describe("selectAll", () => {
    test("returns all matching rows", () => {
        const rows = sql`
            SELECT
                id,
                name
            FROM
                t
            ORDER BY
                id
        `.selectAll(db, {
            id: Schema.integer,
            name: Schema.string,
        });
        expect(rows).toEqual([
            {id: 1, name: "alice"},
            {id: 2, name: "bob"},
            {id: 3, name: "carol"},
        ]);
    });

    test("returns empty array when no rows match", () => {
        const rows = sql`
            SELECT
                id
            FROM
                t
            WHERE
                id = ${999}
        `.selectAll(db, {
            id: Schema.integer,
        });
        expect(rows).toEqual([]);
    });

    test("binds parameters correctly", () => {
        const rows = sql`
            SELECT
                name
            FROM
                t
            WHERE
                score > ${15}
        `.selectAll(db, {
            name: Schema.string,
        });
        expect(rows).toEqual([{name: "bob"}, {name: "carol"}]);
    });
});

describe("selectValues", () => {
    test("returns each row single column as an array", () => {
        const names = sql`
            SELECT
                name
            FROM
                t
            ORDER BY
                id
        `.selectValues(db, Schema.string);
        expect(names).toEqual(["alice", "bob", "carol"]);
    });

    test("returns an empty array when no rows match", () => {
        const names = sql`
            SELECT
                name
            FROM
                t
            WHERE
                id = ${999}
        `.selectValues(db, Schema.string);
        expect(names).toEqual([]);
    });
});

describe("selectOne", () => {
    test("returns the single matching row", () => {
        const row = sql`
            SELECT
                name
            FROM
                t
            WHERE
                id = ${1}
        `.selectOne(db, {
            name: Schema.string,
        });
        expect(row).toEqual({name: "alice"});
    });

    test("asserts when zero rows returned", () => {
        expect(() =>
            sql`
                SELECT
                    name
                FROM
                    t
                WHERE
                    id = ${999}
            `.selectOne(db, {
                name: Schema.string,
            }),
        ).toThrow("Expected 1 row, got 0");
    });

    test("asserts when multiple rows returned", () => {
        expect(() =>
            sql`
                SELECT
                    name
                FROM
                    t
            `.selectOne(db, {
                name: Schema.string,
            }),
        ).toThrow("Expected 1 row, got 3");
    });
});

describe("selectOneOrNone", () => {
    test("returns the row when one matches", () => {
        const row = sql`
            SELECT
                name
            FROM
                t
            WHERE
                id = ${2}
        `.selectOneOrNone(db, {
            name: Schema.string,
        });
        expect(row).toEqual({name: "bob"});
    });

    test("returns null when no rows match", () => {
        const row = sql`
            SELECT
                name
            FROM
                t
            WHERE
                id = ${999}
        `.selectOneOrNone(db, {
            name: Schema.string,
        });
        expect(row).toBeNull();
    });

    test("asserts when multiple rows returned", () => {
        expect(() =>
            sql`
                SELECT
                    name
                FROM
                    t
            `.selectOneOrNone(db, {
                name: Schema.string,
            }),
        ).toThrow("Expected at most 1 row, got 3");
    });
});

describe("selectValue", () => {
    test("returns a single scalar", () => {
        expect(
            sql`
                SELECT
                    1 + 1
            `.selectValue(db, Schema.integer),
        ).toBe(2);
    });

    test("binds parameters", () => {
        expect(
            sql`
                SELECT
                    score
                FROM
                    t
                WHERE
                    id = ${2}
            `.selectValue(db, Schema.integer),
        ).toBe(20);
    });

    test("asserts when zero rows returned", () => {
        expect(() =>
            sql`
                SELECT
                    id
                FROM
                    t
                WHERE
                    id = ${999}
            `.selectValue(db, Schema.integer),
        ).toThrow("Expected 1 row, got 0");
    });

    test("asserts when multiple rows returned", () => {
        expect(() =>
            sql`
                SELECT
                    id
                FROM
                    t
            `.selectValue(db, Schema.integer),
        ).toThrow("Expected 1 row, got more");
    });

    test("asserts when multiple columns returned", () => {
        expect(() =>
            sql`
                SELECT
                    id,
                    name
                FROM
                    t
                WHERE
                    id = ${1}
            `.selectValue(db, Schema.integer),
        ).toThrow("Expected 1 column, got 2");
    });
});

describe("exec", () => {
    test("executes DDL", () => {
        sql`CREATE TABLE t2 (x INTEGER)`.exec(db);
        const rows = sql`
            SELECT
                name
            FROM
                sqlite_schema
            WHERE
                name = ${"t2"}
        `.selectAll(db, {
            name: Schema.string,
        });
        expect(rows).toEqual([{name: "t2"}]);
    });

    test("executes INSERT with bindings", () => {
        sql`
            INSERT INTO
                t
            VALUES
                (
                    ${4},
                    ${"dave"},
                    ${40}
                )
        `.exec(db);
        const row = sql`
            SELECT
                name
            FROM
                t
            WHERE
                id = ${4}
        `.selectOne(db, {
            name: Schema.string,
        });
        expect(row).toEqual({name: "dave"});
    });
});
