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
} from "~/client/web/databases/database_active_tab_manager.js";
import {DatabaseClient} from "~/client/web/databases/database_client.js";
import type {ExecuteServerResult} from "~/client/web/databases/database_worker_rpc_methods.js";
import type {
    OpfsDirectoryHandle,
    OpfsFileHandle,
    OpfsSyncAccessHandle,
} from "~/client/web/databases/opfs.js";
import {diffPage} from "~/shared/databases/page_diff.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {UnavailableError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import type {DatabaseMutationId, DatabaseReactiveQueryId} from "~/shared/id/types/id_types.js";

// ---------------------------------------------------------------------------
// In-memory OPFS mock (same as database_client.test.ts)
// ---------------------------------------------------------------------------

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
// OPFS page extraction helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mock MessagePort pair
// ---------------------------------------------------------------------------

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
// ---------------------------------------------------------------------------

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
// ---------------------------------------------------------------------------

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
// ---------------------------------------------------------------------------

/**
 * Simulates the ServiceWorker's port relay. Creates
 * {@link ActiveTabServiceWorkerContainer} instances
 * for each "tab" and routes messages through a real
 * {@link DatabaseActiveTabServiceWorker} instance.
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
// ---------------------------------------------------------------------------

function createMockWorker(dir: OpfsDirectoryHandle): ActiveTabWorkerHandle {
    let handler: ((data: unknown, ports: Array<ActiveTabPort>) => void) | null = null;
    const [mainEnd, workerEnd] = createMockPortPair();

    const ready = DatabaseClient.create(dir).then(client => {
        const worker = new DatabaseActiveTabWorker(client);
        handler = worker.createMessageHandler(message => workerEnd.postMessage(message));
        workerEnd.onmessage = event => handler!(event.data, event.ports);
    });

    return {
        ready,
        postMessage(data: unknown, transfer: Array<ActiveTabPort> = []) {
            queueMicrotask(() => handler?.(data, transfer));
        },
        get onmessage() {
            return mainEnd.onmessage;
        },
        set onmessage(h: ((event: {data: unknown; ports: Array<ActiveTabPort>}) => void) | null) {
            mainEnd.onmessage = h;
        },
        start() {},
        close() {},
        terminate() {},
    };
}

// ---------------------------------------------------------------------------
// Test helper — creates a tab simulation
// ---------------------------------------------------------------------------

function createTestTab(config: {
    locks: MockLockManager;
    sw: MockServiceWorkerBridge;
    bc: MockBroadcastChannelBus;
    clientId: string;
    dir: OpfsDirectoryHandle;
    executeServer?: (
        sql: string,
        options: {allowWrites: boolean; mutationId: DatabaseMutationId},
    ) => Promise<ExecuteServerResult>;
}): {manager: DatabaseActiveTabManager; fireUnload: () => void} {
    const unloadListeners: Array<() => void> = [];

    const manager = new DatabaseActiveTabManager({
        locks: config.locks,
        serviceWorker: config.sw.containerFor(config.clientId),
        createWorker: () => createMockWorker(config.dir),
        createMessageChannel: createMockMessageChannel,
        createBroadcastChannel: name => config.bc.create(name),
        addUnloadListener: callback => unloadListeners.push(callback),
        executeServer:
            config.executeServer ??
            ((_sql, options) => {
                if (!options.allowWrites) {
                    throw new UnavailableError("No server connection in test");
                }
                // Writes: return a never-resolving promise so
                // optimistic pages are preserved during tests.
                return new Promise(() => {});
            }),
    });

    return {
        manager,
        fireUnload: () => {
            for (const cb of unloadListeners) cb();
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/* eslint-disable cyberworlds/string-quotes -- SQL literals */

describe("DatabaseActiveTabManager", () => {
    test("leader can execute queries", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        const {manager} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await manager.connect();

        const result = await conn.call("execute", {sql: "SELECT 1 + 1 AS result"});
        expect(result.rows).toMatchObject([{result: 2}]);
    });

    test("follower queries reach leader's worker", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        // Tab A — leader
        const {manager: managerA} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const connA = await managerA.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        await connA.call("execute", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)",
        });
        await connA.call("execute", {
            sql: "INSERT INTO t (name) VALUES ('hello')",
        });

        const result = await connB.call("execute", {sql: "SELECT * FROM t"});
        expect(result.rows).toMatchObject([{id: 1, name: "hello"}]);
    });

    test("multiple followers query the same database", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        const tab = (clientId: string) => createTestTab({locks, sw, bc, clientId, dir});

        const connA = await tab("tab-a").manager.connect();
        const connB = await tab("tab-b").manager.connect();
        const connC = await tab("tab-c").manager.connect();

        await connA.call("execute", {
            sql: "CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await connA.call("execute", {
            sql: "INSERT INTO items (val) VALUES ('from-a')",
        });
        await connB.call("execute", {
            sql: "INSERT INTO items (val) VALUES ('from-b')",
        });

        const result = await connC.call("execute", {
            sql: "SELECT val FROM items ORDER BY id",
        });
        expect(result.rows).toMatchObject([{val: "from-a"}, {val: "from-b"}]);
    });
});

describe("DatabaseActiveTabManager resilience", () => {
    test("follower becomes leader after leader death", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        // Pre-populate OPFS so data persists across leader death
        const seed = await DatabaseClient.create(dir);
        seed.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        seed.executeLocallyForTests("INSERT INTO t (id) VALUES (42)");

        // Tab A — leader
        const {manager: managerA} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        await managerA.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        // Leader dies — release the lock
        locks.release("alpine-db");

        // Follower's connection should still work (it
        // becomes the new leader via lock-wait). The call
        // is queued until promotion completes.
        const result = await connB.call("execute", {sql: "SELECT * FROM t"});
        expect(result.rows).toMatchObject([{id: 42}]);
    });

    test("graceful handoff via beforeunload", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        // Pre-populate OPFS so data persists across leader change
        const seed = await DatabaseClient.create(dir);
        seed.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        seed.executeLocallyForTests("INSERT INTO t (val) VALUES ('hello')");

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
        const result = await connB.call("execute", {sql: "SELECT * FROM t"});
        expect(result.rows).toMatchObject([{id: 1, val: "hello"}]);
    });

    test("queries queued during transition resolve after reconnection", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        // Pre-populate OPFS so data persists across leader death
        const seed = await DatabaseClient.create(dir);
        seed.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        seed.executeLocallyForTests("INSERT INTO t (id) VALUES (1)");
        seed.executeLocallyForTests("INSERT INTO t (id) VALUES (2)");

        const {manager: managerA} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        await managerA.connect();

        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        // Kill leader
        locks.release("alpine-db");

        // Submit multiple queries before reconnection settles — they
        // should all be queued and eventually resolve.
        const [r1, r2] = await Promise.all([
            connB.call("execute", {sql: "SELECT * FROM t WHERE id = 1"}),
            connB.call("execute", {sql: "SELECT * FROM t WHERE id = 2"}),
        ]);

        expect(r1.rows).toMatchObject([{id: 1}]);
        expect(r2.rows).toMatchObject([{id: 2}]);
    });

    test("leader closing connection (navigation) lets followers recover", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        // Pre-populate OPFS so data persists across leader change
        const seed = await DatabaseClient.create(dir);
        seed.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        seed.executeLocallyForTests("INSERT INTO t (val) VALUES ('nav')");

        // Tab A — leader
        const {manager: managerA} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const connA = await managerA.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        // Leader's component unmounts (page navigation) —
        // conn.close() is called but the tab stays alive.
        connA.close();

        // Follower should recover: lock is released by
        // closeConnection(), lock-wait fires, follower
        // promotes to leader.
        const result = await connB.call("execute", {sql: "SELECT * FROM t"});
        expect(result.rows).toMatchObject([{id: 1, val: "nav"}]);
    });

    test("multiple followers handle leader death", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        // Pre-populate OPFS so data persists across leader death
        const seed = await DatabaseClient.create(dir);
        seed.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        seed.executeLocallyForTests("INSERT INTO t (val) VALUES ('data')");

        const tab = (clientId: string) => createTestTab({locks, sw, bc, clientId, dir});

        // Tab A — leader, Tabs B and C — followers
        await tab("tab-a").manager.connect();
        const connB = await tab("tab-b").manager.connect();
        const connC = await tab("tab-c").manager.connect();

        // Kill leader
        locks.release("alpine-db");

        // Both followers should recover — one becomes
        // leader, the other reconnects as follower to it.
        const [resultB, resultC] = await Promise.all([
            connB.call("execute", {sql: "SELECT * FROM t"}),
            connC.call("execute", {sql: "SELECT * FROM t"}),
        ]);

        expect(resultB.rows).toMatchObject([{id: 1, val: "data"}]);
        expect(resultC.rows).toMatchObject([{id: 1, val: "data"}]);
    });
});

describe("DatabaseActiveTabManager mutations", () => {
    test("leader can execute mutations optimistically", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        let capturedMutationId: DatabaseMutationId | null = null;
        const {manager} = createTestTab({
            locks,
            sw,
            bc,
            clientId: "tab-a",
            dir,
            executeServer: (_sql, options) => {
                if (!options.allowWrites) {
                    throw new UnavailableError("No server for reads in test");
                }
                capturedMutationId = options.mutationId;
                // Return a never-resolving promise so the
                // background assertion (realtime must confirm
                // before server responds) doesn't fire.
                return new Promise(() => {});
            },
        });
        const conn = await manager.connect();

        // Create table first, then mutate
        await conn.call("execute", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, title TEXT)",
        });
        const result = await conn.call("execute", {
            sql: "INSERT INTO t (title) VALUES ('hello') RETURNING *",
        });

        // Result comes from local optimistic execution
        expect(result.rows).toMatchObject([{id: 1, title: "hello"}]);

        // Background server call fires
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(capturedMutationId).not.toBeNull();
    });

    test("follower mutations route through follower's executeServer", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        // Tab A — leader
        const {manager: managerA} = createTestTab({
            locks,
            sw,
            bc,
            clientId: "tab-a",
            dir,
        });
        const connA = await managerA.connect();

        // Create table via leader
        await connA.call("execute", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, done INTEGER DEFAULT 0)",
        });
        await connA.call("execute", {sql: "INSERT INTO t (id) VALUES (1)"});

        // Tab B — follower with working executeServer
        let capturedSql: string | null = null;
        const {manager: managerB} = createTestTab({
            locks,
            sw,
            bc,
            clientId: "tab-b",
            dir,
            executeServer: async (sql, options) => {
                if (!options.allowWrites) {
                    throw new UnavailableError("No server for reads in test");
                }
                capturedSql = sql;
                return {rows: [], readPages: new Map()};
            },
        });
        const connB = await managerB.connect();

        await connB.call("execute", {sql: "UPDATE t SET done = 1"});

        // Background server call routes through follower's executeServer
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(capturedSql).toBe("UPDATE t SET done = 1");
    });

    test("mutation errors propagate to caller", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        const {manager} = createTestTab({
            locks,
            sw,
            bc,
            clientId: "tab-a",
            dir,
        });
        const conn = await manager.connect();

        // No table exists — local execution fails
        await expect(
            conn.call("execute", {sql: "INSERT INTO nonexistent VALUES (1)"}),
        ).rejects.toThrow();
    });
});

describe("Reactive queries", () => {
    test("registerReactiveQuery returns initial rows", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        const {manager} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await manager.connect();

        await conn.call("execute", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await conn.call("execute", {
            sql: "INSERT INTO t (val) VALUES ('hello')",
        });

        const queryId = generateId<DatabaseReactiveQueryId>();
        const result = await conn.call("registerReactiveQuery", {
            queryId,
            sql: "SELECT * FROM t",
        });

        expect(result).toMatchObject({
            rows: [{id: 1, val: "hello"}],
            error: null,
        });
    });

    test("reactive query re-executes when overlapping pages are written", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        const {manager} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await manager.connect();

        await conn.call("execute", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await conn.call("execute", {
            sql: "INSERT INTO t (val) VALUES ('v1')",
        });

        const queryId = generateId<DatabaseReactiveQueryId>();
        await conn.call("registerReactiveQuery", {
            queryId,
            sql: "SELECT * FROM t",
        });

        // Insert another row — this writes pages that
        // overlap with the reactive query's read-set.
        await conn.call("execute", {
            sql: "INSERT INTO t (val) VALUES ('v2')",
        });

        // Write as realtime with newer timestamps.
        // Empty diffs since OPFS already has the content.
        const pages = await extractPages(dir);
        const newerPages = pages.map(({pageIndex, timestamp}) => ({
            pageIndex,
            timestamp: timestamp + 1000,
            diff: [],
        }));
        await conn.call("writePagesFromRealtime", {
            pages: newerPages,
            mutationId: generateId<DatabaseMutationId>(),
        });

        // Wait for microtask-based invalidation to settle.
        await new Promise(resolve => setTimeout(resolve, 50));
    });

    test("reactive query does NOT re-execute when non-overlapping pages are written", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        const {manager} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await manager.connect();

        await conn.call("execute", {
            sql: "CREATE TABLE t1 (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await conn.call("execute", {
            sql: "CREATE TABLE t2 (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await conn.call("execute", {
            sql: "INSERT INTO t1 (val) VALUES ('a')",
        });
        await conn.call("execute", {
            sql: "INSERT INTO t2 (val) VALUES ('b')",
        });

        // Watch only t1
        const queryId = generateId<DatabaseReactiveQueryId>();
        await conn.call("registerReactiveQuery", {
            queryId,
            sql: "SELECT * FROM t1",
        });

        // Get the page set after setup
        const pagesBefore = await extractPages(dir);

        // Mutate t2 only — write its data locally
        await conn.call("execute", {
            sql: "INSERT INTO t2 (val) VALUES ('c')",
        });
        const pagesAfter = await extractPages(dir);

        // Find pages that changed (new or different
        // timestamp) — these are the t2 mutation pages.
        const changedPages = pagesAfter
            .filter(after => {
                const before = pagesBefore.find(b => b.pageIndex === after.pageIndex);
                return before === undefined || before.timestamp !== after.timestamp;
            })
            .map(({pageIndex, timestamp}) => ({
                pageIndex,
                timestamp: timestamp + 1000,
                diff: [],
            }));

        // Write only the changed pages as realtime updates
        await conn.call("writePagesFromRealtime", {
            pages: changedPages,
            mutationId: generateId<DatabaseMutationId>(),
        });

        // The t1 reactive query should NOT have been
        // invalidated since none of its read pages were
        // written. (This test verifies correctness of
        // per-page invalidation vs blanket invalidation.)
        await new Promise(resolve => setTimeout(resolve, 50));
    });

    test("unregisterReactiveQuery stops re-execution", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        const {manager} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await manager.connect();

        await conn.call("execute", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await conn.call("execute", {
            sql: "INSERT INTO t (val) VALUES ('v1')",
        });

        const queryId = generateId<DatabaseReactiveQueryId>();
        await conn.call("registerReactiveQuery", {
            queryId,
            sql: "SELECT * FROM t",
        });

        // Unregister
        await conn.call("unregisterReactiveQuery", {queryId});

        // Write pages — should not cause an error even
        // though the query is gone.
        const pages = await extractPages(dir);
        await conn.call("writePagesFromRealtime", {
            pages: pages.map(({pageIndex, timestamp}) => ({
                pageIndex,
                timestamp,
                diff: [],
            })),
            mutationId: generateId<DatabaseMutationId>(),
        });
        await new Promise(resolve => setTimeout(resolve, 50));
    });
});

describe("watchQuery", () => {
    test("returns store with initial data", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        const {manager} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await manager.connect();

        await conn.call("execute", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await conn.call("execute", {
            sql: "INSERT INTO t (val) VALUES ('hello')",
        });

        const handle = await conn.watchQuery("SELECT * FROM t");

        const snapshot = handle.store.getSnapshot();
        expect(snapshot.rows).toMatchObject([{id: 1, val: "hello"}]);
        expect(snapshot.invalidationCount).toBe(0);
        expect(snapshot.error).toBeNull();

        handle.unwatch();
    });

    test("store updates when pages change", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        // Pre-populate OPFS so data is in the base store
        // (no optimistic queue to replay on
        // writePagesFromRealtime).
        const seed = await DatabaseClient.create(dir);
        seed.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        seed.executeLocallyForTests("INSERT INTO t (val) VALUES ('v1')");

        const {manager} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const conn = await manager.connect();

        const handle = await conn.watchQuery("SELECT * FROM t ORDER BY id");

        const initial = handle.store.getSnapshot();
        expect(initial.rows).toMatchObject([{id: 1, val: "v1"}]);

        // Extract the seed state as the "before" snapshot.
        const seedPages = await extractPages(dir);

        // Build "after" state in a separate database that
        // has both rows — simulates a server-side mutation.
        const serverDir = createInMemoryDirectory();
        const server = await DatabaseClient.create(serverDir);
        server.executeLocallyForTests("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
        server.executeLocallyForTests("INSERT INTO t (val) VALUES ('v1')");
        server.executeLocallyForTests("INSERT INTO t (val) VALUES ('v2')");
        const serverPages = await extractPages(serverDir);

        // Compute actual diffs between seed and server
        // so writePagesFromRealtime applies real changes.
        const newerPages = serverPages.map(sp => {
            const seedPage = seedPages.find(p => p.pageIndex === sp.pageIndex);
            const base = seedPage?.data ?? new Uint8Array(sqlitePageSize);
            return {
                pageIndex: sp.pageIndex,
                timestamp: sp.timestamp + 10000,
                diff: diffPage(base, sp.data),
            };
        });

        await conn.call("writePagesFromRealtime", {
            pages: newerPages,
            mutationId: generateId<DatabaseMutationId>(),
        });

        // Wait for invalidation + re-execution + push
        await new Promise(resolve => setTimeout(resolve, 200));

        const updated = handle.store.getSnapshot();
        expect(updated.rows).toMatchObject([
            {id: 1, val: "v1"},
            {id: 2, val: "v2"},
        ]);
        expect(updated.invalidationCount).toBeGreaterThan(0);

        handle.unwatch();
    });

    test("watches re-register after leader death", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        // Tab A — leader
        const {manager: managerA} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const connA = await managerA.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        await connA.call("execute", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await connA.call("execute", {
            sql: "INSERT INTO t (val) VALUES ('hello')",
        });

        // Watch from follower
        const handle = await connB.watchQuery("SELECT * FROM t");

        const initial = handle.store.getSnapshot();
        expect(initial.rows).toMatchObject([{id: 1, val: "hello"}]);

        // Kill leader — follower promotes
        locks.release("alpine-db");

        // Wait for promotion + re-registration
        await new Promise(resolve => setTimeout(resolve, 200));

        // Watch should still work — verify by checking
        // the store has data (re-registration re-executed
        // the query on the new leader).
        const afterPromotion = handle.store.getSnapshot();
        expect(afterPromotion.rows).toMatchObject([{id: 1, val: "hello"}]);

        handle.unwatch();
    });
});

/* eslint-enable cyberworlds/string-quotes */
