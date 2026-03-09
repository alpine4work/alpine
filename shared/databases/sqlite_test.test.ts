import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {pageAccessFlagRead, pageAccessFlagWrite} from "~/shared/databases/sqlite_constants.js";

const sqlite3Promise = sqlite3InitModule();

test("sqlite works", async () => {
    const sqlite3 = await sqlite3Promise;

    const db = new sqlite3.oo1.DB("/mydb.sqlite3", "ct");

    expect(db.selectArray("SELECT 1 + 1")).toEqual([2]);
});

describe("pageAccessHook", () => {
    test("read flag is pageAccessFlagRead, write flag is pageAccessFlagWrite", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-flags.sqlite3", "ct");

        db.exec("CREATE TABLE t(a INTEGER)");
        db.exec("INSERT INTO t VALUES(1)");

        const readFlags = new Set<number>();
        db.pageAccessHook((_pArg, _pgno, flags) => {
            readFlags.add(flags);
        });
        db.exec("SELECT * FROM t");

        expect(readFlags.has(pageAccessFlagRead)).toBe(true);

        const writeFlags = new Set<number>();
        db.pageAccessHook((_pArg, _pgno, flags) => {
            writeFlags.add(flags);
        });
        db.exec("INSERT INTO t VALUES(2)");

        expect(writeFlags.has(pageAccessFlagWrite)).toBe(true);

        db.pageAccessHook(null);
        db.close();
    });

    test("page numbers are 1-based", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-1based.sqlite3", "ct");

        db.exec("CREATE TABLE t(a INTEGER)");
        db.exec("INSERT INTO t VALUES(1)");

        const pages: Array<number> = [];
        db.pageAccessHook((_pArg, pgno, flags) => {
            if (flags === pageAccessFlagRead) pages.push(pgno);
        });
        db.exec("SELECT * FROM t");

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

        db.exec("CREATE TABLE t1(a INTEGER)");
        db.exec("CREATE TABLE t2(a INTEGER)");
        db.exec("CREATE TABLE t3(a INTEGER)");
        db.exec("INSERT INTO t1 VALUES(1)");
        db.exec("INSERT INTO t2 VALUES(2)");
        db.exec("INSERT INTO t3 VALUES(3)");

        const schema = db.exec("SELECT name, rootpage FROM sqlite_schema ORDER BY name", {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<{name: string; rootpage: number}>;

        for (const {name, rootpage} of schema) {
            const pages = new Set<number>();
            db.pageAccessHook((_pArg, pgno, flags) => {
                if (flags === pageAccessFlagRead) pages.add(pgno);
            });
            db.exec(`SELECT * FROM ${name}`);

            expect(pages.has(rootpage)).toBe(true);
        }

        db.pageAccessHook(null);
        db.close();
    });

    test("different tables report different root pages", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-difftables.sqlite3", "ct");

        db.exec("CREATE TABLE t1(a INTEGER)");
        db.exec("CREATE TABLE t2(a INTEGER)");
        db.exec("INSERT INTO t1 VALUES(1)");
        db.exec("INSERT INTO t2 VALUES(2)");

        const pagesForT1 = new Set<number>();
        db.pageAccessHook((_pArg, pgno, flags) => {
            if (flags === pageAccessFlagRead) pagesForT1.add(pgno);
        });
        db.exec("SELECT * FROM t1");

        const pagesForT2 = new Set<number>();
        db.pageAccessHook((_pArg, pgno, flags) => {
            if (flags === pageAccessFlagRead) pagesForT2.add(pgno);
        });
        db.exec("SELECT * FROM t2");

        // Both should access page 1 (schema).
        expect(pagesForT1.has(1)).toBe(true);
        expect(pagesForT2.has(1)).toBe(true);

        // But they should differ on at least one page (the
        // root page of each table).
        const onlyT1 = [...pagesForT1].filter(p => !pagesForT2.has(p));
        const onlyT2 = [...pagesForT2].filter(p => !pagesForT1.has(p));
        expect(onlyT1.length + onlyT2.length).toBeGreaterThan(0);

        db.pageAccessHook(null);
        db.close();
    });

    test("tracks write pages", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-write.sqlite3", "ct");

        db.exec("CREATE TABLE t(a INTEGER)");

        const writePages = new Set<number>();
        db.pageAccessHook((_pArg, pgno, flags) => {
            if (flags === pageAccessFlagWrite) writePages.add(pgno);
        });
        db.exec("INSERT INTO t VALUES(42)");

        expect(writePages.size).toBeGreaterThan(0);

        db.pageAccessHook(null);
        db.close();
    });

    test("can be disabled", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-disable.sqlite3", "ct");

        db.exec("CREATE TABLE t(a INTEGER)");
        db.exec("INSERT INTO t VALUES(1)");

        const pages: Array<number> = [];
        db.pageAccessHook((_pArg, pgno) => {
            pages.push(pgno);
        });
        db.exec("SELECT * FROM t");
        const countWithHook = pages.length;
        expect(countWithHook).toBeGreaterThan(0);

        // Disable the hook — subsequent queries should not
        // add entries.
        db.pageAccessHook(null);
        db.exec("SELECT * FROM t");
        expect(pages.length).toBe(countWithHook);

        db.close();
    });

    test("fires on cached pages", async () => {
        const sqlite3 = await sqlite3Promise;
        const db = new sqlite3.oo1.DB("/test-cached.sqlite3", "ct");

        db.exec("CREATE TABLE t(a INTEGER)");
        db.exec("INSERT INTO t VALUES(1)");

        // First read warms the cache.
        db.exec("SELECT * FROM t");

        // Install hook after pages are cached, then read again.
        const firstRun: Array<number> = [];
        db.pageAccessHook((_pArg, pgno, flags) => {
            if (flags === pageAccessFlagRead) firstRun.push(pgno);
        });
        db.exec("SELECT * FROM t");
        expect(firstRun.length).toBeGreaterThan(0);

        // A third read should fire the hook with the same pages.
        const secondRun: Array<number> = [];
        db.pageAccessHook((_pArg, pgno, flags) => {
            if (flags === pageAccessFlagRead) secondRun.push(pgno);
        });
        db.exec("SELECT * FROM t");
        expect(secondRun).toEqual(firstRun);

        db.pageAccessHook(null);
        db.close();
    });

    test("does not fire for attached databases", async () => {
        const sqlite3 = await sqlite3Promise;
        const main = new sqlite3.oo1.DB("/test-main.sqlite3", "ct");
        const attached = new sqlite3.oo1.DB("/test-attached.sqlite3", "ct");

        attached.exec("CREATE TABLE t2(x INTEGER)");
        attached.exec("INSERT INTO t2 VALUES(99)");
        attached.close();

        main.exec("CREATE TABLE t1(a INTEGER)");
        main.exec("INSERT INTO t1 VALUES(1)");
        // eslint-disable-next-line cyberworlds/string-quotes
        main.exec("ATTACH '/test-attached.sqlite3' AS other");

        // Hook only covers the main database's pager.
        const pages: Array<number> = [];
        main.pageAccessHook((_pArg, pgno, flags) => {
            if (flags === pageAccessFlagRead) pages.push(pgno);
        });

        // Read from the attached database only.
        main.exec("SELECT * FROM other.t2");
        const pagesFromAttached = [...pages];

        // Read from the main database.
        pages.length = 0;
        main.exec("SELECT * FROM t1");
        const pagesFromMain = [...pages];

        expect(pagesFromMain.length).toBeGreaterThan(0);
        // Attached DB has a separate pager — hook should not fire.
        expect(pagesFromAttached.length).toBe(0);

        main.pageAccessHook(null);
        main.exec("DETACH other");
        main.close();
    });
});
