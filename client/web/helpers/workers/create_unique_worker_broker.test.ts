import {
    createUniqueWorkerBroker,
    uniqueWorkerBrokerGenerationLockName,
} from "~/client/web/helpers/workers/create_unique_worker_broker.js";
import {installUniqueWorkerTestMocks} from "~/client/web/helpers/workers/test_helpers/install_unique_worker_test_mocks.js";
import {settleUniqueWorkerTest} from "~/client/web/helpers/workers/test_helpers/settle_unique_worker_test.js";

// Message-level tests for the broker. Full multi-tab behavior is covered by
// `unique_worker_client.test.ts`; these pin down the broker's own contract. The
// mocked globals provide `navigator.locks` (client liveness) and `MessageChannel`.

function createTestBroker() {
    installUniqueWorkerTestMocks();
    const broker = createUniqueWorkerBroker();

    let nextTab = 0;
    async function connectTab() {
        const {port1, port2} = new MessageChannel();
        const received: Array<MessageEvent> = [];
        port1.onmessage = event => {
            received.push(event);
        };
        broker.handleConnect(port2);

        // Hold this tab's lifetime lock (like a real tab), then say hello. The broker
        // watches the lock; releasing it simulates the tab dying.
        const clientLockName = `client-${nextTab++}`;
        const die = await new Promise<() => void>(resolve => {
            void navigator.locks.request(
                clientLockName,
                () =>
                    new Promise<void>(release => {
                        resolve(release);
                    }),
            );
        });
        port1.postMessage({type: "unique-worker:hello", clientLockName});
        await settleUniqueWorkerTest();
        return {port: port1, received, die};
    }

    return {broker, connectTab};
}

function receivedTypes(received: Array<MessageEvent>): Array<string> {
    return received.map(event => (event.data as {type: string}).type);
}

describe("createUniqueWorkerBroker", () => {
    test("queues connects until a leader registers, then forwards them all", async () => {
        const broker = createTestBroker();
        const leader = await broker.connectTab();
        const follower = await broker.connectTab();

        const {port2: followerPort} = new MessageChannel();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [followerPort]);
        await settleUniqueWorkerTest();
        expect(leader.received).toHaveLength(0);

        leader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        expect(receivedTypes(leader.received)).toEqual(["unique-worker:connect-request"]);
        expect(leader.received[0]!.ports).toEqual([followerPort]);
    });

    test("forwards connects directly once a leader is registered", async () => {
        const broker = createTestBroker();
        const leader = await broker.connectTab();
        const follower = await broker.connectTab();
        leader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        const {port2: followerPort} = new MessageChannel();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [followerPort]);
        await settleUniqueWorkerTest();

        expect(receivedTypes(leader.received)).toEqual(["unique-worker:connect-request"]);
    });

    test("unregister broadcasts leader-lost to everyone except the leaving leader", async () => {
        const broker = createTestBroker();
        const leader = await broker.connectTab();
        const follower = await broker.connectTab();
        leader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        leader.port.postMessage({type: "unique-worker:unregister-leader", key: "k"});
        await settleUniqueWorkerTest();

        expect(receivedTypes(follower.received)).toEqual(["unique-worker:leader-lost"]);
        expect(leader.received).toHaveLength(0);
    });

    test("client death clears its leadership and broadcasts leader-lost", async () => {
        const broker = createTestBroker();
        const leader = await broker.connectTab();
        const follower = await broker.connectTab();
        leader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        leader.die();
        await settleUniqueWorkerTest();

        expect(receivedTypes(follower.received)).toEqual(["unique-worker:leader-lost"]);
    });

    test("registering over a stale leader notifies its followers to reconnect", async () => {
        const broker = createTestBroker();
        const staleLeader = await broker.connectTab();
        const follower = await broker.connectTab();
        const newLeader = await broker.connectTab();
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
        const oldLeader = await broker.connectTab();
        const newLeader = await broker.connectTab();
        const follower = await broker.connectTab();
        oldLeader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        newLeader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        oldLeader.port.postMessage({type: "unique-worker:unregister-leader", key: "k"});
        const {port2: followerPort} = new MessageChannel();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [followerPort]);
        await settleUniqueWorkerTest();

        // The connect still reaches the new leader; no extra leader-lost beyond the one
        // from the replacement itself.
        expect(receivedTypes(newLeader.received)).toEqual(["unique-worker:connect-request"]);
    });

    test("registering drops the new leader\u2019s own queued connect", async () => {
        const broker = createTestBroker();
        const tab = await broker.connectTab();
        const {port2: ownPort} = new MessageChannel();
        tab.port.postMessage({type: "unique-worker:connect", key: "k"}, [ownPort]);
        await settleUniqueWorkerTest();

        tab.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        // The tab's own pre-election connect is not relayed back into its own worker.
        expect(tab.received).toHaveLength(0);
    });

    test("a client\u2019s new connect supersedes its earlier queued connect", async () => {
        const broker = createTestBroker();
        const follower = await broker.connectTab();
        const lateLeader = await broker.connectTab();

        const {port2: staleConnectPort} = new MessageChannel();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [staleConnectPort]);
        const {port2: freshConnectPort} = new MessageChannel();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [freshConnectPort]);
        await settleUniqueWorkerTest();

        lateLeader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        expect(receivedTypes(lateLeader.received)).toEqual(["unique-worker:connect-request"]);
        expect(lateLeader.received[0]!.ports).toEqual([freshConnectPort]);
    });

    test("pending connects from a dead client are dropped", async () => {
        const broker = createTestBroker();
        const follower = await broker.connectTab();
        const lateLeader = await broker.connectTab();

        const {port2: followerPort} = new MessageChannel();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [followerPort]);
        await settleUniqueWorkerTest();
        // Let the broker detect the death (lock release) before a leader shows up.
        follower.die();
        await settleUniqueWorkerTest();
        lateLeader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        expect(lateLeader.received).toHaveLength(0);
    });

    test("losing the generation lock to a newer broker tells all clients they are outdated", async () => {
        const broker = createTestBroker();
        const tabA = await broker.connectTab();
        const tabB = await broker.connectTab();

        // A broker from a newer app version starts and steals the generation lock.
        void navigator.locks.request(
            uniqueWorkerBrokerGenerationLockName,
            {steal: true},
            () => new Promise(() => {}),
        );
        await settleUniqueWorkerTest();

        expect(receivedTypes(tabA.received)).toEqual(["unique-worker:outdated"]);
        expect(receivedTypes(tabB.received)).toEqual(["unique-worker:outdated"]);
    });

    test("clients connecting to an already-superseded broker are told immediately", async () => {
        const broker = createTestBroker();
        void navigator.locks.request(
            uniqueWorkerBrokerGenerationLockName,
            {steal: true},
            () => new Promise(() => {}),
        );
        await settleUniqueWorkerTest();

        const lateTab = await broker.connectTab();

        expect(receivedTypes(lateTab.received)).toEqual(["unique-worker:outdated"]);
    });

    test("messages before hello are ignored", async () => {
        const broker = createTestBroker();
        const {port1: prematurePort, port2: brokerSide} = new MessageChannel();
        broker.broker.handleConnect(brokerSide);
        prematurePort.onmessage = () => {};
        prematurePort.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        // The pre-hello register must not have taken: a proper tab's connect still queues
        // (nothing is forwarded to the premature port), and a proper leader registration
        // then receives it.
        const follower = await broker.connectTab();
        const leader = await broker.connectTab();
        const {port2: followerPort} = new MessageChannel();
        follower.port.postMessage({type: "unique-worker:connect", key: "k"}, [followerPort]);
        await settleUniqueWorkerTest();

        leader.port.postMessage({type: "unique-worker:register-leader", key: "k"});
        await settleUniqueWorkerTest();

        expect(receivedTypes(leader.received)).toEqual(["unique-worker:connect-request"]);
    });
});
