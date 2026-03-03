import {
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
// Mock LockManager
// ---------------------------------------------------------------------------

class MockLockManager implements ActiveTabLockManager {
    private readonly held = new Set<string>();

    async request(
        name: string,
        options: {ifAvailable: boolean},
        callback: (lock: unknown) => Promise<unknown>,
    ): Promise<unknown> {
        if (options.ifAvailable && this.held.has(name)) {
            return callback(null);
        }
        this.held.add(name);
        return callback({name});
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
// Tests
// ---------------------------------------------------------------------------

/* eslint-disable cyberworlds/string-quotes -- SQL literals */

describe("DatabaseActiveTabManager", () => {
    test("leader can execute queries", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const dir = createInMemoryDirectory();

        const manager = new DatabaseActiveTabManager({
            locks,
            serviceWorker: sw.containerFor("tab-a"),
            createWorker: () => createMockWorker(dir),
            createMessageChannel: createMockMessageChannel,
        });
        const conn = await manager.connect();

        const result = await conn.rpc.call("executeQuery", {sql: "SELECT 1 + 1 AS result"});
        expect(result.rows).toMatchObject([{result: 2}]);
    });

    test("follower queries reach leader's worker", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const dir = createInMemoryDirectory();

        // Tab A — leader
        const managerA = new DatabaseActiveTabManager({
            locks,
            serviceWorker: sw.containerFor("tab-a"),
            createWorker: () => createMockWorker(dir),
            createMessageChannel: createMockMessageChannel,
        });
        const connA = await managerA.connect();

        // Tab B — follower
        const managerB = new DatabaseActiveTabManager({
            locks,
            serviceWorker: sw.containerFor("tab-b"),
            createWorker: () => createMockWorker(dir),
            createMessageChannel: createMockMessageChannel,
        });
        const connB = await managerB.connect();

        await connA.rpc.call("executeQuery", {
            sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)",
        });
        await connA.rpc.call("executeQuery", {
            sql: "INSERT INTO t (name) VALUES ('hello')",
        });

        const result = await connB.rpc.call("executeQuery", {sql: "SELECT * FROM t"});
        expect(result.rows).toMatchObject([{id: 1, name: "hello"}]);
    });

    test("multiple followers query the same database", async () => {
        const locks = new MockLockManager();
        const sw = new MockServiceWorkerBridge();
        const dir = createInMemoryDirectory();

        const createManager = (clientId: string) =>
            new DatabaseActiveTabManager({
                locks,
                serviceWorker: sw.containerFor(clientId),
                createWorker: () => createMockWorker(dir),
                createMessageChannel: createMockMessageChannel,
            });

        const connA = await createManager("tab-a").connect();
        const connB = await createManager("tab-b").connect();
        const connC = await createManager("tab-c").connect();

        await connA.rpc.call("executeQuery", {
            sql: "CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT)",
        });
        await connA.rpc.call("executeQuery", {
            sql: "INSERT INTO items (val) VALUES ('from-a')",
        });
        await connB.rpc.call("executeQuery", {
            sql: "INSERT INTO items (val) VALUES ('from-b')",
        });

        const result = await connC.rpc.call("executeQuery", {
            sql: "SELECT val FROM items ORDER BY id",
        });
        expect(result.rows).toMatchObject([{val: "from-a"}, {val: "from-b"}]);
    });
});

/* eslint-enable cyberworlds/string-quotes */
