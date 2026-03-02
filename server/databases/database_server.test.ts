import {DatabaseServer} from "~/server/databases/database_server.js";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";

const pageSize = 4096;

class InMemoryStorage implements DatabaseServerStorage {
    private pages = new Map<number, Uint8Array>();
    private fileSize = 0;

    readPage(index: number): Uint8Array {
        return this.pages.get(index) ?? new Uint8Array(pageSize);
    }

    writePage(index: number, data: Uint8Array): void {
        this.pages.set(index, new Uint8Array(data));
        const end = (index + 1) * pageSize;
        if (end > this.fileSize) {
            this.fileSize = end;
        }
    }

    flush(): void {}

    getFileSize(): number {
        return this.fileSize;
    }

    truncate(size: number): void {
        this.fileSize = size;
    }
}

test("SELECT 1 + 1", async () => {
    const server = await DatabaseServer.create(new InMemoryStorage());
    const db = server.unsafeGetDbForTests();

    expect(db.selectValue("SELECT 1 + 1")).toBe(2);

    server.close();
});

test("create table, insert, and query", async () => {
    const server = await DatabaseServer.create(new InMemoryStorage());
    const db = server.unsafeGetDbForTests();

    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    // eslint-disable-next-line cyberworlds/string-quotes
    db.exec("INSERT INTO items (name) VALUES ('alpha'), ('beta')");

    expect(
        db.exec("SELECT id, name FROM items ORDER BY id", {
            returnValue: "resultRows",
            rowMode: "array",
        }),
    ).toEqual([
        [1, "alpha"],
        [2, "beta"],
    ]);

    server.close();
});

test("data persists across multiple exec calls", async () => {
    const server = await DatabaseServer.create(new InMemoryStorage());
    const db = server.unsafeGetDbForTests();

    db.exec("CREATE TABLE counters (value INTEGER NOT NULL)");
    db.exec("INSERT INTO counters (value) VALUES (10)");
    db.exec("INSERT INTO counters (value) VALUES (20)");
    db.exec("UPDATE counters SET value = value + 1");

    expect(
        db.exec("SELECT value FROM counters ORDER BY value", {
            returnValue: "resultRows",
            rowMode: "array",
        }),
    ).toEqual([[11], [21]]);

    server.close();
});

test("query returns rows and accessed pages", async () => {
    const server = await DatabaseServer.create(new InMemoryStorage());
    const db = server.unsafeGetDbForTests();

    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    // eslint-disable-next-line cyberworlds/string-quotes
    db.exec("INSERT INTO items (name) VALUES ('alpha'), ('beta')");

    const result = server.query("SELECT id, name FROM items ORDER BY id");

    expect(result.rows).toEqual([
        {id: 1, name: "alpha"},
        {id: 2, name: "beta"},
    ]);
    expect(result.pages.size).toBeGreaterThan(0);

    // Every page should be a full page of data.
    for (const [, data] of result.pages) {
        expect(data.byteLength).toBe(pageSize);
    }

    server.close();
});

test("query rejects write statements", async () => {
    const server = await DatabaseServer.create(new InMemoryStorage());
    const db = server.unsafeGetDbForTests();

    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");

    expect(() => server.query("INSERT INTO items (id) VALUES (1)")).toThrow();
    expect(() => server.query("DELETE FROM items")).toThrow();
    expect(() => server.query("UPDATE items SET id = 2")).toThrow();

    server.close();
});

test("query rejects pragmas", async () => {
    const server = await DatabaseServer.create(new InMemoryStorage());

    expect(() => server.query("PRAGMA table_list")).toThrow();

    server.close();
});
