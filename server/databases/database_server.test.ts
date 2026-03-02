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

    expect(server.selectValue("SELECT 1 + 1")).toBe(2);

    server.close();
});

test("create table, insert, and query", async () => {
    const server = await DatabaseServer.create(new InMemoryStorage());

    server.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    // eslint-disable-next-line cyberworlds/string-quotes
    server.exec("INSERT INTO items (name) VALUES ('alpha'), ('beta')");

    expect(server.selectArrays("SELECT id, name FROM items ORDER BY id")).toEqual([
        [1, "alpha"],
        [2, "beta"],
    ]);

    server.close();
});

test("data persists across multiple exec calls", async () => {
    const server = await DatabaseServer.create(new InMemoryStorage());

    server.exec("CREATE TABLE counters (value INTEGER NOT NULL)");
    server.exec("INSERT INTO counters (value) VALUES (10)");
    server.exec("INSERT INTO counters (value) VALUES (20)");
    server.exec("UPDATE counters SET value = value + 1");

    expect(server.selectArrays("SELECT value FROM counters ORDER BY value")).toEqual([[11], [21]]);

    server.close();
});
