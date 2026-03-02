import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";

const sqlite3Promise = sqlite3InitModule();

test("sqlite works", async () => {
    const sqlite3 = await sqlite3Promise;

    const db = new sqlite3.oo1.DB("/mydb.sqlite3", "ct");

    expect(db.selectArray("SELECT 1 + 1")).toEqual([2]);
});

test("page access hook tracks read pages", async () => {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB("/test-hook-read.sqlite3", "ct");

    db.exec("CREATE TABLE t(a INTEGER, b TEXT)");
    // eslint-disable-next-line cyberworlds/string-quotes
    db.exec("INSERT INTO t VALUES(1, 'hello'), (2, 'world')");

    const readPages: Array<number> = [];
    db.pageAccessHook((pgno: number, flags: number) => {
        if (flags === 1) readPages.push(pgno);
    });

    db.exec("SELECT * FROM t");
    expect(readPages.length).toBeGreaterThan(0);

    db.pageAccessHook(null);
    db.close();
});

test("page access hook tracks write pages", async () => {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB("/test-hook-write.sqlite3", "ct");

    db.exec("CREATE TABLE t(a INTEGER)");

    const writePages: Array<number> = [];
    db.pageAccessHook((pgno: number, flags: number) => {
        if (flags === 2) writePages.push(pgno);
    });

    db.exec("INSERT INTO t VALUES(42)");
    expect(writePages.length).toBeGreaterThan(0);

    db.pageAccessHook(null);
    db.close();
});

test("page access hook can be disabled", async () => {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB("/test-hook-disable.sqlite3", "ct");

    db.exec("CREATE TABLE t(a INTEGER)");
    db.exec("INSERT INTO t VALUES(1)");

    const pages: Array<number> = [];
    db.pageAccessHook((pgno: number) => {
        pages.push(pgno);
    });
    db.exec("SELECT * FROM t");
    const countWithHook = pages.length;
    expect(countWithHook).toBeGreaterThan(0);

    db.pageAccessHook(null);
    db.exec("SELECT * FROM t");
    expect(pages.length).toBe(countWithHook);

    db.close();
});

test("page access hook fires on cached pages", async () => {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB("/test-hook-cached.sqlite3", "ct");

    db.exec("CREATE TABLE t(a INTEGER)");
    db.exec("INSERT INTO t VALUES(1)");

    // First read warms the cache.
    db.exec("SELECT * FROM t");

    // Install hook after pages are already cached, then read again.
    const firstRun: Array<number> = [];
    db.pageAccessHook((pgno: number, flags: number) => {
        if (flags === 1) firstRun.push(pgno);
    });
    db.exec("SELECT * FROM t");
    expect(firstRun.length).toBeGreaterThan(0);

    // A third read should still fire the hook with the same pages.
    const secondRun: Array<number> = [];
    db.pageAccessHook((pgno: number, flags: number) => {
        if (flags === 1) secondRun.push(pgno);
    });
    db.exec("SELECT * FROM t");
    expect(secondRun).toEqual(firstRun);

    db.pageAccessHook(null);
    db.close();
});

test("page access hook does not fire for attached databases", async () => {
    const sqlite3 = await sqlite3Promise;
    const main = new sqlite3.oo1.DB("/test-hook-main.sqlite3", "ct");
    const attached = new sqlite3.oo1.DB("/test-hook-attached.sqlite3", "ct");

    // Set up a table in the database we will attach.
    attached.exec("CREATE TABLE t2(x INTEGER)");
    attached.exec("INSERT INTO t2 VALUES(99)");
    attached.close();

    // Attach it to the main connection.
    main.exec("CREATE TABLE t1(a INTEGER)");
    main.exec("INSERT INTO t1 VALUES(1)");
    // eslint-disable-next-line cyberworlds/string-quotes
    main.exec("ATTACH '/test-hook-attached.sqlite3' AS other");

    // Install hook — it only covers the main database's pager.
    const pages: Array<number> = [];
    main.pageAccessHook((pgno: number, flags: number) => {
        if (flags === 1) pages.push(pgno);
    });

    // Read from the attached database only.
    main.exec("SELECT * FROM other.t2");
    const pagesFromAttached = [...pages];

    // Read from the main database.
    pages.length = 0;
    main.exec("SELECT * FROM t1");
    const pagesFromMain = [...pages];

    // The main-db read must fire the hook.
    expect(pagesFromMain.length).toBeGreaterThan(0);

    // The attached-db read should not fire the hook (it has a
    // separate pager that the hook was not installed on).
    expect(pagesFromAttached.length).toBe(0);

    main.pageAccessHook(null);
    main.exec("DETACH other");
    main.close();
});
