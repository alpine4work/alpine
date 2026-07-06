import {
    createInMemoryOpfsDirectoryHandle,
    extractOpfsPages,
    prepopulateOpfsPages,
} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {makeDatabaseClientConnection} from "~/client/web/databases/test_helpers/make_database_client_connection.js";
import type {DatabaseClientConnection} from "~/client/web/databases/worker/database_client.js";
import {DatabaseClient} from "~/client/web/databases/worker/database_client.js";
import type {
    OpfsDirectoryHandle,
    OpfsFileHandle,
    OpfsSyncAccessHandle,
} from "~/client/web/databases/worker/opfs.js";
import type {
    DatabaseActionObject,
    DatabaseActionResult,
} from "~/shared/databases/database_actions.js";
import {SqlQuery, databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {databaseMainTableId} from "~/shared/databases/sqlite_constants.js";
import {InternalError} from "~/shared/error/error.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseMutationId, DatabaseTableId} from "~/shared/id/types/id_types.js";

const testConn = makeDatabaseClientConnection();

async function execute(
    client: DatabaseClient,
    conn: DatabaseClientConnection,
    query: SqlQuery,
): Promise<ReadonlyArray<Record<string, unknown>>> {
    const {rows} = await client.executeAction<"rawSql">(conn, {
        name: "rawSql",
        input: {sql: query.query},
    });
    return rows as ReadonlyArray<Record<string, unknown>>;
}

function rawSqlInput(query: SqlQuery): {sql: string} {
    return {sql: query.query};
}

function pagesToMap(
    pages: Array<{pageIndex: number; version: number; data: Uint8Array}>,
): Map<number, {version: number; data: Uint8Array}> {
    return new Map(pages.map(p => [p.pageIndex, {version: p.version, data: p.data}]));
}

// ---------------------------------------------------------------------------
// Tests
// ---
//
// ---

describe("DatabaseClient", () => {
    test("SELECT 1 + 1", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        const rows = await execute(
            client,
            testConn,
            sql`
                SELECT
                    1 + 1 AS result
            `,
        );

        expect(rows).toMatchObject([{result: 2}]);
    });

    test("create table, insert, and select", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests(sql`
            CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)
        `);
        client.commitOptimisticPagesForTests();
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    items (name)
                VALUES
                    ('alpha'),
                    ('beta')
            `,
        );
        const rows = await execute(
            client,
            testConn,
            sql`
                SELECT
                    *
                FROM
                    items
                ORDER BY
                    id
            `,
        );

        expect(rows).toMatchObject([
            {id: 1, name: "alpha"},
            {id: 2, name: "beta"},
        ]);
    });

    test("aggregate query", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests(sql`
            CREATE TABLE tasks (id INTEGER PRIMARY KEY, status TEXT NOT NULL)
        `);
        client.commitOptimisticPagesForTests();
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    tasks (status)
                VALUES
                    ('done'),
                    ('todo'),
                    ('todo'),
                    ('done'),
                    ('done')
            `,
        );
        const rows = await execute(
            client,
            testConn,
            sql`
                SELECT
                    status,
                    COUNT(*) AS count
                FROM
                    tasks
                GROUP BY
                    status
                ORDER BY
                    status
            `,
        );

        expect(rows).toMatchObject([
            {status: "done", count: 3},
            {status: "todo", count: 2},
        ]);
    });

    test("multiple clients have independent databases", async () => {
        const client1 = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        const client2 = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client1.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client1.commitOptimisticPagesForTests();
        await execute(
            client1,
            testConn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );

        client2.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client2.commitOptimisticPagesForTests();
        await execute(
            client2,
            testConn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (99)
            `,
        );

        expect(
            await execute(
                client1,
                testConn,
                sql`
                    SELECT
                        *
                    FROM
                        t
                `,
            ),
        ).toMatchObject([{id: 1}]);
        expect(
            await execute(
                client2,
                testConn,
                sql`
                    SELECT
                        *
                    FROM
                        t
                `,
            ),
        ).toMatchObject([{id: 99}]);
    });
});

describe("execute — mutations", () => {
    test("executes mutation locally and returns rows", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`);
        client.commitOptimisticPagesForTests();

        const rows = await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t (name)
                VALUES
                    ('test')
                RETURNING
                    *
            `,
        );

        expect(rows).toMatchObject([{id: 1, name: "test"}]);
    });

    test("sends mutation to server in background", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();

        let capturedAction: DatabaseActionObject | null = null;
        let capturedMutationId: DatabaseMutationId | null = null;
        const conn = makeDatabaseClientConnection({
            async executeActionServer(action, options) {
                capturedAction = action;
                capturedMutationId = options.mutationId;
                // Simulate realtime confirmation arriving before server response (same as
                // production).
                client.writePageDiffsFromRealtime(
                    new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
                    options.mutationId,
                );
                return {
                    result: {name: "rawSql", output: {rows: []}},
                    readPages: new Map(),
                    fileSizesInPages: null,
                };
            },
        });

        await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(capturedAction).toMatchObject({
            name: "rawSql",
            input: rawSqlInput(sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `),
        });
        expect(capturedMutationId).not.toBeNull();
    });

    test("falls back to server when a page is missing from the local store", async () => {
        const serverDir = createInMemoryOpfsDirectoryHandle();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)`);
        server.commitOptimisticPagesForTests();
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(sql`
                INSERT INTO
                    t (data)
                VALUES
                    (${"x".repeat(200)})
            `);
            server.commitOptimisticPagesForTests();
        }

        const {fileSizeInPages, pages: allPages} = await extractOpfsPages(serverDir);

        const localDir = createInMemoryOpfsDirectoryHandle();
        await prepopulateOpfsPages(localDir, fileSizeInPages, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        let serverCalled = false;
        const serverConn = makeDatabaseClientConnection({
            async executeActionServer() {
                serverCalled = true;
                return {
                    result: {name: "rawSql", output: {rows: [{inserted: true}]}},
                    readPages: new Map(),
                    fileSizesInPages: null,
                };
            },
        });

        const rows = await execute(
            local,
            serverConn,
            sql`
                INSERT INTO
                    t (data)
                VALUES
                    ('new')
            `,
        );

        expect(serverCalled).toBe(true);
        expect(rows).toMatchObject([{inserted: true}]);
    });

    test("references to an unattached, uncached table fall back to the server", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        const tableId = generateChronologicalId<DatabaseTableId>();

        let serverCalled = false;
        const conn = makeDatabaseClientConnection({
            async executeActionServer() {
                serverCalled = true;
                return {
                    result: {name: "rawSql", output: {rows: [{ok: 1}]}},
                    readPages: new Map(),
                    fileSizesInPages: null,
                };
            },
        });

        // The per-db file isn't attached and we hold none of its pages locally, so ATTACH
        // can't read its header — the action routes to the server (which would attach +
        // populate it) instead of attaching locally.
        const rows = await execute(
            client,
            conn,
            sql`
                SELECT
                    *
                FROM
                    ${sql.identifier(databaseTableSchemaName(tableId), "_alpine_table")}
            `,
        );

        expect(serverCalled).toBe(true);
        expect(rows).toMatchObject([{ok: 1}]);
    });

    test("empty store falls back to local for writes", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        let serverCallCount = 0;
        const conn = makeDatabaseClientConnection({
            async executeActionServer(_action, options) {
                serverCallCount++;
                // Simulate realtime confirmation arriving before server response.
                client.writePageDiffsFromRealtime(
                    new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
                    options.mutationId,
                );
                return {
                    result: {name: "rawSql", output: {rows: []}},
                    readPages: new Map(),
                    fileSizesInPages: null,
                };
            },
        });

        // Use executeLocallyForTests for DDL so the authorizer allows it; the store stays
        // empty because the DB has no user data pages yet beyond the schema page.
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();
        const rows = await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );

        // DML executes locally — returns no rows.
        expect(rows).toMatchObject([]);

        // Background send fires after microtask.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(serverCallCount).toBe(1);
    });

    test("propagates local execution errors", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        await expect(
            execute(
                client,
                testConn,
                sql`
                    INSERT INTO
                        nonexistent
                    VALUES
                        (1)
                `,
            ),
        ).rejects.toThrow();
    });
});

describe("optimistic mutations", () => {
    test("writePageDiffsFromRealtime dequeues confirmed mutation", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();

        let capturedMutationId: DatabaseMutationId | null = null;
        const conn = makeDatabaseClientConnection({
            executeActionServer(_action, options) {
                capturedMutationId = options.mutationId;
                return new Promise(() => {});
            },
        });

        await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );
        expect(capturedMutationId).not.toBeNull();

        // Confirm the mutation — should not throw
        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
            capturedMutationId!,
        );
    });

    test("replays remaining mutations after confirmation", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        client.commitOptimisticPagesForTests();

        const mutationIds: Array<DatabaseMutationId> = [];
        const conn = makeDatabaseClientConnection({
            executeActionServer(_action, options) {
                mutationIds.push(options.mutationId);
                return new Promise(() => {});
            },
        });

        await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('first')
            `,
        );
        await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('second')
            `,
        );

        // Confirm first mutation
        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
            mutationIds[0]!,
        );

        // Second mutation should still be visible via replay
        const rows = await execute(
            client,
            testConn,
            sql`
                SELECT
                    val
                FROM
                    t
                ORDER BY
                    id
            `,
        );
        expect(rows).toMatchObject([{val: "second"}]);
    });

    test("asserts on out-of-order confirmation", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();

        const mutationIds: Array<DatabaseMutationId> = [];
        const conn = makeDatabaseClientConnection({
            executeActionServer(_action, options) {
                mutationIds.push(options.mutationId);
                return new Promise(() => {});
            },
        });

        await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );
        await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (2)
            `,
        );

        expect(() =>
            client.writePageDiffsFromRealtime(
                new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
                mutationIds[1]!,
            ),
        ).toThrow("unexpected mutation confirmation order");
    });

    test("external mutation applies pages without dequeue", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();

        // No optimistic mutations queued — just apply pages
        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: new Map(), fileSizeInPages: 0}]]),
            "unknown-mutation-id" as DatabaseMutationId,
        );

        // Should succeed without assertion error
        const rows = await execute(
            client,
            testConn,
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    t
            `,
        );
        expect(rows).toMatchObject([{n: 0}]);
    });

    test("reports error when server mutation fails", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
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

        await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(reportedError).toBeInstanceOf(Error);
        expect((reportedError as Error).message).toBe("server rejected mutation");
    });

    test("removes optimistic mutation on server error", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();

        const conn = makeDatabaseClientConnection({
            async executeActionServer() {
                throw new InternalError("server rejected mutation");
            },
        });

        await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );
        await new Promise(resolve => setTimeout(resolve, 0));

        // Optimistic mutation should be removed — query sees the base state (empty table).
        const rows = await execute(
            client,
            testConn,
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    t
            `,
        );
        expect(rows).toMatchObject([{n: 0}]);
    });

    test("asserts mutation confirmed before server responds", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();

        let reportedError: unknown = null;
        const conn = makeDatabaseClientConnection({
            async executeActionServer() {
                // Return without calling writePageDiffsFromRealtime — the mutation is still in the
                // queue.
                return {
                    result: {name: "rawSql", output: {rows: []}},
                    readPages: new Map(),
                    fileSizesInPages: null,
                };
            },
            reportError(error) {
                reportedError = error;
            },
        });

        await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(reportedError).toBeInstanceOf(Error);
        expect((reportedError as Error).message).toBe(
            "Assertion failure: mutation not confirmed via realtime before server responded",
        );
    });
});

describe("writeLoaderPages", () => {
    // `writeLoaderPages` must not await between dropping the optimistic buffer and
    // replaying the queue: worker RPC handlers aren't serialized, so an optimistic
    // action arriving in that window executes against a discarded-but-not-replayed
    // state and is then applied a second time by the replay.
    test("concurrent optimistic action during writeLoaderPages is not applied twice", async () => {
        const dir = createInMemoryOpfsDirectoryHandle();
        const client = await DatabaseClient.create(dir);
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        client.commitOptimisticPagesForTests();

        const conn = makeDatabaseClientConnection({
            executeActionServer() {
                return new Promise(() => {});
            },
        });
        await execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('first')
            `,
        );

        // Loader pages snapshotted before the optimistic mutation — the store already has
        // these versions, so applying them changes nothing.
        const {pages} = await extractOpfsPages(dir);
        const loaderPages = new Map([[databaseMainTableId, pagesToMap(pages)]]);

        // Fire a second optimistic action inside writeLoaderPages' await window.
        const writePromise = client.writeLoaderPages(loaderPages);
        const insertPromise = execute(
            client,
            conn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('second')
            `,
        );
        await writePromise;
        await insertPromise;

        const rows = await execute(
            client,
            testConn,
            sql`
                SELECT
                    val
                FROM
                    t
                ORDER BY
                    id
            `,
        );
        expect(rows).toMatchObject([{val: "first"}, {val: "second"}]);
    });
});

describe("ensureCacheIsUpToDate", () => {
    // A cache-validation response can race a newer realtime diff: the diff mismatches
    // its base (tombstoning the page at the diff's version), and the validation
    // response — snapshotted before the diff was broadcast — then offers the page at
    // an older version, which the tombstone rightly rejects. The client must not
    // acknowledge a page it rejected: a lying ack marks the page "confirmed" in the
    // server's per-browser tracker, which then filters it out of every future
    // `executeAction` response — so the cache can never heal and every read of that
    // page falls back to the server forever.
    test("does not acknowledge pages a tombstone rejected", async () => {
        const serverDir = createInMemoryOpfsDirectoryHandle();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)`);
        server.commitOptimisticPagesForTests();
        const {fileSizeInPages, pages} = await extractOpfsPages(serverDir);

        const localDir = createInMemoryOpfsDirectoryHandle();
        await prepopulateOpfsPages(localDir, fileSizeInPages, pages);
        const local = await DatabaseClient.create(localDir);

        const page = pages[pages.length - 1]!;
        let resolveValidation: (result: {
            tables: Map<
                DatabaseTableId,
                {
                    updatedPages: Map<number, {version: number; data: Uint8Array}>;
                    stalePageIndexes: Array<number>;
                    fileSizeInPages: number;
                }
            >;
        }) => void;
        const validationGate = new Promise<{
            tables: Map<
                DatabaseTableId,
                {
                    updatedPages: Map<number, {version: number; data: Uint8Array}>;
                    stalePageIndexes: Array<number>;
                    fileSizeInPages: number;
                }
            >;
        }>(resolve => {
            resolveValidation = resolve;
        });
        const acknowledged: Array<ReadonlyMap<DatabaseTableId, ReadonlyArray<number>>> = [];
        const conn = makeDatabaseClientConnection({
            ensureCacheIsUpToDate: () => validationGate,
            acknowledgePages(pageIndexes) {
                acknowledged.push(pageIndexes);
            },
        });

        const validation = local.ensureCacheIsUpToDate(conn);

        // While the validation response is in flight, a diff for the page arrives whose
        // base the client never saw — the page is dropped and tombstoned at the diff's
        // version.
        local.writePageDiffsFromRealtime(
            new Map([
                [
                    databaseMainTableId,
                    {
                        diffs: new Map([
                            [
                                page.pageIndex,
                                {
                                    previousVersion: page.version + 1,
                                    version: page.version + 2,
                                    diff: [],
                                },
                            ],
                        ]),
                        fileSizeInPages,
                    },
                ],
            ]),
            generateId<DatabaseMutationId>(),
        );

        // The validation response offers the page at a version below the tombstone; the
        // write is rejected, so the page must not be acknowledged.
        resolveValidation!({
            tables: new Map([
                [
                    databaseMainTableId,
                    {
                        updatedPages: new Map([
                            [page.pageIndex, {version: page.version + 1, data: page.data}],
                        ]),
                        stalePageIndexes: [],
                        fileSizeInPages,
                    },
                ],
            ]),
        });
        await validation;

        expect(acknowledged).toEqual([]);
    });
});

describe("server fallback", () => {
    test("missing page triggers server fallback", async () => {
        // Create a "server" DB with enough data to span multiple pages (4096 bytes each).
        const serverDir = createInMemoryOpfsDirectoryHandle();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)`);
        server.commitOptimisticPagesForTests();
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(sql`
                INSERT INTO
                    t (data)
                VALUES
                    (${"x".repeat(200)})
            `);
            server.commitOptimisticPagesForTests();
        }

        const {fileSizeInPages, pages: allPages} = await extractOpfsPages(serverDir);

        // Pre-populate a local directory with all pages EXCEPT the last one, then open it.
        // SQLite sees the existing DB but one page is absent.
        const localDir = createInMemoryOpfsDirectoryHandle();
        await prepopulateOpfsPages(localDir, fileSizeInPages, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        let serverCalled = false;
        const serverConn = makeDatabaseClientConnection({
            async executeActionServer(action) {
                serverCalled = true;
                const rows = await execute(
                    server,
                    testConn,
                    sql.raw((action.input as {sql: string}).sql),
                );
                return {
                    result: {name: action.name, output: {rows}} as DatabaseActionResult,
                    readPages: new Map([[databaseMainTableId, pagesToMap(allPages)]]),
                    fileSizesInPages: new Map([[databaseMainTableId, fileSizeInPages]]),
                };
            },
        });

        const rows = await execute(
            local,
            serverConn,
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    t
            `,
        );

        expect(rows).toMatchObject([{n: 20}]);
        expect(serverCalled).toBe(true);
    });

    test("server fallback caches pages for subsequent local queries", async () => {
        const serverDir = createInMemoryOpfsDirectoryHandle();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)`);
        server.commitOptimisticPagesForTests();
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(sql`
                INSERT INTO
                    t (data)
                VALUES
                    (${"x".repeat(200)})
            `);
            server.commitOptimisticPagesForTests();
        }

        const {fileSizeInPages, pages: allPages} = await extractOpfsPages(serverDir);

        // Pre-populate with all but last page
        const localDir = createInMemoryOpfsDirectoryHandle();
        await prepopulateOpfsPages(localDir, fileSizeInPages, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        // First query: server fallback writes missing pages
        const serverConn = makeDatabaseClientConnection({
            async executeActionServer(action) {
                const rows = await execute(
                    server,
                    testConn,
                    sql.raw((action.input as {sql: string}).sql),
                );
                return {
                    result: {name: action.name, output: {rows}} as DatabaseActionResult,
                    readPages: new Map([[databaseMainTableId, pagesToMap(allPages)]]),
                    fileSizesInPages: new Map([[databaseMainTableId, fileSizeInPages]]),
                };
            },
        });
        await execute(
            local,
            serverConn,
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    t
            `,
        );

        // Second query with a throwing connection — should succeed locally since all pages
        // are now cached.
        const rows = await execute(
            local,
            testConn,
            sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    t
            `,
        );

        expect(rows).toMatchObject([{n: 20}]);
    });
});

describe("executeActionWithTracking", () => {
    test("returns output and read page set", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        client.commitOptimisticPagesForTests();
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('hello')
            `,
        );

        const {output, readPages} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: rawSqlInput(sql`
                SELECT
                    *
                FROM
                    t
            `),
        });

        expect((output as {rows: unknown}).rows).toMatchObject([{id: 1, val: "hello"}]);
        expect(readPages.size).toBeGreaterThan(0);
    });

    test("read pages include the table root page", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        const db = client.unsafeGetDbForTests();

        client.executeLocallyForTests(sql`CREATE TABLE t1 (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests(sql`CREATE TABLE t2 (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t1 (id)
                VALUES
                    (1)
            `,
        );
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t2 (id)
                VALUES
                    (2)
            `,
        );

        const schema = db.exec("SELECT name, rootpage FROM sqlite_schema ORDER BY name", {
            returnValue: "resultRows",
            rowMode: "object",
        }) as Array<{name: string; rootpage: number}>;

        const t1Root = schema.find(s => s.name === "t1")!.rootpage;
        const t2Root = schema.find(s => s.name === "t2")!.rootpage;

        const {readPages: pagesT1} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: rawSqlInput(sql`
                SELECT
                    *
                FROM
                    t1
            `),
        });
        const {readPages: pagesT2} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: rawSqlInput(sql`
                SELECT
                    *
                FROM
                    t2
            `),
        });

        // 0-based page indices (SQLite rootpage is 1-based). These tables live in main
        // (raw DDL), so read pages are tracked under the main table id.
        expect(pagesT1.get(databaseMainTableId)!.has(t1Root - 1)).toBe(true);
        expect(pagesT2.get(databaseMainTableId)!.has(t2Root - 1)).toBe(true);
    });

    test("different tables have different read sets", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests(sql`CREATE TABLE t1 (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests(sql`CREATE TABLE t2 (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t1 (id)
                VALUES
                    (1)
            `,
        );
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t2 (id)
                VALUES
                    (2)
            `,
        );

        const {readPages: pagesT1} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: rawSqlInput(sql`
                SELECT
                    *
                FROM
                    t1
            `),
        });
        const {readPages: pagesT2} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: rawSqlInput(sql`
                SELECT
                    *
                FROM
                    t2
            `),
        });

        // Both include page 0 (schema page), but differ on at least one page (each table's
        // root page).
        const mainT1 = pagesT1.get(databaseMainTableId) ?? new Set<number>();
        const mainT2 = pagesT2.get(databaseMainTableId) ?? new Set<number>();
        const onlyT1 = [...mainT1].filter(p => !mainT2.has(p));
        const onlyT2 = [...mainT2].filter(p => !mainT1.has(p));
        expect(onlyT1.length + onlyT2.length).toBeGreaterThan(0);
    });

    test("throws on write attempts without contacting server", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );

        let serverCalled = false;
        const conn = makeDatabaseClientConnection({
            async executeActionServer() {
                serverCalled = true;
                return {
                    result: {name: "readonlyRawSql", output: {rows: []}},
                    readPages: new Map(),
                    fileSizesInPages: null,
                };
            },
        });

        await expect(
            client.executeActionWithTracking(conn, {
                name: "readonlyRawSql",
                input: rawSqlInput(sql`
                    INSERT INTO
                        t (id)
                    VALUES
                        (2)
                `),
            }),
        ).rejects.toThrow("not authorized");

        expect(serverCalled).toBe(false);

        // Table should be unchanged — the write was rolled back.
        const {output} = await client.executeActionWithTracking(testConn, {
            name: "readonlyRawSql",
            input: rawSqlInput(sql`
                SELECT
                    *
                FROM
                    t
            `),
        });
        expect((output as {rows: unknown}).rows).toMatchObject([{id: 1}]);
    });

    test("server fallback still produces accurate read set", async () => {
        // Create a "server" DB
        const serverDir = createInMemoryOpfsDirectoryHandle();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, data TEXT)`);
        server.commitOptimisticPagesForTests();
        for (let i = 0; i < 20; i++) {
            server.executeLocallyForTests(sql`
                INSERT INTO
                    t (data)
                VALUES
                    (${"x".repeat(200)})
            `);
            server.commitOptimisticPagesForTests();
        }
        const {fileSizeInPages, pages: allPages} = await extractOpfsPages(serverDir);

        // Pre-populate with all but last page
        const localDir = createInMemoryOpfsDirectoryHandle();
        await prepopulateOpfsPages(localDir, fileSizeInPages, allPages.slice(0, -1));
        const local = await DatabaseClient.create(localDir);

        const serverConn = makeDatabaseClientConnection({
            async executeActionServer(action) {
                const rows = await execute(
                    server,
                    testConn,
                    sql.raw((action.input as {sql: string}).sql),
                );
                return {
                    result: {name: action.name, output: {rows}} as DatabaseActionResult,
                    readPages: new Map([[databaseMainTableId, pagesToMap(allPages)]]),
                    fileSizesInPages: new Map([[databaseMainTableId, fileSizeInPages]]),
                };
            },
        });

        const {output, readPages} = await local.executeActionWithTracking(serverConn, {
            name: "readonlyRawSql",
            input: rawSqlInput(sql`
                SELECT
                    COUNT(*) AS n
                FROM
                    t
            `),
        });

        expect((output as {rows: unknown}).rows).toMatchObject([{n: 20}]);
        // After server fallback + local retry, should have an accurate read set covering
        // multiple pages.
        expect(readPages.size).toBeGreaterThan(0);
    });
});

describe("registerReactiveAction", () => {
    test("returns initial output", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        client.commitOptimisticPagesForTests();
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('hello')
            `,
        );

        const result = await client.registerReactiveAction(
            "q1",
            {
                name: "readonlyRawSql",
                input: rawSqlInput(sql`
                    SELECT
                        *
                    FROM
                        t
                `),
            },
            testConn,
            () => {},
            () => {},
        );

        expect(result.ok).toBe(true);
        expect((result.value as {rows: unknown}).rows).toMatchObject([{id: 1, val: "hello"}]);
    });

    test("cache-hit registration and invalidation use one tracked execution each", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        client.commitOptimisticPagesForTests();
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('v1')
            `,
        );

        const executeActionWithTracking = client.executeActionWithTracking.bind(client);
        let trackedExecutionCount = 0;
        client.executeActionWithTracking = ((...args) => {
            trackedExecutionCount++;
            return executeActionWithTracking(...args);
        }) as DatabaseClient["executeActionWithTracking"];

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

        expect(result.ok).toBe(true);
        expect(trackedExecutionCount).toBe(1);

        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('v2')
            `,
        );
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(1);
        expect(trackedExecutionCount).toBe(2);
    });

    test("optimistic mutation invalidates overlapping reactive action", async () => {
        const client = await DatabaseClient.create(createInMemoryOpfsDirectoryHandle());

        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        client.commitOptimisticPagesForTests();
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('v1')
            `,
        );

        const notifications: Array<{rows: ReadonlyArray<Record<string, unknown>>}> = [];
        await client.registerReactiveAction(
            "q1",
            {
                name: "readonlyRawSql",
                input: rawSqlInput(sql`
                    SELECT
                        *
                    FROM
                        t
                    ORDER BY
                        id
                `),
            },
            testConn,
            output => {
                notifications.push(output as {rows: ReadonlyArray<Record<string, unknown>>});
            },
            () => {},
        );

        // Optimistic mutation — should trigger invalidation
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('v2')
            `,
        );

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

        // Use executeLocallyForTests so data goes to OPFS base store (not optimistic
        // pages) — extractPages reads from the base store.
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests(sql`
            INSERT INTO
                t (val)
            VALUES
                ('v1')
        `);
        client.commitOptimisticPagesForTests();

        const notifications: Array<{rows: ReadonlyArray<Record<string, unknown>>}> = [];
        await client.registerReactiveAction(
            "q1",
            {
                name: "readonlyRawSql",
                input: rawSqlInput(sql`
                    SELECT
                        *
                    FROM
                        t
                    ORDER BY
                        id
                `),
            },
            testConn,
            output => {
                notifications.push(output as {rows: ReadonlyArray<Record<string, unknown>>});
            },
            () => {},
        );

        // Insert another row directly to OPFS base store
        client.executeLocallyForTests(sql`
            INSERT INTO
                t (val)
            VALUES
                ('v2')
        `);
        client.commitOptimisticPagesForTests();

        // Write as realtime with newer versions to trigger invalidation. Empty diffs since
        // OPFS already has the current content.
        const {pages} = await extractOpfsPages(dir);
        const newerPageDiffs = new Map(
            pages.map(({pageIndex, version}) => [
                pageIndex,
                {previousVersion: version, version: version + 1, diff: []},
            ]),
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

        // Use executeLocallyForTests so data goes to OPFS base store. This lets
        // markWrittenPages filter page-0 noise correctly (readPage(0) must return non-null
        // for the noise check to work).
        client.executeLocallyForTests(sql`CREATE TABLE t1 (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests(sql`CREATE TABLE t2 (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests(sql`
            INSERT INTO
                t1 (id)
            VALUES
                (1)
        `);
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests(sql`
            INSERT INTO
                t2 (id)
            VALUES
                (2)
        `);
        client.commitOptimisticPagesForTests();

        // Watch only t1
        const notifications: Array<unknown> = [];
        await client.registerReactiveAction(
            "q1",
            {
                name: "readonlyRawSql",
                input: rawSqlInput(sql`
                    SELECT
                        *
                    FROM
                        t1
                `),
            },
            testConn,
            output => {
                notifications.push(output);
            },
            () => {},
        );

        // Record pages before t2 mutation
        const {pages: pagesBefore} = await extractOpfsPages(dir);

        // Mutate t2 only
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t2 (id)
                VALUES
                    (3)
            `,
        );

        const {pages: pagesAfter} = await extractOpfsPages(dir);
        const changedPageDiffs = new Map(
            pagesAfter
                .filter(after => {
                    // Skip page 0 — it always changes (SQLite file change counter) and is in every
                    // query's read set, so it would always trigger a notification.
                    if (after.pageIndex === 0) return false;
                    const before = pagesBefore.find(b => b.pageIndex === after.pageIndex);
                    return before === undefined || before.version !== after.version;
                })
                .map(({pageIndex, version}) => [
                    pageIndex,
                    {previousVersion: version, version: version + 1, diff: []},
                ]),
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

        // Register an action against a table that doesn't exist yet — initial evaluation
        // will fail.
        const notifications: Array<{rows: ReadonlyArray<Record<string, unknown>>}> = [];
        const result = await client.registerReactiveAction(
            "q1",
            {
                name: "readonlyRawSql",
                input: rawSqlInput(sql`
                    SELECT
                        *
                    FROM
                        t
                    ORDER BY
                        id
                `),
            },
            testConn,
            output => {
                notifications.push(output as {rows: ReadonlyArray<Record<string, unknown>>});
            },
            () => {},
        );

        expect(result.ok).toBe(false);

        // Now create the table. The write goes to the base store so extractPages picks it
        // up.
        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        client.commitOptimisticPagesForTests();
        client.executeLocallyForTests(sql`
            INSERT INTO
                t (val)
            VALUES
                ('hello')
        `);
        client.commitOptimisticPagesForTests();

        // Trigger invalidation via realtime page writes. readPages is null so any page
        // write overlaps.
        const {pages} = await extractOpfsPages(dir);
        const newerPageDiffs = new Map(
            pages.map(({pageIndex, version}) => [
                pageIndex,
                {previousVersion: version, version: version + 1, diff: []},
            ]),
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

        client.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        client.commitOptimisticPagesForTests();
        await execute(
            client,
            testConn,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );

        const notifications: Array<unknown> = [];
        await client.registerReactiveAction(
            "q1",
            {
                name: "readonlyRawSql",
                input: rawSqlInput(sql`
                    SELECT
                        *
                    FROM
                        t
                `),
            },
            testConn,
            output => {
                notifications.push(output);
            },
            () => {},
        );

        client.unregisterReactiveAction("q1");

        // Write pages — should not trigger notification
        const {pages} = await extractOpfsPages(dir);
        const newerPageDiffs = new Map(
            pages.map(({pageIndex, version}) => [
                pageIndex,
                {previousVersion: version, version: version + 1, diff: []},
            ]),
        );
        client.writePageDiffsFromRealtime(
            new Map([[databaseMainTableId, {diffs: newerPageDiffs, fileSizeInPages: 0}]]),
            generateId<DatabaseMutationId>(),
        );

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(notifications.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Close / OPFS handle release
// ---
//
// ---

/**
 * In-memory OPFS directory that enforces OPFS's single-open-sync-access-handle
 * rule: a second `createSyncAccessHandle()` for a file whose handle is still open
 * throws, the way real OPFS does. The shared test mock deliberately does not model
 * this (many helpers open handles without closing), so a handle-leak regression is
 * only observable against this stricter fake.
 */
function createExclusiveOpfsDirectoryHandle(): OpfsDirectoryHandle {
    const dirs = new Map<string, OpfsDirectoryHandle>();
    const files = new Map<string, {buffer: Uint8Array; open: boolean}>();
    return {
        async *keys() {
            yield* dirs.keys();
            yield* files.keys();
        },
        async removeEntry(name: string) {
            dirs.delete(name);
            files.delete(name);
        },
        async getDirectoryHandle(name: string) {
            let dir = dirs.get(name);
            if (dir === undefined) {
                dir = createExclusiveOpfsDirectoryHandle();
                dirs.set(name, dir);
            }
            return dir;
        },
        async getFileHandle(name: string): Promise<OpfsFileHandle> {
            return {
                async createSyncAccessHandle(): Promise<OpfsSyncAccessHandle> {
                    let file = files.get(name);
                    if (file === undefined) {
                        file = {buffer: new Uint8Array(0), open: false};
                        files.set(name, file);
                    }
                    if (file.open) {
                        throw new InternalError(
                            `createSyncAccessHandle: access handle already open for ${name}`,
                        );
                    }
                    file.open = true;
                    const f = file;
                    return {
                        read(data, options) {
                            const at = options?.at ?? 0;
                            const available = Math.max(0, f.buffer.byteLength - at);
                            const toCopy = Math.min(data.byteLength, available);
                            if (toCopy > 0) data.set(f.buffer.subarray(at, at + toCopy));
                            return toCopy;
                        },
                        write(data, options) {
                            const at = options?.at ?? 0;
                            const end = at + data.byteLength;
                            if (end > f.buffer.byteLength) {
                                const next = new Uint8Array(end);
                                next.set(f.buffer);
                                f.buffer = next;
                            }
                            f.buffer.set(data, at);
                            return data.byteLength;
                        },
                        truncate(size) {
                            if (size < f.buffer.byteLength) {
                                f.buffer = f.buffer.slice(0, size);
                            } else {
                                const next = new Uint8Array(size);
                                next.set(f.buffer);
                                f.buffer = next;
                            }
                        },
                        flush() {},
                        close() {
                            f.open = false;
                        },
                        getSize() {
                            return f.buffer.byteLength;
                        },
                    };
                },
            };
        },
    };
}

describe("DatabaseClient handle release", () => {
    test("an unclosed client holds OPFS handles that block reopening the group", async () => {
        const dir = createExclusiveOpfsDirectoryHandle();
        const client = await DatabaseClient.create(dir);

        // The main store's sync-access handles are still open, so OPFS refuses a second
        // handle on the same files. This both proves the fake enforces exclusivity and
        // shows that a leaked client wedges the group until its handles close.
        await expect(DatabaseClient.create(dir)).rejects.toThrow(/already open/);

        client.close();
    });

    test("close() releases the group OPFS handles so it can be reopened", async () => {
        const dir = createExclusiveOpfsDirectoryHandle();

        const client = await DatabaseClient.create(dir);
        client.close();

        // Handles released: a fresh open of the same group now succeeds and is usable.
        // Without DatabaseClient.close() closing every page store, this would reject with
        // "access handle already open" (see the test above).
        const reopened = await DatabaseClient.create(dir);
        const rows = await execute(
            reopened,
            testConn,
            sql`
                SELECT
                    1 AS n
            `,
        );
        expect(rows).toMatchObject([{n: 1}]);

        reopened.close();
    });
});
