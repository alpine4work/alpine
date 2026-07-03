import {UniqueWorkerClient} from "~/client/web/helpers/workers/unique_worker_client.js";
import {UniqueWorkerHost} from "~/client/web/helpers/workers/unique_worker_host.js";
import {
    UniqueWorkerTestEnvironment,
    UniqueWorkerTestWorker,
    createUniqueWorkerTestEnvironment,
    settleUniqueWorkerTest,
} from "~/client/web/helpers/workers/unique_worker_test_env.js";
import {defineWebWorkerRpcMethods} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {UnknownError} from "~/shared/error/error.js";
import {Schema} from "~/shared/schema/schema.js";

// These tests run the full multi-tab dance — client, real broker logic, and real
// host — on top of the fake environment, so every scenario covers the whole system
// rather than the client in isolation.

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

function createTestWorker(tag: string, hosts: Array<TestHost>): UniqueWorkerTestWorker {
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
    hosts.push(host);
    return {handleMessage: (data, ports) => host.handleMessage(data, ports)};
}

function createTestClient(
    env: UniqueWorkerTestEnvironment,
    name: string,
    options: {
        onReconnect?: () => Promise<void> | void;
        onFailed?: (error: Error) => void;
        createWorker?: () => UniqueWorkerTestWorker;
        /** Delays every spawned worker's startup until the promise resolves. */
        workerGate?: Promise<void>;
    } = {},
) {
    const tab = env.createTab();
    const hosts: Array<TestHost> = [];
    const notifications: Array<string> = [];
    let workerCount = 0;

    function createDefaultWorker(): UniqueWorkerTestWorker {
        const worker = createTestWorker(`${name}-worker-${workerCount++}`, hosts);
        const gate = options.workerGate;
        if (gate === undefined) return worker;
        return {
            handleMessage(data, ports) {
                void gate.then(() => worker.handleMessage(data, ports));
            },
        };
    }

    const runtime = tab.createRuntime({
        createWorker: options.createWorker ?? createDefaultWorker,
    });

    const client = new UniqueWorkerClient({
        key: "test-worker",
        runtime,
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

    return {tab, client, hosts, notifications};
}

describe("UniqueWorkerClient", () => {
    test("a single tab becomes leader and calls its own worker", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const tabA = createTestClient(env, "a");

        await tabA.client.whenConnected();

        expect(tabA.client.status).toBe("leader");
        expect(await tabA.client.call("echo", {value: "hi"})).toEqual({
            value: "hi",
            servedBy: "a-worker-0",
        });
    });

    test("a second tab attaches as follower and reaches the leader\u2019s worker", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const tabA = createTestClient(env, "a");
        const tabB = createTestClient(env, "b");
        await tabA.client.whenConnected();
        await tabB.client.whenConnected();

        expect(tabB.client.status).toBe("follower");
        expect(await tabB.client.call("echo", {value: "from-b"})).toMatchObject({
            servedBy: "a-worker-0",
        });
    });

    test("calls made before the connection is up are queued and flushed", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const tabA = createTestClient(env, "a");

        const result = await tabA.client.call("echo", {value: "early"});

        expect(result).toMatchObject({value: "early", servedBy: "a-worker-0"});
    });

    test("worker-to-tab pushes reach the calling tab\u2019s handlers", async () => {
        const env = createUniqueWorkerTestEnvironment();
        createTestClient(env, "a");
        const tabB = createTestClient(env, "b");

        await tabB.client.call("echo", {value: "ping"});
        await settleUniqueWorkerTest();

        expect(tabB.notifications).toEqual(["echoed:ping"]);
    });

    test("a follower connect queues at the broker until the leader is ready", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const hosts: Array<TestHost> = [];
        let releaseWorker!: () => void;
        const gate = new Promise<void>(resolve => {
            releaseWorker = resolve;
        });

        // Tab A wins the election but its worker only comes up once the gate opens; tab
        // B's connect request must wait at the broker meanwhile.
        const tabA = createTestClient(env, "a", {
            createWorker: () => {
                const worker = createTestWorker("a-slow-worker", hosts);
                return {
                    handleMessage(data, ports) {
                        void gate.then(() => worker.handleMessage(data, ports));
                    },
                };
            },
        });
        const tabB = createTestClient(env, "b");
        const pendingCall = tabB.client.call("echo", {value: "queued"});
        await settleUniqueWorkerTest();
        expect(tabB.client.status).toBe("connecting-follower");

        releaseWorker();

        expect(await pendingCall).toMatchObject({servedBy: "a-slow-worker"});
        expect(tabA.client.status).toBe("leader");
        expect(tabB.client.status).toBe("follower");
    });

    test("when the leader tab dies its follower promotes and spawns a new worker", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const tabA = createTestClient(env, "a");
        const tabB = createTestClient(env, "b");
        await tabB.client.whenConnected();

        tabA.tab.kill();
        await settleUniqueWorkerTest();

        expect(tabB.client.status).toBe("leader");
        expect(await tabB.client.call("echo", {value: "hi"})).toMatchObject({
            servedBy: "b-worker-0",
        });
    });

    test("with two followers, the non-promoted one reconnects to the new leader", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const tabA = createTestClient(env, "a");
        const tabB = createTestClient(env, "b");
        const tabC = createTestClient(env, "c");
        await tabB.client.whenConnected();
        await tabC.client.whenConnected();

        tabA.tab.kill();
        await settleUniqueWorkerTest();

        // B waited on the failover lock first, so it promotes; C follows it.
        expect(tabB.client.status).toBe("leader");
        expect(tabC.client.status).toBe("follower");
        expect(await tabC.client.call("echo", {value: "hi"})).toMatchObject({
            servedBy: "b-worker-0",
        });
    });

    test("in-flight calls reject on leader death; calls made during failover flush after", async () => {
        const env = createUniqueWorkerTestEnvironment();
        let releaseWorker!: () => void;
        const workerGate = new Promise<void>(resolve => {
            releaseWorker = resolve;
        });
        const tabA = createTestClient(env, "a");
        // B's own worker starts gated, so after A dies B sits in "starting-leader" until
        // we open the gate.
        const tabB = createTestClient(env, "b", {workerGate});
        await tabB.client.whenConnected();
        const inflight = tabB.client.call("hang", {});

        tabA.tab.kill();
        await expect(inflight).rejects.toThrow("Unique worker leader changed");

        // B noticed the death and is promoting; new calls queue until its worker is up,
        // then flush. They are never sent to the dead worker.
        expect(tabB.client.status).toBe("starting-leader");
        const duringFailover = tabB.client.call("echo", {value: "later"});
        releaseWorker();
        expect(await duringFailover).toMatchObject({servedBy: "b-worker-0"});
    });

    test("graceful close of the leader client hands leadership to a follower", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const tabA = createTestClient(env, "a");
        const tabB = createTestClient(env, "b");
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
        const env = createUniqueWorkerTestEnvironment();
        const tabA = createTestClient(env, "a");
        const tabB = createTestClient(env, "b");
        await tabB.client.whenConnected();
        await settleUniqueWorkerTest();
        expect(tabA.hosts[0]!.connections).toHaveLength(2);

        tabB.client.close();
        await settleUniqueWorkerTest();

        expect(tabA.hosts[0]!.connections).toHaveLength(1);
    });

    test("onReconnect runs after reconnecting, before queued calls flush", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const events: Array<string> = [];
        let releaseWorker!: () => void;
        const workerGate = new Promise<void>(resolve => {
            releaseWorker = resolve;
        });
        const tabA = createTestClient(env, "a");
        const tabB = createTestClient(env, "b", {workerGate});
        const tabC = createTestClient(env, "c", {
            onReconnect: async () => {
                events.push("hook-start");
                await Promise.resolve();
                events.push("hook-end");
            },
        });
        await tabB.client.whenConnected();
        await tabC.client.whenConnected();

        tabA.tab.kill();
        // Let C notice the leader is gone (it moves to "connecting-follower" while B's
        // replacement worker is still gated), then queue a call.
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
        const env = createUniqueWorkerTestEnvironment();
        let reconnects = 0;
        const tabA = createTestClient(env, "a", {
            onReconnect: () => {
                reconnects++;
            },
        });

        await tabA.client.whenConnected();

        expect(reconnects).toBe(0);
    });

    test("worker startup failure fails the client and frees the lock for other tabs", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const failures: Array<Error> = [];
        const tabA = createTestClient(env, "a", {
            onFailed: error => failures.push(error),
            createWorker: () => ({
                handleMessage: () => {
                    throw new UnknownError("worker exploded on startup");
                },
            }),
        });

        await expect(tabA.client.whenConnected()).rejects.toThrow("worker exploded on startup");
        expect(tabA.client.status).toBe("failed");
        expect(failures).toHaveLength(1);
        await expect(tabA.client.call("echo", {value: "x"})).rejects.toThrow(
            "worker exploded on startup",
        );

        // The lock was released, so a fresh tab can lead.
        const tabB = createTestClient(env, "b");
        await tabB.client.whenConnected();
        expect(tabB.client.status).toBe("leader");
    });

    test("closing while still electing rejects queued calls and holds no lock", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const tabA = createTestClient(env, "a");
        const pending = tabA.client.call("echo", {value: "x"});

        tabA.client.close();

        await expect(pending).rejects.toThrow("Unique worker client closed");
        await settleUniqueWorkerTest();

        const tabB = createTestClient(env, "b");
        await tabB.client.whenConnected();
        expect(tabB.client.status).toBe("leader");
    });

    test("two clients for different keys coexist independently", async () => {
        const env = createUniqueWorkerTestEnvironment();
        const tab = env.createTab();
        const hosts: Array<TestHost> = [];

        function createClient(key: string, tag: string) {
            return new UniqueWorkerClient({
                key,
                runtime: tab.createRuntime({createWorker: () => createTestWorker(tag, hosts)}),
                workerMethods: testWorkerMethods,
                tabMethods: testTabMethods,
                handlers: {notify: async () => ({})},
            });
        }
        const first = createClient("key-one", "worker-one");
        const second = createClient("key-two", "worker-two");

        expect(await first.call("echo", {value: "1"})).toMatchObject({servedBy: "worker-one"});
        expect(await second.call("echo", {value: "2"})).toMatchObject({servedBy: "worker-two"});
    });
});
