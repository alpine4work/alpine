/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import {DatabaseServer} from "~/server/databases/database_server.js";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {sql} from "~/shared/databases/sql.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {Schema} from "~/shared/schema/schema.js";

class InMemoryStorage implements DatabaseServerStorage {
    private pages = new Map<number, {data: Uint8Array | null; timestamp: number}>();
    private _fileSize = 0;
    private lastWriteTimestamp = 0;

    readPage(index: number): {data: Uint8Array | null; timestamp: number} | null {
        return this.pages.get(index) ?? null;
    }

    writePages(pages: ReadonlyMap<number, Uint8Array>): number {
        const timestamp = Math.max(Date.now(), this.lastWriteTimestamp + 1);
        this.lastWriteTimestamp = timestamp;
        for (const [index, data] of pages) {
            this.pages.set(index, {data: new Uint8Array(data), timestamp});
            const end = (index + 1) * sqlitePageSize;
            if (end > this._fileSize) {
                this._fileSize = end;
            }
        }
        return timestamp;
    }

    getFileSize(): number {
        return this._fileSize;
    }

    truncate(size: number): void {
        this._fileSize = size;
        const maxPageIndex = Math.floor(size / sqlitePageSize);
        const timestamp = Math.max(Date.now(), this.lastWriteTimestamp + 1);
        this.lastWriteTimestamp = timestamp;
        for (const [index] of this.pages) {
            if (index >= maxPageIndex) {
                this.pages.set(index, {data: null, timestamp});
            }
        }
    }
}

// Servers created during a test are tracked here and
// closed in `afterEach` so individual tests don't have
// to call `server.close()` themselves.
const openServers: Array<DatabaseServer> = [];

afterEach(() => {
    while (openServers.length > 0) {
        // Tolerate already-closed servers — earlier tests
        // may have called close() explicitly.
        try {
            openServers.pop()!.close();
        } catch {
            // ignore
        }
    }
});

async function createServerWithSchema(...statements: Array<string>): Promise<DatabaseServer> {
    const server = await DatabaseServer.create(new InMemoryStorage());
    openServers.push(server);
    const db = server.unsafeGetDbForTests();
    for (const stmt of statements) {
        db.exec(stmt);
    }
    return server;
}

describe("DatabaseServer", () => {
    describe("setup and basic queries via unsafeGetDbForTests", () => {
        test("SELECT 1 + 1", async () => {
            const server = await createServerWithSchema();
            const db = server.unsafeGetDbForTests();

            expect(
                sql`
                    SELECT
                        1 + 1
                `.selectValue(db, Schema.integer),
            ).toBe(2);
        });

        test("create table, insert, and query back", async () => {
            const server = await createServerWithSchema();
            const db = server.unsafeGetDbForTests();

            db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");

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
        });

        test("multiple tables", async () => {
            const server = await createServerWithSchema();
            const db = server.unsafeGetDbForTests();

            db.exec("CREATE TABLE a (id INTEGER PRIMARY KEY)");
            db.exec("CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id))");
            db.exec("INSERT INTO a VALUES (1)");
            db.exec("INSERT INTO b VALUES (10, 1)");

            expect(
                sql`
                    SELECT
                        COUNT(*)
                    FROM
                        a
                `.selectValue(db, Schema.integer),
            ).toBe(1);
            expect(
                sql`
                    SELECT
                        COUNT(*)
                    FROM
                        b
                `.selectValue(db, Schema.integer),
            ).toBe(1);
        });
    });

    describe("execute read-only — rows", () => {
        test("SELECT returns rows as objects", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",

                "INSERT INTO items (name) VALUES ('alpha'), ('beta')",
            );

            const result = server.execute("SELECT id, name FROM items ORDER BY id", {
                allowWrites: "none",
            });

            expect(result.rows).toEqual([
                {id: 1, name: "alpha"},
                {id: 2, name: "beta"},
            ]);
        });

        test("SELECT with WHERE filters correctly", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",

                "INSERT INTO items (name) VALUES ('a'), ('b'), ('c')",
            );

            const result = server.execute("SELECT name FROM items WHERE id > 1 ORDER BY id", {
                allowWrites: "none",
            });

            expect(result.rows).toEqual([{name: "b"}, {name: "c"}]);
        });

        test("SELECT with JOIN across tables", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT)",
                "CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER, title TEXT)",

                "INSERT INTO authors VALUES (1, 'Alice')",

                "INSERT INTO books VALUES (1, 1, 'Book A')",
            );

            const result = server.execute(
                "SELECT authors.name, books.title FROM books JOIN authors ON books.author_id = authors.id",
                {allowWrites: "none"},
            );

            expect(result.rows).toEqual([{name: "Alice", title: "Book A"}]);
        });

        test("SELECT with aggregate functions", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE nums (value INTEGER)",
                "INSERT INTO nums VALUES (10), (20), (30)",
            );

            const result = server.execute("SELECT COUNT(*) as cnt, SUM(value) as total FROM nums", {
                allowWrites: "none",
            });

            expect(result.rows).toEqual([{cnt: 3, total: 60}]);
        });

        test("SELECT on empty table returns empty array", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE empty_t (id INTEGER PRIMARY KEY)",
            );

            const result = server.execute("SELECT * FROM empty_t", {allowWrites: "none"});

            expect(result.rows).toEqual([]);
        });

        test("SELECT with no matching rows returns empty array", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1), (2), (3)",
            );

            const result = server.execute("SELECT * FROM items WHERE id > 100", {
                allowWrites: "none",
            });

            expect(result.rows).toEqual([]);
        });

        test("recursive CTE works", async () => {
            const server = await createServerWithSchema();

            const result = server.execute(
                "WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x < 5) SELECT x FROM cnt",
                {allowWrites: "none"},
            );

            expect(result.rows).toEqual([{x: 1}, {x: 2}, {x: 3}, {x: 4}, {x: 5}]);
        });

        test("subquery works", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, value INTEGER)",
                "INSERT INTO items VALUES (1, 10), (2, 20), (3, 30)",
            );

            const result = server.execute(
                "SELECT * FROM items WHERE value > (SELECT AVG(value) FROM items)",
                {allowWrites: "none"},
            );

            expect(result.rows).toEqual([{id: 3, value: 30}]);
        });
    });

    describe("execute read-only — page tracking", () => {
        test("returns non-empty pages map", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});

            expect(result.readPages.size).toBeGreaterThan(0);
        });

        test("all page values are 4096 bytes", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT)",

                "INSERT INTO items VALUES (1, 'hello world')",
            );

            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});

            for (const [, pageData] of result.readPages) {
                expect(pageData.data.byteLength).toBe(sqlitePageSize);
            }
        });

        test("pages contain actual database content", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});

            // At least one page should be non-zero.
            let hasNonZeroPage = false;
            for (const [, pageData] of result.readPages) {
                if (pageData.data.some(b => b !== 0)) {
                    hasNonZeroPage = true;
                    break;
                }
            }
            expect(hasNonZeroPage).toBe(true);
        });

        test("same query returns same pages deterministically", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1), (2), (3)",
            );

            const result1 = server.execute("SELECT * FROM items", {allowWrites: "none"});
            const result2 = server.execute("SELECT * FROM items", {allowWrites: "none"});

            expect(result1.readPages.size).toBe(result2.readPages.size);
            for (const [pageIndex, pageData] of result1.readPages) {
                expect(result2.readPages.has(pageIndex)).toBe(true);
                expect(pageData).toEqual(result2.readPages.get(pageIndex));
            }
        });

        test("tracks page 0 and the root page of the queried table", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE t1 (id INTEGER PRIMARY KEY, data TEXT)",
                "CREATE TABLE t2 (id INTEGER PRIMARY KEY, data TEXT)",
                "CREATE TABLE t3 (id INTEGER PRIMARY KEY, data TEXT)",

                "INSERT INTO t1 VALUES (1, 'a')",

                "INSERT INTO t2 VALUES (1, 'b')",

                "INSERT INTO t3 VALUES (1, 'c')",
            );

            // Get each table's root page (SQLite's rootpage is
            // 1-based; our storage is 0-based).
            const db = server.unsafeGetDbForTests();
            const schema = sql`
                SELECT
                    name,
                    rootpage
                FROM
                    sqlite_schema
                WHERE
                    type = 'table'
                ORDER BY
                    name
            `.selectAll(db, {name: Schema.string, rootpage: Schema.integer});

            for (const {name, rootpage} of schema) {
                const result = server.execute(`SELECT * FROM "${name}"`, {allowWrites: "none"});
                const pageIndices = [...result.readPages.keys()];

                // Page 0 (the schema page) is always accessed.
                expect(pageIndices).toContain(0);
                // The table's own root page should be accessed.
                // rootpage is 1-based, our map keys are 0-based.
                expect(pageIndices).toContain(rootpage - 1);
            }
        });
    });

    // The writeLevel × action authorization matrix is
    // covered exhaustively in
    // shared/databases/sqlite_authorizer.test.ts. The tests
    // here only assert behavior unique to DatabaseServer
    // (page tracking, changedPages, transaction lifecycle).

    describe("execute read-only — isolation", () => {
        test("does not modify database state", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1), (2), (3)",
            );

            const result1 = server.execute("SELECT COUNT(*) as cnt FROM items", {
                allowWrites: "none",
            });
            const result2 = server.execute("SELECT COUNT(*) as cnt FROM items", {
                allowWrites: "none",
            });

            expect(result1.rows).toEqual([{cnt: 3}]);
            expect(result2.rows).toEqual(result1.rows);
        });

        test("multiple sequential queries return consistent results", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, value INTEGER)",
                "INSERT INTO items VALUES (1, 100), (2, 200)",
            );

            for (let i = 0; i < 5; i++) {
                const result = server.execute("SELECT SUM(value) as total FROM items", {
                    allowWrites: "none",
                });
                expect(result.rows).toEqual([{total: 300}]);
            }
        });

        test("writes via unsafeGetDbForTests are visible to execute", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            const before = server.execute("SELECT COUNT(*) as cnt FROM items", {
                allowWrites: "none",
            });
            expect(before.rows).toEqual([{cnt: 1}]);

            const db = server.unsafeGetDbForTests();
            db.exec("INSERT INTO items VALUES (2)");

            const after = server.execute("SELECT COUNT(*) as cnt FROM items", {
                allowWrites: "none",
            });
            expect(after.rows).toEqual([{cnt: 2}]);
        });

        test("failed execute does not leave database in bad state", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            // This should fail (INSERT rejected by authorizer).
            expect(() =>
                server.execute("INSERT INTO items VALUES (2)", {allowWrites: "none"}),
            ).toThrow();

            // Database should still be usable.
            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});
            expect(result.rows).toEqual([{id: 1}]);
        });
    });

    describe("execute read-only — error handling", () => {
        test("invalid SQL throws", async () => {
            const server = await createServerWithSchema();

            expect(() => server.execute("NOT VALID SQL", {allowWrites: "none"})).toThrow();
        });

        test("reference to non-existent table throws", async () => {
            const server = await createServerWithSchema();

            expect(() =>
                server.execute("SELECT * FROM nonexistent", {allowWrites: "none"}),
            ).toThrow();
        });

        test("database is usable after error", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            expect(() =>
                server.execute("SELECT * FROM nonexistent", {allowWrites: "none"}),
            ).toThrow();

            // Should still work.
            const result = server.execute("SELECT COUNT(*) as cnt FROM items", {
                allowWrites: "none",
            });
            expect(result.rows).toEqual([{cnt: 0}]);
        });
    });

    describe("storage integration", () => {
        test("writes go through to storage", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage);
            openServers.push(server);
            const db = server.unsafeGetDbForTests();

            db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
            db.exec("INSERT INTO items VALUES (1)");

            // Storage should have been written to.
            expect(storage.getFileSize()).toBeGreaterThan(0);
        });

        test("page data from execute matches what storage has", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage);
            openServers.push(server);
            const db = server.unsafeGetDbForTests();

            db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
            db.exec("INSERT INTO items VALUES (1)");

            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});

            // Each page in the result should match what storage
            // returns for that page index.
            for (const [pageIndex, pageData] of result.readPages) {
                expect(pageData).toEqual(storage.readPage(pageIndex));
            }
        });
    });

    describe("execute with writes — basic operations", () => {
        test("INSERT returns empty rows and non-empty changedPages", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
            );

            const result = server.execute("INSERT INTO items VALUES (1, 'hello')", {
                allowWrites: "data",
            });

            expect(result.rows).toEqual([]);
            expect(result.changedPages.size).toBeGreaterThan(0);
        });

        test("INSERT with RETURNING returns rows", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
            );

            const result = server.execute(
                "INSERT INTO items VALUES (1, 'hello') RETURNING id, name",
                {allowWrites: "data"},
            );

            expect(result.rows).toEqual([{id: 1, name: "hello"}]);
        });

        test("CREATE TABLE via execute", async () => {
            const server = await createServerWithSchema();

            server.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)", {
                allowWrites: "schema+data",
            });
            server.execute("INSERT INTO items VALUES (1, 'hello')", {allowWrites: "data"});

            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});
            expect(result.rows).toEqual([{id: 1, name: "hello"}]);
        });

        test("multiple mutations accumulate state", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"});
            server.execute("INSERT INTO items VALUES (2)", {allowWrites: "data"});
            server.execute("INSERT INTO items VALUES (3)", {allowWrites: "data"});

            const result = server.execute("SELECT * FROM items ORDER BY id", {
                allowWrites: "none",
            });
            expect(result.rows).toEqual([{id: 1}, {id: 2}, {id: 3}]);
        });

        test("UPDATE modifies existing data", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, value INTEGER)",
                "INSERT INTO items VALUES (1, 100)",
            );

            server.execute("UPDATE items SET value = 200 WHERE id = 1", {allowWrites: "data"});

            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});
            expect(result.rows).toEqual([{id: 1, value: 200}]);
        });

        test("DELETE removes data", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1), (2), (3)",
            );

            server.execute("DELETE FROM items WHERE id = 2", {allowWrites: "data"});

            const result = server.execute("SELECT * FROM items ORDER BY id", {
                allowWrites: "none",
            });
            expect(result.rows).toEqual([{id: 1}, {id: 3}]);
        });
    });

    describe("execute with writes — changed pages", () => {
        test("changedPages has before and after snapshots", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            const result = server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"});

            for (const [, change] of result.changedPages) {
                expect(change.before).toBeInstanceOf(Uint8Array);
                expect(change.after).toBeInstanceOf(Uint8Array);
            }
        });

        test("all page snapshots are 4096 bytes", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            const result = server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"});

            for (const [, change] of result.changedPages) {
                expect(change.before.byteLength).toBe(sqlitePageSize);
                expect(change.after.byteLength).toBe(sqlitePageSize);
            }
        });

        test("before snapshot matches pre-mutation storage state", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage);
            openServers.push(server);
            const db = server.unsafeGetDbForTests();
            db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
            db.exec("INSERT INTO items VALUES (1)");

            // Snapshot storage state before the mutation.
            const prePages = new Map<number, Uint8Array>();
            for (let i = 0; i < storage.getFileSize() / sqlitePageSize; i++) {
                prePages.set(i, new Uint8Array(storage.readPage(i)!.data!));
            }

            const result = server.execute("INSERT INTO items VALUES (2)", {allowWrites: "data"});

            for (const [pageIndex, change] of result.changedPages) {
                const prePage = prePages.get(pageIndex) ?? new Uint8Array(sqlitePageSize);
                expect(change.before).toEqual(prePage);
            }
        });

        test("after snapshot matches post-mutation storage state", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage);
            openServers.push(server);
            const db = server.unsafeGetDbForTests();
            db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
            db.exec("INSERT INTO items VALUES (1)");

            const result = server.execute("INSERT INTO items VALUES (2)", {allowWrites: "data"});

            for (const [pageIndex, change] of result.changedPages) {
                expect(change.after).toEqual(storage.readPage(pageIndex)!.data);
            }
        });

        test("before and after differ for changed pages", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            const result = server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"});

            // At least one page should have different before/after.
            let hasDiff = false;
            for (const [, change] of result.changedPages) {
                if (!change.before.every((b, i) => b === change.after[i])) {
                    hasDiff = true;
                    break;
                }
            }
            expect(hasDiff).toBe(true);
        });
    });

    describe("execute with writes — error handling", () => {
        test("invalid SQL throws", async () => {
            const server = await createServerWithSchema();

            expect(() => server.execute("NOT VALID SQL", {allowWrites: "data"})).toThrow();
        });

        test("constraint violation throws", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            expect(() =>
                server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"}),
            ).toThrow();
        });

        test("database is usable after failed mutation", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            // Duplicate key — should fail.
            expect(() =>
                server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"}),
            ).toThrow();

            // Should still be able to query.
            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});
            expect(result.rows).toEqual([{id: 1}]);

            // Should still be able to mutate.
            server.execute("INSERT INTO items VALUES (2)", {allowWrites: "data"});
            const result2 = server.execute("SELECT * FROM items ORDER BY id", {
                allowWrites: "none",
            });
            expect(result2.rows).toEqual([{id: 1}, {id: 2}]);
        });
    });

    describe("executeAction — rawSql", () => {
        test("SELECT returns rows in result", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",

                "INSERT INTO items (name) VALUES ('alpha'), ('beta')",
            );

            const {result} = server.executeAction<"rawSql">({
                name: "rawSql",
                input: {sql: "SELECT id, name FROM items ORDER BY id"},
            });

            expect(result.rows).toEqual([
                {id: 1, name: "alpha"},
                {id: 2, name: "beta"},
            ]);
        });

        test("INSERT produces changedPages", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
            );

            const {result, changedPages} = server.executeAction<"rawSql">({
                name: "rawSql",

                input: {sql: "INSERT INTO items VALUES (1, 'hello')"},
            });

            expect(result.rows).toEqual([]);
            expect(changedPages.size).toBeGreaterThan(0);
        });

        test("respects writeLevel (rawSql uses data)", async () => {
            const server = await createServerWithSchema();

            // DDL should be rejected because rawSql writeLevel is "data"
            expect(() =>
                server.executeAction({
                    name: "rawSql",
                    input: {sql: "CREATE TABLE bad (id INTEGER)"},
                }),
            ).toThrow();
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

            expect(
                sql`
                    SELECT
                        id
                    FROM
                        t1
                `.selectValue(server1.unsafeGetDbForTests(), Schema.integer),
            ).toBe(1);
            expect(
                sql`
                    SELECT
                        id
                    FROM
                        t2
                `.selectValue(server2.unsafeGetDbForTests(), Schema.integer),
            ).toBe(2);

            server1.close();
            server2.close();
        });
    });
});
