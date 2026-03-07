import type {DatabaseClientConnection} from "~/client/web/databases/database_client.js";
import {DatabaseClient} from "~/client/web/databases/database_client.js";
import type {QueryServerResult} from "~/client/web/databases/database_rpc_methods.js";
import type {
    OpfsDirectoryHandle,
    OpfsFileHandle,
    OpfsSyncAccessHandle,
} from "~/client/web/databases/opfs.js";
import {InternalError, UnavailableError} from "~/shared/error/error.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";

const testConn: DatabaseClientConnection = {
    queryServer() {
        throw new UnavailableError("No server in test");
    },
    mutateServer() {
        throw new UnavailableError("No server in test");
    },
    reportError() {},
};

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

const pageSize = 4096;

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
        const data = new Uint8Array(pageSize);
        pagesHandle.read(data, {at: slot * pageSize});
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
        pagesHandle.write(page.data, {at: i * pageSize});
        indexEntries.push([page.pageIndex, {slot: i, timestamp: page.timestamp}]);
    }
    pagesHandle.flush();

    const json = new TextEncoder().encode(JSON.stringify(indexEntries, null, 2));
    indexHandle.write(json, {at: 0});
    indexHandle.flush();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/* eslint-disable cyberworlds/string-quotes -- SQL literals, not UI text */

describe("DatabaseClient", () => {
    test("SELECT 1 + 1", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        const rows = await client.executeQuery(testConn, "SELECT 1 + 1 AS result");

        expect(rows).toMatchObject([{result: 2}]);
    });

    test("create table, insert, and select", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        await client.executeQuery(
            testConn,
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        );
        await client.executeQuery(testConn, "INSERT INTO items (name) VALUES ('alpha'), ('beta')");
        const rows = await client.executeQuery(testConn, "SELECT * FROM items ORDER BY id");

        expect(rows).toMatchObject([
            {id: 1, name: "alpha"},
            {id: 2, name: "beta"},
        ]);
    });

    test("aggregate query", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        await client.executeQuery(
            testConn,
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, status TEXT NOT NULL)",
        );
        await client.executeQuery(
            testConn,
            "INSERT INTO tasks (status) VALUES ('done'), ('todo'), ('todo'), ('done'), ('done')",
        );
        const rows = await client.executeQuery(
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

        await client1.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await client1.executeQuery(testConn, "INSERT INTO t (id) VALUES (1)");

        await client2.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await client2.executeQuery(testConn, "INSERT INTO t (id) VALUES (99)");

        expect(await client1.executeQuery(testConn, "SELECT * FROM t")).toMatchObject([{id: 1}]);
        expect(await client2.executeQuery(testConn, "SELECT * FROM t")).toMatchObject([{id: 99}]);
    });
});

describe("executeMutation", () => {
    test("executes mutation locally and returns rows", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        await client.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");

        const rows = await client.executeMutation(
            testConn,
            "INSERT INTO t (name) VALUES ('test') RETURNING *",
        );

        expect(rows).toMatchObject([{id: 1, name: "test"}]);
    });

    test("sends mutation to server in background", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        await client.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY)");

        let capturedSql: string | null = null;
        let capturedMutationId: DatabaseMutationId | null = null;
        const conn: DatabaseClientConnection = {
            queryServer() {
                throw new UnavailableError("No server in test");
            },
            async mutateServer(sql, mutationId) {
                capturedSql = sql;
                capturedMutationId = mutationId;
                // Simulate realtime confirmation arriving
                // before server response (same as production).
                client.writePagesFromRealtime([], mutationId);
                return {rows: []};
            },
            reportError() {},
        };

        await client.executeMutation(conn, "INSERT INTO t (id) VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(capturedSql).toBe("INSERT INTO t (id) VALUES (1)");
        expect(capturedMutationId).not.toBeNull();
    });

    test("falls back to server on PageMissingError", async () => {
        const serverDir = createInMemoryDirectory();
        const server = await DatabaseClient.create(serverDir);
        await server.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        for (let i = 0; i < 20; i++) {
            await server.executeQuery(
                testConn,
                `INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`,
            );
        }

        const allPages = await extractPages(serverDir);

        const localDir = createInMemoryDirectory();
        await prepopulatePages(localDir, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        let serverCalled = false;
        const serverConn: DatabaseClientConnection = {
            queryServer() {
                throw new UnavailableError("No server in test");
            },
            async mutateServer() {
                serverCalled = true;
                return {rows: [{inserted: true}]};
            },
            reportError() {},
        };

        const rows = await local.executeMutation(serverConn, "INSERT INTO t (data) VALUES ('new')");

        expect(serverCalled).toBe(true);
        expect(rows).toMatchObject([{inserted: true}]);
    });

    test("propagates local execution errors", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());

        await expect(
            client.executeMutation(testConn, "INSERT INTO nonexistent VALUES (1)"),
        ).rejects.toThrow();
    });
});

describe("optimistic mutations", () => {
    test("writePagesFromRealtime dequeues confirmed mutation", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        await client.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY)");

        let capturedMutationId: DatabaseMutationId | null = null;
        const conn: DatabaseClientConnection = {
            queryServer() {
                throw new UnavailableError("No server in test");
            },
            mutateServer(_sql, mutationId) {
                capturedMutationId = mutationId;
                return new Promise(() => {});
            },
            reportError() {},
        };

        await client.executeMutation(conn, "INSERT INTO t (id) VALUES (1)");
        expect(capturedMutationId).not.toBeNull();

        // Confirm the mutation — should not throw
        client.writePagesFromRealtime([], capturedMutationId!);
    });

    test("replays remaining mutations after confirmation", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        await client.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");

        const mutationIds: Array<DatabaseMutationId> = [];
        const conn: DatabaseClientConnection = {
            queryServer() {
                throw new UnavailableError("No server in test");
            },
            mutateServer(_sql, mutationId) {
                mutationIds.push(mutationId);
                return new Promise(() => {});
            },
            reportError() {},
        };

        await client.executeMutation(conn, "INSERT INTO t (val) VALUES ('first')");
        await client.executeMutation(conn, "INSERT INTO t (val) VALUES ('second')");

        // Confirm first mutation
        client.writePagesFromRealtime([], mutationIds[0]!);

        // Second mutation should still be visible via replay
        const rows = await client.executeQuery(testConn, "SELECT val FROM t ORDER BY id");
        expect(rows).toMatchObject([{val: "second"}]);
    });

    test("asserts on out-of-order confirmation", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        await client.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY)");

        const mutationIds: Array<DatabaseMutationId> = [];
        const conn: DatabaseClientConnection = {
            queryServer() {
                throw new UnavailableError("No server in test");
            },
            mutateServer(_sql, mutationId) {
                mutationIds.push(mutationId);
                return new Promise(() => {});
            },
            reportError() {},
        };

        await client.executeMutation(conn, "INSERT INTO t (id) VALUES (1)");
        await client.executeMutation(conn, "INSERT INTO t (id) VALUES (2)");

        expect(() => client.writePagesFromRealtime([], mutationIds[1]!)).toThrow(
            "unexpected mutation confirmation order",
        );
    });

    test("external mutation applies pages without dequeue", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        await client.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY)");

        // No optimistic mutations queued — just apply pages
        client.writePagesFromRealtime([], "unknown-mutation-id" as DatabaseMutationId);

        // Should succeed without assertion error
        const rows = await client.executeQuery(testConn, "SELECT count(*) AS n FROM t");
        expect(rows).toMatchObject([{n: 0}]);
    });

    test("reports error when server mutation fails", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        await client.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY)");

        let reportedError: unknown = null;
        const conn: DatabaseClientConnection = {
            queryServer() {
                throw new UnavailableError("No server in test");
            },
            async mutateServer() {
                throw new InternalError("server rejected mutation");
            },
            reportError(error) {
                reportedError = error;
            },
        };

        await client.executeMutation(conn, "INSERT INTO t (id) VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(reportedError).toBeInstanceOf(Error);
        expect((reportedError as Error).message).toBe("server rejected mutation");
    });

    test("removes optimistic mutation on server error", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        await client.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY)");

        const conn: DatabaseClientConnection = {
            queryServer() {
                throw new UnavailableError("No server in test");
            },
            async mutateServer() {
                throw new InternalError("server rejected mutation");
            },
            reportError() {},
        };

        await client.executeMutation(conn, "INSERT INTO t (id) VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 0));

        // Optimistic mutation should be removed — query sees
        // the base state (empty table).
        const rows = await client.executeQuery(testConn, "SELECT count(*) AS n FROM t");
        expect(rows).toMatchObject([{n: 0}]);
    });

    test("asserts mutation confirmed before server responds", async () => {
        const client = await DatabaseClient.create(createInMemoryDirectory());
        await client.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY)");

        let reportedError: unknown = null;
        const conn: DatabaseClientConnection = {
            queryServer() {
                throw new UnavailableError("No server in test");
            },
            async mutateServer() {
                // Return without calling writePagesFromRealtime
                // — the mutation is still in the queue.
                return {rows: []};
            },
            reportError(error) {
                reportedError = error;
            },
        };

        await client.executeMutation(conn, "INSERT INTO t (id) VALUES (1)");
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
        await server.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        for (let i = 0; i < 20; i++) {
            await server.executeQuery(
                testConn,
                `INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`,
            );
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
            async queryServer(sql) {
                serverCalled = true;
                const rows = await server.executeQuery(testConn, sql);
                return {rows, pages: allPages} as QueryServerResult;
            },
            mutateServer() {
                throw new UnavailableError("No server in test");
            },
            reportError() {},
        };

        const rows = await local.executeQuery(serverConn, "SELECT count(*) AS n FROM t");

        expect(rows).toMatchObject([{n: 20}]);
        expect(serverCalled).toBe(true);
    });

    test("server fallback caches pages for subsequent local queries", async () => {
        const serverDir = createInMemoryDirectory();
        const server = await DatabaseClient.create(serverDir);
        await server.executeQuery(testConn, "CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        for (let i = 0; i < 20; i++) {
            await server.executeQuery(
                testConn,
                `INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`,
            );
        }

        const allPages = await extractPages(serverDir);

        // Pre-populate with all but last page
        const localDir = createInMemoryDirectory();
        await prepopulatePages(localDir, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        // First query: server fallback writes missing pages
        const serverConn: DatabaseClientConnection = {
            async queryServer(sql) {
                const rows = await server.executeQuery(testConn, sql);
                return {rows, pages: allPages} as QueryServerResult;
            },
            mutateServer() {
                throw new UnavailableError("No server in test");
            },
            reportError() {},
        };
        await local.executeQuery(serverConn, "SELECT count(*) AS n FROM t");

        // Second query with a throwing connection — should
        // succeed locally since all pages are now cached.
        const rows = await local.executeQuery(testConn, "SELECT count(*) AS n FROM t");

        expect(rows).toMatchObject([{n: 20}]);
    });
});

/* eslint-enable cyberworlds/string-quotes */
