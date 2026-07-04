import {
    type DatabaseWorkerConnection,
    createDatabaseGroupConnection,
    databaseUniqueWorkerKey,
} from "~/client/web/databases/connect_to_database.js";
import {
    type DatabaseActiveTabRealtimeConnection,
    DatabaseConnectionManager,
} from "~/client/web/databases/worker/database_connection_manager.js";
import {
    createInMemoryOpfsDirectoryHandle,
    extractOpfsPages,
} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {DatabaseClient} from "~/client/web/databases/worker/database_client.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/worker/opfs.js";
import {installUniqueWorkerTestMocks} from "~/client/web/helpers/workers/test_helpers/install_unique_worker_test_mocks.js";
import {settleUniqueWorkerTest} from "~/client/web/helpers/workers/test_helpers/settle_unique_worker_test.js";
import {uniqueWorkerWebLockName} from "~/client/web/helpers/workers/unique_worker_client.js";
import type {DatabaseExecuteActionResponse} from "~/shared/databases/database_protocol_schemas.js";
import {diffPage} from "~/shared/databases/page_diff.js";
import {SqlQuery, sql} from "~/shared/databases/sql.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {runMainMigrations} from "~/shared/databases/sqlite_migrations.js";
import {InternalError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import type {
    DatabaseGroupId,
    DatabaseMutationId,
    DatabaseReactiveActionId,
} from "~/shared/id/types/id_types.js";

const testDatabaseGroupId = generateId<DatabaseGroupId>();

/**
 * Creates a {@link DatabaseClient} seeded into the per-database OPFS subdirectory
 * so that the worker can find it.
 */
async function createSeededClient(
    dir: OpfsDirectoryHandle,
    databaseGroupId: string = testDatabaseGroupId,
): Promise<DatabaseClient> {
    const dbsDir = await dir.getDirectoryHandle("databases", {create: true});
    const groupDir = await dbsDir.getDirectoryHandle(databaseGroupId, {create: true});
    return DatabaseClient.create(groupDir);
}

/**
 * Seed a group's main database with the Alpine routing schema, as the server
 * always does before a client opens it. Without this the client's cold-open (which
 * attaches existing tables + prefetches schema pages) has no `_alpine_tables` to
 * read.
 */
async function seedMainSchema(
    dir: OpfsDirectoryHandle,
    databaseGroupId: string = testDatabaseGroupId,
): Promise<void> {
    const client = await createSeededClient(dir, databaseGroupId);
    client.executeLocallyForTests(runMainMigrations);
    client.commitOptimisticPagesForTests();
}

/** Create an OPFS dir with a migrated main database seeded. */
async function createSeededTestDir(
    databaseGroupId: string = testDatabaseGroupId,
): Promise<OpfsDirectoryHandle> {
    const newDir = createInMemoryOpfsDirectoryHandle();
    await seedMainSchema(newDir, databaseGroupId);
    return newDir;
}

async function executeSql(
    conn: DatabaseWorkerConnection,
    query: SqlQuery,
): Promise<Array<Record<string, unknown>>> {
    const result = await conn.executeAction("rawSql", rawSqlInputForTest(query));
    return result.rows as Array<Record<string, unknown>>;
}

function rawSqlInputForTest(query: SqlQuery): {sql: string} {
    let bindIndex = 0;
    const quote = String.fromCharCode(39);
    const sqlWithLiterals = query.query.replaceAll("?", () => {
        const value = query.bind[bindIndex++];
        if (value === null) return "NULL";
        if (typeof value === "number" || typeof value === "bigint") return String(value);
        if (typeof value === "string") {
            return quote + value.split(quote).join(quote + quote) + quote;
        }
        if (value instanceof Uint8Array) {
            const hex = [...value].map(byte => byte.toString(16).padStart(2, "0")).join("");
            return `x${quote}${hex}${quote}`;
        }
        throw new InternalError(`unsupported rawSql test bind: ${String(value)}`);
    });
    if (bindIndex !== query.bind.length) {
        throw new InternalError("rawSql test query did not consume all binds");
    }
    return {sql: sqlWithLiterals};
}

// ---------------------------------------------------------------------------
// OPFS page extraction helper — descends into the
// per-database-group subdirectory structure that the
// active-tab worker creates, then delegates to the
// shared OPFS helper.
// ---
//
// ---

async function extractPages(
    dir: OpfsDirectoryHandle,
    databaseGroupId: string = testDatabaseGroupId,
): Promise<Array<{pageIndex: number; version: number; data: Uint8Array}>> {
    const dbsDir = await dir.getDirectoryHandle("databases");
    const groupDir = await dbsDir.getDirectoryHandle(databaseGroupId);
    const {pages} = await extractOpfsPages(groupDir);
    return pages;
}

// ---------------------------------------------------------------------------
// Test environment
// ---
//
// The unique worker machinery (locks, broker, ports, workers) comes from the
// mocked globals; this harness provides the fake dedicated worker (a real
// `DatabaseActiveTabWorker` on in-memory OPFS) and simulates the realtime server
// connection against the local OPFS state. Each `connect()` call plays the role of
// one tab; a leader tab crash is simulated by force-releasing the election Web
// Lock.
//
// ---

function createDatabaseTestEnv(config: {
    dir: OpfsDirectoryHandle;
    databaseGroupId?: DatabaseGroupId;
    executeActionServer?: (
        action: {name: string; input: unknown},
        options: {
            mutationId: DatabaseMutationId;
            returnResult?: boolean;
            returnPages?: boolean;
        },
    ) => Promise<DatabaseExecuteActionResponse>;
}): {
    connect(): Promise<DatabaseWorkerConnection>;
    crashLeaderTab(): void;
    readonly worker: DatabaseConnectionManager;
} {
    const mocks = installUniqueWorkerTestMocks();
    const databaseGroupId = config.databaseGroupId ?? testDatabaseGroupId;
    const workers: Array<DatabaseConnectionManager> = [];

    const createRealtimeConnection = (): DatabaseActiveTabRealtimeConnection => ({
        executeActionServer:
            config.executeActionServer ??
            (() => {
                // Return a never-resolving promise so optimistic pages are preserved during tests.
                return new Promise(() => {});
            }),
        ensureCacheIsUpToDate: async pageVersionsByTable => {
            const clientVersions =
                pageVersionsByTable.get(databaseMainTableId) ?? new Map<number, number>();

            const empty = {
                tables: new Map([
                    [
                        databaseMainTableId,
                        {
                            updatedPages: new Map<number, {version: number; data: Uint8Array}>(),
                            stalePageIndexes: [] as Array<number>,
                            fileSizeInPages: 0,
                        },
                    ],
                ]),
            };

            // Read the local OPFS index to compare against client versions, simulating a
            // server that agrees with the local cache.
            try {
                const dbsDir = await config.dir.getDirectoryHandle("databases");
                const groupDir = await dbsDir.getDirectoryHandle(databaseGroupId);
                const dataDir = await groupDir.getDirectoryHandle(databaseMainTableId);
                const indexFile = await dataDir.getFileHandle("index.json");
                const indexHandle = await indexFile.createSyncAccessHandle();
                const size = indexHandle.getSize();
                if (size > 0) {
                    const raw = new Uint8Array(size);
                    indexHandle.read(raw, {at: 0});
                    const entries = JSON.parse(new TextDecoder().decode(raw)) as Array<
                        [number, {slot: number; version: number}]
                    >;
                    const serverVersions = new Map<number, number>();
                    for (const [pageIndex, {version}] of entries) {
                        serverVersions.set(pageIndex, version);
                    }

                    // Test page counts are tiny — always return inline data for stale pages.
                    const pagesHandle = await (
                        await dataDir.getFileHandle("pages.bin")
                    ).createSyncAccessHandle();
                    const slotMap = new Map<number, number>();
                    for (const [pageIndex, {slot}] of entries) {
                        slotMap.set(pageIndex, slot);
                    }

                    const updatedPages = new Map<number, {version: number; data: Uint8Array}>();
                    const stalePageIndexes: Array<number> = [];
                    for (const [pageIndex, clientVersion] of clientVersions) {
                        const serverVersion = serverVersions.get(pageIndex) ?? 0;
                        if (serverVersion === clientVersion) continue;
                        const slot = slotMap.get(pageIndex);
                        if (slot !== undefined) {
                            const data = new Uint8Array(sqlitePageSize);
                            pagesHandle.read(data, {at: slot * sqlitePageSize});
                            updatedPages.set(pageIndex, {
                                version: serverVersion,
                                data,
                            });
                        } else {
                            stalePageIndexes.push(pageIndex);
                        }
                    }
                    return {
                        tables: new Map([
                            [
                                databaseMainTableId,
                                {updatedPages, stalePageIndexes, fileSizeInPages: 0},
                            ],
                        ]),
                    };
                }
            } catch {
                // No index yet
            }
            return empty;
        },
        acknowledgePages: () => {},
        reportError: () => {},
        close: () => {},
    });

    mocks.setWorkerScriptFactory(() => {
        const worker = new DatabaseConnectionManager(
            config.dir.getDirectoryHandle("databases", {create: true}),
            {createRealtimeConnection},
        );
        workers.push(worker);
        return {handleMessage: (data, ports) => worker.host.handleMessage(data, ports)};
    });

    return {
        async connect() {
            const db = createDatabaseGroupConnection();
            await db.connect({
                databaseGroupId,
                webSocketUrl: "ws://test.invalid",
            });
            return db.connection;
        },
        crashLeaderTab() {
            mocks.forceReleaseWebLock(uniqueWorkerWebLockName(databaseUniqueWorkerKey));
        },
        // The current leader's worker (the most recently spawned one).
        get worker() {
            return workers[workers.length - 1]!;
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---
//
// ---

describe("connectToDatabaseGroup", () => {
    test("leader can execute queries", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});

        const conn = await env.connect();

        const rows = await executeSql(
            conn,
            sql`
                SELECT
                    1 + 1 AS result
            `,
        );
        expect(rows).toMatchObject([{result: 2}]);
    });

    test("follower queries reach leader\u2019s worker", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});

        const connA = await env.connect();
        const connB = await env.connect();

        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(
            connA,
            sql`
                INSERT INTO
                    t (name)
                VALUES
                    ('hello')
            `,
        );

        const rows = await executeSql(
            connB,
            sql`
                SELECT
                    *
                FROM
                    t
            `,
        );
        expect(rows).toMatchObject([{id: 1, name: "hello"}]);
    });

    test("multiple followers query the same database", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});

        const connA = await env.connect();
        const connB = await env.connect();
        const connC = await env.connect();

        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(
            connA,
            sql`
                INSERT INTO
                    items (val)
                VALUES
                    ('from-a')
            `,
        );
        await executeSql(
            connB,
            sql`
                INSERT INTO
                    items (val)
                VALUES
                    ('from-b')
            `,
        );

        const rows = await executeSql(
            connC,
            sql`
                SELECT
                    val
                FROM
                    items
                ORDER BY
                    id
            `,
        );
        expect(rows).toMatchObject([{val: "from-a"}, {val: "from-b"}]);
    });
});

describe("connectToDatabaseGroup resilience", () => {
    test("follower becomes leader after leader death", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});

        // Pre-populate OPFS so data persists across leader death
        const seed = await createSeededClient(dir);
        seed.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        seed.commitOptimisticPagesForTests();
        seed.executeLocallyForTests(sql`
            INSERT INTO
                t (id)
            VALUES
                (42)
        `);
        seed.commitOptimisticPagesForTests();

        await env.connect();
        const connB = await env.connect();

        // Leader dies — its Web Lock releases and the follower promotes.
        env.crashLeaderTab();
        await settleUniqueWorkerTest();

        const rows = await executeSql(
            connB,
            sql`
                SELECT
                    *
                FROM
                    t
            `,
        );
        expect(rows).toMatchObject([{id: 42}]);
    });

    test("queries after leader death resolve on the new leader", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});

        // Pre-populate OPFS so data persists across leader death
        const seed = await createSeededClient(dir);
        seed.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY)`);
        seed.commitOptimisticPagesForTests();
        seed.executeLocallyForTests(sql`
            INSERT INTO
                t (id)
            VALUES
                (1)
        `);
        seed.commitOptimisticPagesForTests();
        seed.executeLocallyForTests(sql`
            INSERT INTO
                t (id)
            VALUES
                (2)
        `);
        seed.commitOptimisticPagesForTests();

        await env.connect();
        const connB = await env.connect();

        // Kill leader and let the follower promote. (Calls in flight _during_ the failover
        // window reject rather than being replayed — that behavior is covered in
        // unique_worker_client.test.ts.)
        env.crashLeaderTab();
        await settleUniqueWorkerTest();

        const [rows1, rows2] = await Promise.all([
            executeSql(
                connB,
                sql`
                    SELECT
                        *
                    FROM
                        t
                    WHERE
                        id = 1
                `,
            ),
            executeSql(
                connB,
                sql`
                    SELECT
                        *
                    FROM
                        t
                    WHERE
                        id = 2
                `,
            ),
        ]);

        expect(rows1).toMatchObject([{id: 1}]);
        expect(rows2).toMatchObject([{id: 2}]);
    });

    test("leader closing connection (navigation) lets followers recover", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});

        // Pre-populate OPFS so data persists across leader change
        const seed = await createSeededClient(dir);
        seed.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        seed.commitOptimisticPagesForTests();
        seed.executeLocallyForTests(sql`
            INSERT INTO
                t (val)
            VALUES
                ('nav')
        `);
        seed.commitOptimisticPagesForTests();

        const connA = await env.connect();
        const connB = await env.connect();

        // Leader's component unmounts (page navigation) — conn.close() is called but the
        // tab stays alive. The Web Lock releases and the follower promotes.
        connA.close();
        await settleUniqueWorkerTest();

        const rows = await executeSql(
            connB,
            sql`
                SELECT
                    *
                FROM
                    t
            `,
        );
        expect(rows).toMatchObject([{id: 1, val: "nav"}]);
    });

    test("multiple followers handle leader death", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});

        // Pre-populate OPFS so data persists across leader death
        const seed = await createSeededClient(dir);
        seed.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        seed.commitOptimisticPagesForTests();
        seed.executeLocallyForTests(sql`
            INSERT INTO
                t (val)
            VALUES
                ('data')
        `);
        seed.commitOptimisticPagesForTests();

        await env.connect();
        const connB = await env.connect();
        const connC = await env.connect();

        // Kill leader — one follower becomes leader, the other reconnects to it.
        env.crashLeaderTab();
        await settleUniqueWorkerTest();

        const [rowsB, rowsC] = await Promise.all([
            executeSql(
                connB,
                sql`
                    SELECT
                        *
                    FROM
                        t
                `,
            ),
            executeSql(
                connC,
                sql`
                    SELECT
                        *
                    FROM
                        t
                `,
            ),
        ]);

        expect(rowsB).toMatchObject([{id: 1, val: "data"}]);
        expect(rowsC).toMatchObject([{id: 1, val: "data"}]);
    });
});

describe("connectToDatabaseGroup mutations", () => {
    test("leader can execute mutations optimistically", async () => {
        const dir = await createSeededTestDir();
        let capturedMutationId: DatabaseMutationId | null = null;
        const env = createDatabaseTestEnv({
            dir,
            executeActionServer: (_action, options) => {
                capturedMutationId = options.mutationId;
                // Return a never-resolving promise so the background assertion (realtime must
                // confirm before server responds) doesn't fire.
                return new Promise(() => {});
            },
        });
        const conn = await env.connect();

        // Create table first, then mutate
        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, title TEXT)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        const rows = await executeSql(
            conn,
            sql`
                INSERT INTO
                    t (title)
                VALUES
                    ('hello')
                RETURNING
                    *
            `,
        );

        // Result comes from local optimistic execution
        expect(rows).toMatchObject([{id: 1, title: "hello"}]);

        // Background server call fires
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(capturedMutationId).not.toBeNull();
    });

    test("follower mutations route through leader worker\u2019s realtime connection", async () => {
        const dir = await createSeededTestDir();
        let capturedAction: {name: string; input: unknown} | null = null;
        const env = createDatabaseTestEnv({
            dir,
            executeActionServer: async action => {
                capturedAction = action;
                return {
                    result: {name: action.name, output: {rows: []}},
                    readPages: new Map([[databaseMainTableId, new Map()]]),
                } as DatabaseExecuteActionResponse;
            },
        });
        await env.connect();

        // Create table via leader
        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, done INTEGER DEFAULT 0)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`
                INSERT INTO
                    t (id)
                VALUES
                    (1)
            `,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);

        // Follower tab. Its calls are proxied to the leader worker, so it does not get a
        // separate server route.
        const connB = await env.connect();

        const updateSql = sql`
            UPDATE t
            SET
                done = 1
        `;
        await executeSql(connB, updateSql);

        // Background server call routes through the leader worker's realtime connection.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(capturedAction).toMatchObject({
            name: "rawSql",
            input: rawSqlInputForTest(updateSql),
        });
    });

    test("mutation errors propagate to caller", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});
        const conn = await env.connect();

        // No table exists — local execution fails
        await expect(
            executeSql(
                conn,
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

describe("Reactive actions", () => {
    test("registerReactiveAction returns initial result", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});
        const conn = await env.connect();

        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(
            conn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('hello')
            `,
        );

        const id = generateId<DatabaseReactiveActionId>();
        const result = await conn.call("registerReactiveAction", {
            id,
            action: {
                name: "readonlyRawSql" as const,
                input: {
                    sql: sql`
                        SELECT
                            *
                        FROM
                            t
                    `.query,
                },
            },
        });

        expect(result.error).toBeNull();
        expect((result.result as any).output.rows).toMatchObject([{id: 1, val: "hello"}]);
    });

    test("reactive action re-executes when overlapping pages are written", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});
        const conn = await env.connect();

        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(
            conn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('v1')
            `,
        );

        // Use watchAction so the store snapshot reflects re-executions
        // (registerReactiveAction directly is fire-and-forget; nothing observable
        // downstream).
        const handle = await conn.watchAction("readonlyRawSql", {
            sql: sql`
                SELECT
                    *
                FROM
                    t
            `.query,
        });
        expect(handle.store.getSnapshot()).toMatchObject({
            ok: true,
            value: {rows: [{id: 1, val: "v1"}]},
        });

        // Insert another row — this writes pages that overlap with the reactive action's
        // read-set.
        await executeSql(
            conn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('v2')
            `,
        );

        // Realtime confirmation with newer versions; empty diffs because OPFS already has
        // the content.
        const pages = await extractPages(dir);
        const newerDiffs = new Map(
            pages.map(({pageIndex, version}) => [pageIndex, {version: version + 1, diff: []}]),
        );
        await conn.call("writePageDiffsFromRealtime", {
            pageDiffs: new Map([[databaseMainTableId, {diffs: newerDiffs, fileSizeInPages: 0}]]),
            mutationId: generateId<DatabaseMutationId>(),
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(handle.store.getSnapshot()).toMatchObject({
            ok: true,
            value: {
                rows: [
                    {id: 1, val: "v1"},
                    {id: 2, val: "v2"},
                ],
            },
        });

        handle.unwatch();
    });

    test("reactive action does NOT re-execute when non-overlapping pages are written", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});
        const conn = await env.connect();

        // All setup writes go to the base store via executeLocallyForTests so we control
        // the page change set we then ship as a realtime event.
        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t1 (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t2 (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`
                INSERT INTO
                    t1 (val)
                VALUES
                    ('a')
            `,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`
                INSERT INTO
                    t2 (val)
                VALUES
                    ('b')
            `,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);

        // Watch only t1.
        const handle = await conn.watchAction("readonlyRawSql", {
            sql: sql`
                SELECT
                    *
                FROM
                    t1
            `.query,
        });
        const initial = handle.store.getSnapshot();
        expect(initial).toMatchObject({ok: true, value: {rows: [{id: 1, val: "a"}]}});

        const updates: Array<unknown> = [];
        const listener = () => {
            const snap = handle.store.getSnapshot();
            if (snap !== initial) updates.push(snap);
        };
        handle.store.addListener(listener);

        // Mutate t2 via the base store, then take diff between before/after snapshots.
        const pagesBefore = await extractPages(dir);
        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`
                INSERT INTO
                    t2 (val)
                VALUES
                    ('c')
            `,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        const pagesAfter = await extractPages(dir);

        // Drop page 0 — SQLite touches its file-change counter on every write, and that's
        // a noise region the production code filters out via shouldIgnorePageInvalidation.
        // The point of this test is the non-page-0 case.
        const changedDiffs = new Map(
            pagesAfter
                .filter(after => {
                    if (after.pageIndex === 0) return false;
                    const before = pagesBefore.find(b => b.pageIndex === after.pageIndex);
                    return before === undefined || before.version !== after.version;
                })
                .map(({pageIndex, version}) => [pageIndex, {version: version + 1, diff: []}]),
        );

        // Sanity: the t2 mutation should have changed at least one non-page-0 page;
        // otherwise the test tells us nothing.
        expect(changedDiffs.size).toBeGreaterThan(0);

        await conn.call("writePageDiffsFromRealtime", {
            pageDiffs: new Map([[databaseMainTableId, {diffs: changedDiffs, fileSizeInPages: 0}]]),
            mutationId: generateId<DatabaseMutationId>(),
        });
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(updates).toEqual([]);
        expect(handle.store.getSnapshot()).toMatchObject({
            ok: true,
            value: {rows: [{id: 1, val: "a"}]},
        });

        handle.store.removeListener(listener);
        handle.unwatch();
    });

    test("unregisterReactiveAction stops re-execution", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});
        const conn = await env.connect();

        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(
            conn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('v1')
            `,
        );

        const handle = await conn.watchAction("readonlyRawSql", {
            sql: sql`
                SELECT
                    *
                FROM
                    t
            `.query,
        });
        const initial = handle.store.getSnapshot();
        expect(initial).toMatchObject({ok: true, value: {rows: [{id: 1, val: "v1"}]}});

        const updates: Array<unknown> = [];
        handle.store.addListener(() => {
            const snap = handle.store.getSnapshot();
            if (snap !== initial) updates.push(snap);
        });

        // Unregister, then write pages that would normally invalidate the watch.
        handle.unwatch();

        await executeSql(
            conn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('v2')
            `,
        );
        const pages = await extractPages(dir);
        const diffs = new Map(
            pages.map(({pageIndex, version}) => [pageIndex, {version: version + 1, diff: []}]),
        );
        await conn.call("writePageDiffsFromRealtime", {
            pageDiffs: new Map([[databaseMainTableId, {diffs, fileSizeInPages: 0}]]),
            mutationId: generateId<DatabaseMutationId>(),
        });
        await new Promise(resolve => setTimeout(resolve, 50));

        // No notifications after unwatch, store unchanged.
        expect(updates).toEqual([]);
        expect(handle.store.getSnapshot()).toMatchObject({
            ok: true,
            value: {rows: [{id: 1, val: "v1"}]},
        });
    });
});

describe("watchAction", () => {
    test("returns store with initial data", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});
        const conn = await env.connect();

        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(
            conn,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('hello')
            `,
        );

        const handle = await conn.watchAction("readonlyRawSql", {
            sql: sql`
                SELECT
                    *
                FROM
                    t
            `.query,
        });

        const snapshot = handle.store.getSnapshot();
        expect(snapshot).toMatchObject({ok: true, value: {rows: [{id: 1, val: "hello"}]}});

        handle.unwatch();
    });

    test("store updates when pages change", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});

        // Pre-populate OPFS so data is in the base store (no optimistic queue to replay on
        // writePageDiffsFromRealtime).
        const seed = await createSeededClient(dir);
        seed.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        seed.commitOptimisticPagesForTests();
        seed.executeLocallyForTests(sql`
            INSERT INTO
                t (val)
            VALUES
                ('v1')
        `);
        seed.commitOptimisticPagesForTests();

        const conn = await env.connect();

        const handle = await conn.watchAction("readonlyRawSql", {
            sql: "SELECT * FROM t ORDER BY id",
        });

        const initial = handle.store.getSnapshot();
        expect(initial).toMatchObject({ok: true, value: {rows: [{id: 1, val: "v1"}]}});

        // Extract the seed state as the "before" snapshot.
        const seedPages = await extractPages(dir);

        // Build "after" state in a separate database that has both rows — simulates a
        // server-side mutation.
        const serverDir = await createSeededTestDir();
        const server = await createSeededClient(serverDir);
        server.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        server.commitOptimisticPagesForTests();
        server.executeLocallyForTests(sql`
            INSERT INTO
                t (val)
            VALUES
                ('v1')
        `);
        server.commitOptimisticPagesForTests();
        server.executeLocallyForTests(sql`
            INSERT INTO
                t (val)
            VALUES
                ('v2')
        `);
        server.commitOptimisticPagesForTests();
        const serverPages = await extractPages(serverDir);

        // Compute actual diffs between seed and server so writePageDiffsFromRealtime
        // applies real changes. Seed pages were committed at small versions; pick a
        // sufficiently large one so writePageIfNewer overwrites them.
        const newerDiffs = new Map(
            serverPages.map(sp => {
                const seedPage = seedPages.find(p => p.pageIndex === sp.pageIndex);
                const base = seedPage?.data ?? new Uint8Array(sqlitePageSize);
                return [sp.pageIndex, {version: 1000, diff: diffPage(base, sp.data)}];
            }),
        );

        await conn.call("writePageDiffsFromRealtime", {
            pageDiffs: new Map([[databaseMainTableId, {diffs: newerDiffs, fileSizeInPages: 0}]]),
            mutationId: generateId<DatabaseMutationId>(),
        });

        // Wait for invalidation + re-execution + push
        await new Promise(resolve => setTimeout(resolve, 200));

        const updated = handle.store.getSnapshot();
        expect(updated).toMatchObject({
            ok: true,
            value: {
                rows: [
                    {id: 1, val: "v1"},
                    {id: 2, val: "v2"},
                ],
            },
        });

        handle.unwatch();
    });

    test("watches re-register after leader death", async () => {
        const dir = await createSeededTestDir();
        const env = createDatabaseTestEnv({dir});

        await env.connect();
        const connB = await env.connect();

        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await env.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('hello')
            `,
        );
        await env.worker.commitOptimisticPagesForTests(testDatabaseGroupId);

        // Watch from follower
        const handle = await connB.watchAction("readonlyRawSql", {
            sql: sql`
                SELECT
                    *
                FROM
                    t
            `.query,
        });

        const initial = handle.store.getSnapshot();
        expect(initial).toMatchObject({ok: true, value: {rows: [{id: 1, val: "hello"}]}});

        // Kill leader — the follower promotes and re-registers its watches with the new
        // worker via the reconnect hook.
        env.crashLeaderTab();
        await new Promise(resolve => setTimeout(resolve, 200));

        // Watch should still work — verify by checking the store has data (re-registration
        // re-executed the action on the new leader).
        const afterPromotion = handle.store.getSnapshot();
        expect(afterPromotion).toMatchObject({ok: true, value: {rows: [{id: 1, val: "hello"}]}});

        handle.unwatch();
    });
});
