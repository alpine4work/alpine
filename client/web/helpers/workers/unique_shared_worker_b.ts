import {error} from "aws-cdk";
import {WebWorkerRpc, WebWorkerRpcHandlers} from "~/client/web/helpers/workers/web_worker_rpc.js";
import {WebWorkerRpcMethodDefinitions} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Schema} from "~/shared/schema/schema.js";

const BroadcastChannelMessage = Schema.union({
    newLeaderConnecting: Schema.object({
        type: Schema.value("newLeaderConnecting"),
    }),
    newLeaderConnected: Schema.object({
        type: Schema.value("newLeaderConnected"),
    }),
});

const TabToServiceWorkerMessage = Schema.union({
    registerLeader: Schema.object({
        type: Schema.value("registerLeader"),
        key: Schema.string,
    }),
    connect: Schema.object({
        type: Schema.value("connect"),
        key: Schema.string,
    }),
});

const WorkerToLeaderTabMessage = Schema.union({
    ready: Schema.object({type: Schema.value("ready")}),
});

const LeaderTabToWorkerMessage = Schema.union({
    connect: Schema.object({type: Schema.value("connect")}),
});

export interface UniqueSharedWorkerOptions<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    workerUrl: string | URL;
    workerMethods: WorkerDef;
    tabMethods: TabDef;
    handlers: WebWorkerRpcHandlers<TabDef>;
    onReconnect?: () => Promise<void> | void;
}

function namespaceKey(key: string) {
    return `UniqueSharedWorker:${key}`;
}

type UniqueSharedWorkerState<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> =
    | {type: "connecting"; abort: () => void}
    | {type: "connecting-leader"; worker: Worker; lock: UniqueSharedWorkerLock}
    | {
          type: "connected-leader";
          worker: Worker;
          lock: UniqueSharedWorkerLock;
          port: MessagePort;
          rpc: WebWorkerRpc<WorkerDef, TabDef>;
      }
    | {type: "connecting-follower"; abortFailoverLock: () => void}
    | {type: "error"; error: unknown}
    | {type: "closed"};

export class UniqueSharedWorker<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    private state!: UniqueSharedWorkerState<WorkerDef, TabDef>;
    private readyPromise = createPromiseResolver<void>();
    private broadcastChannel: BroadcastChannel;

    private constructor(
        readonly key: string,
        readonly options: UniqueSharedWorkerOptions<WorkerDef, TabDef>,
    ) {
        this.beginConnectingWithoutCheckingState();
    }

    close() {
        this.handleClose();
    }

    // #region updates these implement our state machine. they should all be
    // synchronous, and all switch on/replace the current state
    private handleClose() {
        switch (this.state.type) {
            case "connecting": {
                this.state.abort();
                break;
            }
            case "connecting-leader": {
                this.state.worker.terminate();
                this.state.lock.release();
                break;
            }
            case "connected-leader": {
                this.state.port.close();
                this.state.worker.terminate();
                this.state.lock.release();
                break;
            }
            case "error":
            case "closed":
                break;
            default:
                exhaustive(this.state);
        }
        this.state = {type: "closed"};
    }

    private handleAquireLock(lock: UniqueSharedWorkerLock) {
        const state = this.state;
        switch (state.type) {
            case "connecting-follower":
            // TODO: implement
            case "connecting": {
                if (lock) {
                    this.state = {
                        type: "connecting-leader",
                        lock: lock,
                        worker: this.createLeaderWorker(),
                    };
                }
                break;
            }
            case "connecting-leader":
            case "connected-leader":
            case "closed":
            case "error":
                lock.release();
                impossible("aquired lock", state.type);
            default:
                exhaustive(state);
        }
    }

    private handleFailToAcquireLock() {
        switch (this.state.type) {
            case "connecting": {
                this.state = {
                    type: "connecting-follower",
                    abortFailoverLock: this.setupFailoverLock(),
                };
                this.obtainServiceWorker();
                break;
            }
            case "connecting-leader":
            case "connected-leader":
            case "connecting-follower":
            case "closed":
            case "error":
                impossible("fail to acquire lock", this.state.type);
            default:
                exhaustive(this.state);
        }
    }

    private handleWorkerReady() {
        switch (this.state.type) {
            case "connecting-leader": {
                const {port1, port2} = new MessageChannel();
                this.state.worker.postMessage(
                    LeaderTabToWorkerMessage.serialize({type: "connect"}),
                    [port2],
                );
                const rpc = this.createRpc(port1);
                this.state = {
                    type: "connected-leader",
                    lock: this.state.lock,
                    worker: this.state.worker,
                    port: port1,
                    rpc,
                };
                this.readyPromise.resolve();
                break;
            }
            case "connected-leader":
            case "connecting":
            case "error":
            case "closed":
                impossible("worker ready", this.state.type);
            default:
                exhaustive(this.state);
        }
    }

    private handleWorkerError(error: unknown) {
        switch (this.state.type) {
            case "connecting-leader":
            case "connected-leader":
                this.handleClose();
                this.beginConnectingWithoutCheckingState();
                break;
            case "connecting":
            case "closed":
            case "error":
                impossible("worker error", this.state.type);
            default:
                exhaustive(this.state);
        }
    }

    private handleUnrecoverableError(error: unknown) {
        this.handleClose();
        this.state = {type: "error", error};
        this.readyPromise.reject(error);
        // TODO: maybe throw??? or notify or something???
    }

    // #endregion

    private createLeaderWorker() {
        const worker = new Worker(this.options.workerUrl, {type: "module"});

        worker.onerror = event => {
            this.handleWorkerError(event.error);
        };

        worker.onmessage = event => {
            if (event.data && typeof event.data === "object" && this.key in event.data) {
                const message = WorkerToLeaderTabMessage.deserialize(event.data[this.key]);

                // cast until we have another message type when we can change to exhaustive switch
                cast<"ready">(message.type);
                this.handleWorkerReady();
            }
        };

        return worker;
    }

    private createRpc(port: MessagePort) {
        const rpc = new WebWorkerRpc({
            callMethods: this.options.workerMethods,
            handleMethods: this.options.tabMethods,
            handlers: this.options.handlers,
            send: message => port.postMessage(message),
        });

        port.onmessage = event => {
            rpc.handleMessage(event.data);
        };

        return rpc;
    }

    private beginConnectingWithoutCheckingState() {
        const abortController = new AbortController();

        this.state = {
            type: "connecting",
            abort: () => abortController.abort(),
        };

        acquireLock(this.key, {ifAvailable: true, abortSignal: abortController.signal})
            .then(lock => {
                if (lock) {
                    this.handleAquireLock(lock);
                } else {
                    this.handleFailToAcquireLock();
                }
            })
            .catch(error => this.handleUnrecoverableError(error));
    }

    private setupFailoverLock() {
        const abortController = new AbortController();

        acquireLock(this.key, {abortSignal: abortController.signal})
            .then(lock => {
                this.handleAquireLock(lock);
            })
            .catch(error => this.handleUnrecoverableError(error));

        return () => abortController.abort();
    }

    private obtainServiceWorker() {
        navigator.serviceWorker.ready
            .then(registration => {
                this.handleServiceWorkerReady(registration);
            })
            .catch(error => this.handleUnrecoverableError(error));
    }
}

function impossible(event: string, currentState: string): never {
    fail(`got ${event} in ${currentState}: this should be impossible`);
}

interface UniqueSharedWorkerLock {
    release(): void;
}
function acquireLock(
    key: string,
    options: {ifAvailable: true; abortSignal?: AbortSignal},
): Promise<UniqueSharedWorkerLock | null>;
function acquireLock(
    key: string,
    options: {ifAvailable?: false; abortSignal?: AbortSignal},
): Promise<UniqueSharedWorkerLock>;
function acquireLock(
    key: string,
    {ifAvailable, abortSignal}: {ifAvailable?: boolean; abortSignal?: AbortSignal} = {},
): Promise<UniqueSharedWorkerLock | null> {
    const returnPromise = createPromiseResolver<UniqueSharedWorkerLock | null>();
    const lockPromise = createPromiseResolver<void>();
    try {
        void navigator.locks.request(
            key,
            {mode: "exclusive", ifAvailable, signal: abortSignal},
            lock => {
                if (lock) {
                    returnPromise.resolve({
                        release: () => {
                            lockPromise.resolve();
                        },
                    });
                } else {
                    returnPromise.resolve(null);
                }

                return lockPromise.promise;
            },
        );
    } catch (error) {
        returnPromise.reject(error);
    }
    return returnPromise.promise;
}
