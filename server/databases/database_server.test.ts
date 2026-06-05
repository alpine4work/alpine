/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import {DatabaseServer} from "~/server/databases/database_server.js";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {sql} from "~/shared/databases/sql.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

interface InMemoryTable {
    pages: Map<number, {data: Uint8Array; version: number}>;
    fileSize: number;
}

class InMemoryStorage implements DatabaseServerStorage {
    private tables = new Map<DatabaseTableId, InMemoryTable>();
    private lastWriteVersion = 0;

    private getTable(databaseTableId: DatabaseTableId): InMemoryTable {
        let table = this.tables.get(databaseTableId);
        if (table === undefined) {
            table = {pages: new Map(), fileSize: 0};
            this.tables.set(databaseTableId, table);
        }
        return table;
    }

    readPage(
        databaseTableId: DatabaseTableId,
        index: number,
    ): {data: Uint8Array; version: number} | null {
        const table = this.tables.get(databaseTableId);
        return table?.pages.get(index) ?? null;
    }

    writePages(
        pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
        truncates: ReadonlyMap<DatabaseTableId, number>,
    ): number {
        const version = ++this.lastWriteVersion;
        for (const [databaseTableId, size] of truncates) {
            const table = this.getTable(databaseTableId);
            table.fileSize = size;
            const maxPageIndex = Math.floor(size / sqlitePageSize);
            for (const [index] of table.pages) {
                if (index >= maxPageIndex) {
                    table.pages.delete(index);
                }
            }
        }
        for (const [databaseTableId, tablePages] of pages) {
            const table = this.getTable(databaseTableId);
            for (const [index, data] of tablePages) {
                table.pages.set(index, {data: new Uint8Array(data), version});
                const end = (index + 1) * sqlitePageSize;
                if (end > table.fileSize) {
                    table.fileSize = end;
                }
            }
        }
        return version;
    }

    getFileSize(databaseTableId: DatabaseTableId): number {
        return this.tables.get(databaseTableId)?.fileSize ?? 0;
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
    // Drain test-setup writes to durable storage so a
    // later failed execute (which discards the buffer)
    // doesn't roll the schema out from under the test.
    server.commitBufferForTests();
    return server;
}

describe("DatabaseServer — storage failure recovery", () => {
    // A storage that delegates to an in-memory store but can
    // be armed to throw from `writePages`, simulating a
    // durable-storage failure during the buffer drain.
    class FlakyStorage implements DatabaseServerStorage {
        private readonly inner = new InMemoryStorage();
        failNextWritePages = false;

        readPage(
            databaseTableId: DatabaseTableId,
            index: number,
        ): {data: Uint8Array; version: number} | null {
            return this.inner.readPage(databaseTableId, index);
        }

        getFileSize(databaseTableId: DatabaseTableId): number {
            return this.inner.getFileSize(databaseTableId);
        }

        writePages(
            pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
            truncates: ReadonlyMap<DatabaseTableId, number>,
        ): number {
            if (this.failNextWritePages) {
                this.failNextWritePages = false;
                throw new Error("simulated storage failure");
            }
            return this.inner.writePages(pages, truncates);
        }
    }

    test("a failed buffer drain does not wedge later executes", async () => {
        const storage = new FlakyStorage();
        const server = await DatabaseServer.create(storage);
        openServers.push(server);
        server.execute("CREATE TABLE items (id INTEGER PRIMARY KEY)", {
            allowWrites: "schema+data",
        });

        // Arm a storage failure: the drain (`writePages`) throws
        // after `execute` has already buffered its write.
        storage.failNextWritePages = true;
        expect(() =>
            server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"}),
        ).toThrow("simulated storage failure");

        // The failed drain must not leave the buffer dirty: a
        // subsequent execute should succeed, not throw
        // "_runAndPersist requires an empty buffer".
        expect(() =>
            server.execute("INSERT INTO items VALUES (2)", {allowWrites: "data"}),
        ).not.toThrow();
    });
});

describe("DatabaseServer", () => {
    // Pass-through smoke: rows from a SELECT come back as
    // objects. Exhaustive SQL feature coverage lives in
    // SQLite's own test suite; we only verify the wiring.
    test("execute passes SELECT rows through", async () => {
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

    describe("execute read-only — page tracking", () => {
        test("returns non-empty pages map", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});

            expect(result.readPages.get(databaseMainTableId)?.size ?? 0).toBeGreaterThan(0);
        });

        test("all page values are 4096 bytes", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT)",

                "INSERT INTO items VALUES (1, 'hello world')",
            );

            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});

            for (const [, pageData] of result.readPages.get(databaseMainTableId)!) {
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
            for (const [, pageData] of result.readPages.get(databaseMainTableId)!) {
                if (pageData.data.some(b => b !== 0)) {
                    hasNonZeroPage = true;
                    break;
                }
            }
            expect(hasNonZeroPage).toBe(true);
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
                const pageIndices = [...result.readPages.get(databaseMainTableId)!.keys()];

                // Page 0 (the schema page) is always accessed.
                expect(pageIndices).toContain(0);
                // The table's own root page should be accessed.
                // rootpage is 1-based, our map keys are 0-based.
                expect(pageIndices).toContain(rootpage - 1);
            }
        });

        test("repeated identical queries return identical readPages", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1), (2), (3)",
            );

            const result1 = server.execute("SELECT * FROM items", {allowWrites: "none"});
            const result2 = server.execute("SELECT * FROM items", {allowWrites: "none"});

            const t1 = result1.readPages.get(databaseMainTableId)!;
            const t2 = result2.readPages.get(databaseMainTableId)!;
            expect(t1.size).toBe(t2.size);
            for (const [pageIndex, pageData] of t1) {
                expect(t2.has(pageIndex)).toBe(true);
                expect(pageData).toEqual(t2.get(pageIndex));
            }
        });
    });

    // The writeLevel × action authorization matrix is
    // covered exhaustively in
    // shared/databases/sqlite_authorizer.test.ts. The tests
    // here only assert behavior unique to DatabaseServer
    // (page tracking, changedPages, transaction lifecycle).

    describe("execute read-only — isolation", () => {
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
            server.commitBufferForTests();

            const after = server.execute("SELECT COUNT(*) as cnt FROM items", {
                allowWrites: "none",
            });
            expect(after.rows).toEqual([{cnt: 2}]);
        });

        test("database is usable after a failed execute (any writeLevel)", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
                "INSERT INTO items VALUES (1)",
            );

            // Authorizer rejection.
            expect(() =>
                server.execute("INSERT INTO items VALUES (2)", {allowWrites: "none"}),
            ).toThrow();
            // Reference to non-existent table.
            expect(() =>
                server.execute("SELECT * FROM nonexistent", {allowWrites: "none"}),
            ).toThrow();
            // Constraint violation under writes.
            expect(() =>
                server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"}),
            ).toThrow();

            // After all of the above, the server should still
            // serve queries and accept new writes.
            const after = server.execute("SELECT * FROM items", {allowWrites: "none"});
            expect(after.rows).toEqual([{id: 1}]);
            server.execute("INSERT INTO items VALUES (2)", {allowWrites: "data"});
            const final = server.execute("SELECT * FROM items ORDER BY id", {
                allowWrites: "none",
            });
            expect(final.rows).toEqual([{id: 1}, {id: 2}]);
        });
    });

    describe("execute — error handling", () => {
        test("invalid SQL throws regardless of writeLevel", async () => {
            const server = await createServerWithSchema();

            expect(() => server.execute("NOT VALID SQL", {allowWrites: "none"})).toThrow();
            expect(() => server.execute("NOT VALID SQL", {allowWrites: "data"})).toThrow();
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
            server.commitBufferForTests();

            // Storage should have been written to.
            expect(storage.getFileSize(databaseMainTableId)).toBeGreaterThan(0);
        });

        test("page data from execute matches what storage has", async () => {
            const storage = new InMemoryStorage();
            const server = await DatabaseServer.create(storage);
            openServers.push(server);
            const db = server.unsafeGetDbForTests();

            db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
            db.exec("INSERT INTO items VALUES (1)");
            server.commitBufferForTests();

            const result = server.execute("SELECT * FROM items", {allowWrites: "none"});

            // Each page in the result should match what storage
            // returns for that page index.
            for (const [pageIndex, pageData] of result.readPages.get(databaseMainTableId)!) {
                expect(pageData).toEqual(storage.readPage(databaseMainTableId, pageIndex));
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
            expect(result.changedPages.get(databaseMainTableId)?.pages.size ?? 0).toBeGreaterThan(
                0,
            );
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
    });

    describe("execute with writes — changed pages", () => {
        test("changedPages has before and after snapshots", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            const result = server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"});

            for (const [, change] of result.changedPages.get(databaseMainTableId)!.pages) {
                expect(change.before).toBeInstanceOf(Uint8Array);
                expect(change.after).toBeInstanceOf(Uint8Array);
            }
        });

        test("all page snapshots are 4096 bytes", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            const result = server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"});

            for (const [, change] of result.changedPages.get(databaseMainTableId)!.pages) {
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
            server.commitBufferForTests();

            // Snapshot storage state before the mutation.
            const prePages = new Map<number, Uint8Array>();
            for (let i = 0; i < storage.getFileSize(databaseMainTableId) / sqlitePageSize; i++) {
                prePages.set(i, new Uint8Array(storage.readPage(databaseMainTableId, i)!.data));
            }

            const result = server.execute("INSERT INTO items VALUES (2)", {allowWrites: "data"});

            for (const [pageIndex, change] of result.changedPages.get(databaseMainTableId)!.pages) {
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
            server.commitBufferForTests();

            const result = server.execute("INSERT INTO items VALUES (2)", {allowWrites: "data"});

            for (const [pageIndex, change] of result.changedPages.get(databaseMainTableId)!.pages) {
                expect(change.after).toEqual(
                    storage.readPage(databaseMainTableId, pageIndex)!.data,
                );
            }
        });

        test("before and after differ for changed pages", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            const result = server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"});

            // At least one page should have different before/after.
            let hasDiff = false;
            for (const [, change] of result.changedPages.get(databaseMainTableId)!.pages) {
                if (!change.before.every((b, i) => b === change.after[i])) {
                    hasDiff = true;
                    break;
                }
            }
            expect(hasDiff).toBe(true);
        });

        test("changedPages reports per-table fileSizeInPages after the drain", async () => {
            const server = await createServerWithSchema(
                "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            );

            const result = server.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"});
            const entry = result.changedPages.get(databaseMainTableId);
            expect(entry).toBeDefined();
            expect(entry!.fileSizeInPages).toBeGreaterThan(0);
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
