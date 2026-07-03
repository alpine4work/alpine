import {
    UniqueWorkerTestWorkerScript,
    installUniqueWorkerTestMocks,
} from "~/client/web/helpers/workers/test_helpers/install_unique_worker_test_mocks.js";
import {settleUniqueWorkerTest} from "~/client/web/helpers/workers/test_helpers/settle_unique_worker_test.js";
import {
    UniqueWorkerClient,
    uniqueWorkerWebLockName,
} from "~/client/web/helpers/workers/unique_worker_client.js";
import {UniqueWorkerHost} from "~/client/web/helpers/workers/unique_worker_host.js";
import {defineWebWorkerRpcMethods} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {UnknownError} from "~/shared/error/error.js";
import {Schema} from "~/shared/schema/schema.js";

// These tests run the full multi-tab dance — client, real broker logic, and real
// host — on top of the mocked browser globals, so every scenario covers the whole
// system rather than the client in isolation. Each simulated "tab" is simply a
// separate client; a leader tab crash is simulated by force-releasing the election
// Web Lock, exactly what a real browser does when a tab dies.

const testWorkerMethods = defineWebWorkerRpcMethods({
    echo: {
        input: {value: Schema.string},
        output: {value: Schema.string, servedBy: Schema.string},
    },
    hang: {
        input: {},
        output: {},
    },
});

const testTabMethods = defineWebWorkerRpcMethods({
    notify: {
        input: {value: Schema.string},
        output: {},
    },
});

type TestHost = UniqueWorkerHost<typeof testWorkerMethods, typeof testTabMethods>;

const testKey = "test-worker";

function createTestHarness() {
    const mocks = installUniqueWorkerTestMocks();
    const hostsByTag = new Map<string, TestHost>();
    const workerGates = new Map<string, Promise<void>>();
    const workerScriptOverrides = new Map<string, UniqueWorkerTestWorkerScript>();

    function createWorkerScript(tag: string): UniqueWorkerTestWorkerScript {
        const host: TestHost = new UniqueWorkerHost({
            workerMethods: testWorkerMethods,
            tabMethods: testTabMethods,
            handlers: {
                echo: async (input, connection) => {
                    void connection.call("notify", {value: `echoed:${input.value}`});
                    return {value: input.value, servedBy: tag};
                },
                hang: () => new Promise(() => {}),
            },
        });
        hostsByTag.set(tag, host);
        return {handleMessage: (data, ports) => host.handleMessage(data, ports)};
    }

    mocks.setWorkerScriptFactory(url => {
        const tag = url.replace("test-worker://", "");
        const clientName = tag.split("-worker-")[0]!;
        const override = workerScriptOverrides.get(clientName);
        if (override !== undefined) return override;
        const script = createWorkerScript(tag);
        const gate = workerGates.get(clientName);
        if (gate === undefined) return script;
        return {
            handleMessage(data, ports) {
                void gate.then(() => script.handleMessage(data, ports));
            },
        };
    });

    function createClient(
        name: string,
        options: {
            onReconnect?: () => Promise<void> | void;
            onFailed?: (error: Error) => void;
            /** Delays this client's spawned workers until the promise resolves. */
            workerGate?: Promise<void>;
            /** Replaces this client's worker script entirely. */
            workerScript?: UniqueWorkerTestWorkerScript;
            key?: string;
        } = {},
    ) {
        if (options.workerGate !== undefined) workerGates.set(name, options.workerGate);
        if (options.workerScript !== undefined) {
            workerScriptOverrides.set(name, options.workerScript);
        }
        const notifications: Array<string> = [];
        let workerCount = 0;
        const client = new UniqueWorkerClient({
            key: options.key ?? testKey,
            createWorker: () => new Worker(`test-worker://${name}-worker-${workerCount++}`),
            workerMethods: testWorkerMethods,
            tabMethods: testTabMethods,
            handlers: {
                notify: async input => {
                    notifications.push(input.value);
                    return {};
                },
            },
            onReconnect: options.onReconnect,
            onFailed: options.onFailed,
        });
        return {client, notifications};
    }

    return {
        createClient,
        hostsByTag,
        crashLeaderTab: () => mocks.forceReleaseWebLock(uniqueWorkerWebLockName(testKey)),
    };
}

describe("UniqueWorkerClient", () => {
    test("a single tab becomes leader and calls its own worker", async () => {
        const harness = createTestHarness();
        const tabA = harness.createClient("a");

        await tabA.client.whenConnected();

        expect(tabA.client.status).toBe("leader");
        expect(await tabA.client.call("echo", {value: "hi"})).toEqual({
            value: "hi",
            servedBy: "a-worker-0",
        });
    });

    test("a second tab attaches as follower and reaches the leader\u2019s worker", async () => {
        const harness = createTestHarness();
        const tabA = harness.createClient("a");
        const tabB = harness.createClient("b");
        await tabA.client.whenConnected();
        await tabB.client.whenConnected();

        expect(tabB.client.status).toBe("follower");
        expect(await tabB.client.call("echo", {value: "from-b"})).toMatchObject({
            servedBy: "a-worker-0",
        });
    });

    test("calls made before the connection is up are queued and flushed", async () => {
        const harness = createTestHarness();
        const tabA = harness.createClient("a");

        const result = await tabA.client.call("echo", {value: "early"});

        expect(result).toMatchObject({value: "early", servedBy: "a-worker-0"});
    });

    test("worker-to-tab pushes reach the calling tab\u2019s handlers", async () => {
        const harness = createTestHarness();
        harness.createClient("a");
        const tabB = harness.createClient("b");

        await tabB.client.call("echo", {value: "ping"});
        await settleUniqueWorkerTest();

        expect(tabB.notifications).toEqual(["echoed:ping"]);
    });

    test("a follower connect queues at the broker until the leader is ready", async () => {
        const harness = createTestHarness();
        let releaseWorker!: () => void;
        const workerGate = new Promise<void>(resolve => {
            releaseWorker = resolve;
        });

        // Tab A wins the election but its worker only comes up once the gate opens; tab
        // B's connect request must wait at the broker meanwhile.
        const tabA = harness.createClient("a", {workerGate});
        const tabB = harness.createClient("b");
        const pendingCall = tabB.client.call("echo", {value: "queued"});
        await settleUniqueWorkerTest();
        expect(tabB.client.status).toBe("connecting-follower");

        releaseWorker();

        expect(await pendingCall).toMatchObject({servedBy: "a-worker-0"});
        expect(tabA.client.status).toBe("leader");
        expect(tabB.client.status).toBe("follower");
    });

    test("when the leader tab dies its follower promotes and spawns a new worker", async () => {
        const harness = createTestHarness();
        const tabA = harness.createClient("a");
        const tabB = harness.createClient("b");
        await tabA.client.whenConnected();
        await tabB.client.whenConnected();

        harness.crashLeaderTab();
        await settleUniqueWorkerTest();

        expect(tabB.client.status).toBe("leader");
        expect(await tabB.client.call("echo", {value: "hi"})).toMatchObject({
            servedBy: "b-worker-0",
        });
    });

    test("with two followers, the non-promoted one reconnects to the new leader", async () => {
        const harness = createTestHarness();
        const tabA = harness.createClient("a");
        const tabB = harness.createClient("b");
        const tabC = harness.createClient("c");
        await tabA.client.whenConnected();
        await tabB.client.whenConnected();
        await tabC.client.whenConnected();

        harness.crashLeaderTab();
        await settleUniqueWorkerTest();

        // B waited on the election lock first, so it promotes; C follows it.
        expect(tabB.client.status).toBe("leader");
        expect(tabC.client.status).toBe("follower");
        expect(await tabC.client.call("echo", {value: "hi"})).toMatchObject({
            servedBy: "b-worker-0",
        });
    });

    test("in-flight calls reject on leader death; calls made during failover flush after", async () => {
        const harness = createTestHarness();
        let releaseWorker!: () => void;
        const workerGate = new Promise<void>(resolve => {
            releaseWorker = resolve;
        });
        const tabA = harness.createClient("a");
        // B's own worker starts gated, so after A dies B sits in "starting-leader" until
        // we open the gate.
        const tabB = harness.createClient("b", {workerGate});
        await tabA.client.whenConnected();
        await tabB.client.whenConnected();
        const inflight = tabB.client.call("hang", {});

        harness.crashLeaderTab();
        await expect(inflight).rejects.toThrow("Unique worker leader changed");

        // B noticed the death and is promoting; new calls queue until its worker is up,
        // then flush. They are never sent to the dead worker.
        expect(tabB.client.status).toBe("starting-leader");
        const duringFailover = tabB.client.call("echo", {value: "later"});
        releaseWorker();
        expect(await duringFailover).toMatchObject({servedBy: "b-worker-0"});
    });

    test("graceful close of the leader client hands leadership to a follower", async () => {
        const harness = createTestHarness();
        const tabA = harness.createClient("a");
        const tabB = harness.createClient("b");
        await tabA.client.whenConnected();
        await tabB.client.whenConnected();

        tabA.client.close();
        await settleUniqueWorkerTest();

        expect(tabA.client.status).toBe("closed");
        expect(tabB.client.status).toBe("leader");
        await expect(tabA.client.call("echo", {value: "x"})).rejects.toThrow(
            "Unique worker client closed",
        );
    });

    test("a follower closing gracefully removes its connection from the host", async () => {
        const harness = createTestHarness();
        const tabA = harness.createClient("a");
        const tabB = harness.createClient("b");
        await tabA.client.whenConnected();
        await tabB.client.whenConnected();
        await settleUniqueWorkerTest();
        const host = harness.hostsByTag.get("a-worker-0")!;
        expect(host.connections).toHaveLength(2);

        tabB.client.close();
        await settleUniqueWorkerTest();

        expect(host.connections).toHaveLength(1);
    });

    test("onReconnect runs after reconnecting, before queued calls flush", async () => {
        const harness = createTestHarness();
        const events: Array<string> = [];
        let releaseWorker!: () => void;
        const workerGate = new Promise<void>(resolve => {
            releaseWorker = resolve;
        });
        const tabA = harness.createClient("a");
        const tabB = harness.createClient("b", {workerGate});
        const tabC = harness.createClient("c", {
            onReconnect: async () => {
                events.push("hook-start");
                await Promise.resolve();
                events.push("hook-end");
            },
        });
        await tabB.client.whenConnected();
        await tabC.client.whenConnected();

        // The leader closes gracefully; C hears leader-lost right away and waits as
        // "connecting-follower" while B's replacement worker is still gated.
        tabA.client.close();
        await settleUniqueWorkerTest();
        expect(tabC.client.status).toBe("connecting-follower");
        const queued = tabC.client.call("echo", {value: "x"}).then(() => {
            events.push("queued-call-done");
        });
        releaseWorker();
        await queued;

        expect(events).toEqual(["hook-start", "hook-end", "queued-call-done"]);
    });

    test("onReconnect does not run on initial connection", async () => {
        const harness = createTestHarness();
        let reconnects = 0;
        const tabA = harness.createClient("a", {
            onReconnect: () => {
                reconnects++;
            },
        });

        await tabA.client.whenConnected();

        expect(reconnects).toBe(0);
    });

    test("worker startup failure fails the client and frees the lock for other tabs", async () => {
        const harness = createTestHarness();
        const failures: Array<Error> = [];
        const tabA = harness.createClient("a", {
            onFailed: error => failures.push(error),
            workerScript: {
                handleMessage: () => {
                    throw new UnknownError("worker exploded on startup");
                },
            },
        });

        await expect(tabA.client.whenConnected()).rejects.toThrow("worker exploded on startup");
        expect(tabA.client.status).toBe("failed");
        expect(failures).toHaveLength(1);
        await expect(tabA.client.call("echo", {value: "x"})).rejects.toThrow(
            "worker exploded on startup",
        );

        // The lock was released, so a fresh tab can lead.
        const tabB = harness.createClient("b");
        await tabB.client.whenConnected();
        expect(tabB.client.status).toBe("leader");
    });

    test("closing while still connecting rejects queued calls and abandons the election", async () => {
        const harness = createTestHarness();
        const tabA = harness.createClient("a");
        const pending = tabA.client.call("echo", {value: "x"});

        expect(tabA.client.status).toBe("connecting-follower");
        tabA.client.close();

        await expect(pending).rejects.toThrow("Unique worker client closed");
        await settleUniqueWorkerTest();

        const tabB = harness.createClient("b");
        await tabB.client.whenConnected();
        expect(tabB.client.status).toBe("leader");
    });

    test("two clients for different keys coexist independently", async () => {
        const harness = createTestHarness();
        const first = harness.createClient("one", {key: "key-one"});
        const second = harness.createClient("two", {key: "key-two"});

        expect(await first.client.call("echo", {value: "1"})).toMatchObject({
            servedBy: "one-worker-0",
        });
        expect(await second.client.call("echo", {value: "2"})).toMatchObject({
            servedBy: "two-worker-0",
        });
    });
});
