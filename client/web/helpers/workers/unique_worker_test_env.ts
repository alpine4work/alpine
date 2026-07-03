import {createUniqueWorkerBroker} from "~/client/web/helpers/workers/create_unique_worker_broker.js";
import {createUniqueWorkerBrokerTabConnection} from "~/client/web/helpers/workers/create_unique_worker_broker_tab_connection.js";
import {
    UniqueWorkerHandle,
    UniqueWorkerLockHold,
    UniqueWorkerTabRuntime,
} from "~/client/web/helpers/workers/unique_worker_client.js";
import {UniqueWorkerHostPort} from "~/client/web/helpers/workers/unique_worker_host.js";
import {UnknownError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";

// Test-only in-memory simulation of the browser pieces the unique worker system
// runs on: Web Locks, MessagePorts, dedicated workers, and the broker SharedWorker
// (which runs the real broker logic). Supports multiple simulated tabs and abrupt
// tab death, so the full election/failover dance can be tested in Jest.

/** The worker-side entry the test provides per spawned fake worker. */
export interface UniqueWorkerTestWorker {
    handleMessage(data: unknown, ports: ReadonlyArray<UniqueWorkerHostPort>): void;
}

export interface UniqueWorkerTestTab {
    /** Simulate abrupt tab death: locks release, ports go dead, workers die. */
    kill(): void;
    createRuntime(options: {createWorker(): UniqueWorkerTestWorker}): UniqueWorkerTabRuntime;
}

export interface UniqueWorkerTestEnvironment {
    createTab(): UniqueWorkerTestTab;
}

/** Wait for all in-flight fake message deliveries and lock grants to settle. */
export async function settleUniqueWorkerTest(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise<void>(resolve => {
            setTimeout(resolve, 0);
        });
    }
}

// -- Fake ports ---------------------------------------------------------------

// The event delivered to handlers always carries `ports`, but `onmessage` is
// declared with the narrow `{data}` shape so the fake is assignable to every port
// interface in the system (richer handlers still receive their ports).
interface UniqueWorkerTestPortEvent {
    data: unknown;
    ports: ReadonlyArray<unknown>;
}

export interface UniqueWorkerTestPort {
    postMessage(data: unknown, transfer?: ReadonlyArray<unknown>): void;
    onmessage: ((event: {data: unknown}) => void) | null;
    onclose: (() => void) | null;
    start(): void;
    close(): void;
    /** Stop sending and receiving, without firing the peer's `onclose`. */
    disable(): void;
}

interface UniqueWorkerTestPortInternal extends UniqueWorkerTestPort {
    deliver(event: UniqueWorkerTestPortEvent): void;
    firePeerClose(): void;
}

// Mimics the real MessagePort semantics the system relies on: delivery is async,
// messages buffer until a handler is attached, and `close()` fires the peer's
// `onclose`.
export function createUniqueWorkerTestPortPair(): [UniqueWorkerTestPort, UniqueWorkerTestPort] {
    function createEnd(getPeer: () => UniqueWorkerTestPortInternal): UniqueWorkerTestPortInternal {
        let handler: ((event: {data: unknown}) => void) | null = null;
        let dead = false;
        const buffered: Array<UniqueWorkerTestPortEvent> = [];

        const end: UniqueWorkerTestPortInternal = {
            onclose: null,
            get onmessage() {
                return handler;
            },
            set onmessage(newHandler: ((event: {data: unknown}) => void) | null) {
                handler = newHandler;
                if (handler !== null && buffered.length > 0) {
                    const pending = buffered.splice(0);
                    queueMicrotask(() => {
                        for (const event of pending) {
                            if (!dead) handler?.(event);
                        }
                    });
                }
            },
            postMessage(data: unknown, transfer: ReadonlyArray<unknown> = []) {
                if (dead) return;
                const event: UniqueWorkerTestPortEvent = {data, ports: transfer};
                queueMicrotask(() => getPeer().deliver(event));
            },
            deliver(event: UniqueWorkerTestPortEvent) {
                if (dead) return;
                if (handler === null) {
                    buffered.push(event);
                } else {
                    handler(event);
                }
            },
            firePeerClose() {
                queueMicrotask(() => getPeer().onclose?.());
            },
            start() {},
            close() {
                if (dead) return;
                dead = true;
                end.firePeerClose();
            },
            disable() {
                dead = true;
            },
        };
        return end;
    }

    const ends: {a?: UniqueWorkerTestPortInternal; b?: UniqueWorkerTestPortInternal} = {};
    ends.a = createEnd(() => ends.b!);
    ends.b = createEnd(() => ends.a!);
    return [ends.a, ends.b];
}

// -- Fake lock manager ----------------------------------------------------------

interface UniqueWorkerFakeLockWaiter {
    readonly owner: object;
    resolve(hold: UniqueWorkerLockHold | null): void;
    removed: boolean;
}

class UniqueWorkerFakeLockManager {
    private readonly heldBy = new Map<string, object>();
    private readonly waiters = new Map<string, Array<UniqueWorkerFakeLockWaiter>>();

    acquire(
        name: string,
        owner: object,
        options: {ifAvailable?: boolean; signal?: AbortSignal} = {},
    ): Promise<UniqueWorkerLockHold | null> {
        const result = createPromiseResolver<UniqueWorkerLockHold | null>();

        if (!this.heldBy.has(name)) {
            this.grant(name, owner, result.resolve);
        } else if (options.ifAvailable) {
            queueMicrotask(() => result.resolve(null));
        } else {
            const waiter: UniqueWorkerFakeLockWaiter = {
                owner,
                resolve: result.resolve,
                removed: false,
            };
            let queue = this.waiters.get(name);
            if (queue === undefined) {
                queue = [];
                this.waiters.set(name, queue);
            }
            queue.push(waiter);
            options.signal?.addEventListener("abort", () => {
                waiter.removed = true;
                result.resolve(null);
            });
        }

        return result.promise;
    }

    /** Simulate the owner dying: releases held locks, abandons pending waits. */
    releaseAllForOwner(owner: object): void {
        for (const queue of this.waiters.values()) {
            for (const waiter of queue) {
                if (waiter.owner === owner) waiter.removed = true;
            }
        }
        for (const [name, heldOwner] of this.heldBy) {
            if (heldOwner === owner) this.release(name);
        }
    }

    private grant(
        name: string,
        owner: object,
        resolve: (hold: UniqueWorkerLockHold | null) => void,
    ): void {
        this.heldBy.set(name, owner);
        let released = false;
        queueMicrotask(() =>
            resolve({
                release: () => {
                    if (released) return;
                    released = true;
                    this.release(name);
                },
            }),
        );
    }

    private release(name: string): void {
        this.heldBy.delete(name);
        const queue = this.waiters.get(name);
        while (queue !== undefined && queue.length > 0) {
            const waiter = queue.shift()!;
            if (waiter.removed) continue;
            this.grant(name, waiter.owner, waiter.resolve);
            return;
        }
    }
}

// -- Environment ----------------------------------------------------------------

let nextUniqueWorkerTestClientId = 0;

/**
 * Creates an isolated fake browser environment with a running (real) broker. Each
 * {@link UniqueWorkerTestTab} simulates one tab; `kill()` simulates the tab dying
 * abruptly, which releases its Web Locks (as browsers do) and silences all its
 * ports and workers.
 */
export function createUniqueWorkerTestEnvironment(): UniqueWorkerTestEnvironment {
    const locks = new UniqueWorkerFakeLockManager();
    const brokerOwner = {};
    const broker = createUniqueWorkerBroker({
        watchClientGone(clientLockName, onGone) {
            void locks.acquire(clientLockName, brokerOwner).then(() => onGone());
        },
    });

    function createTab(): UniqueWorkerTestTab {
        const tabOwner = {};
        const tabPorts: Array<UniqueWorkerTestPort> = [];
        const tabWorkers: Array<{terminate(): void}> = [];
        let tabDead = false;

        const [tabBrokerPort, brokerSidePort] = createUniqueWorkerTestPortPair();
        tabPorts.push(tabBrokerPort);
        broker.handleConnect(brokerSidePort);

        const brokerConnection = createUniqueWorkerBrokerTabConnection({
            port: tabBrokerPort,
            clientLockName: `unique-worker-test-client:${nextUniqueWorkerTestClientId++}`,
            holdClientLock: async clientLockName => {
                await locks.acquire(clientLockName, tabOwner);
            },
        });

        function createRuntime(options: {
            createWorker(): UniqueWorkerTestWorker;
        }): UniqueWorkerTabRuntime {
            return {
                tryAcquireLock: name =>
                    tabDead
                        ? new Promise<never>(() => {})
                        : locks.acquire(name, tabOwner, {ifAvailable: true}),
                waitForLock: (name, signal) =>
                    tabDead
                        ? new Promise<never>(() => {})
                        : locks.acquire(name, tabOwner, {signal}),
                broker: brokerConnection,
                createWorker: () => {
                    const worker = options.createWorker();
                    const workerPorts: Array<UniqueWorkerTestPort> = [];
                    let terminated = false;
                    const handle: UniqueWorkerHandle = {
                        postMessage(data, transfer) {
                            if (terminated || tabDead) return;
                            const ports = transfer as ReadonlyArray<UniqueWorkerTestPort>;
                            workerPorts.push(...ports);
                            queueMicrotask(() => {
                                if (terminated) return;
                                try {
                                    worker.handleMessage(data, ports);
                                } catch (error) {
                                    // Real dedicated workers report uncaught errors via the parent's `onerror`.
                                    handle.onerror?.(
                                        error instanceof Error
                                            ? error
                                            : new UnknownError(String(error)),
                                    );
                                }
                            });
                        },
                        onerror: null,
                        terminate() {
                            terminated = true;
                            for (const port of workerPorts) {
                                port.disable();
                            }
                        },
                    };
                    tabWorkers.push(handle);
                    return handle;
                },
                createMessageChannel: () => {
                    const [rpcPort, transferPort] = createUniqueWorkerTestPortPair();
                    tabPorts.push(rpcPort);
                    return {rpcPort, transferPort};
                },
            };
        }

        return {
            createRuntime,
            kill() {
                if (tabDead) return;
                tabDead = true;
                for (const port of tabPorts) {
                    port.disable();
                }
                for (const worker of tabWorkers) {
                    worker.terminate();
                }
                locks.releaseAllForOwner(tabOwner);
            },
        };
    }

    return {createTab};
}
