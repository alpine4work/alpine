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
