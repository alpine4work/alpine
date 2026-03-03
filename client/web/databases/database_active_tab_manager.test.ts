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
import type {
    OpfsDirectoryHandle,
    OpfsFileHandle,
    OpfsSyncAccessHandle,
} from "~/client/web/databases/opfs.js";

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
}): {manager: DatabaseActiveTabManager; fireUnload: () => void} {
    const unloadListeners: Array<() => void> = [];

    const manager = new DatabaseActiveTabManager({
        locks: config.locks,
        serviceWorker: config.sw.containerFor(config.clientId),
        createWorker: () => createMockWorker(config.dir),
        createMessageChannel: createMockMessageChannel,
        createBroadcastChannel: name => config.bc.create(name),
        addUnloadListener: callback => unloadListeners.push(callback),
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

        const result = await conn.call("executeQuery", {sql: "SELECT 1 + 1 AS result"});
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

        await connA.call("executeQuery", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)",
        });
        await connA.call("executeQuery", {
            sql: "INSERT INTO t (name) VALUES ('hello')",
        });

        const result = await connB.call("executeQuery", {sql: "SELECT * FROM t"});
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

        await connA.call("executeQuery", {
            sql: "CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await connA.call("executeQuery", {
            sql: "INSERT INTO items (val) VALUES ('from-a')",
        });
        await connB.call("executeQuery", {
            sql: "INSERT INTO items (val) VALUES ('from-b')",
        });

        const result = await connC.call("executeQuery", {
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

        // Tab A — leader
        const {manager: managerA} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const connA = await managerA.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        // Write data via leader
        await connA.call("executeQuery", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY)",
        });
        await connA.call("executeQuery", {sql: "INSERT INTO t (id) VALUES (42)"});

        // Leader dies — release the lock
        locks.release("alpine-db");

        // Follower's connection should still work (it
        // becomes the new leader via lock-wait). The call
        // is queued until promotion completes.
        const result = await connB.call("executeQuery", {sql: "SELECT * FROM t"});
        expect(result.rows).toMatchObject([{id: 42}]);
    });

    test("graceful handoff via beforeunload", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        // Tab A — leader
        const tabA = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const connA = await tabA.manager.connect();

        // Tab B — follower
        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        // Write data
        await connA.call("executeQuery", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await connA.call("executeQuery", {sql: "INSERT INTO t (val) VALUES ('hello')"});

        // Leader announces graceful close
        tabA.fireUnload();

        // Release the lock (tab actually closes)
        locks.release("alpine-db");

        // Follower takes over — queries should succeed
        const result = await connB.call("executeQuery", {sql: "SELECT * FROM t"});
        expect(result.rows).toMatchObject([{id: 1, val: "hello"}]);
    });

    test("queries queued during transition resolve after reconnection", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        const {manager: managerA} = createTestTab({locks, sw, bc, clientId: "tab-a", dir});
        const connA = await managerA.connect();

        const {manager: managerB} = createTestTab({locks, sw, bc, clientId: "tab-b", dir});
        const connB = await managerB.connect();

        await connA.call("executeQuery", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY)",
        });
        await connA.call("executeQuery", {sql: "INSERT INTO t (id) VALUES (1)"});
        await connA.call("executeQuery", {sql: "INSERT INTO t (id) VALUES (2)"});

        // Kill leader
        locks.release("alpine-db");

        // Submit multiple queries before reconnection settles — they
        // should all be queued and eventually resolve.
        const [r1, r2] = await Promise.all([
            connB.call("executeQuery", {sql: "SELECT * FROM t WHERE id = 1"}),
            connB.call("executeQuery", {sql: "SELECT * FROM t WHERE id = 2"}),
        ]);

        expect(r1.rows).toMatchObject([{id: 1}]);
        expect(r2.rows).toMatchObject([{id: 2}]);
    });

    test("leader closing connection (navigation) lets followers recover", async () => {
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

        await connA.call("executeQuery", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await connA.call("executeQuery", {sql: "INSERT INTO t (val) VALUES ('nav')"});

        // Leader's component unmounts (page navigation) —
        // conn.close() is called but the tab stays alive.
        connA.close();

        // Follower should recover: lock is released by
        // closeConnection(), lock-wait fires, follower
        // promotes to leader.
        const result = await connB.call("executeQuery", {sql: "SELECT * FROM t"});
        expect(result.rows).toMatchObject([{id: 1, val: "nav"}]);
    });

    test("multiple followers handle leader death", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const bc = new MockBroadcastChannelBus();
        const dir = createInMemoryDirectory();

        const tab = (clientId: string) => createTestTab({locks, sw, bc, clientId, dir});

        // Tab A — leader, Tabs B and C — followers
        const connA = await tab("tab-a").manager.connect();
        const connB = await tab("tab-b").manager.connect();
        const connC = await tab("tab-c").manager.connect();

        await connA.call("executeQuery", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await connA.call("executeQuery", {sql: "INSERT INTO t (val) VALUES ('data')"});

        // Kill leader
        locks.release("alpine-db");

        // Both followers should recover — one becomes
        // leader, the other reconnects as follower to it.
        const [resultB, resultC] = await Promise.all([
            connB.call("executeQuery", {sql: "SELECT * FROM t"}),
            connC.call("executeQuery", {sql: "SELECT * FROM t"}),
        ]);

        expect(resultB.rows).toMatchObject([{id: 1, val: "data"}]);
        expect(resultC.rows).toMatchObject([{id: 1, val: "data"}]);
    });
});

/* eslint-enable cyberworlds/string-quotes */
