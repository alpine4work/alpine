import {DatabaseServer} from "~/server/databases/database_server.js";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";

const pageSize = 4096;

class InMemoryStorage implements DatabaseServerStorage {
    private pages = new Map<number, Uint8Array>();
    private _fileSize = 0;

    readPage(index: number): Uint8Array {
        return this.pages.get(index) ?? new Uint8Array(pageSize);
    }

    writePage(index: number, data: Uint8Array): void {
        this.pages.set(index, new Uint8Array(data));
        const end = (index + 1) * pageSize;
        if (end > this._fileSize) {
            this._fileSize = end;
        }
    }

    flush(): void {}

    getFileSize(): number {
        return this._fileSize;
    }

    truncate(size: number): void {
        this._fileSize = size;
    }
}

async function createServerWithSchema(...statements: Array<string>): Promise<DatabaseServer> {
    const server = await DatabaseServer.create(new InMemoryStorage());
    const db = server.unsafeGetDbForTests();
    for (const sql of statements) {
        db.exec(sql);
    }
    return server;
}

describe("DatabaseServer", () => {
    describe("setup and basic queries via unsafeGetDbForTests", () => {
        test("SELECT 1 + 1", async () => {
            const server = await createServerWithSchema();
            const db = server.unsafeGetDbForTests();

            expect(db.selectValue("SELECT 1 + 1")).toBe(2);

            server.close();
        });

        test("create table, insert, and query back", async () => {
            const server = await createServerWithSchema();
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
            const server = await createServerWithSchema();
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

        test("multiple tables", async () => {
            const server = await createServerWithSchema();
            const db = server.unsafeGetDbForTests();

            db.exec("CREATE TABLE a (id INTEGER PRIMARY KEY)");
            db.exec("CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id))");
            db.exec("INSERT INTO a VALUES (1)");
            db.exec("INSERT INTO b VALUES (10, 1)");

            expect(db.selectValue("SELECT COUNT(*) FROM a")).toBe(1);
            expect(db.selectValue("SELECT COUNT(*) FROM b")).toBe(1);

            server.close();
        });
    });

    describe("query — rows", () => {
        test("SELECT returns rows as objects", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
                // eslint-disable-next-line cyberworlds/string-quotes
                "INSERT INTO items (name) VALUES ('alpha'), ('beta')",
            );

            const result = server.query("SELECT id, name FROM items ORDER BY id");

            expect(result.rows).toEqual([
                {id: 1, name: "alpha"},
                {id: 2, name: "beta"},
            ]);

            server.close();
        });

        test("SELECT with WHERE filters correctly", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
                // eslint-disable-next-line cyberworlds/string-quotes
                "INSERT INTO items (name) VALUES ('a'), ('b'), ('c')",
            );

            const result = server.query("SELECT name FROM items WHERE id > 1 ORDER BY id");

            expect(result.rows).toEqual([{name: "b"}, {name: "c"}]);

            server.close();
        });

        test("SELECT with JOIN across tables", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT)",
                "CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER, title TEXT)",
                // eslint-disable-next-line cyberworlds/string-quotes
                "INSERT INTO authors VALUES (1, 'Alice')",
                // eslint-disable-next-line cyberworlds/string-quotes
                "INSERT INTO books VALUES (1, 1, 'Book A')",
            );

            const result = server.query(
                "SELECT authors.name, books.title FROM books JOIN authors ON books.author_id = authors.id",
            );

            expect(result.rows).toEqual([{name: "Alice", title: "Book A"}]);

            server.close();
        });

        test("SELECT with aggregate functions", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE nums (value INTEGER)",
                "INSERT INTO nums VALUES (10), (20), (30)",
            );

            const result = server.query("SELECT COUNT(*) as cnt, SUM(value) as total FROM nums");

            expect(result.rows).toEqual([{cnt: 3, total: 60}]);

            server.close();
        });

        test("SELECT on empty table returns empty array", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE empty_t (id INTEGER PRIMARY KEY)",
            );

            const result = server.query("SELECT * FROM empty_t");

            expect(result.rows).toEqual([]);

            server.close();
        });

        test("SELECT with no matching rows returns empty array", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1), (2), (3)",
            );

            const result = server.query("SELECT * FROM items WHERE id > 100");

            expect(result.rows).toEqual([]);

            server.close();
        });

        test("recursive CTE works", async () => {
            const server = await createServerWithSchema();

            const result = server.query(
                "WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x < 5) SELECT x FROM cnt",
            );

            expect(result.rows).toEqual([{x: 1}, {x: 2}, {x: 3}, {x: 4}, {x: 5}]);

            server.close();
        });

        test("subquery works", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, value INTEGER)",
                "INSERT INTO items VALUES (1, 10), (2, 20), (3, 30)",
            );

            const result = server.query(
                "SELECT * FROM items WHERE value > (SELECT AVG(value) FROM items)",
            );

            expect(result.rows).toEqual([{id: 3, value: 30}]);

            server.close();
        });
    });

    describe("query — page tracking", () => {
        test("query returns non-empty pages map", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            const result = server.query("SELECT * FROM items");

            expect(result.pages.size).toBeGreaterThan(0);

            server.close();
        });

        test("all page values are 4096 bytes", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT)",
                // eslint-disable-next-line cyberworlds/string-quotes
                "INSERT INTO items VALUES (1, 'hello world')",
            );

            const result = server.query("SELECT * FROM items");

            for (const [, pageData] of result.pages) {
                expect(pageData.byteLength).toBe(pageSize);
            }

            server.close();
        });

        test("pages contain actual database content", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            const result = server.query("SELECT * FROM items");

            // At least one page should be non-zero.
            let hasNonZeroPage = false;
            for (const [, pageData] of result.pages) {
                if (pageData.some(b => b !== 0)) {
                    hasNonZeroPage = true;
                    break;
                }
            }
            expect(hasNonZeroPage).toBe(true);

            server.close();
        });

        test("same query returns same pages deterministically", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1), (2), (3)",
            );

            const result1 = server.query("SELECT * FROM items");
            const result2 = server.query("SELECT * FROM items");

            expect(result1.pages.size).toBe(result2.pages.size);
            for (const [pageIndex, pageData] of result1.pages) {
                expect(result2.pages.has(pageIndex)).toBe(true);
                expect(pageData).toEqual(result2.pages.get(pageIndex));
            }

            server.close();
        });

        test("query tracks page 0 and the root page of the queried table", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE t1 (id INTEGER PRIMARY KEY, data TEXT)",
                "CREATE TABLE t2 (id INTEGER PRIMARY KEY, data TEXT)",
                "CREATE TABLE t3 (id INTEGER PRIMARY KEY, data TEXT)",
                // eslint-disable-next-line cyberworlds/string-quotes
                "INSERT INTO t1 VALUES (1, 'a')",
                // eslint-disable-next-line cyberworlds/string-quotes
                "INSERT INTO t2 VALUES (1, 'b')",
                // eslint-disable-next-line cyberworlds/string-quotes
                "INSERT INTO t3 VALUES (1, 'c')",
            );

            // Get each table's root page (SQLite's rootpage is
            // 1-based; our storage is 0-based).
            const db = server.unsafeGetDbForTests();
            const schema = db.exec("SELECT name, rootpage FROM sqlite_schema ORDER BY name", {
                returnValue: "resultRows",
                rowMode: "object",
            }) as Array<{name: string; rootpage: number}>;

            for (const {name, rootpage} of schema) {
                const result = server.query(`SELECT * FROM ${name}`);
                const pageIndices = [...result.pages.keys()];

                // Page 0 (the schema page) is always accessed.
                expect(pageIndices).toContain(0);
                // The table's own root page should be accessed.
                // rootpage is 1-based, our map keys are 0-based.
                expect(pageIndices).toContain(rootpage - 1);
            }

            server.close();
        });
    });

    describe("query — authorization", () => {
        test("INSERT is rejected", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            expect(() => server.query("INSERT INTO items VALUES (1)")).toThrow();

            server.close();
        });

        test("UPDATE is rejected", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            expect(() => server.query("UPDATE items SET id = 2")).toThrow();

            server.close();
        });

        test("DELETE is rejected", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            expect(() => server.query("DELETE FROM items")).toThrow();

            server.close();
        });

        test("PRAGMA is rejected", async () => {
            const server = await createServerWithSchema();

            expect(() => server.query("PRAGMA table_list")).toThrow();

            server.close();
        });

        test("CREATE TABLE is rejected", async () => {
            const server = await createServerWithSchema();

            expect(() => server.query("CREATE TABLE bad (id INTEGER)")).toThrow();

            server.close();
        });

        test("DROP TABLE is rejected", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            expect(() => server.query("DROP TABLE items")).toThrow();

            server.close();
        });

        test("ALTER TABLE is rejected", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            expect(() => server.query("ALTER TABLE items ADD COLUMN name TEXT")).toThrow();

            server.close();
        });

        test("CREATE INDEX is rejected", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
            );

            expect(() => server.query("CREATE INDEX idx_name ON items(name)")).toThrow();

            server.close();
        });

        test("allowed operations still work after rejected query", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            expect(() => server.query("INSERT INTO items VALUES (2)")).toThrow();

            // SELECT should still work after a rejected mutation.
            const result = server.query("SELECT * FROM items");
            expect(result.rows).toEqual([{id: 1}]);

            server.close();
        });
    });

    describe("query — isolation", () => {
        test("query does not modify database state", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1), (2), (3)",
            );

            const result1 = server.query("SELECT COUNT(*) as cnt FROM items");
            const result2 = server.query("SELECT COUNT(*) as cnt FROM items");

            expect(result1.rows).toEqual([{cnt: 3}]);
            expect(result2.rows).toEqual(result1.rows);

            server.close();
        });

        test("multiple sequential queries return consistent results", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, value INTEGER)",
                "INSERT INTO items VALUES (1, 100), (2, 200)",
            );

            for (let i = 0; i < 5; i++) {
                const result = server.query("SELECT SUM(value) as total FROM items");
                expect(result.rows).toEqual([{total: 300}]);
            }

            server.close();
        });

        test("writes via unsafeGetDbForTests are visible to query", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            const before = server.query("SELECT COUNT(*) as cnt FROM items");
            expect(before.rows).toEqual([{cnt: 1}]);

            const db = server.unsafeGetDbForTests();
            db.exec("INSERT INTO items VALUES (2)");

            const after = server.query("SELECT COUNT(*) as cnt FROM items");
            expect(after.rows).toEqual([{cnt: 2}]);

            server.close();
        });

        test("failed query does not leave database in bad state", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            // This should fail (INSERT rejected by authorizer).
            expect(() => server.query("INSERT INTO items VALUES (2)")).toThrow();

            // Database should still be usable.
            const result = server.query("SELECT * FROM items");
            expect(result.rows).toEqual([{id: 1}]);

            server.close();
        });
    });

    describe("query — error handling", () => {
        test("invalid SQL throws", async () => {
            const server = await createServerWithSchema();

            expect(() => server.query("NOT VALID SQL")).toThrow();

            server.close();
        });

        test("reference to non-existent table throws", async () => {
            const server = await createServerWithSchema();

            expect(() => server.query("SELECT * FROM nonexistent")).toThrow();

            server.close();
        });

        test("database is usable after error", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            expect(() => server.query("SELECT * FROM nonexistent")).toThrow();

            // Should still work.
            const result = server.query("SELECT COUNT(*) as cnt FROM items");
            expect(result.rows).toEqual([{cnt: 0}]);

            server.close();
        });
    });

    describe("storage integration", () => {
        test("writes go through to storage", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage);
            const db = server.unsafeGetDbForTests();

            db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
            db.exec("INSERT INTO items VALUES (1)");

            // Storage should have been written to.
            expect(storage.getFileSize()).toBeGreaterThan(0);

            server.close();
        });

        test("page data from query matches what storage has", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage);
            const db = server.unsafeGetDbForTests();

            db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
            db.exec("INSERT INTO items VALUES (1)");

            const result = server.query("SELECT * FROM items");

            // Each page in the result should match what storage
            // returns for that page index.
            for (const [pageIndex, pageData] of result.pages) {
                expect(pageData).toEqual(storage.readPage(pageIndex));
            }

            server.close();
        });
    });

    describe("create", () => {
        test("multiple servers can coexist", async () => {
            const server1 = await createServerWithSchema(
                "CREATE TABLE t1 (id INTEGER PRIMARY KEY)",
                "INSERT INTO t1 VALUES (1)",
            );
            const server2 = await createServerWithSchema(
                "CREATE TABLE t2 (id INTEGER PRIMARY KEY)",
                "INSERT INTO t2 VALUES (2)",
            );

            expect(server1.unsafeGetDbForTests().selectValue("SELECT id FROM t1")).toBe(1);
            expect(server2.unsafeGetDbForTests().selectValue("SELECT id FROM t2")).toBe(2);

            server1.close();
            server2.close();
        });
    });
});
