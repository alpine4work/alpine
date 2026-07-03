import {readUniqueWorkerMessage} from "~/client/web/helpers/workers/unique_worker_message.js";
import {WebWorkerRpc, WebWorkerRpcHandlers} from "~/client/web/helpers/workers/web_worker_rpc.js";
import {WebWorkerRpcMethodDefinitions} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {CancelledError, ErrorBase, InternalError, UnavailableError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SchemaType} from "~/shared/schema/schema.js";

// # Unique worker
//
// A "unique worker" is a dedicated worker that exists in exactly one tab (because
// it holds resources that can only be held once, e.g. OPFS sync access handles)
// but is callable from every same-origin tab.
//
// Participants:
//
// - `UniqueWorkerClient` (this file) runs on the main thread of every tab.
// - A broker SharedWorker (`unique_worker_broker.ts`) relays MessagePorts between
//   tabs and pushes leader-change notifications. It is never on the steady-state
//   data path.
// - `UniqueWorkerHost` runs inside the dedicated worker and serves RPC on every
//   connection port it receives.
//
// Coordination uses exactly two mechanisms:
//
// - A Web Lock per key elects the leader tab. The browser releases locks when a
//   tab dies, so failover is crash-safe by construction: one waiting follower is
//   granted the lock and promotes itself.
// - The broker relays ports and broadcasts `leader-lost`. Connect requests that
//   arrive while no leader is registered queue inside the broker until one
//   registers, so clients never poll or retry on a timer.

/**
 * The tab side of a connection port. Mirrors the subset of `MessagePort` the
 * client uses; tests substitute fakes.
 */
export interface UniqueWorkerRpcPort {
    postMessage(data: unknown): void;
    onmessage: ((event: {data: unknown}) => void) | null;
    start(): void;
    close(): void;
}

/** The dedicated worker as seen by the leader tab. Mirrors `Worker`. */
export interface UniqueWorkerHandle {
    postMessage(data: unknown, transfer: ReadonlyArray<unknown>): void;
    onerror: ((error: Error) => void) | null;
    terminate(): void;
}

/** Releases a held Web Lock. */
export interface UniqueWorkerLockHold {
    release(): void;
}

/**
 * This tab's connection to the broker SharedWorker. One connection is shared by
 * all `UniqueWorkerClient` instances in the tab.
 */
export interface UniqueWorkerBrokerTabConnection {
    registerLeader(key: string): void;
    unregisterLeader(key: string): void;
    /** Ask the broker to relay `transferPort` to the leader for `key`. */
    connect(key: string, transferPort: unknown): void;
    /** Returns an unsubscribe function. */
    subscribe(
        key: string,
        subscriber: {
            onLeaderLost(): void;
            /**
             * A follower's port arrived for relaying into our dedicated worker. Delivered to
             * every subscriber for the key; non-leaders ignore it.
             */
            onConnectRequest(transferPort: unknown): void;
        },
    ): () => void;
}

/**
 * Browser APIs the client depends on, kept small so tests can run the full
 * multi-tab dance with fakes. `createUniqueWorkerBrowserRuntime` provides the real
 * implementation.
 */
export interface UniqueWorkerTabRuntime {
    /** Resolves `null` if the lock is currently held elsewhere. */
    tryAcquireLock(name: string): Promise<UniqueWorkerLockHold | null>;
    /** Waits for the lock. Resolves `null` if `signal` aborts first. */
    waitForLock(name: string, signal: AbortSignal): Promise<UniqueWorkerLockHold | null>;
    broker: UniqueWorkerBrokerTabConnection;
    createWorker(): UniqueWorkerHandle;
    /**
     * A `MessageChannel`: `rpcPort` stays in this tab, `transferPort` is opaque and
     * gets transferred (to our own worker, or through the broker to the leader's
     * worker).
     */
    createMessageChannel(): {rpcPort: UniqueWorkerRpcPort; transferPort: unknown};
}

export interface UniqueWorkerClientOptions<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    /**
     * Identifies the worker across tabs. Every client using the same key must spawn
     * the same worker script — nothing enforces this, so treat the key as belonging to
     * one worker implementation.
     */
    key: string;
    runtime: UniqueWorkerTabRuntime;
    /** Methods this tab can call on the worker. */
    workerMethods: WorkerDef;
    /** Methods the worker can call on this tab. */
    tabMethods: TabDef;
    handlers: WebWorkerRpcHandlers<TabDef>;
    /**
     * Called after this client connects to a _new_ worker following a leader change
     * (never on initial connection), before queued calls are flushed. Use it to
     * re-establish worker-side session state (e.g. re-register watches). Calls made
     * inside the hook go directly to the new connection.
     */
    onReconnect?(): Promise<void> | void;
    /**
     * Called when the client enters the terminal `failed` state (worker failed to
     * start, or `onReconnect` threw). All calls reject from then on; the caller may
     * create a fresh client to retry.
     */
    onFailed?(error: Error): void;
    /**
     * Called for uncaught errors in our own dedicated worker after it started
     * successfully. These don't kill the worker, so the client stays connected.
     */
    onWorkerError?(error: Error): void;
}

export type UniqueWorkerClientStatus =
    | "electing"
    | "starting-leader"
    | "leader"
    | "connecting-follower"
    | "follower"
    | "closed"
    | "failed";

// A handshake in progress: we created a channel and are waiting for the worker to
// send `ready` on it. Compared by identity to ignore stale handshakes.
interface UniqueWorkerClientAttempt {
    readonly rpcPort: UniqueWorkerRpcPort;
}

interface UniqueWorkerClientConnection<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    readonly rpc: WebWorkerRpc<WorkerDef, TabDef>;
    readonly rpcPort: UniqueWorkerRpcPort;
    // Rejection callbacks for calls in flight on this connection, so they can be
    // failed fast when the connection dies instead of hanging forever.
    readonly inflightRejects: Set<(error: Error) => void>;
}

type UniqueWorkerClientState<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> =
    // Initial `tryAcquireLock` is in flight.
    | {readonly type: "electing"}
    // We hold the lock; our worker is spawned and we await its `ready`.
    | {
          readonly type: "starting-leader";
          readonly attempt: UniqueWorkerClientAttempt;
          readonly worker: UniqueWorkerHandle;
          readonly lockHold: UniqueWorkerLockHold;
      }
    | {
          readonly type: "leader";
          readonly connection: UniqueWorkerClientConnection<WorkerDef, TabDef>;
          readonly worker: UniqueWorkerHandle;
          readonly lockHold: UniqueWorkerLockHold;
      }
    // A connect request is with the broker (possibly queued there until a leader
    // registers) and we await `ready` on our end of the channel.
    | {readonly type: "connecting-follower"; readonly attempt: UniqueWorkerClientAttempt}
    | {
          readonly type: "follower";
          readonly connection: UniqueWorkerClientConnection<WorkerDef, TabDef>;
      }
    | {readonly type: "closed"}
    | {readonly type: "failed"; readonly error: Error};

interface UniqueWorkerClientQueuedCall {
    readonly method: string;
    readonly input: unknown;
    readonly resolve: (value: any) => void;
    readonly reject: (error: Error) => void;
}

/**
 * Connects this tab to the unique worker for `key`, electing this tab as the
 * leader (spawning the worker here) or attaching as a follower through the broker.
 * See the module comment for the architecture.
 *
 * The client is usable immediately: calls made before the connection is up are
 * queued and flushed once connected. During a leader failover, in-flight calls
 * reject with `UnavailableError` (they may or may not have executed — the client
 * never replays them) and new calls queue until reconnected.
 */
export class UniqueWorkerClient<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    private state: UniqueWorkerClientState<WorkerDef, TabDef> = {type: "electing"};
    private readonly callQueue: Array<UniqueWorkerClientQueuedCall> = [];
    private readonly firstConnection: PromiseResolver<void> = createPromiseResolver();
    private readonly failoverAbort = new AbortController();
    private readonly unsubscribeFromBroker: () => void;
    private failoverWaitStarted = false;
    private everConnected = false;

    constructor(private readonly options: UniqueWorkerClientOptions<WorkerDef, TabDef>) {
        // Calling `whenConnected` is optional, so its rejection on close/failure must not
        // surface as an unhandled rejection.
        void this.firstConnection.promise.catch(() => {});
        this.unsubscribeFromBroker = options.runtime.broker.subscribe(options.key, {
            onLeaderLost: () => this.handleLeaderLost(),
            onConnectRequest: transferPort => this.handleConnectRequest(transferPort),
        });
        void options.runtime.tryAcquireLock(this.lockName()).then(
            lockHold => this.handleElectionResult(lockHold),
            error => this.fail(ErrorBase.from(error)),
        );
    }

    /** Current state, exposed for tests and debugging. */
    get status(): UniqueWorkerClientStatus {
        return this.state.type;
    }

    /**
     * Resolves once the first connection is established. Calling this is optional —
     * `call` queues until connected either way.
     */
    async whenConnected(): Promise<void> {
        await this.firstConnection.promise;
    }

    call<K extends string & keyof WorkerDef>(
        method: K,
        input: SchemaType<WorkerDef[K]["inputSchema"]>,
    ): Promise<SchemaType<WorkerDef[K]["outputSchema"]>> {
        const state = this.state;
        switch (state.type) {
            case "electing":
            case "starting-leader":
            case "connecting-follower":
                return new Promise((resolve, reject) => {
                    this.callQueue.push({method, input, resolve, reject});
                });
            case "leader":
            case "follower":
                return callOnUniqueWorkerConnection(state.connection, method, input);
            case "closed":
                return Promise.reject(new CancelledError("Unique worker client closed"));
            case "failed":
                return Promise.reject(state.error);
            default:
                throw exhaustive(state);
        }
    }

    close(): void {
        const state = this.state;
        switch (state.type) {
            case "electing":
                break;
            case "starting-leader":
                state.worker.terminate();
                state.lockHold.release();
                state.attempt.rpcPort.close();
                break;
            case "leader":
                this.options.runtime.broker.unregisterLeader(this.options.key);
                state.worker.terminate();
                state.lockHold.release();
                state.connection.rpcPort.close();
                break;
            case "connecting-follower":
                state.attempt.rpcPort.close();
                break;
            case "follower":
                // Tell the host so it can drop this connection's state; the port close alone is
                // only detected on browsers with MessagePort `close` events.
                state.connection.rpcPort.postMessage({type: "unique-worker:close-port"});
                state.connection.rpcPort.close();
                break;
            case "closed":
            case "failed":
                return;
            default:
                throw exhaustive(state);
        }

        const connection = stateConnection(state);
        this.state = {type: "closed"};
        this.failoverAbort.abort();
        this.unsubscribeFromBroker();
        const error = new CancelledError("Unique worker client closed");
        this.rejectQueuedCalls(error);
        if (connection !== null) rejectInflightCalls(connection, error);
        this.firstConnection.reject(error);
    }

    // -- State transitions ----------------------------------------------------
    //
    // Each `handle*` method is a synchronous transition: it switches on the current
    // state, replaces it, and kicks off any follow-up async work whose completion
    // re-enters through another `handle*` method.

    private handleElectionResult(lockHold: UniqueWorkerLockHold | null): void {
        const state = this.state;
        switch (state.type) {
            case "electing":
                if (lockHold !== null) {
                    this.becomeStartingLeader(lockHold);
                } else {
                    this.startFailoverWait();
                    this.becomeConnectingFollower();
                }
                break;
            case "closed":
            case "failed":
                // Closed or failed while the lock request was in flight.
                lockHold?.release();
                break;
            case "starting-leader":
            case "leader":
            case "connecting-follower":
            case "follower":
                throw impossibleUniqueWorkerEvent("election result", state.type);
            default:
                throw exhaustive(state);
        }
    }

    private handleFailoverLockAcquired(lockHold: UniqueWorkerLockHold): void {
        const state = this.state;
        switch (state.type) {
            case "follower":
                // The previous leader died and we won the failover race.
                rejectInflightCalls(
                    state.connection,
                    new UnavailableError("Unique worker leader changed"),
                );
                state.connection.rpcPort.close();
                this.becomeStartingLeader(lockHold);
                break;
            case "connecting-follower":
                state.attempt.rpcPort.close();
                this.becomeStartingLeader(lockHold);
                break;
            case "closed":
            case "failed":
                lockHold.release();
                break;
            case "electing":
            case "starting-leader":
            case "leader":
                // The failover wait only exists while we're a follower.
                throw impossibleUniqueWorkerEvent("failover lock acquired", state.type);
            default:
                throw exhaustive(state);
        }
    }

    private handleReady(attempt: UniqueWorkerClientAttempt): void {
        const state = this.state;
        switch (state.type) {
            case "starting-leader": {
                if (state.attempt !== attempt) {
                    attempt.rpcPort.close();
                    break;
                }
                const connection = this.createConnection(attempt.rpcPort);
                this.state = {
                    type: "leader",
                    connection,
                    worker: state.worker,
                    lockHold: state.lockHold,
                };
                // Register only now that the worker is ready, so ports the broker relays (or has
                // queued) never reach a half-started worker.
                this.options.runtime.broker.registerLeader(this.options.key);
                void this.finishConnecting();
                break;
            }
            case "connecting-follower": {
                if (state.attempt !== attempt) {
                    attempt.rpcPort.close();
                    break;
                }
                const connection = this.createConnection(attempt.rpcPort);
                this.state = {type: "follower", connection};
                void this.finishConnecting();
                break;
            }
            case "electing":
            case "leader":
            case "follower":
            case "closed":
            case "failed":
                // A stale handshake from an attempt we already abandoned.
                attempt.rpcPort.close();
                break;
            default:
                throw exhaustive(state);
        }
    }

    private handleLeaderLost(): void {
        const state = this.state;
        switch (state.type) {
            case "follower":
                rejectInflightCalls(
                    state.connection,
                    new UnavailableError("Unique worker leader changed"),
                );
                state.connection.rpcPort.close();
                this.becomeConnectingFollower();
                break;
            case "connecting-follower":
                // Our pending connect may have been relayed to the dying leader and lost; retry
                // with a fresh channel. If it is still queued at the broker, the old channel is
                // simply abandoned.
                state.attempt.rpcPort.close();
                this.becomeConnectingFollower();
                break;
            case "electing":
            case "starting-leader":
            case "leader":
            case "closed":
            case "failed":
                // Not connected through the lost leader — nothing to do. As the (new) leader we
                // may hear about the leader we just replaced.
                break;
            default:
                throw exhaustive(state);
        }
    }

    private handleWorkerError(error: Error): void {
        const state = this.state;
        switch (state.type) {
            case "starting-leader":
                // The worker never came up (e.g. the script failed to load). Treat as
                // unrecoverable for this tab; releasing the lock lets another tab try.
                this.fail(error);
                break;
            case "leader":
                // Uncaught errors don't kill a running worker, so stay connected.
                this.options.onWorkerError?.(error);
                break;
            case "electing":
            case "connecting-follower":
            case "follower":
            case "closed":
            case "failed":
                // A late event from a worker we already terminated.
                break;
            default:
                throw exhaustive(state);
        }
    }

    private handleConnectRequest(transferPort: unknown): void {
        const state = this.state;
        switch (state.type) {
            case "leader":
                state.worker.postMessage({type: "unique-worker:connect-port"}, [transferPort]);
                break;
            case "electing":
            case "starting-leader":
            case "connecting-follower":
            case "follower":
            case "closed":
            case "failed":
                // The broker only relays connect requests to the registered leader; anything else
                // is a stale delivery. Drop it — the follower will retry when it hears
                // `leader-lost`.
                break;
            default:
                throw exhaustive(state);
        }
    }

    // -- Transition helpers -----------------------------------------------------

    private becomeStartingLeader(lockHold: UniqueWorkerLockHold): void {
        let worker: UniqueWorkerHandle;
        try {
            worker = this.options.runtime.createWorker();
        } catch (error) {
            // e.g. worker creation blocked by CSP. The lock isn't attached to any state yet,
            // so release it here before failing.
            lockHold.release();
            this.fail(ErrorBase.from(error));
            return;
        }
        worker.onerror = error => this.handleWorkerError(error);
        const {rpcPort, transferPort} = this.options.runtime.createMessageChannel();
        const attempt: UniqueWorkerClientAttempt = {rpcPort};
        this.state = {type: "starting-leader", attempt, worker, lockHold};
        this.listenForReady(attempt);
        worker.postMessage({type: "unique-worker:connect-port"}, [transferPort]);
    }

    private becomeConnectingFollower(): void {
        const {rpcPort, transferPort} = this.options.runtime.createMessageChannel();
        const attempt: UniqueWorkerClientAttempt = {rpcPort};
        this.state = {type: "connecting-follower", attempt};
        this.listenForReady(attempt);
        this.options.runtime.broker.connect(this.options.key, transferPort);
    }

    private startFailoverWait(): void {
        if (this.failoverWaitStarted) return;
        this.failoverWaitStarted = true;
        void this.options.runtime.waitForLock(this.lockName(), this.failoverAbort.signal).then(
            lockHold => {
                if (lockHold !== null) this.handleFailoverLockAcquired(lockHold);
            },
            error => this.fail(ErrorBase.from(error)),
        );
    }

    private listenForReady(attempt: UniqueWorkerClientAttempt): void {
        attempt.rpcPort.onmessage = event => {
            const message = readUniqueWorkerMessage(event.data);
            if (message?.type === "unique-worker:ready") {
                this.handleReady(attempt);
            }
        };
        attempt.rpcPort.start();
    }

    private createConnection(
        rpcPort: UniqueWorkerRpcPort,
    ): UniqueWorkerClientConnection<WorkerDef, TabDef> {
        const rpc: WebWorkerRpc<WorkerDef, TabDef> = new WebWorkerRpc({
            callMethods: this.options.workerMethods,
            handleMethods: this.options.tabMethods,
            handlers: this.options.handlers,
            send: message => rpcPort.postMessage(message),
        });
        rpcPort.onmessage = event => rpc.handleMessage(event.data);
        return {rpc, rpcPort, inflightRejects: new Set()};
    }

    /**
     * Runs after entering a connected state: the reconnect hook first (with calls
     * going directly to the new connection), then the queued calls. If the state
     * changes again while the hook runs, the flushed calls simply re-queue through
     * `call`.
     */
    private async finishConnecting(): Promise<void> {
        const isReconnect = this.everConnected;
        this.everConnected = true;
        if (isReconnect) {
            try {
                await this.options.onReconnect?.();
            } catch (error) {
                this.fail(ErrorBase.from(error));
                return;
            }
        }
        this.firstConnection.resolve();
        for (const queued of this.callQueue.splice(0)) {
            void this.call(queued.method as string & keyof WorkerDef, queued.input as any).then(
                queued.resolve,
                queued.reject,
            );
        }
    }

    private fail(error: Error): void {
        const state = this.state;
        switch (state.type) {
            case "closed":
            case "failed":
                return;
            case "starting-leader":
                state.worker.terminate();
                state.lockHold.release();
                state.attempt.rpcPort.close();
                break;
            case "leader":
                this.options.runtime.broker.unregisterLeader(this.options.key);
                state.worker.terminate();
                state.lockHold.release();
                state.connection.rpcPort.close();
                break;
            case "connecting-follower":
                state.attempt.rpcPort.close();
                break;
            case "follower":
                state.connection.rpcPort.close();
                break;
            case "electing":
                break;
            default:
                throw exhaustive(state);
        }

        const connection = stateConnection(state);
        this.state = {type: "failed", error};
        this.failoverAbort.abort();
        this.unsubscribeFromBroker();
        this.rejectQueuedCalls(error);
        if (connection !== null) rejectInflightCalls(connection, error);
        this.firstConnection.reject(error);
        this.options.onFailed?.(error);
    }

    private rejectQueuedCalls(error: Error): void {
        for (const queued of this.callQueue.splice(0)) {
            queued.reject(error);
        }
    }

    private lockName(): string {
        return `unique-worker:${this.options.key}`;
    }
}

function callOnUniqueWorkerConnection<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
    K extends string & keyof WorkerDef,
>(
    connection: UniqueWorkerClientConnection<WorkerDef, TabDef>,
    method: K,
    input: SchemaType<WorkerDef[K]["inputSchema"]>,
): Promise<SchemaType<WorkerDef[K]["outputSchema"]>> {
    return new Promise((resolve, reject) => {
        const rejectInflight = (error: Error) => {
            if (connection.inflightRejects.delete(rejectInflight)) reject(error);
        };
        connection.inflightRejects.add(rejectInflight);
        connection.rpc.call(method, input).then(output => {
            if (connection.inflightRejects.delete(rejectInflight)) resolve(output);
        }, rejectInflight);
    });
}

function rejectInflightCalls<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
>(connection: UniqueWorkerClientConnection<WorkerDef, TabDef>, error: Error): void {
    for (const rejectInflight of [...connection.inflightRejects]) {
        rejectInflight(error);
    }
}

function stateConnection<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
>(
    state: UniqueWorkerClientState<WorkerDef, TabDef>,
): UniqueWorkerClientConnection<WorkerDef, TabDef> | null {
    return state.type === "leader" || state.type === "follower" ? state.connection : null;
}

function impossibleUniqueWorkerEvent(event: string, stateType: string): InternalError {
    return new InternalError(
        `UniqueWorkerClient received ${event} in state ${stateType}; this should be impossible`,
    );
}
