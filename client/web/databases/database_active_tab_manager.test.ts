/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import {
    type ActiveTabBroadcastChannel,
    type ActiveTabLockManager,
    type ActiveTabPort,
    type ActiveTabServiceWorkerClients,
    type ActiveTabServiceWorkerContainer,
    type ActiveTabServiceWorkerRegistration,
    type ActiveTabWorkerHandle,
    DatabaseActiveTabManager,
    DatabaseActiveTabServiceWorker,
    DatabaseActiveTabWorker,
    type DatabaseWorkerConnection,
} from "~/client/web/databases/database_active_tab_manager.js";
import {
    createInMemoryOpfsDirectoryHandle,
    extractOpfsPages,
} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {DatabaseClient} from "~/client/web/databases/worker/database_client.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/worker/opfs.js";
import type {DatabaseExecuteActionResponse} from "~/shared/databases/database_protocol_schemas.js";
import {diffPage} from "~/shared/databases/page_diff.js";
import {sql} from "~/shared/databases/sql.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {runMainMigrations} from "~/shared/databases/sqlite_migrations.js";
import {generateId} from "~/shared/id/id.js";
import type {
    DatabaseGroupId,
    DatabaseMutationId,
    DatabaseReactiveActionId,
} from "~/shared/id/types/id_types.js";

const testDatabaseGroupId = generateId<DatabaseGroupId>();

/**
 * Creates a {@link DatabaseClient} seeded into the per-database OPFS subdirectory
 * so that the mock worker can find it.
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
    sql: string,
): Promise<Array<Record<string, unknown>>> {
    const result = await conn.executeAction("rawSql", {sql});
    return result.rows as Array<Record<string, unknown>>;
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
// Mock MessagePort pair
// ---
//
// ---

function createMockPortPair(): [ActiveTabPort, ActiveTabPort] {
    const portA: ActiveTabPort = {
        postMessage(data: unknown, transfer: Array<ActiveTabPort> = []) {
            const handler = portB.onmessage;
            if (handler) {
                queueMicrotask(() => handler({data, ports: transfer}));
            }
        },
        onmessage: null,
        start() {},
        close() {},
    };

    const portB: ActiveTabPort = {
        postMessage(data: unknown, transfer: Array<ActiveTabPort> = []) {
            const handler = portA.onmessage;
            if (handler) {
                queueMicrotask(() => handler({data, ports: transfer}));
            }
        },
        onmessage: null,
        start() {},
        close() {},
    };

    return [portA, portB];
}

function createMockMessageChannel(): {port1: ActiveTabPort; port2: ActiveTabPort} {
    const [port1, port2] = createMockPortPair();
    return {port1, port2};
}

// ---------------------------------------------------------------------------
// Mock LockManager — supports ifAvailable and blocking wait
// ---
//
// ---

class MockLockManager implements ActiveTabLockManager {
    private readonly held = new Set<string>();
    private readonly holdResolvers = new Map<string, () => void>();
    private readonly waitQueue = new Map<string, Array<() => void>>();

    async request(
        name: string,
        options: {ifAvailable: boolean},
        callback: (lock: unknown) => Promise<unknown>,
    ): Promise<unknown> {
        if (this.held.has(name)) {
            if (options.ifAvailable) {
                return callback(null);
            }
            // Block until the lock is released
            await new Promise<void>(resolve => {
                const queue = this.waitQueue.get(name) ?? [];
                queue.push(resolve);
                this.waitQueue.set(name, queue);
            });
        }

        this.held.add(name);

        // Race the callback against an external release() call
        const holdPromise = new Promise<void>(resolve => {
            this.holdResolvers.set(name, resolve);
        });

        await Promise.race([callback({name}), holdPromise]);

        // Lock released — clean up and grant to next waiter
        this.held.delete(name);
        this.holdResolvers.delete(name);

        const queue = this.waitQueue.get(name);
        if (queue !== undefined && queue.length > 0) {
            const next = queue.shift()!;
            next();
        }
    }

    /** Simulate tab death: release the held lock. */
    release(name: string): void {
        const resolve = this.holdResolvers.get(name);
        resolve?.();
    }
}

// ---------------------------------------------------------------------------
// Mock BroadcastChannel bus
// ---
//
// ---

class MockBroadcastChannelBus {
    private readonly channels = new Map<string, Set<ActiveTabBroadcastChannel>>();

    create(name: string): ActiveTabBroadcastChannel {
        const channel: ActiveTabBroadcastChannel = {
            postMessage: (data: unknown) => {
                const set = this.channels.get(name);
                if (!set) return;
                for (const ch of set) {
                    if (ch !== channel && ch.onmessage) {
                        const handler = ch.onmessage;
                        queueMicrotask(() => handler({data}));
                    }
                }
            },
            onmessage: null,
            close: () => {
                this.channels.get(name)?.delete(channel);
            },
        };

        let set = this.channels.get(name);
        if (set === undefined) {
            set = new Set();
            this.channels.set(name, set);
        }
        set.add(channel);

        return channel;
    }
}

// ---------------------------------------------------------------------------
// Mock ServiceWorker bridge
// ---
//
// ---

/**
 * Simulates the ServiceWorker's port relay. Creates {@link
 * ActiveTabServiceWorkerContainer} instances for each "tab" and routes messages
 * through a real {@link DatabaseActiveTabServiceWorker} instance.
 */
class MockServiceWorkerBridge {
    private readonly sw: DatabaseActiveTabServiceWorker;
    private readonly clientHandlers = new Map<
        string,
        (event: {data: unknown; ports: Array<ActiveTabPort>}) => void
    >();

    constructor() {
        const clients: ActiveTabServiceWorkerClients = {
            postMessage: async (clientId, data, transfer) => {
                const handler = this.clientHandlers.get(clientId);
                handler?.({data, ports: transfer});
            },
        };
        this.sw = new DatabaseActiveTabServiceWorker(clients);
    }

    containerFor(clientId: string): ActiveTabServiceWorkerContainer {
        const reg: ActiveTabServiceWorkerRegistration = {
            active: {
                postMessage: (data: unknown, transfer: Array<ActiveTabPort> = []) => {
                    // Deliver to the real SW handler
                    void this.sw.handleMessage(clientId, data, transfer);
                },
            },
        };

        return {
            ready: Promise.resolve(reg),
            addEventListener: (
                _type: "message",
                handler: (event: {data: unknown; ports: Array<ActiveTabPort>}) => void,
            ) => {
                this.clientHandlers.set(clientId, handler);
            },
        };
    }
}

// ---------------------------------------------------------------------------
// Mock worker
// ---
//
// ---

function createMockWorker(dir: OpfsDirectoryHandle): {
    handle: ActiveTabWorkerHandle;
    worker: DatabaseActiveTabWorker;
} {
    let handler: ((data: unknown, ports: Array<ActiveTabPort>) => void) | null = null;
    let resolvedWorker!: DatabaseActiveTabWorker;
    const [mainEnd, workerEnd] = createMockPortPair();

    const ready = dir.getDirectoryHandle("databases", {create: true}).then(dbsDir => {
        resolvedWorker = new DatabaseActiveTabWorker(dbsDir);
        handler = resolvedWorker.createMessageHandler(message => workerEnd.postMessage(message));
        workerEnd.onmessage = event => handler!(event.data, event.ports);
    });

    return {
        handle: {
            ready,
            postMessage(data: unknown, transfer: Array<ActiveTabPort> = []) {
                queueMicrotask(() => handler?.(data, transfer));
            },
            get onmessage() {
                return mainEnd.onmessage;
            },
            set onmessage(
                h: ((event: {data: unknown; ports: Array<ActiveTabPort>}) => void) | null,
            ) {
                mainEnd.onmessage = h;
            },
            start() {},
            close() {},
            terminate() {},
        },
        get worker() {
            return resolvedWorker;
        },
    };
}

// ---------------------------------------------------------------------------
// Test helper — creates a tab simulation
// ---
//
// ---

function createTestTab(config: {
    locks: MockLockManager;
    sw: MockServiceWorkerBridge;
    bc: MockBroadcastChannelBus;
    clientId: string;
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
    manager: DatabaseActiveTabManager;
    fireUnload: () => void;
    worker: DatabaseActiveTabWorker;
} {
    const unloadListeners: Array<() => void> = [];
    let mockWorker: ReturnType<typeof createMockWorker> | undefined;

    const manager = new DatabaseActiveTabManager({
        databaseGroupId: config.databaseGroupId ?? testDatabaseGroupId,
        locks: config.locks,
        serviceWorker: config.sw.containerFor(config.clientId),
        createWorker: () => {
            mockWorker = createMockWorker(config.dir);
            return mockWorker.handle;
        },
        createMessageChannel: createMockMessageChannel,
        createBroadcastChannel: name => config.bc.create(name),
        addUnloadListener: callback => unloadListeners.push(callback),
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
                const databaseGroupId = config.databaseGroupId ?? testDatabaseGroupId;
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
    });

    return {
        manager,
        fireUnload: () => {
            for (const cb of unloadListeners) cb();
        },
        get worker() {
            return mockWorker!.worker;
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---
//
// ---

describe("DatabaseActiveTabManager", () => {
    test("leader can execute queries", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        const {manager} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await manager.connect();

        const rows = await executeSql(conn, "SELECT 1 + 1 AS result");
        expect(rows).toMatchObject([{result: 2}]);
    });

    test("follower queries reach leader's worker", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        // Tab A — leader
        const tabA = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const connA = await tabA.manager.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        await tabA.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)`,
        );
        await tabA.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(connA, "INSERT INTO t (name) VALUES ('hello')");

        const rows = await executeSql(connB, "SELECT * FROM t");
        expect(rows).toMatchObject([{id: 1, name: "hello"}]);
    });

    test("multiple followers query the same database", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        const tab = (clientId: string) => createTestTab({locks, sw, bc, clientId, dir});

        const tabA = tab("tab-a");
        const connA = await tabA.manager.connect();
        const connB = await tab("tab-b").manager.connect();
        const connC = await tab("tab-c").manager.connect();

        await tabA.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await tabA.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(connA, "INSERT INTO items (val) VALUES ('from-a')");
        await executeSql(connB, "INSERT INTO items (val) VALUES ('from-b')");

        const rows = await executeSql(connC, "SELECT val FROM items ORDER BY id");
        expect(rows).toMatchObject([{val: "from-a"}, {val: "from-b"}]);
    });
});

describe("DatabaseActiveTabManager resilience", () => {
    test("follower becomes leader after leader death", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

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

        // Tab A — leader
        const {manager: managerA} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        await managerA.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        // Leader dies — release the lock
        locks.release("alpine-db");

        // Follower's connection should still work (it becomes the new leader via
        // lock-wait). The call is queued until promotion completes.
        const rows = await executeSql(connB, "SELECT * FROM t");
        expect(rows).toMatchObject([{id: 42}]);
    });

    test("graceful handoff via beforeunload", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        // Pre-populate OPFS so data persists across leader change
        const seed = await createSeededClient(dir);
        seed.executeLocallyForTests(sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`);
        seed.commitOptimisticPagesForTests();
        seed.executeLocallyForTests(sql`
            INSERT INTO
                t (val)
            VALUES
                ('hello')
        `);
        seed.commitOptimisticPagesForTests();

        // Tab A — leader
        const tabA = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        await tabA.manager.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        // Leader announces graceful close
        tabA.fireUnload();

        // Release the lock (tab actually closes)
        locks.release("alpine-db");

        // Follower takes over — queries should succeed
        const rows = await executeSql(connB, "SELECT * FROM t");
        expect(rows).toMatchObject([{id: 1, val: "hello"}]);
    });

    test("queries queued during transition resolve after reconnection", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

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

        const {manager: managerA} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        await managerA.connect();

        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        // Kill leader
        locks.release("alpine-db");

        // Submit multiple queries before reconnection settles — they should all be queued
        // and eventually resolve.
        const [rows1, rows2] = await Promise.all([
            executeSql(connB, "SELECT * FROM t WHERE id = 1"),
            executeSql(connB, "SELECT * FROM t WHERE id = 2"),
        ]);

        expect(rows1).toMatchObject([{id: 1}]);
        expect(rows2).toMatchObject([{id: 2}]);
    });

    test("leader closing connection (navigation) lets followers recover", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

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

        // Tab A — leader
        const {manager: managerA} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const connA = await managerA.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        // Leader's component unmounts (page navigation) — conn.close() is called but the
        // tab stays alive.
        connA.close();

        // Follower should recover: lock is released by closeConnection(), lock-wait fires,
        // follower promotes to leader.
        const rows = await executeSql(connB, "SELECT * FROM t");
        expect(rows).toMatchObject([{id: 1, val: "nav"}]);
    });

    test("multiple followers handle leader death", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

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

        const tab = (clientId: string) => createTestTab({locks, sw, bc, clientId, dir});

        // Tab A — leader, Tabs B and C — followers
        await tab("tab-a").manager.connect();
        const connB = await tab("tab-b").manager.connect();
        const connC = await tab("tab-c").manager.connect();

        // Kill leader
        locks.release("alpine-db");

        // Both followers should recover — one becomes leader, the other reconnects as
        // follower to it.
        const [rowsB, rowsC] = await Promise.all([
            executeSql(connB, "SELECT * FROM t"),
            executeSql(connC, "SELECT * FROM t"),
        ]);

        expect(rowsB).toMatchObject([{id: 1, val: "data"}]);
        expect(rowsC).toMatchObject([{id: 1, val: "data"}]);
    });
});

describe("DatabaseActiveTabManager mutations", () => {
    test("leader can execute mutations optimistically", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        let capturedMutationId: DatabaseMutationId | null = null;
        const tab = createTestTab({
            locks,
            sw,
            bc,
            clientId: "tab-a",
            dir,
            executeActionServer: (_action, options) => {
                capturedMutationId = options.mutationId;
                // Return a never-resolving promise so the background assertion (realtime must
                // confirm before server responds) doesn't fire.
                return new Promise(() => {});
            },
        });
        const conn = await tab.manager.connect();

        // Create table first, then mutate
        await tab.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, title TEXT)`,
        );
        await tab.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        const rows = await executeSql(conn, "INSERT INTO t (title) VALUES ('hello') RETURNING *");

        // Result comes from local optimistic execution
        expect(rows).toMatchObject([{id: 1, title: "hello"}]);

        // Background server call fires
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(capturedMutationId).not.toBeNull();
    });

    test("follower mutations route through follower's executeActionServer", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        // Tab A — leader
        const tabA = createTestTab({
            locks,
            sw,
            bc,
            clientId: "tab-a",
            dir,
        });
        const connA = await tabA.manager.connect();

        // Create table via leader
        await tabA.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, done INTEGER DEFAULT 0)`,
        );
        await tabA.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(connA, "INSERT INTO t (id) VALUES (1)");

        // Tab B — follower with working executeActionServer
        let capturedAction: {name: string; input: unknown} | null = null;
        const {manager: managerB} = createTestTab({
            locks,
            sw,
            bc,
            clientId: "tab-b",
            dir,
            executeActionServer: async action => {
                capturedAction = action;
                return {
                    result: {name: action.name, output: {rows: []}},
                    readPages: new Map([[databaseMainTableId, new Map()]]),
                } as DatabaseExecuteActionResponse;
            },
        });
        const connB = await managerB.connect();

        await executeSql(connB, "UPDATE t SET done = 1");

        // Background server call routes through follower's executeActionServer
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(capturedAction).toMatchObject({
            name: "rawSql",
            input: {sql: "UPDATE t SET done = 1"},
        });
    });

    test("mutation errors propagate to caller", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        const {manager} = createTestTab({
            locks,
            sw,
            bc,
            clientId: "tab-a",
            dir,
        });
        const conn = await manager.connect();

        // No table exists — local execution fails
        await expect(executeSql(conn, "INSERT INTO nonexistent VALUES (1)")).rejects.toThrow();
    });
});

describe("Reactive actions", () => {
    test("registerReactiveAction returns initial result", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        const tab = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await tab.manager.connect();

        await tab.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await tab.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(conn, "INSERT INTO t (val) VALUES ('hello')");

        const id = generateId<DatabaseReactiveActionId>();
        const result = await conn.call("registerReactiveAction", {
            id,
            action: {name: "readonlyRawSql" as const, input: {sql: "SELECT * FROM t"}},
        });

        expect(result.error).toBeNull();
        expect((result.result as any).output.rows).toMatchObject([{id: 1, val: "hello"}]);
    });

    test("reactive action re-executes when overlapping pages are written", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        const tab = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await tab.manager.connect();

        await tab.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await tab.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(conn, "INSERT INTO t (val) VALUES ('v1')");

        // Use watchAction so the store snapshot reflects re-executions
        // (registerReactiveAction directly is fire-and-forget; nothing observable
        // downstream).
        const handle = await conn.watchAction("readonlyRawSql", {sql: "SELECT * FROM t"});
        expect(handle.store.getSnapshot()).toMatchObject({
            ok: true,
            value: {rows: [{id: 1, val: "v1"}]},
        });

        // Insert another row — this writes pages that overlap with the reactive action's
        // read-set.
        await executeSql(conn, "INSERT INTO t (val) VALUES ('v2')");

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
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        const tab = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await tab.manager.connect();

        // All setup writes go to the base store via executeLocallyForTests so we control
        // the page change set we then ship as a realtime event.
        await tab.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t1 (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await tab.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await tab.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t2 (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await tab.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await tab.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`
                INSERT INTO
                    t1 (val)
                VALUES
                    ('a')
            `,
        );
        await tab.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await tab.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`
                INSERT INTO
                    t2 (val)
                VALUES
                    ('b')
            `,
        );
        await tab.worker.commitOptimisticPagesForTests(testDatabaseGroupId);

        // Watch only t1.
        const handle = await conn.watchAction("readonlyRawSql", {sql: "SELECT * FROM t1"});
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
        await tab.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`
                INSERT INTO
                    t2 (val)
                VALUES
                    ('c')
            `,
        );
        await tab.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
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
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        const tab = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await tab.manager.connect();

        await tab.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await tab.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(conn, "INSERT INTO t (val) VALUES ('v1')");

        const handle = await conn.watchAction("readonlyRawSql", {sql: "SELECT * FROM t"});
        const initial = handle.store.getSnapshot();
        expect(initial).toMatchObject({ok: true, value: {rows: [{id: 1, val: "v1"}]}});

        const updates: Array<unknown> = [];
        handle.store.addListener(() => {
            const snap = handle.store.getSnapshot();
            if (snap !== initial) updates.push(snap);
        });

        // Unregister, then write pages that would normally invalidate the watch.
        handle.unwatch();

        await executeSql(conn, "INSERT INTO t (val) VALUES ('v2')");
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
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        const tab = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await tab.manager.connect();

        await tab.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await tab.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await executeSql(conn, "INSERT INTO t (val) VALUES ('hello')");

        const handle = await conn.watchAction("readonlyRawSql", {sql: "SELECT * FROM t"});

        const snapshot = handle.store.getSnapshot();
        expect(snapshot).toMatchObject({ok: true, value: {rows: [{id: 1, val: "hello"}]}});

        handle.unwatch();
    });

    test("store updates when pages change", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

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

        const {manager} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await manager.connect();

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
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = await createSeededTestDir();

        // Tab A — leader
        const tabA = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        await tabA.manager.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        await tabA.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)`,
        );
        await tabA.worker.commitOptimisticPagesForTests(testDatabaseGroupId);
        await tabA.worker.executeLocallyForTests(
            testDatabaseGroupId,
            sql`
                INSERT INTO
                    t (val)
                VALUES
                    ('hello')
            `,
        );
        await tabA.worker.commitOptimisticPagesForTests(testDatabaseGroupId);

        // Watch from follower
        const handle = await connB.watchAction("readonlyRawSql", {sql: "SELECT * FROM t"});

        const initial = handle.store.getSnapshot();
        expect(initial).toMatchObject({ok: true, value: {rows: [{id: 1, val: "hello"}]}});

        // Kill leader — follower promotes
        locks.release("alpine-db");

        // Wait for promotion + re-registration
        await new Promise(resolve => setTimeout(resolve, 200));

        // Watch should still work — verify by checking the store has data (re-registration
        // re-executed the action on the new leader).
        const afterPromotion = handle.store.getSnapshot();
        expect(afterPromotion).toMatchObject({ok: true, value: {rows: [{id: 1, val: "hello"}]}});

        handle.unwatch();
    });
});
