import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";

test("sqlite works", async () => {
    const sqlite3 = await sqlite3InitModule();

    const db = new sqlite3.oo1.DB("/mydb.sqlite3", "ct");

    expect(db.selectArray("SELECT 1 + 1")).toEqual([2]);
});
