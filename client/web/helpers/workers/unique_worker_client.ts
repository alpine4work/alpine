import {readUniqueWorkerMessage} from "~/client/web/helpers/workers/unique_worker_message.js";
import {WebWorkerRpc, WebWorkerRpcHandlers} from "~/client/web/helpers/workers/web_worker_rpc.js";
import {WebWorkerRpcMethodDefinitions} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {
    CancelledError,
    ErrorBase,
    InternalError,
    UnavailableError,
    UnknownError,
} from "~/shared/error/error.js";
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
// - A Web Lock per key elects the leader tab. Every client requests the lock and
//   simultaneously asks the broker for a follower connection; whichever happens
//   first decides the role. The browser releases locks when a tab dies, so
//   failover is crash-safe by construction: one waiting follower is granted the
//   lock and promotes itself.
// - The broker relays ports and broadcasts `leader-lost`. Connect requests that
//   arrive while no leader is registered queue inside the broker until one
//   registers, so clients never poll or retry on a timer.
//
// Tests run this class against `test_helpers/install_unique_worker_test_mocks`,
// which replaces `navigator.locks`, `MessageChannel`, `Worker`, and `SharedWorker`
// with in-process fakes (the broker fake runs the real broker logic).

/** Name of the Web Lock that elects the leader for `key`. */
export function uniqueWorkerWebLockName(key: string): string {
    return `unique-worker:${key}`;
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
    /**
     * Creates the dedicated worker; called if this client becomes the leader. Write it
     * as `() => new Worker(new URL("./x.js", import.meta.url), {type: "module"})` so
     * the bundler recognizes the worker script and bundles it.
     */
    createWorker(): Worker;
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
    | "connecting-follower"
    | "follower"
    | "starting-leader"
    | "leader"
    | "closed"
    | "failed";

interface UniqueWorkerLockHold {
    release(): void;
}

// A handshake in progress: we created a channel and are waiting for the worker to
// send `ready` on it. Compared by identity to ignore stale handshakes.
interface UniqueWorkerClientAttempt {
    readonly rpcPort: MessagePort;
}

interface UniqueWorkerClientConnection<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    readonly rpc: WebWorkerRpc<WorkerDef, TabDef>;
    readonly rpcPort: MessagePort;
    // Rejection callbacks for calls in flight on this connection, so they can be
    // failed fast when the connection dies instead of hanging forever.
    readonly inflightRejects: Set<(error: Error) => void>;
}

type UniqueWorkerClientState<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> =
    // A connect request is with the broker (possibly queued there until a leader
    // registers) and we await `ready` on our end of the channel. Also the initial
    // state — every client starts as a would-be follower while waiting on the election
    // lock.
    | {readonly type: "connecting-follower"; readonly attempt: UniqueWorkerClientAttempt}
    | {
          readonly type: "follower";
          readonly connection: UniqueWorkerClientConnection<WorkerDef, TabDef>;
      }
    // We hold the lock; our worker is spawned and we await its `ready`.
    | {
          readonly type: "starting-leader";
          readonly attempt: UniqueWorkerClientAttempt;
          readonly worker: Worker;
          readonly lockHold: UniqueWorkerLockHold;
      }
    | {
          readonly type: "leader";
          readonly connection: UniqueWorkerClientConnection<WorkerDef, TabDef>;
          readonly worker: Worker;
          readonly lockHold: UniqueWorkerLockHold;
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
    private state!: UniqueWorkerClientState<WorkerDef, TabDef>;
    private readonly callQueue: Array<UniqueWorkerClientQueuedCall> = [];
    private readonly firstConnection: PromiseResolver<void> = createPromiseResolver();
    private readonly shutdownAbort = new AbortController();
    private readonly brokerPort: MessagePort;
    // Outgoing broker messages queue behind the hello (see the constructor).
    private readonly helloSent: PromiseResolver<void> = createPromiseResolver();
    private clientLockHold: UniqueWorkerLockHold | null = null;
    private everConnected = false;

    constructor(private readonly options: UniqueWorkerClientOptions<WorkerDef, TabDef>) {
        // Calling `whenConnected` is optional, so its rejection on close/failure must not
        // surface as an unhandled rejection.
        void this.firstConnection.promise.catch(() => {});

        // Connect to the broker. Each client has its own SharedWorker port; the browser
        // shares the underlying worker.
        const sharedWorker = new SharedWorker(
            new URL("./unique_worker_broker.js", import.meta.url),
            {type: "module", name: "unique-worker-broker"},
        );
        this.brokerPort = sharedWorker.port;
        this.brokerPort.onmessage = event => this.handleBrokerMessage(event);
        this.brokerPort.start();

        // Hold a lock for this client's lifetime; the broker watches it to detect us going
        // away. The hello must only be sent once the lock is actually held — otherwise the
        // broker could observe the lock as free and consider us dead immediately — so all
        // other outgoing messages queue behind it.
        const clientLockName = `unique-worker-client:${Math.random().toString(36).slice(2)}`;
        this.holdWebLock(clientLockName, hold => {
            this.clientLockHold = hold;
            this.brokerPort.postMessage({type: "unique-worker:hello", clientLockName});
            this.helloSent.resolve();
        });

        // Request the election lock. First grant — now or after the current leader goes
        // away — makes this client the leader.
        this.holdWebLock(uniqueWorkerWebLockName(options.key), hold =>
            this.handleLockAcquired(hold),
        );

        // Meanwhile, ask for a follower connection. If we win the election first, the
        // broker drops this request when we register as leader.
        this.becomeConnectingFollower();
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
            case "connecting-follower":
            case "starting-leader":
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
            case "connecting-follower":
                state.attempt.rpcPort.close();
                break;
            case "follower":
                // Tell the host so it can drop this connection's state; the port close alone is
                // only detected on browsers with MessagePort `close` events.
                state.connection.rpcPort.postMessage({type: "unique-worker:close-port"});
                state.connection.rpcPort.close();
                break;
            case "starting-leader":
                state.worker.terminate();
                state.lockHold.release();
                state.attempt.rpcPort.close();
                break;
            case "leader":
                this.brokerPort.postMessage({
                    type: "unique-worker:unregister-leader",
                    key: this.options.key,
                });
                state.worker.terminate();
                state.lockHold.release();
                state.connection.rpcPort.close();
                break;
            case "closed":
            case "failed":
                return;
            default:
                throw exhaustive(state);
        }

        const connection = stateUniqueWorkerConnection(state);
        this.state = {type: "closed"};
        const error = new CancelledError("Unique worker client closed");
        this.shutdown(error);
        if (connection !== null) rejectUniqueWorkerInflightCalls(connection, error);
    }

    // -- State transitions ----------------------------------------------------
    //
    // Each `handle*` method is a synchronous transition: it switches on the current
    // state, replaces it, and kicks off any follow-up async work whose completion
    // re-enters through another `handle*` method.

    private handleLockAcquired(lockHold: UniqueWorkerLockHold): void {
        const state = this.state;
        switch (state.type) {
            case "connecting-follower":
                state.attempt.rpcPort.close();
                this.becomeStartingLeader(lockHold);
                break;
            case "follower":
                // The previous leader went away and we won the failover race.
                rejectUniqueWorkerInflightCalls(
                    state.connection,
                    new UnavailableError("Unique worker leader changed"),
                );
                state.connection.rpcPort.close();
                this.becomeStartingLeader(lockHold);
                break;
            case "closed":
            case "failed":
                // Closed or failed while the lock request was still queued.
                lockHold.release();
                break;
            case "starting-leader":
            case "leader":
                // We already hold the lock; there is no second request.
                throw impossibleUniqueWorkerEvent("lock acquired", state.type);
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
                this.sendToBroker({
                    type: "unique-worker:register-leader",
                    key: this.options.key,
                });
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
                rejectUniqueWorkerInflightCalls(
                    state.connection,
                    new UnavailableError("Unique worker leader changed"),
                );
                state.connection.rpcPort.close();
                this.becomeConnectingFollower();
                break;
            case "connecting-follower":
                // Our pending connect may have been relayed to the dying leader and lost; retry
                // with a fresh channel. If it is still queued at the broker, the new request
                // replaces it there.
                state.attempt.rpcPort.close();
                this.becomeConnectingFollower();
                break;
            case "starting-leader":
            case "leader":
                // We are the (new) leader; this is news about the leader we replaced.
                break;
            case "closed":
            case "failed":
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

    private handleConnectRequest(transferPort: MessagePort): void {
        const state = this.state;
        switch (state.type) {
            case "leader":
                state.worker.postMessage({type: "unique-worker:connect-port"}, [transferPort]);
                break;
            case "connecting-follower":
            case "follower":
            case "starting-leader":
            case "closed":
            case "failed":
                // The broker only relays connect requests to the registered leader; anything else
                // is a stale delivery. Drop it — the follower will retry when it hears
                // `leader-lost`.
                transferPort.close();
                break;
            default:
                throw exhaustive(state);
        }
    }

    // -- Transition helpers -----------------------------------------------------

    private becomeStartingLeader(lockHold: UniqueWorkerLockHold): void {
        let worker: Worker;
        try {
            worker = this.options.createWorker();
        } catch (error) {
            // e.g. worker creation blocked by CSP. The lock isn't attached to any state yet,
            // so release it here before failing.
            lockHold.release();
            this.fail(ErrorBase.from(error));
            return;
        }
        worker.onerror = event => {
            this.handleWorkerError(
                event.error instanceof Error
                    ? event.error
                    : new UnknownError(event.message || "Unique worker error"),
            );
        };
        const channel = new MessageChannel();
        const attempt: UniqueWorkerClientAttempt = {rpcPort: channel.port1};
        this.state = {type: "starting-leader", attempt, worker, lockHold};
        this.listenForReady(attempt);
        worker.postMessage({type: "unique-worker:connect-port"}, [channel.port2]);
    }

    private becomeConnectingFollower(): void {
        const channel = new MessageChannel();
        const attempt: UniqueWorkerClientAttempt = {rpcPort: channel.port1};
        this.state = {type: "connecting-follower", attempt};
        this.listenForReady(attempt);
        this.sendToBroker({type: "unique-worker:connect", key: this.options.key}, [channel.port2]);
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
        rpcPort: MessagePort,
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
            case "connecting-follower":
                state.attempt.rpcPort.close();
                break;
            case "follower":
                state.connection.rpcPort.close();
                break;
            case "starting-leader":
                state.worker.terminate();
                state.lockHold.release();
                state.attempt.rpcPort.close();
                break;
            case "leader":
                this.brokerPort.postMessage({
                    type: "unique-worker:unregister-leader",
                    key: this.options.key,
                });
                state.worker.terminate();
                state.lockHold.release();
                state.connection.rpcPort.close();
                break;
            default:
                throw exhaustive(state);
        }

        const connection = stateUniqueWorkerConnection(state);
        this.state = {type: "failed", error};
        this.shutdown(error);
        if (connection !== null) rejectUniqueWorkerInflightCalls(connection, error);
        this.options.onFailed?.(error);
    }

    /** Cleanup shared by `close` and `fail`, run after the state is replaced. */
    private shutdown(error: Error): void {
        // Aborts our still-queued lock requests. A request granted after this point
        // re-enters `handleLockAcquired`, which releases it immediately.
        this.shutdownAbort.abort();
        // Releasing the client lifetime lock tells the broker to drop all state for this
        // client.
        this.clientLockHold?.release();
        this.clientLockHold = null;
        this.brokerPort.close();
        for (const queued of this.callQueue.splice(0)) {
            queued.reject(error);
        }
        this.firstConnection.reject(error);
    }

    // -- Browser plumbing -------------------------------------------------------

    private handleBrokerMessage(event: MessageEvent): void {
        const message = readUniqueWorkerMessage(event.data);
        if (message === null) return;
        switch (message.type) {
            case "unique-worker:leader-lost":
                if (message.key === this.options.key) this.handleLeaderLost();
                break;
            case "unique-worker:connect-request": {
                const transferPort = event.ports[0];
                if (message.key === this.options.key && transferPort !== undefined) {
                    this.handleConnectRequest(transferPort);
                }
                break;
            }
            default:
                // Other protocol messages never target a client.
                break;
        }
    }

    // `.then` callbacks on the same settled promise run in registration order, so
    // queuing behind the hello preserves message order.
    private sendToBroker(data: unknown, transfer: Array<Transferable> = []): void {
        void this.helloSent.promise.then(() => {
            this.brokerPort.postMessage(data, transfer);
        });
    }

    /**
     * Requests a Web Lock and holds it until the returned hold is released. The
     * request is dropped if `shutdownAbort` fires first; `onGranted` decides what to
     * do when the lock arrives.
     */
    private holdWebLock(name: string, onGranted: (hold: UniqueWorkerLockHold) => void): void {
        const hold = createPromiseResolver<void>();
        navigator.locks
            .request(name, {mode: "exclusive", signal: this.shutdownAbort.signal}, async () => {
                onGranted({release: () => hold.resolve()});
                await hold.promise;
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === "AbortError") return;
                this.fail(ErrorBase.from(error));
            });
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

function rejectUniqueWorkerInflightCalls<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
>(connection: UniqueWorkerClientConnection<WorkerDef, TabDef>, error: Error): void {
    for (const rejectInflight of [...connection.inflightRejects]) {
        rejectInflight(error);
    }
}

function stateUniqueWorkerConnection<
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
