import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {sql} from "~/shared/databases/sql.js";
import {pageAccessFlagRead, pageAccessFlagWrite} from "~/shared/databases/sqlite_constants.js";

const sqlite3Promise = sqlite3InitModule();

test("sqlite works", async () => {
    const sqlite3 = await sqlite3Promise;

    const db = new sqlite3.oo1.DB("/mydb.sqlite3", "ct");

    expect(
        db.selectArray(sql`
            SELECT
                1 + 1
        `.query),
    ).toEqual([2]);
});

describe("pageAccessHook", () => {
    test("read flag is pageAccessFlagRead, write flag is pageAccessFlagWrite", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-flags.sqlite3", "ct");

        db.exec(sql`CREATE TABLE t (a INTEGER)`.query);
        db.exec(sql`
            INSERT INTO
                t
            VALUES
                (1)
        `.query);

        const readFlags = new Set<number>();
        db.pageAccessHook((_schemaName, _pgno, flags) => {
            readFlags.add(flags);
        });
        db.exec(sql`
            SELECT
                *
            FROM
                t
        `.query);

        expect(readFlags.has(pageAccessFlagRead)).toBe(true);

        const writeFlags = new Set<number>();
        db.pageAccessHook((_schemaName, _pgno, flags) => {
            writeFlags.add(flags);
        });
        db.exec(sql`
            INSERT INTO
                t
            VALUES
                (2)
        `.query);

        expect(writeFlags.has(pageAccessFlagWrite)).toBe(true);

        db.pageAccessHook(null);
        db.close();
    });

    test("page numbers are 1-based", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-1based.sqlite3", "ct");

        db.exec(sql`CREATE TABLE t (a INTEGER)`.query);
        db.exec(sql`
            INSERT INTO
                t
            VALUES
                (1)
        `.query);

        const pages: Array<number> = [];
        db.pageAccessHook((_schemaName, pgno, flags) => {
            if (flags === pageAccessFlagRead) pages.push(pgno);
        });
        db.exec(sql`
            SELECT
                *
            FROM
                t
        `.query);

        // Page 1 is the schema page — always accessed on read.
        expect(pages).toContain(1);
        // No page should be 0 (SQLite pages start at 1).
        expect(pages.every(p => p >= 1)).toBe(true);

        db.pageAccessHook(null);
        db.close();
    });

    test("reports the root page of the queried table", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-rootpage.sqlite3", "ct");

        db.exec(sql`CREATE TABLE t1 (a INTEGER)`.query);
        db.exec(sql`CREATE TABLE t2 (a INTEGER)`.query);
        db.exec(sql`CREATE TABLE t3 (a INTEGER)`.query);
        db.exec(sql`
            INSERT INTO
                t1
            VALUES
                (1)
        `.query);
        db.exec(sql`
            INSERT INTO
                t2
            VALUES
                (2)
        `.query);
        db.exec(sql`
            INSERT INTO
                t3
            VALUES
                (3)
        `.query);

        const schema = db.exec(
            sql`
                SELECT
                    name,
                    rootpage
                FROM
                    sqlite_schema
                ORDER BY
                    name
            `.query,
            {
                returnValue: "resultRows",
                rowMode: "object",
            },
        ) as Array<{name: string; rootpage: number}>;

        for (const {name, rootpage} of schema) {
            const pages = new Set<number>();
            db.pageAccessHook((_schemaName, pgno, flags) => {
                if (flags === pageAccessFlagRead) pages.add(pgno);
            });
            db.exec(sql`
                SELECT
                    *
                FROM
                    ${sql.identifier(name)}
            `.query);

            expect(pages.has(rootpage)).toBe(true);
        }

        db.pageAccessHook(null);
        db.close();
    });

    test("different tables report different root pages", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-difftables.sqlite3", "ct");

        db.exec(sql`CREATE TABLE t1 (a INTEGER)`.query);
        db.exec(sql`CREATE TABLE t2 (a INTEGER)`.query);
        db.exec(sql`
            INSERT INTO
                t1
            VALUES
                (1)
        `.query);
        db.exec(sql`
            INSERT INTO
                t2
            VALUES
                (2)
        `.query);

        const pagesForT1 = new Set<number>();
        db.pageAccessHook((_schemaName, pgno, flags) => {
            if (flags === pageAccessFlagRead) pagesForT1.add(pgno);
        });
        db.exec(sql`
            SELECT
                *
            FROM
                t1
        `.query);

        const pagesForT2 = new Set<number>();
        db.pageAccessHook((_schemaName, pgno, flags) => {
            if (flags === pageAccessFlagRead) pagesForT2.add(pgno);
        });
        db.exec(sql`
            SELECT
                *
            FROM
                t2
        `.query);

        // Both should access page 1 (schema).
        expect(pagesForT1.has(1)).toBe(true);
        expect(pagesForT2.has(1)).toBe(true);

        // But they should differ on at least one page (the root page of each table).
        const onlyT1 = [...pagesForT1].filter(p => !pagesForT2.has(p));
        const onlyT2 = [...pagesForT2].filter(p => !pagesForT1.has(p));
        expect(onlyT1.length + onlyT2.length).toBeGreaterThan(0);

        db.pageAccessHook(null);
        db.close();
    });

    test("tracks write pages", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-write.sqlite3", "ct");

        db.exec(sql`CREATE TABLE t (a INTEGER)`.query);

        const writePages = new Set<number>();
        db.pageAccessHook((_schemaName, pgno, flags) => {
            if (flags === pageAccessFlagWrite) writePages.add(pgno);
        });
        db.exec(sql`
            INSERT INTO
                t
            VALUES
                (42)
        `.query);

        expect(writePages.size).toBeGreaterThan(0);

        db.pageAccessHook(null);
        db.close();
    });

    test("can be disabled", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-disable.sqlite3", "ct");

        db.exec(sql`CREATE TABLE t (a INTEGER)`.query);
        db.exec(sql`
            INSERT INTO
                t
            VALUES
                (1)
        `.query);

        const pages: Array<number> = [];
        db.pageAccessHook((_schemaName, pgno) => {
            pages.push(pgno);
        });
        db.exec(sql`
            SELECT
                *
            FROM
                t
        `.query);
        const countWithHook = pages.length;
        expect(countWithHook).toBeGreaterThan(0);

        // Disable the hook — subsequent queries should not add entries.
        db.pageAccessHook(null);
        db.exec(sql`
            SELECT
                *
            FROM
                t
        `.query);
        expect(pages.length).toBe(countWithHook);

        db.close();
    });

    test("fires on cached pages", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-cached.sqlite3", "ct");

        db.exec(sql`CREATE TABLE t (a INTEGER)`.query);
        db.exec(sql`
            INSERT INTO
                t
            VALUES
                (1)
        `.query);

        // First read warms the cache.
        db.exec(sql`
            SELECT
                *
            FROM
                t
        `.query);

        // Install hook after pages are cached, then read again.
        const firstRun: Array<number> = [];
        db.pageAccessHook((_schemaName, pgno, flags) => {
            if (flags === pageAccessFlagRead) firstRun.push(pgno);
        });
        db.exec(sql`
            SELECT
                *
            FROM
                t
        `.query);
        expect(firstRun.length).toBeGreaterThan(0);

        // A third read should fire the hook with the same pages.
        const secondRun: Array<number> = [];
        db.pageAccessHook((_schemaName, pgno, flags) => {
            if (flags === pageAccessFlagRead) secondRun.push(pgno);
        });
        db.exec(sql`
            SELECT
                *
            FROM
                t
        `.query);
        expect(secondRun).toEqual(firstRun);

        db.pageAccessHook(null);
        db.close();
    });

    test("schema name for the main database is main", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-main-schema.sqlite3", "ct");

        db.exec(sql`CREATE TABLE t (a INTEGER)`.query);
        db.exec(sql`
            INSERT INTO
                t
            VALUES
                (1)
        `.query);

        const schemas = new Set<string>();
        db.pageAccessHook(schemaName => {
            schemas.add(schemaName);
        });
        db.exec(sql`
            SELECT
                *
            FROM
                t
        `.query);

        expect(schemas.has("main")).toBe(true);

        db.pageAccessHook(null);
        db.close();
    });

    test("fires for attached databases with the AS-name as schema", async () => {
        const sqlite3 = await sqlite3Promise;
        const main = new sqlite3.oo1.DB("/test-main.sqlite3", "ct");
        const attached = new sqlite3.oo1.DB("/test-attached.sqlite3", "ct");

        attached.exec(sql`CREATE TABLE t2 (x INTEGER)`.query);
        attached.exec(sql`
            INSERT INTO
                t2
            VALUES
                (99)
        `.query);
        attached.close();

        main.exec(sql`CREATE TABLE t1 (a INTEGER)`.query);
        main.exec(sql`
            INSERT INTO
                t1
            VALUES
                (1)
        `.query);

        // ATTACH must happen BEFORE pageAccessHook so the new pager exists when we install
        // the hook.
        main.exec(sql`ATTACH '/test-attached.sqlite3' AS other`.query);

        const events: Array<{schema: string; pgno: number}> = [];
        main.pageAccessHook((schemaName, pgno, flags) => {
            if (flags === pageAccessFlagRead) events.push({schema: schemaName, pgno});
        });

        // Read from the attached database only.
        main.exec(sql`
            SELECT
                *
            FROM
                other.t2
        `.query);
        const fromAttached = events.filter(e => e.schema === "other");
        const initialMain = events.filter(e => e.schema === "main");

        // Read from the main database.
        events.length = 0;
        main.exec(sql`
            SELECT
                *
            FROM
                t1
        `.query);
        const fromMain = events.filter(e => e.schema === "main");

        expect(fromAttached.length).toBeGreaterThan(0);
        // Selecting from `other.t2` shouldn't have read main table pages (other than
        // perhaps ATTACH-related schema lookups, which we don't strictly assert on).
        void initialMain;
        expect(fromMain.length).toBeGreaterThan(0);
        // No event should report a schema we didn't open.
        const allSchemas = new Set(events.map(e => e.schema));
        for (const s of allSchemas) {
            expect(["main", "other"]).toContain(s);
        }

        main.pageAccessHook(null);
        main.exec(sql`DETACH other`.query);
        main.close();
    });
});
