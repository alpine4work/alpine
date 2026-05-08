/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import type {DatabaseClientConnection} from "~/client/web/databases/database_client.js";
import {DatabaseClient} from "~/client/web/databases/database_client.js";
import {
    createInMemoryOpfsDirectoryHandle,
    extractOpfsPages,
    prepopulateOpfsPages,
} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {makeDatabaseClientConnection} from "~/client/web/databases/test_helpers/make_database_client_connection.js";
import type {
    DatabaseActionObject,
    DatabaseActionResult,
} from "~/shared/databases/database_actions.js";
import {databaseMainTableId} from "~/shared/databases/sqlite_constants.js";
import {InternalError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseMutationId} from "~/shared/id/types/id_types.js";

const testConn = makeDatabaseClientConnection();

async function execute(
    client: DatabaseClient,
    conn: DatabaseClientConnection,
    sql: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
    const {rows} = await client.executeAction<"rawSql">(conn, {name: "rawSql", input: {sql}});
    return rows as ReadonlyArray<Record<string, unknown>>;
}

function pagesToMap(
    pages: Array<{pageIndex: number; version: number; data: Uint8Array}>,
): Map<number, {version: number; data: Uint8Array}> {
    return new Map(pages.map(p => [p.pageIndex, {version: p.version, data: p.data}]));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DatabaseClient", () => {
    test("SELECT 1 + 1", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        const rows = await execute(client, testConn, "SELECT 1 + 1 AS result");

        expect(rows).toMatchObject([{result: 2}]);
    });

    test("create table, insert, and select", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        );
        client.commitOptimisticPagesForTests();
        await execute(client, testConn, "INSERT INTO items (name) VALUES ('alpha'), ('beta')");
        const rows = await execute(client, testConn, "SELECT * FROM items ORDER BY id");

        expect(rows).toMatchObject([
            {id: 1, name: "alpha"},
            {id: 2, name: "beta"},
        ]);
    });

    test("aggregate query", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests(
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, status TEXT NOT NULL)",
        );
        client.commitOptimisticPagesForTests();
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
        const client1 = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        const client2 = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client1.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client1.commitOptimisticPagesForTests();
        await execute(client1, testConn, "INSERT INTO t (id) VALUES (1)");

        client2.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client2.commitOptimisticPagesForTests();
        await execute(client2, testConn, "INSERT INTO t (id) VALUES (99)");

        expect(await execute(client1, testConn, "SELECT * FROM t")).toMatchObject([{id: 1}]);
        expect(await execute(client2, testConn, "SELECT * FROM t")).toMatchObject([{id: 99}]);
    });
});

describe("execute — mutations", () => {
    test("executes mutation locally and returns rows", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
        client.commitOptimisticPagesForTests();

        const rows = await execute(
            client,
            testConn,
            "INSERT INTO t (name) VALUES ('test') RETURNING *",
        );

        expect(rows).toMatchObject([{id: 1, name: "test"}]);
    });

    test("sends mutation to server in background", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();

        let capturedAction: DatabaseActionObject | null = null;
        let capturedMutationId: DatabaseMutationId | null = null;
        const conn = makeDatabaseClientConnection({
            async executeActionServer(action, options) {
                capturedAction = action;
                capturedMutationId = options.mutationId;
                // Simulate realtime confirmation arriving
                // before server response (same as production).
                client.writePageDiffsFromRealtime(
                    new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
                    options.mutationId,
                );
                return {
                    result: {name: "rawSql", output: {rows: []}},
                    readPages: new Map(),
                };
            },
        });

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(capturedAction).toMatchObject({
            name: "rawSql",
            input: {sql: "INSERT INTO t (id) VALUES (1)"},
        });
        expect(capturedMutationId).not.toBeNull();
    });

    test("falls back to server on PageMissingError", async () => {
        const serverDir = createInMemoryOpfsDirectoryHandle();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        server.commitOptimisticPagesForTests();
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(`INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`);
            server.commitOptimisticPagesForTests();
        }

        const allPages = await extractOpfsPages(serverDir);

        const localDir = createInMemoryOpfsDirectoryHandle();
        await prepopulateOpfsPages(localDir, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        let serverCalled = false;
        const serverConn = makeDatabaseClientConnection({
            async executeActionServer() {
                serverCalled = true;
                return {
                    result: {name: "rawSql", output: {rows: [{inserted: true}]}},
                    readPages: new Map(),
                };
            },
        });

        const rows = await execute(local, serverConn, "INSERT INTO t (data) VALUES ('new')");

        expect(serverCalled).toBe(true);
        expect(rows).toMatchObject([{inserted: true}]);
    });

    test("empty store falls back to local for writes", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        let serverCallCount = 0;
        const conn = makeDatabaseClientConnection({
            async executeActionServer(_action, options) {
                serverCallCount++;
                // Simulate realtime confirmation arriving
                // before server response.
                client.writePageDiffsFromRealtime(
                    new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
                    options.mutationId,
                );
                return {
                    result: {name: "rawSql", output: {rows: []}},
                    readPages: new Map(),
                };
            },
        });

        // Use executeLocallyForTests for DDL so the
        // authorizer allows it; the store stays empty
        // because the DB has no user data pages yet
        // beyond the schema page.
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();
        const rows = await execute(client, conn, "INSERT INTO t (id) VALUES (1)");

        // DML executes locally — returns no rows.
        expect(rows).toMatchObject([]);

        // Background send fires after microtask.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(serverCallCount).toBe(1);
    });

    test("propagates local execution errors", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        await expect(
            execute(client, testConn, "INSERT INTO nonexistent VALUES (1)"),
        ).rejects.toThrow();
    });
});

describe("optimistic mutations", () => {
    test("writePageDiffsFromRealtime dequeues confirmed mutation", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();

        let capturedMutationId: DatabaseMutationId | null = null;
        const conn = makeDatabaseClientConnection({
            executeActionServer(_action, options) {
                capturedMutationId = options.mutationId;
                return new Promise(() => {});
            },
        });

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        expect(capturedMutationId).not.toBeNull();

        // Confirm the mutation — should not throw
        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
            capturedMutationId!,
        );
    });

    test("replays remaining mutations after confirmation", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        client.commitOptimisticPagesForTests();

        const mutationIds: Array<DatabaseMutationId> = [];
        const conn = makeDatabaseClientConnection({
            executeActionServer(_action, options) {
                mutationIds.push(options.mutationId);
                return new Promise(() => {});
            },
        });

        await execute(client, conn, "INSERT INTO t (val) VALUES ('first')");
        await execute(client, conn, "INSERT INTO t (val) VALUES ('second')");

        // Confirm first mutation
        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
            mutationIds[0]!,
        );

        // Second mutation should still be visible via replay
        const rows = await execute(client, testConn, "SELECT val FROM t ORDER BY id");
        expect(rows).toMatchObject([{val: "second"}]);
    });

    test("asserts on out-of-order confirmation", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();

        const mutationIds: Array<DatabaseMutationId> = [];
        const conn = makeDatabaseClientConnection({
            executeActionServer(_action, options) {
                mutationIds.push(options.mutationId);
                return new Promise(() => {});
            },
        });

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        await execute(client, conn, "INSERT INTO t (id) VALUES (2)");

        expect(() =>
            client.writePageDiffsFromRealtime(
                new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
                mutationIds[1]!,
            ),
        ).toThrow("unexpected mutation confirmation order");
    });

    test("external mutation applies pages without dequeue", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();

        // No optimistic mutations queued — just apply pages
        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
            "unknown-mutation-id" as DatabaseMutationId,
        );

        // Should succeed without assertion error
        const rows = await execute(client, testConn, "SELECT count(*) AS n FROM t");
        expect(rows).toMatchObject([{n: 0}]);
    });

    test("reports error when server mutation fails", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();

        let reportedError: unknown = null;
        const conn = makeDatabaseClientConnection({
            async executeActionServer() {
                throw new InternalError("server rejected mutation");
            },
            reportError(error) {
                reportedError = error;
            },
        });

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(reportedError).toBeInstanceOf(Error);
        expect((reportedError as Error).message).toBe("server rejected mutation");
    });

    test("removes optimistic mutation on server error", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();

        const conn = makeDatabaseClientConnection({
            async executeActionServer() {
                throw new InternalError("server rejected mutation");
            },
        });

        await execute(client, conn, "INSERT INTO t (id) VALUES (1)");
        await new Promise(resolve => setTimeout(resolve, 0));

        // Optimistic mutation should be removed — query sees
        // the base state (empty table).
        const rows = await execute(client, testConn, "SELECT count(*) AS n FROM t");
        expect(rows).toMatchObject([{n: 0}]);
    });

    test("asserts mutation confirmed before server responds", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();

        let reportedError: unknown = null;
        const conn = makeDatabaseClientConnection({
            async executeActionServer() {
                // Return without calling writePageDiffsFromRealtime
                // — the mutation is still in the queue.
                return {
                    result: {name: "rawSql", output: {rows: []}},
                    readPages: new Map(),
                };
            },
            reportError(error) {
                reportedError = error;
            },
        });

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
        const serverDir = createInMemoryOpfsDirectoryHandle();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        server.commitOptimisticPagesForTests();
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(`INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`);
            server.commitOptimisticPagesForTests();
        }

        const allPages = await extractOpfsPages(serverDir);

        // Pre-populate a local directory with all pages
        // EXCEPT the last one, then open it. SQLite sees
        // the existing DB but one page is absent.
        const localDir = createInMemoryOpfsDirectoryHandle();
        await prepopulateOpfsPages(localDir, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        let serverCalled = false;
        const serverConn = makeDatabaseClientConnection({
            async executeActionServer(action) {
                serverCalled = true;
                const rows = await execute(server, testConn, (action.input as any).sql);
                return {
                    result: {name: action.name, output: {rows}} as DatabaseActionResult,
                    readPages: new Map([[databaseMainTableId, pagesToMap(allPages)]]),
                };
            },
        });

        const rows = await execute(local, serverConn, "SELECT count(*) AS n FROM t");

        expect(rows).toMatchObject([{n: 20}]);
        expect(serverCalled).toBe(true);
    });

    test("server fallback caches pages for subsequent local queries", async () => {
        const serverDir = createInMemoryOpfsDirectoryHandle();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        server.commitOptimisticPagesForTests();
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(`INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`);
            server.commitOptimisticPagesForTests();
        }

        const allPages = await extractOpfsPages(serverDir);

        // Pre-populate with all but last page
        const localDir = createInMemoryOpfsDirectoryHandle();
        await prepopulateOpfsPages(localDir, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        // First query: server fallback writes missing pages
        const serverConn = makeDatabaseClientConnection({
            async executeActionServer(action) {
                const rows = await execute(server, testConn, (action.input as any).sql);
                return {
                    result: {name: action.name, output: {rows}} as DatabaseActionResult,
                    readPages: new Map([[databaseMainTableId, pagesToMap(allPages)]]),
                };
            },
        });
        await execute(local, serverConn, "SELECT count(*) AS n FROM t");

        // Second query with a throwing connection — should
        // succeed locally since all pages are now cached.
        const rows = await execute(local, testConn, "SELECT count(*) AS n FROM t");

        expect(rows).toMatchObject([{n: 20}]);
    });
});

describe("executeActionWithTracking", () => {
    test("returns output and read page set", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        client.commitOptimisticPagesForTests();
        await execute(client, testConn, "INSERT INTO t (val) VALUES ('hello')");

        const {output, readPages} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: {sql: "SELECT * FROM t"},
        });

        expect((output as {rows: unknown}).rows).toMatchObject([{id: 1, val: "hello"}]);
        expect(readPages.size).toBeGreaterThan(0);
    });

    test("read pages include the table's root page", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        const db = client.unsafeGetDbForTests();

        client.executeLocallyForTests("CREATE TABLE t1 (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests("CREATE TABLE t2 (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();
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
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests("CREATE TABLE t1 (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests("CREATE TABLE t2 (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();
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
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();
        await execute(client, testConn, "INSERT INTO t (id) VALUES (1)");

        let serverCalled = false;
        const conn = makeDatabaseClientConnection({
            async executeActionServer() {
                serverCalled = true;
                return {
                    result: {name: "readonlyRawSql", output: {rows: []}},
                    readPages: new Map(),
                };
            },
        });

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
        const serverDir = createInMemoryOpfsDirectoryHandle();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)");
        server.commitOptimisticPagesForTests();
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(`INSERT INTO t (data) VALUES ('${"x".repeat(200)}')`);
            server.commitOptimisticPagesForTests();
        }
        const allPages = await extractOpfsPages(serverDir);

        // Pre-populate with all but last page
        const localDir = createInMemoryOpfsDirectoryHandle();
        await prepopulateOpfsPages(localDir, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        const serverConn = makeDatabaseClientConnection({
            async executeActionServer(action) {
                const rows = await execute(server, testConn, (action.input as any).sql);
                return {
                    result: {name: action.name, output: {rows}} as DatabaseActionResult,
                    readPages: new Map([[databaseMainTableId, pagesToMap(allPages)]]),
                };
            },
        });

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
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        client.commitOptimisticPagesForTests();
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
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        client.commitOptimisticPagesForTests();
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
        const dir = createInMemoryOpfsDirectoryHandle();
        const client = await DatabaseClient.create(dir);

        // Use executeLocallyForTests so data goes to OPFS
        // base store (not optimistic pages) — extractPages
        // reads from the base store.
        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests("INSERT INTO t (val) VALUES ('v1')");
        client.commitOptimisticPagesForTests();

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
        client.commitOptimisticPagesForTests();

        // Write as realtime with newer versions to
        // trigger invalidation. Empty diffs since OPFS
        // already has the current content.
        const pages = await extractOpfsPages(dir);
        const newerPageDiffs = new Map(
            pages.map(({pageIndex, version}) => [pageIndex, {version: version + 1, diff: []}]),
        );
        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: newerPageDiffs, fileSizeInPages: 0}]]),
            generateId<DatabaseMutationId>(),
        );

        // Wait for microtask-based invalidation
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(1);
        expect(notifications[0]!.rows).toMatchObject([
            {id: 1, val: "v1"},
            {id: 2, val: "v2"},
        ]);
    });

    test("notify does NOT fire for non-overlapping pages", async () => {
        const dir = createInMemoryOpfsDirectoryHandle();
        const client = await DatabaseClient.create(dir);

        // Use executeLocallyForTests so data goes to OPFS
        // base store. This lets markWrittenPages filter
        // page-0 noise correctly (readPage(0) must return
        // non-null for the noise check to work).
        client.executeLocallyForTests("CREATE TABLE t1 (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests("CREATE TABLE t2 (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests("INSERT INTO t1 (id) VALUES (1)");
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests("INSERT INTO t2 (id) VALUES (2)");
        client.commitOptimisticPagesForTests();

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
        const pagesBefore = await extractOpfsPages(dir);

        // Mutate t2 only
        await execute(client, testConn, "INSERT INTO t2 (id) VALUES (3)");

        const pagesAfter = await extractOpfsPages(dir);
        const changedPageDiffs = new Map(
            pagesAfter
                .filter(after => {
                    // Skip page 0 — it always changes (SQLite
                    // file change counter) and is in every
                    // query's read set, so it would always
                    // trigger a notification.
                    if (after.pageIndex === 0) return false;
                    const before = pagesBefore.find(b => b.pageIndex === after.pageIndex);
                    return before === undefined || before.version !== after.version;
                })
                .map(({pageIndex, version}) => [pageIndex, {version: version + 1, diff: []}]),
        );

        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: changedPageDiffs, fileSizeInPages: 0}]]),
            generateId<DatabaseMutationId>(),
        );

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(0);
    });

    test("initial failure still registers action, re-executes on page write", async () => {
        const dir = createInMemoryOpfsDirectoryHandle();
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
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests("INSERT INTO t (val) VALUES ('hello')");
        client.commitOptimisticPagesForTests();

        // Trigger invalidation via realtime page writes.
        // readPages is null so any page write overlaps.
        const pages = await extractOpfsPages(dir);
        const newerPageDiffs = new Map(
            pages.map(({pageIndex, version}) => [pageIndex, {version: version + 1, diff: []}]),
        );
        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: newerPageDiffs, fileSizeInPages: 0}]]),
            generateId<DatabaseMutationId>(),
        );

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(1);
        expect(notifications[0]!.rows).toMatchObject([{id: 1, val: "hello"}]);
    });

    test("unregisterReactiveAction stops notifications", async () => {
        const dir = createInMemoryOpfsDirectoryHandle();
        const client = await DatabaseClient.create(dir);

        client.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        client.commitOptimisticPagesForTests();
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
        const pages = await extractOpfsPages(dir);
        const newerPageDiffs = new Map(
            pages.map(({pageIndex, version}) => [pageIndex, {version: version + 1, diff: []}]),
        );
        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: newerPageDiffs, fileSizeInPages: 0}]]),
            generateId<DatabaseMutationId>(),
        );

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(0);
    });
});
