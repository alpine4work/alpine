import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";

// NOCOMMIT: Currently we're trying to get this test to work

test("sqlite works", async () => {
    console.log(sqlite3InitModule.instantiateWasm);

    const sqlite3 = await sqlite3InitModule();

    const db = new sqlite3.oo1.DB("/mydb.sqlite3", "ct");

    expect(db.selectArray("SELECT 1 + 1")).toEqual([2]);
});
