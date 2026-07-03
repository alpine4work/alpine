import {createUniqueWorkerBroker} from "~/client/web/helpers/workers/create_unique_worker_broker.js";
import {
    createUniqueWorkerTestPortPair,
    settleUniqueWorkerTest,
} from "~/client/web/helpers/workers/unique_worker_test_env.js";

// Message-level tests for the broker. Full multi-tab behavior is covered by
// `unique_worker_client.test.ts`; these pin down the broker's own contract.

function createTestBroker() {
    const gones = new Map<string, () => void>();
    const broker = createUniqueWorkerBroker({
        watchClientGone(clientLockName, onGone) {
            gones.set(clientLockName, onGone);
        },
    });

    let nextTab = 0;
    function connectTab() {
        const [tabPort, brokerPort] = createUniqueWorkerTestPortPair();
        const received: Array<{data: unknown; ports: ReadonlyArray<unknown>}> = [];
        tabPort.onmessage = event => {
            received.push(event as {data: unknown; ports: ReadonlyArray<unknown>});
        };
        broker.handleConnect(brokerPort);
        const clientLockName = `client-${nextTab++}`;
        tabPort.postMessage({type: "unique-worker:hello", clientLockName});
        return {
            port: tabPort,
            received,
            die: () => gones.get(clientLockName)!(),
        };
    }

    return {connectTab};
}

function receivedTypes(received: Array<{data: unknown}>): Array<string> {
    return received.map(event => (event.data as {type: string}).type);
}

describe("createUniqueWorkerBroker", () => {
    test("queues connects until a leader registers, then forwards them all", async () => {
        const broker = createTestBroker();
        const leader = broker.connectTab();
        const follower = broker.connectTab();
        await settleUniqueWorkerTest();

        const [followerPort] = createUniqueWorkerTestPortPair();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [followerPort]);
        await settleUniqueWorkerTest();
        expect(leader.received).toHaveLength(0);

        leader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        expect(leader.received).toMatchObject([
            {data: {type: "unique-worker:connect-request", key: "k"}, ports: [followerPort]},
        ]);
    });

    test("forwards connects directly once a leader is registered", async () => {
        const broker = createTestBroker();
        const leader = broker.connectTab();
        const follower = broker.connectTab();
        leader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        const [followerPort] = createUniqueWorkerTestPortPair();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [followerPort]);
        await settleUniqueWorkerTest();

        expect(receivedTypes(leader.received)).toEqual(["unique-worker:connect-request"]);
    });

    test("unregister broadcasts leader-lost to everyone except the leaving leader", async () => {
        const broker = createTestBroker();
        const leader = broker.connectTab();
        const follower = broker.connectTab();
        leader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        leader.port.postMessage({type: "unique-worker:unregister-leader", key: "k"});
        await settleUniqueWorkerTest();

        expect(receivedTypes(follower.received)).toEqual(["unique-worker:leader-lost"]);
        expect(leader.received).toHaveLength(0);
    });

    test("client death clears its leadership and broadcasts leader-lost", async () => {
        const broker = createTestBroker();
        const leader = broker.connectTab();
        const follower = broker.connectTab();
        leader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        leader.die();
        await settleUniqueWorkerTest();

        expect(receivedTypes(follower.received)).toEqual(["unique-worker:leader-lost"]);
    });

    test("registering over a stale leader notifies its followers to reconnect", async () => {
        const broker = createTestBroker();
        const staleLeader = broker.connectTab();
        const follower = broker.connectTab();
        const newLeader = broker.connectTab();
        staleLeader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        // The stale leader died but the broker hasn't detected it yet when the new leader
        // registers.
        newLeader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        expect(receivedTypes(follower.received)).toEqual(["unique-worker:leader-lost"]);
        expect(newLeader.received).toHaveLength(0);
    });

    test("a stale unregister from a replaced leader does not unseat the new leader", async () => {
        const broker = createTestBroker();
        const oldLeader = broker.connectTab();
        const newLeader = broker.connectTab();
        const follower = broker.connectTab();
        oldLeader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        newLeader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        oldLeader.port.postMessage({type: "unique-worker:unregister-leader", key: "k"});
        const [followerPort] = createUniqueWorkerTestPortPair();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [followerPort]);
        await settleUniqueWorkerTest();

        // The connect still reaches the new leader; no extra leader-lost beyond the one
        // from the replacement itself.
        expect(receivedTypes(newLeader.received)).toEqual(["unique-worker:connect-request"]);
    });

    test("pending connects from a dead client are dropped", async () => {
        const broker = createTestBroker();
        const follower = broker.connectTab();
        const lateLeader = broker.connectTab();
        await settleUniqueWorkerTest();

        const [followerPort] = createUniqueWorkerTestPortPair();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [followerPort]);
        await settleUniqueWorkerTest();
        follower.die();
        lateLeader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        expect(lateLeader.received).toHaveLength(0);
    });

    test("messages before hello are ignored", async () => {
        const gones = new Map<string, () => void>();
        const broker = createUniqueWorkerBroker({
            watchClientGone(clientLockName, onGone) {
                gones.set(clientLockName, onGone);
            },
        });
        const [tabPort, brokerPort] = createUniqueWorkerTestPortPair();
        broker.handleConnect(brokerPort);

        tabPort.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        // No hello was sent, so the broker must not have registered leadership: a hello'd
        // tab registering afterwards must win the key unchallenged.
        tabPort.postMessage({type: "unique-worker:hello", clientLockName: "late"});
        tabPort.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();
        expect(gones.has("late")).toBe(true);
    });
});
