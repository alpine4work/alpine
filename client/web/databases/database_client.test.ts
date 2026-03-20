/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import type {DatabaseClientConnection} from "~/client/web/databases/database_client.js";
import {DatabaseClient} from "~/client/web/databases/database_client.js";
import type {ExecuteActionServerResult} from "~/client/web/databases/database_worker_rpc_methods.js";
import type {
    OpfsDirectoryHandle,
    OpfsFileHandle,
    OpfsSyncAccessHandle,
} from "~/client/web/databases/opfs.js";
import type {DatabaseActionObject} from "~/shared/databases/database_actions.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {InternalError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";

const testConn: DatabaseClientConnection = {
    executeActionServer() {
        // Return a never-resolving promise so optimistic
        // pages are preserved during tests.
        return new Promise(() => {});
    },
    ensureCacheIsUpToDate() {
        return Promise.resolve({updatedPages: new Map(), stalePageIndexes: [], fileSizeInPages: 0});
    },
    reportError() {},
};

async function execute(
    client: DatabaseClient,
    conn: DatabaseClientConnection,
    sql: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
    const {rows} = await client.executeAction<"rawSql">(conn, {name: "rawSql", input: {sql}});
    return rows as ReadonlyArray<Record<string, unknown>>;
}

function createInMemorySyncHandle(): OpfsSyncAccessHandle {
    let buffer = new Uint8Array(0);
    return {
        read(data, options) {
            const at = options?.at ?? 0;
            const available = Math.max(0, buffer.byteLength - at);
            const toCopy = Math.min(data.byteLength, available);
            if (toCopy > 0) {
                data.set(buffer.subarray(at, at + toCopy));
            }
            return toCopy;
        },
        write(data, options) {
            const at = options?.at ?? 0;
            const end = at + data.byteLength;
            if (end > buffer.byteLength) {
                const next = new Uint8Array(end);
                next.set(buffer);
                buffer = next;
            }
            buffer.set(data, at);
            return data.byteLength;
        },
        truncate(size) {
            if (size < buffer.byteLength) {
                buffer = buffer.slice(0, size);
            } else {
                const next = new Uint8Array(size);
                next.set(buffer);
                buffer = next;
            }
        },
        flush() {},
        close() {},
        getSize() {
            return buffer.byteLength;
        },
    };
}

function createInMemoryDirectory(): OpfsDirectoryHandle {
    const dirs = new Map<string, OpfsDirectoryHandle>();
    const files = new Map<string, OpfsSyncAccessHandle>();
    return {
        async removeEntry(name: string) {
            dirs.delete(name);
            files.delete(name);
        },
        async getDirectoryHandle(name: string) {
            let dir = dirs.get(name);
            if (dir === undefined) {
                dir = createInMemoryDirectory();
                dirs.set(name, dir);
            }
            return dir;
        },
        async getFileHandle(name: string): Promise<OpfsFileHandle> {
            return {
                async createSyncAccessHandle() {
                    let handle = files.get(name);
                    if (handle === undefined) {
                        handle = createInMemorySyncHandle();
                        files.set(name, handle);
                    }
                    return handle;
                },
            };
        },
    };
}

// ---------------------------------------------------------------------------
// OPFS page extraction / pre-population helpers
// ---------------------------------------------------------------------------

/**
 * Reads all pages + index from a directory's "databases"
 * subdirectory. Uses the same OPFS mock handles that the
 * `DatabaseClient` wrote to.
 */
async function extractPages(
    dir: OpfsDirectoryHandle,
): Promise<Array<{pageIndex: number; timestamp: number; data: Uint8Array}>> {
    const dbDir = await dir.getDirectoryHandle("databases");
    const pagesHandle = await (await dbDir.getFileHandle("pages.bin")).createSyncAccessHandle();
    const indexHandle = await (await dbDir.getFileHandle("index.json")).createSyncAccessHandle();

    const indexSize = indexHandle.getSize();
    if (indexSize === 0) return [];

    const raw = new Uint8Array(indexSize);
    indexHandle.read(raw, {at: 0});
    const entries = JSON.parse(new TextDecoder().decode(raw)) as Array<
        [number, {slot: number; timestamp: number}]
    >;

    return entries.map(([pageIndex, {slot, timestamp}]) => {
        const data = new Uint8Array(sqlitePageSize);
        pagesHandle.read(data, {at: slot * sqlitePageSize});
        return {pageIndex, timestamp, data};
    });
}

/**
 * Pre-populates a directory's "databases" subdirectory
 * with pages + index so that a subsequent
 * `DatabaseClient.create` opens an existing DB rather
 * than creating a fresh one.
 */
async function prepopulatePages(
    dir: OpfsDirectoryHandle,
    pages: Array<{pageIndex: number; timestamp: number; data: Uint8Array}>,
): Promise<void> {
    const dbDir = await dir.getDirectoryHandle("databases");
    const pagesHandle = await (await dbDir.getFileHandle("pages.bin")).createSyncAccessHandle();
    const indexHandle = await (await dbDir.getFileHandle("index.json")).createSyncAccessHandle();

    const indexEntries: Array<[number, {slot: number; timestamp: number}]> = [];
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i]!;
        pagesHandle.write(page.data, {at: i * sqlitePageSize});
        indexEntries.push([page.pageIndex, {slot: i, timestamp: page.timestamp}]);
    }
    pagesHandle.flush();

    const json = new TextEncoder().encode(JSON.stringify(indexEntries, null, 2));
    indexHandle.write(json, {at: 0});
    indexHandle.flush();
}

function pagesToMap(
    pages: Array<{pageIndex: number; timestamp: number; data: Uint8Array}>,
): Map<number, {timestamp: number; data: Uint8Array}> {
    return new Map(pages.map(p => [p.pageIndex, {timestamp: p.timestamp, data: p.data}]));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DatabaseClient", () => {
    test("SELECT 1 + 1", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        const rows = await execute(client, testConn, "SELECT 1 + 1 AS result");

        expect(rows).toMatchObject([{result: 2}]);
    });

    test("create table, insert, and select", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        client.executeLocallyForTests(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        );
        await execute(client, testConn, "INSERT INTO items (name) VALUES ('alpha'), ('beta')");
        const rows = await execute(client, testConn, "SELECT * FROM items ORDER BY id");

        expect(rows).toMatchObject([
            {id: 1, name: "alpha"},
            {id: 2, name: "beta"},
        ]);
    });

    test("aggregate query", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        client.executeLocallyForTests(
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, status TEXT NOT NULL)",
        );
        await execute(
            client,
            testConn,
            "INSERT INTO tasks (status) VALUES ('done'), ('todo'), ('todo'), ('done'), ('done')",
        );
        const rows = await execute(
            client,
            testConn,
            "SELECT status, count(*) AS count FROM tasks GROUP BY status ORDER BY status",
        );

        expect(rows).toMatchObject([
            {status: "done", count: 3},
            {status: "todo", count: 2},
        ]);
    });

    test("multiple clients have independent databases", async () => {
        const client1 = await DatabaseClient.create(createInMemoryDirectory());
        const client2 = await DatabaseClient.create(createInMemoryDirectory());

        client1.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await execute(client1, testConn, "INSERT INTO t (id) VALUES (1)");

        client2.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await execute(client2, testConn, "INSERT INTO t (id) VALUES (99)");

        expect(await execute(client1, testConn, "SELECT * FROM t")).toMatchObject([{id: 1}]);
        expect(await execute(client2, testConn, "SELECT * FROM t")).toMatchObject([{id: 99}]);
    });
});

describe("execute — mutations", () => {
    test("executes mutation locally and returns rows", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");

        const rows = await execute(
            client,
            testConn,
            "INSERT INTO t (name) VALUES ('test') RETURNING *",
        );

        expect(rows).toMatchObject([{id: 1, name: "test"}]);
    });

    test("sends mutation to server in background", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");

        let capturedAction: DatabaseActionObject | null = null;
        let capturedMutationId: DatabaseMutationId | null = null;
        const conn: DatabaseClientConnection = {
            async executeActionServer(action, options) {
                capturedAction = action;
                capturedMutationId = options.mutationId;
                // Simulate realtime confirmation arriving
                // before server response (same as production).
                client.writePagesFromRealtime([], options.mutationId, 0);
                return {
                    result: {name: "rawSql", output: {rows: []}},
                    readPages: new Map(),
                };
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(capturedAction).toMatchObject({
            name: "rawSql",
            input: {sql: "INSERT INTO t (id) VALUES (1)"},
        });
        expect(capturedMutationId).not.toBeNull();
    });

    test("falls back to server on PageMissingError", async () => {
        const serverDir = createInMemoryDirectory();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(`INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`);
        }

        const allPages = await extractPages(serverDir);

        const localDir = createInMemoryDirectory();
        await prepopulatePages(localDir, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        let serverCalled = false;
        const serverConn: DatabaseClientConnection = {
            async executeActionServer() {
                serverCalled = true;
                return {
                    result: {name: "rawSql", output: {rows: [{inserted: true}]}},
                    readPages: new Map(),
                };
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };

        const rows = await execute(local, serverConn, "INSERT INTO t (data) VALUES ('new')");

        expect(serverCalled).toBe(true);
        expect(rows).toMatchObject([{inserted: true}]);
    });

    test("empty store falls back to local for writes", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        let serverCallCount = 0;
        const conn: DatabaseClientConnection = {
            async executeActionServer(_action, options) {
                serverCallCount++;
                // Simulate realtime confirmation arriving
                // before server response.
                client.writePagesFromRealtime([], options.mutationId, 0);
                return {
                    result: {name: "rawSql", output: {rows: []}},
                    readPages: new Map(),
                };
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };

        // Use executeLocallyForTests for DDL so the
        // authorizer allows it; the store stays empty
        // because the DB has no user data pages yet
        // beyond the schema page.
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        const rows = await execute(client, conn, "INSERT INTO t (id) VALUES (1)");

        // DML executes locally — returns no rows.
        expect(rows).toMatchObject([]);

        // Background send fires after microtask.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(serverCallCount).toBe(1);
    });

    test("propagates local execution errors", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        await expect(
            execute(client, testConn, "INSERT INTO nonexistent VALUES (1)"),
        ).rejects.toThrow();
    });
});

describe("optimistic mutations", () => {
    test("writePagesFromRealtime dequeues confirmed mutation", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");

        let capturedMutationId: DatabaseMutationId | null = null;
        const conn: DatabaseClientConnection = {
            executeActionServer(_action, options) {
                capturedMutationId = options.mutationId;
                return new Promise(() => {});
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        expect(capturedMutationId).not.toBeNull();

        // Confirm the mutation — should not throw
        client.writePagesFromRealtime([], capturedMutationId!, 0);
    });

    test("replays remaining mutations after confirmation", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");

        const mutationIds: Array<DatabaseMutationId> = [];
        const conn: DatabaseClientConnection = {
            executeActionServer(_action, options) {
                mutationIds.push(options.mutationId);
                return new Promise(() => {});
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };

        await execute(client, conn, "INSERT INTO t (val) VALUES ('first')");
        await execute(client, conn, "INSERT INTO t (val) VALUES ('second')");

        // Confirm first mutation
        client.writePagesFromRealtime([], mutationIds[0]!, 0);

        // Second mutation should still be visible via replay
        const rows = await execute(client, testConn, "SELECT val FROM t ORDER BY id");
        expect(rows).toMatchObject([{val: "second"}]);
    });

    test("asserts on out-of-order confirmation", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");

        const mutationIds: Array<DatabaseMutationId> = [];
        const conn: DatabaseClientConnection = {
            executeActionServer(_action, options) {
                mutationIds.push(options.mutationId);
                return new Promise(() => {});
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        await execute(client, conn, "INSERT INTO t (id) VALUES (2)");

        expect(() => client.writePagesFromRealtime([], mutationIds[1]!, 0)).toThrow(
            "unexpected mutation confirmation order",
        );
    });

    test("external mutation applies pages without dequeue", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");

        // No optimistic mutations queued — just apply pages
        client.writePagesFromRealtime([], "unknown-mutation-id" as DatabaseMutationId, 0);

        // Should succeed without assertion error
        const rows = await execute(client, testConn, "SELECT count(*) AS n FROM t");
        expect(rows).toMatchObject([{n: 0}]);
    });

    test("reports error when server mutation fails", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");

        let reportedError: unknown = null;
        const conn: DatabaseClientConnection = {
            async executeActionServer() {
                throw new InternalError("server rejected mutation");
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError(error) {
                reportedError = error;
            },
        };

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(reportedError).toBeInstanceOf(Error);
        expect((reportedError as Error).message).toBe("server rejected mutation");
    });

    test("removes optimistic mutation on server error", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");

        const conn: DatabaseClientConnection = {
            async executeActionServer() {
                throw new InternalError("server rejected mutation");
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 0));

        // Optimistic mutation should be removed — query sees
        // the base state (empty table).
        const rows = await execute(client, testConn, "SELECT count(*) AS n FROM t");
        expect(rows).toMatchObject([{n: 0}]);
    });

    test("asserts mutation confirmed before server responds", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");

        let reportedError: unknown = null;
        const conn: DatabaseClientConnection = {
            async executeActionServer() {
                // Return without calling writePagesFromRealtime
                // — the mutation is still in the queue.
                return {
                    result: {name: "rawSql", output: {rows: []}},
                    readPages: new Map(),
                };
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError(error) {
                reportedError = error;
            },
        };

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(reportedError).toBeInstanceOf(Error);
        expect((reportedError as Error).message).toBe(
            "Assertion failure: mutation not confirmed via realtime before server responded",
        );
    });
});

describe("server fallback", () => {
    test("missing page triggers server fallback", async () => {
        // Create a "server" DB with enough data to span
        // multiple pages (4096 bytes each).
        const serverDir = createInMemoryDirectory();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(`INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`);
        }

        const allPages = await extractPages(serverDir);

        // Pre-populate a local directory with all pages
        // EXCEPT the last one, then open it. SQLite sees
        // the existing DB but one page is absent.
        const localDir = createInMemoryDirectory();
        await prepopulatePages(localDir, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        let serverCalled = false;
        const serverConn: DatabaseClientConnection = {
            async executeActionServer(action) {
                serverCalled = true;
                const rows = await execute(server, testConn, (action.input as any).sql);
                return {
                    result: {name: action.name, output: {rows}},
                    readPages: pagesToMap(allPages),
                } as ExecuteActionServerResult;
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };

        const rows = await execute(local, serverConn, "SELECT count(*) AS n FROM t");

        expect(rows).toMatchObject([{n: 20}]);
        expect(serverCalled).toBe(true);
    });

    test("server fallback caches pages for subsequent local queries", async () => {
        const serverDir = createInMemoryDirectory();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(`INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`);
        }

        const allPages = await extractPages(serverDir);

        // Pre-populate with all but last page
        const localDir = createInMemoryDirectory();
        await prepopulatePages(localDir, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        // First query: server fallback writes missing pages
        const serverConn: DatabaseClientConnection = {
            async executeActionServer(action) {
                const rows = await execute(server, testConn, (action.input as any).sql);
                return {
                    result: {name: action.name, output: {rows}},
                    readPages: pagesToMap(allPages),
                } as ExecuteActionServerResult;
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };
        await execute(local, serverConn, "SELECT count(*) AS n FROM t");

        // Second query with a throwing connection — should
        // succeed locally since all pages are now cached.
        const rows = await execute(local, testConn, "SELECT count(*) AS n FROM t");

        expect(rows).toMatchObject([{n: 20}]);
    });
});

describe("executeActionWithTracking", () => {
    test("returns output and read page set", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        await execute(client, testConn, "INSERT INTO t (val) VALUES ('hello')");

        const {output, readPages} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: {sql: "SELECT * FROM t"},
        });

        expect((output as {rows: unknown}).rows).toMatchObject([{id: 1, val: "hello"}]);
        expect(readPages.size).toBeGreaterThan(0);
    });

    test("read pages include the table's root page", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        const db = client.unsafeGetDbForTests();

        client.executeLocallyForTests("CREATE TABLE t1 (id INTEGER PRIMARY KEY)");
        client.executeLocallyForTests("CREATE TABLE t2 (id INTEGER PRIMARY KEY)");
        await execute(client, testConn, "INSERT INTO t1 (id) VALUES (1)");
        await execute(client, testConn, "INSERT INTO t2 (id) VALUES (2)");

        const schema = db.exec("SELECT name, rootpage FROM sqlite_schema ORDER BY name", {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<{name: string; rootpage: number}>;

        const t1Root = schema.find(s => s.name === "t1")!.rootpage;
        const t2Root = schema.find(s => s.name === "t2")!.rootpage;

        const {readPages: pagesT1} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: {sql: "SELECT * FROM t1"},
        });
        const {readPages: pagesT2} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: {sql: "SELECT * FROM t2"},
        });

        // 0-based page indices (SQLite rootpage is 1-based)
        expect(pagesT1.has(t1Root - 1)).toBe(true);
        expect(pagesT2.has(t2Root - 1)).toBe(true);
    });

    test("different tables have different read sets", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        client.executeLocallyForTests("CREATE TABLE t1 (id INTEGER PRIMARY KEY)");
        client.executeLocallyForTests("CREATE TABLE t2 (id INTEGER PRIMARY KEY)");
        await execute(client, testConn, "INSERT INTO t1 (id) VALUES (1)");
        await execute(client, testConn, "INSERT INTO t2 (id) VALUES (2)");

        const {readPages: pagesT1} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: {sql: "SELECT * FROM t1"},
        });
        const {readPages: pagesT2} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: {sql: "SELECT * FROM t2"},
        });

        // Both include page 0 (schema page), but differ
        // on at least one page (each table's root page).
        const onlyT1 = [...pagesT1].filter(p => !pagesT2.has(p));
        const onlyT2 = [...pagesT2].filter(p => !pagesT1.has(p));
        expect(onlyT1.length + onlyT2.length).toBeGreaterThan(0);
    });

    test("throws on write attempts without contacting server", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await execute(client, testConn, "INSERT INTO t (id) VALUES (1)");

        let serverCalled = false;
        const conn: DatabaseClientConnection = {
            async executeActionServer() {
                serverCalled = true;
                return {
                    result: {name: "readonlyRawSql", output: {rows: []}},
                    readPages: new Map(),
                };
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };

        await expect(
            client.executeActionWithTracking(conn, {
                name: "readonlyRawSql",
                input: {sql: "INSERT INTO t (id) VALUES (2)"},
            }),
        ).rejects.toThrow("not authorized");

        expect(serverCalled).toBe(false);

        // Table should be unchanged — the write was rolled back.
        const {output} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: {sql: "SELECT * FROM t"},
        });
        expect((output as {rows: unknown}).rows).toMatchObject([{id: 1}]);
    });

    test("server fallback still produces accurate read set", async () => {
        // Create a "server" DB
        const serverDir = createInMemoryDirectory();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(`INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`);
        }
        const allPages = await extractPages(serverDir);

        // Pre-populate with all but last page
        const localDir = createInMemoryDirectory();
        await prepopulatePages(localDir, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        const serverConn: DatabaseClientConnection = {
            async executeActionServer(action) {
                const rows = await execute(server, testConn, (action.input as any).sql);
                return {
                    result: {name: action.name, output: {rows}},
                    readPages: pagesToMap(allPages),
                } as ExecuteActionServerResult;
            },
            ensureCacheIsUpToDate() {
                return Promise.resolve({
                    updatedPages: new Map(),
                    stalePageIndexes: [],
                    fileSizeInPages: 0,
                });
            },
            reportError() {},
        };

        const {output, readPages} = await local.executeActionWithTracking(serverConn, {
            name: "readonlyRawSql",
            input: {sql: "SELECT count(*) AS n FROM t"},
        });

        expect((output as {rows: unknown}).rows).toMatchObject([{n: 20}]);
        // After server fallback + local retry, should have
        // an accurate read set covering multiple pages.
        expect(readPages.size).toBeGreaterThan(0);
    });
});

describe("registerReactiveAction", () => {
    test("returns initial output", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        await execute(client, testConn, "INSERT INTO t (val) VALUES ('hello')");

        const result = await client.registerReactiveAction(
            "q1",
            {name: "readonlyRawSql", input: {sql: "SELECT * FROM t"}},
            testConn,
            () => {},
            () => {},
        );

        expect(result.ok).toBe(true);
        expect((result.value as {rows: unknown}).rows).toMatchObject([{id: 1, val: "hello"}]);
    });

    test("optimistic mutation invalidates overlapping reactive action", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        await execute(client, testConn, "INSERT INTO t (val) VALUES ('v1')");

        const notifications: Array<{rows: ReadonlyArray<Record<string, unknown>>}> = [];
        await client.registerReactiveAction(
            "q1",
            {name: "readonlyRawSql", input: {sql: "SELECT * FROM t ORDER BY id"}},
            testConn,
            output => {
                notifications.push(output as {rows: ReadonlyArray<Record<string, unknown>>});
            },
            () => {},
        );

        // Optimistic mutation — should trigger invalidation
        await execute(client, testConn, "INSERT INTO t (val) VALUES ('v2')");

        // Wait for microtask-based invalidation
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(1);
        expect(notifications[0]!.rows).toMatchObject([
            {id: 1, val: "v1"},
            {id: 2, val: "v2"},
        ]);
    });

    test("notify fires when overlapping pages are written", async () => {
        const dir = createInMemoryDirectory();
        const client = await DatabaseClient.create(dir);

        // Use executeLocallyForTests so data goes to OPFS
        // base store (not optimistic pages) — extractPages
        // reads from the base store.
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        client.executeLocallyForTests("INSERT INTO t (val) VALUES ('v1')");

        const notifications: Array<{rows: ReadonlyArray<Record<string, unknown>>}> = [];
        await client.registerReactiveAction(
            "q1",
            {name: "readonlyRawSql", input: {sql: "SELECT * FROM t ORDER BY id"}},
            testConn,
            output => {
                notifications.push(output as {rows: ReadonlyArray<Record<string, unknown>>});
            },
            () => {},
        );

        // Insert another row directly to OPFS base store
        client.executeLocallyForTests("INSERT INTO t (val) VALUES ('v2')");

        // Write as realtime with newer timestamps to
        // trigger invalidation. Empty diffs since OPFS
        // already has the current content.
        const pages = await extractPages(dir);
        const newerPages = pages.map(({pageIndex, timestamp}) => ({
            pageIndex,
            timestamp: timestamp + 1000,
            diff: [],
        }));
        client.writePagesFromRealtime(newerPages, generateId<DatabaseMutationId>(), 0);

        // Wait for microtask-based invalidation
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(1);
        expect(notifications[0]!.rows).toMatchObject([
            {id: 1, val: "v1"},
            {id: 2, val: "v2"},
        ]);
    });

    test("notify does NOT fire for non-overlapping pages", async () => {
        const dir = createInMemoryDirectory();
        const client = await DatabaseClient.create(dir);

        // Use executeLocallyForTests so data goes to OPFS
        // base store. This lets markWrittenPages filter
        // page-0 noise correctly (readPage(0) must return
        // non-null for the noise check to work).
        client.executeLocallyForTests("CREATE TABLE t1 (id INTEGER PRIMARY KEY)");
        client.executeLocallyForTests("CREATE TABLE t2 (id INTEGER PRIMARY KEY)");
        client.executeLocallyForTests("INSERT INTO t1 (id) VALUES (1)");
        client.executeLocallyForTests("INSERT INTO t2 (id) VALUES (2)");

        // Watch only t1
        const notifications: Array<unknown> = [];
        await client.registerReactiveAction(
            "q1",
            {name: "readonlyRawSql", input: {sql: "SELECT * FROM t1"}},
            testConn,
            output => {
                notifications.push(output);
            },
            () => {},
        );

        // Record pages before t2 mutation
        const pagesBefore = await extractPages(dir);

        // Mutate t2 only
        await execute(client, testConn, "INSERT INTO t2 (id) VALUES (3)");

        const pagesAfter = await extractPages(dir);
        const changedPages = pagesAfter
            .filter(after => {
                // Skip page 0 — it always changes (SQLite
                // file change counter) and is in every
                // query's read set, so it would always
                // trigger a notification.
                if (after.pageIndex === 0) return false;
                const before = pagesBefore.find(b => b.pageIndex === after.pageIndex);
                return before === undefined || before.timestamp !== after.timestamp;
            })
            .map(({pageIndex, timestamp}) => ({
                pageIndex,
                timestamp: timestamp + 1000,
                diff: [],
            }));

        client.writePagesFromRealtime(changedPages, generateId<DatabaseMutationId>(), 0);

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(0);
    });

    test("initial failure still registers action, re-executes on page write", async () => {
        const dir = createInMemoryDirectory();
        const client = await DatabaseClient.create(dir);

        // Register an action against a table that doesn't
        // exist yet — initial evaluation will fail.
        const notifications: Array<{rows: ReadonlyArray<Record<string, unknown>>}> = [];
        const result = await client.registerReactiveAction(
            "q1",
            {name: "readonlyRawSql", input: {sql: "SELECT * FROM t ORDER BY id"}},
            testConn,
            output => {
                notifications.push(output as {rows: ReadonlyArray<Record<string, unknown>>});
            },
            () => {},
        );

        expect(result.ok).toBe(false);

        // Now create the table. The write goes to the
        // base store so extractPages picks it up.
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        client.executeLocallyForTests("INSERT INTO t (val) VALUES ('hello')");

        // Trigger invalidation via realtime page writes.
        // readPages is null so any page write overlaps.
        const pages = await extractPages(dir);
        const newerPages = pages.map(({pageIndex, timestamp}) => ({
            pageIndex,
            timestamp: timestamp + 1000,
            diff: [],
        }));
        client.writePagesFromRealtime(newerPages, generateId<DatabaseMutationId>(), 0);

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(1);
        expect(notifications[0]!.rows).toMatchObject([{id: 1, val: "hello"}]);
    });

    test("unregisterReactiveAction stops notifications", async () => {
        const dir = createInMemoryDirectory();
        const client = await DatabaseClient.create(dir);

        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await execute(client, testConn, "INSERT INTO t (id) VALUES (1)");

        const notifications: Array<unknown> = [];
        await client.registerReactiveAction(
            "q1",
            {name: "readonlyRawSql", input: {sql: "SELECT * FROM t"}},
            testConn,
            output => {
                notifications.push(output);
            },
            () => {},
        );

        client.unregisterReactiveAction("q1");

        // Write pages — should not trigger notification
        const pages = await extractPages(dir);
        const newerPages = pages.map(({pageIndex, timestamp}) => ({
            pageIndex,
            timestamp: timestamp + 1000,
            diff: [],
        }));
        client.writePagesFromRealtime(newerPages, generateId<DatabaseMutationId>(), 0);

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(0);
    });
});
