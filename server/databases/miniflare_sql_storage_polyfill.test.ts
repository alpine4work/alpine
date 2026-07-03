/**
 * Tests for the `SqlStorage` and `transactionSync` polyfill patched into
 * `@miniflare/durable-objects`. Verifies that our better-sqlite3-backed
 * implementation matches the Cloudflare `SqlStorage` API surface used by {@link
 * DatabaseDurableObjectStorage}.
 */

import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {SqlQuery, sql} from "~/shared/databases/sql.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";

// Cast to `any` because Miniflare's DurableObjectStorage type doesn't include our
// patched `sql` / `transactionSync` in the upstream .d.ts that TypeScript resolves
// for the global type.
let storage: any;

beforeEach(() => {
    storage = new DurableObjectStorage(new MemoryStorage());
});

function exec(query: SqlQuery, ...bind: Array<unknown>) {
    return storage.sql.exec(query.query, ...query.bind, ...bind);
}

describe("SqlStorage cursor API", () => {
    test("exec returns cursor with correct columnNames", () => {
        exec(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (1, 'a')
        `);

        const cursor = exec(sql`
            SELECT
                id,
                name
            FROM
                t
        `);

        expect(cursor.columnNames).toEqual(["id", "name"]);
    });

    test("next iterates rows and signals done", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (10)
        `);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (20)
        `);

        const cursor = exec(sql`
            SELECT
                v
            FROM
                t
            ORDER BY
                v
        `);

        expect(cursor.next()).toMatchObject({done: false, value: {v: 10}});
        expect(cursor.next()).toMatchObject({done: false, value: {v: 20}});
        expect(cursor.next()).toMatchObject({done: true});
    });

    test("toArray drains remaining rows", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (1)
        `);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (2)
        `);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (3)
        `);

        const cursor = exec(sql`
            SELECT
                v
            FROM
                t
            ORDER BY
                v
        `);
        // Consume the first row via next(), then drain the rest.
        cursor.next();

        expect(cursor.toArray()).toEqual([{v: 2}, {v: 3}]);
    });

    test("one returns the single row", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (42)
        `);

        expect(
            exec(sql`
                SELECT
                    v
                FROM
                    t
            `).one(),
        ).toEqual({v: 42});
    });

    test("one throws when zero rows", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);

        expect(() =>
            exec(sql`
                SELECT
                    v
                FROM
                    t
            `).one(),
        ).toThrow("0");
    });

    test("one throws when more than one row", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (1)
        `);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (2)
        `);

        expect(() =>
            exec(sql`
                SELECT
                    v
                FROM
                    t
            `).one(),
        ).toThrow("2");
    });

    test("Symbol.iterator works in for-of", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (1)
        `);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (2)
        `);

        const values: Array<number> = [];
        for (const row of exec(sql`
            SELECT
                v
            FROM
                t
            ORDER BY
                v
        `)) {
            values.push(row.v);
        }

        expect(values).toEqual([1, 2]);
    });

    test("rowsRead reflects number of rows returned by SELECT", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (1)
        `);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (2)
        `);

        const cursor = exec(sql`
            SELECT
                v
            FROM
                t
        `);

        expect(cursor.rowsRead).toBe(2);
    });

    test("rowsWritten reflects rows changed by INSERT", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);

        const cursor = exec(sql`
            INSERT INTO
                t
            VALUES
                (1),
                (2),
                (3)
        `);

        expect(cursor.rowsWritten).toBe(3);
    });
});

describe("data types and binding conversion", () => {
    test("string, number, and null round-trip", () => {
        exec(sql`CREATE TABLE t (s TEXT, n REAL, nu TEXT)`);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (
                    ${"hello"},
                    ${3.14},
                    ${null}
                )
        `);

        expect(
            exec(sql`
                SELECT
                    *
                FROM
                    t
            `).one(),
        ).toEqual({
            s: "hello",
            n: 3.14,
            nu: null,
        });
    });

    test("ArrayBuffer blob round-trips as ArrayBuffer", () => {
        exec(sql`CREATE TABLE t (data BLOB)`);

        const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        exec(
            sql`
                INSERT INTO
                    t
                VALUES
                    (?)
            `,
            input.buffer,
        );

        const row = exec(sql`
            SELECT
                data
            FROM
                t
        `).one();

        expect(row.data).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(row.data)).toEqual(input);
    });

    test("page-sized blob round-trips correctly", () => {
        exec(sql`CREATE TABLE t (data BLOB)`);

        const page = new Uint8Array(sqlitePageSize);
        page[0] = 0x53;
        page[1] = 0x51;
        page[sqlitePageSize - 1] = 0xff;
        exec(
            sql`
                INSERT INTO
                    t
                VALUES
                    (?)
            `,
            page.buffer,
        );

        const row = exec(sql`
            SELECT
                data
            FROM
                t
        `).one();
        const result = new Uint8Array(row.data);

        expect(result.byteLength).toBe(sqlitePageSize);
        expect(result[0]).toBe(0x53);
        expect(result[1]).toBe(0x51);
        expect(result[sqlitePageSize - 1]).toBe(0xff);
    });
});

describe("transactionSync", () => {
    test("commits on success", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);

        storage.transactionSync(() => {
            exec(sql`
                INSERT INTO
                    t
                VALUES
                    (1)
            `);
            exec(sql`
                INSERT INTO
                    t
                VALUES
                    (2)
            `);
        });

        expect(
            exec(sql`
                SELECT
                    COUNT(*) AS c
                FROM
                    t
            `).one(),
        ).toEqual({
            c: 2,
        });
    });

    test("rolls back on thrown error", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (0)
        `);

        expect(() =>
            storage.transactionSync(() => {
                exec(sql`
                    INSERT INTO
                        t
                    VALUES
                        (1)
                `);
                throw new Error("abort"); // eslint-disable-line cyberworlds/no-global-error
            }),
        ).toThrow("abort");

        expect(
            exec(sql`
                SELECT
                    COUNT(*) AS c
                FROM
                    t
            `).one(),
        ).toEqual({
            c: 1,
        });
    });

    test("returns the closure return value", () => {
        exec(sql`CREATE TABLE t (v INTEGER)`);
        exec(sql`
            INSERT INTO
                t
            VALUES
                (42)
        `);

        const result = storage.transactionSync(() => {
            return exec(sql`
                SELECT
                    v
                FROM
                    t
            `).one().v;
        });

        expect(result).toBe(42);
    });
});
