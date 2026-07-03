import {
    type SharedUniqueWorkerClientMessage,
    receiveSharedUniqueWorkerClientMessage,
    sendSharedUniqueWorkerConnectMessage,
    sendSharedUniqueWorkerRegisterLeaderMessage,
    sendSharedUniqueWorkerUnregisterLeaderMessage,
} from "~/client/web/helpers/workers/shared_unique_worker_message_port_broker_a.js";
import {WebWorkerRpc, WebWorkerRpcHandlers} from "~/client/web/helpers/workers/web_worker_rpc.js";
import {WebWorkerRpcMethodDefinitions} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {
    CancelledError,
    ErrorBase,
    FailedPreconditionError,
    InvalidArgumentError,
    UnavailableError,
    UnknownError,
} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SchemaType} from "~/shared/schema/schema.js";

type UniqueSharedWorkerBroadcastMessage =
    | {
          readonly type: "shared-unique-worker:new-leader";
          readonly key: string;
      }
    | {
          readonly type: "shared-unique-worker:leader-closing";
          readonly key: string;
      };

type UniqueSharedWorkerConnectPortMessage = {
    readonly type: "shared-unique-worker:worker-connect";
    readonly key: string;
    readonly workerUrl: string;
};

type UniqueSharedWorkerReadyMessage = {
    readonly type: "shared-unique-worker:ready";
    readonly workerUrl: string;
};

type UniqueSharedWorkerSetupErrorMessage = {
    readonly type: "shared-unique-worker:setup-error";
    readonly message: string;
};

type UniqueSharedWorkerCloseMessage = {
    readonly type: "shared-unique-worker:close";
};

type UniqueSharedWorkerPortSetupMessage =
    | UniqueSharedWorkerReadyMessage
    | UniqueSharedWorkerSetupErrorMessage
    | SharedUniqueWorkerClientMessage;

interface UniqueSharedWorkerOptions<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    workerUrl: string | URL;
    workerMethods: WorkerDef;
    tabMethods: TabDef;
    handlers: WebWorkerRpcHandlers<TabDef>;
    onReconnect?: () => Promise<void> | void;
}

type UniqueSharedWorkerLeaderHandlers<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> = {
    readonly [K in keyof WorkerDef]: (
        this: UniqueSharedWorkerLeader<WorkerDef, TabDef>,
        input: SchemaType<WorkerDef[K]["inputSchema"]>,
        connection: UniqueSharedWorkerConnection<WorkerDef, TabDef>,
    ) => Promise<SchemaType<WorkerDef[K]["outputSchema"]>>;
};

interface UniqueSharedWorkerLeaderOptions<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    workerMethods: WorkerDef;
    tabMethods: TabDef;
    handlers: UniqueSharedWorkerLeaderHandlers<WorkerDef, TabDef>;
    onConnect?: (
        connection: UniqueSharedWorkerConnection<WorkerDef, TabDef>,
    ) => Promise<void> | void;
}

interface UniqueSharedWorkerLockManager {
    request(
        name: string,
        options: {ifAvailable: boolean},
        callback: (lock: unknown | null) => Promise<unknown>,
    ): Promise<unknown>;
}

interface UniqueSharedWorkerPort {
    postMessage(message: unknown, transfer?: Array<Transferable>): void;
    onmessage: ((event: {data: unknown; ports: Array<MessagePort>}) => void) | null;
    start(): void;
    close(): void;
}

interface UniqueSharedWorkerHandle {
    postMessage(message: unknown, transfer?: Array<Transferable>): void;
    terminate(): void;
}

interface UniqueSharedWorkerServiceWorkerRegistration {
    readonly active: {
        postMessage(message: unknown, transfer?: Array<Transferable>): void;
    } | null;
}

interface UniqueSharedWorkerServiceWorkerContainer {
    readonly ready: Promise<UniqueSharedWorkerServiceWorkerRegistration>;
    addEventListener(
        type: "message",
        handler: (event: {data: unknown; ports: Array<MessagePort>}) => void,
    ): void;
}

interface UniqueSharedWorkerBroadcastChannel {
    postMessage(message: unknown): void;
    onmessage: ((event: {data: unknown}) => void) | null;
    close(): void;
}

interface UniqueSharedWorkerRuntime {
    readonly locks: UniqueSharedWorkerLockManager;
    readonly serviceWorker: UniqueSharedWorkerServiceWorkerContainer;
    createBroadcastChannel(name: string): UniqueSharedWorkerBroadcastChannel;
    createMessageChannel(): {port1: UniqueSharedWorkerPort; port2: MessagePort};
    createWorker(url: string): UniqueSharedWorkerHandle;
}

interface UniqueSharedWorkerRawConnection<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    readonly rpc: WebWorkerRpc<WorkerDef, TabDef>;
    readonly port: UniqueSharedWorkerPort;
    close(): void;
}

interface UniqueSharedWorkerQueuedCall<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    K extends keyof WorkerDef = keyof WorkerDef,
> {
    readonly method: K;
    readonly input: SchemaType<WorkerDef[K]["inputSchema"]>;
    readonly resolve: (value: SchemaType<WorkerDef[K]["outputSchema"]>) => void;
    readonly reject: (error: Error) => void;
}

interface UniqueSharedWorkerInflightCall {
    readonly reject: (error: Error) => void;
}

type UniqueSharedWorkerState<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> =
    | {readonly type: "initializing"}
    | {
          readonly type: "connected-leader";
          readonly connection: UniqueSharedWorkerRawConnection<WorkerDef, TabDef>;
          readonly releaseLock: () => void;
          readonly worker: UniqueSharedWorkerHandle;
      }
    | {
          readonly type: "connected-follower";
          readonly connection: UniqueSharedWorkerRawConnection<WorkerDef, TabDef>;
      }
    | {
          readonly type: "reconnecting-follower";
          readonly connection?: UniqueSharedWorkerRawConnection<WorkerDef, TabDef>;
      }
    | {
          readonly type: "promoting-to-leader";
          readonly releaseLock: () => void;
          readonly connection?: UniqueSharedWorkerRawConnection<WorkerDef, TabDef>;
          readonly worker?: UniqueSharedWorkerHandle;
      }
    | {readonly type: "closed"}
    | {readonly type: "failed"; readonly error: Error};

/**
 * Connects to a per-key unique worker, creating the dedicated worker in exactly
 * one same-origin tab and connecting all other tabs through MessagePorts relayed
 * by the app ServiceWorker.
 */
export class UniqueSharedWorker<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    private state: UniqueSharedWorkerState<WorkerDef, TabDef> = {type: "initializing"};
    private readonly callQueue: Array<UniqueSharedWorkerQueuedCall<WorkerDef>> = [];
    private readonly inflight = new Map<number, UniqueSharedWorkerInflightCall>();
    private readonly broadcastChannel: UniqueSharedWorkerBroadcastChannel;
    private readonly serviceWorkerMessageHandler: (event: {
        data: unknown;
        ports: Array<MessagePort>;
    }) => void;
    private lockWaitPromotion: Promise<void> | null = null;
    private lockWaitActive = false;
    private reconnecting: Promise<void> | null = null;
    private nextCallId = 0;

    private constructor(
        private readonly key: string,
        private readonly workerUrl: string,
        private readonly options: UniqueSharedWorkerOptions<WorkerDef, TabDef>,
        private readonly runtime: UniqueSharedWorkerRuntime,
    ) {
        this.broadcastChannel = runtime.createBroadcastChannel(key);
        this.broadcastChannel.onmessage = event => this.handleBroadcast(event.data);

        this.serviceWorkerMessageHandler = event => this.handleServiceWorkerMessage(event);
        runtime.serviceWorker.addEventListener("message", this.serviceWorkerMessageHandler);
    }

    static async connect<
        WorkerDef extends WebWorkerRpcMethodDefinitions,
        TabDef extends WebWorkerRpcMethodDefinitions,
    >(
        key: string,
        options: UniqueSharedWorkerOptions<WorkerDef, TabDef>,
    ): Promise<UniqueSharedWorker<WorkerDef, TabDef>> {
        const runtime = createDefaultUniqueSharedWorkerRuntime();
        const worker = new UniqueSharedWorker(
            normalizeUniqueSharedWorkerKey(key),
            normalizeUniqueSharedWorkerUrl(options.workerUrl),
            options,
            runtime,
        );
        await worker.connectInitial();
        return worker;
    }

    call<K extends string & keyof WorkerDef>(
        method: K,
        input: SchemaType<WorkerDef[K]["inputSchema"]>,
    ): Promise<SchemaType<WorkerDef[K]["outputSchema"]>> {
        const state = this.state;
        switch (state.type) {
            case "connected-leader":
            case "connected-follower":
                return this.callConnected(state.connection, method, input);

            case "reconnecting-follower":
            case "promoting-to-leader":
                return this.enqueueCall(method, input);

            case "closed":
                return Promise.reject(new CancelledError("Unique shared worker closed"));

            case "failed":
                return Promise.reject(state.error);

            case "initializing":
                return Promise.reject(
                    new FailedPreconditionError("Unique shared worker is still initializing"),
                );
        }
    }

    close(): void {
        const state = this.state;
        if (state.type === "closed") return;

        if (state.type === "connected-leader" || state.type === "promoting-to-leader") {
            sendUniqueSharedWorkerLeaderClosingMessage(this.broadcastChannel, this.key);
            this.unregisterLeader();
            state.worker?.terminate();
            state.releaseLock();
        }

        if (
            state.type === "connected-leader" ||
            state.type === "connected-follower" ||
            state.type === "reconnecting-follower" ||
            state.type === "promoting-to-leader"
        ) {
            state.connection?.close();
        }

        this.state = {type: "closed"};
        this.broadcastChannel.close();
        this.rejectQueuedCalls(new CancelledError("Unique shared worker closed"));
        this.rejectInflightCalls(new CancelledError("Unique shared worker closed"));
    }

    private async connectInitial(): Promise<void> {
        const acquiredLock = await this.tryAcquireLeaderLock();
        if (acquiredLock !== null) {
            const {connection, worker} = await this.createLeaderConnection();
            this.state = {
                type: "connected-leader",
                connection,
                releaseLock: acquiredLock.release,
                worker,
            };
            return;
        }

        this.setupLockWait();
        const connection = await this.createFollowerConnectionWithRetry();
        if (this.state.type === "initializing") {
            this.state = {type: "connected-follower", connection};
            return;
        }

        connection.close();
        await this.lockWaitPromotion;

        const state = this.state;
        if (state.type === "failed") throw state.error;
        if (state.type === "closed") {
            throw new CancelledError("Unique shared worker closed during connect");
        }
    }

    private callConnected<K extends string & keyof WorkerDef>(
        connection: UniqueSharedWorkerRawConnection<WorkerDef, TabDef>,
        method: K,
        input: SchemaType<WorkerDef[K]["inputSchema"]>,
    ): Promise<SchemaType<WorkerDef[K]["outputSchema"]>> {
        const callId = this.nextCallId++;
        return new Promise((resolve, reject) => {
            this.inflight.set(callId, {reject});
            connection.rpc.call(method, input).then(
                output => {
                    if (this.inflight.delete(callId)) {
                        resolve(output);
                    }
                },
                error => {
                    if (this.inflight.delete(callId)) {
                        reject(error);
                    }
                },
            );
        });
    }

    private enqueueCall<K extends string & keyof WorkerDef>(
        method: K,
        input: SchemaType<WorkerDef[K]["inputSchema"]>,
    ): Promise<SchemaType<WorkerDef[K]["outputSchema"]>> {
        return new Promise((resolve, reject) => {
            this.callQueue.push({
                method,
                input,
                resolve: resolve as (
                    value: SchemaType<WorkerDef[keyof WorkerDef]["outputSchema"]>,
                ) => void,
                reject,
            });
        });
    }

    private flushQueuedCalls(): void {
        const queued = this.callQueue.splice(0);
        for (const call of queued) {
            this.call(call.method as string & keyof WorkerDef, call.input).then(
                call.resolve,
                call.reject,
            );
        }
    }

    private rejectQueuedCalls(error: Error): void {
        for (const call of this.callQueue.splice(0)) {
            call.reject(error);
        }
    }

    private rejectInflightCalls(error: Error): void {
        for (const [, call] of this.inflight) {
            call.reject(error);
        }
        this.inflight.clear();
    }

    private handleBroadcast(data: unknown): void {
        const message = receiveUniqueSharedWorkerBroadcastMessage(data);
        if (message === null || message.key !== this.key) return;

        switch (message.type) {
            case "shared-unique-worker:leader-closing":
                this.handleLeaderClosing();
                break;

            case "shared-unique-worker:new-leader":
                void this.reconnectAsFollower();
                break;
        }
    }

    private handleLeaderClosing(): void {
        const state = this.state;
        if (state.type !== "connected-follower") return;

        this.rejectInflightCalls(new CancelledError("Unique shared worker leader closed"));
        state.connection.close();
        this.state = {type: "reconnecting-follower"};
    }

    private handleServiceWorkerMessage(event: {data: unknown; ports: Array<MessagePort>}): void {
        const message = receiveSharedUniqueWorkerClientMessage(event.data);
        if (
            message === null ||
            message.type !== "shared-unique-worker:port" ||
            message.key !== this.key
        ) {
            return;
        }

        const port = event.ports[0];
        const state = this.state;
        const worker =
            state.type === "connected-leader" || state.type === "promoting-to-leader"
                ? state.worker
                : undefined;
        if (port === undefined || worker === undefined) return;

        sendUniqueSharedWorkerConnectPortMessage(worker, this.key, this.workerUrl, port);
    }

    private setupLockWait(): void {
        if (this.lockWaitActive) return;
        this.lockWaitActive = true;

        void this.runtime.locks.request(this.key, {ifAvailable: false}, async lock => {
            this.lockWaitActive = false;
            if (lock === null || this.state.type === "closed") return;

            const hold = createUniqueSharedWorkerLockHold();
            const runReconnect = this.state.type !== "initializing";
            const promotion = this.promoteToLeader(hold.release, runReconnect);
            this.lockWaitPromotion = promotion;
            await promotion;
            await hold.promise;
        });
    }

    private async promoteToLeader(releaseLock: () => void, runReconnect: boolean): Promise<void> {
        const oldState = this.state;
        if (oldState.type === "closed") {
            releaseLock();
            return;
        }
        if (oldState.type === "connected-leader" || oldState.type === "promoting-to-leader") {
            releaseLock();
            return;
        }

        this.rejectInflightCalls(new CancelledError("Unique shared worker leader changed"));
        if (oldState.type === "connected-follower" || oldState.type === "reconnecting-follower") {
            oldState.connection?.close();
        }
        this.state = {type: "promoting-to-leader", releaseLock};

        let connection: UniqueSharedWorkerRawConnection<WorkerDef, TabDef> | undefined;
        let worker: UniqueSharedWorkerHandle | undefined;

        try {
            ({connection, worker} = await this.createLeaderConnection());
            if (this.isClosed()) {
                connection.close();
                worker.terminate();
                releaseLock();
                return;
            }

            this.state = {type: "promoting-to-leader", releaseLock, connection, worker};
            sendUniqueSharedWorkerNewLeaderMessage(this.broadcastChannel, this.key);
            if (runReconnect) {
                await this.runReconnectHook();
            }
            if (this.isClosed()) {
                connection.close();
                worker.terminate();
                releaseLock();
                return;
            }

            this.state = {
                type: "connected-leader",
                connection,
                releaseLock,
                worker,
            };
            this.flushQueuedCalls();
        } catch (error) {
            connection?.close();
            worker?.terminate();
            releaseLock();
            this.failConnection(ErrorBase.from(error));
            throw error;
        }
    }

    private async reconnectAsFollower(): Promise<void> {
        const state = this.state;
        if (state.type === "closed" || state.type === "connected-leader") return;
        if (state.type === "promoting-to-leader") return;
        if (this.reconnecting !== null) return await this.reconnecting;

        this.reconnecting = (async () => {
            const previousState = this.state;
            if (
                previousState.type === "connected-follower" ||
                previousState.type === "reconnecting-follower"
            ) {
                this.rejectInflightCalls(new CancelledError("Unique shared worker leader changed"));
                previousState.connection?.close();
            }
            this.state = {type: "reconnecting-follower"};

            let connection: UniqueSharedWorkerRawConnection<WorkerDef, TabDef> | undefined;

            try {
                connection = await this.createFollowerConnectionWithRetry();
                if (this.isClosed()) {
                    connection.close();
                    return;
                }

                this.state = {type: "reconnecting-follower", connection};
                await this.runReconnectHook();
                if (this.isClosed()) {
                    connection.close();
                    return;
                }

                this.state = {type: "connected-follower", connection};
                this.flushQueuedCalls();
            } catch (error) {
                connection?.close();
                this.failConnection(ErrorBase.from(error));
                throw error;
            }
        })();

        try {
            await this.reconnecting;
        } finally {
            this.reconnecting = null;
        }
    }

    private isClosed(): boolean {
        return this.state.type === "closed";
    }

    private failConnection(error: Error): void {
        if (this.state.type === "closed") return;
        this.state = {type: "failed", error};
        this.rejectQueuedCalls(error);
        this.rejectInflightCalls(error);
    }

    private async runReconnectHook(): Promise<void> {
        await this.options.onReconnect?.();
    }

    private async createLeaderConnection(): Promise<{
        connection: UniqueSharedWorkerRawConnection<WorkerDef, TabDef>;
        worker: UniqueSharedWorkerHandle;
    }> {
        const worker = this.runtime.createWorker(this.workerUrl);
        const channel = this.runtime.createMessageChannel();
        sendUniqueSharedWorkerConnectPortMessage(worker, this.key, this.workerUrl, channel.port2);

        const connection = await this.createConnectionFromPort(channel.port1);
        await this.registerLeader();
        return {connection, worker};
    }

    private async createFollowerConnectionWithRetry(): Promise<
        UniqueSharedWorkerRawConnection<WorkerDef, TabDef>
    > {
        const startedAt = Date.now();
        let lastError: Error | null = null;

        while (Date.now() - startedAt < 2000) {
            try {
                return await this.createFollowerConnection();
            } catch (error) {
                lastError = error instanceof Error ? error : new UnknownError(String(error));
                if (!isMissingSharedUniqueWorkerLeaderError(lastError)) {
                    throw lastError;
                }
                await delay(25);
            }
        }

        throw lastError ?? new UnavailableError(`No shared unique worker leader for ${this.key}`);
    }

    private async createFollowerConnection(): Promise<
        UniqueSharedWorkerRawConnection<WorkerDef, TabDef>
    > {
        const active = await this.getActiveServiceWorker();
        const channel = this.runtime.createMessageChannel();
        sendSharedUniqueWorkerConnectMessage(active, this.key, channel.port2);
        return await this.createConnectionFromPort(channel.port1);
    }

    private async createConnectionFromPort(
        port: UniqueSharedWorkerPort,
    ): Promise<UniqueSharedWorkerRawConnection<WorkerDef, TabDef>> {
        const handshake = await waitForUniqueSharedWorkerHandshake(port);
        if (handshake.type === "error") {
            port.close();
            throw handshake.error;
        }

        if (handshake.workerUrl !== this.workerUrl) {
            port.close();
            throw new InvalidArgumentError(
                `Unique shared worker ${this.key} is running ${handshake.workerUrl}, expected ${this.workerUrl}`,
            );
        }

        const rpc = new WebWorkerRpc({
            callMethods: this.options.workerMethods,
            handleMethods: this.options.tabMethods,
            handlers: this.options.handlers,
            send: message => port.postMessage(message),
        });
        port.onmessage = event => rpc.handleMessage(event.data);
        port.start();

        return {
            rpc,
            port,
            close() {
                try {
                    sendUniqueSharedWorkerCloseMessage(port);
                } catch {
                    // The other side may already be gone.
                }
                port.close();
            },
        };
    }

    private async tryAcquireLeaderLock(): Promise<{release: () => void} | null> {
        return await new Promise(resolve => {
            void this.runtime.locks.request(this.key, {ifAvailable: true}, async lock => {
                if (lock === null) {
                    resolve(null);
                    return;
                }

                const hold = createUniqueSharedWorkerLockHold();
                resolve({release: hold.release});
                await hold.promise;
            });
        });
    }

    private async registerLeader(): Promise<void> {
        const active = await this.getActiveServiceWorker();
        sendSharedUniqueWorkerRegisterLeaderMessage(active, this.key);
    }

    private unregisterLeader(): void {
        this.getActiveServiceWorker().then(
            active => {
                sendSharedUniqueWorkerUnregisterLeaderMessage(active, this.key);
            },
            () => {},
        );
    }

    private async getActiveServiceWorker(): Promise<{
        postMessage(message: unknown, transfer?: Array<Transferable>): void;
    }> {
        const registration = await this.runtime.serviceWorker.ready;
        const active = registration.active;
        if (active === null) {
            throw new UnavailableError("Unique shared worker requires an active ServiceWorker");
        }
        return active;
    }
}

/**
 * A single tab connection as seen by the dedicated worker.
 */
export class UniqueSharedWorkerConnection<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    constructor(
        private readonly rpc: WebWorkerRpc<TabDef, WorkerDef>,
        private readonly closePort: () => void,
    ) {}

    async call<K extends string & keyof TabDef>(
        method: K,
        input: SchemaType<TabDef[K]["inputSchema"]>,
    ): Promise<SchemaType<TabDef[K]["outputSchema"]>> {
        return await this.rpc.call(method, input);
    }

    close(): void {
        this.closePort();
    }
}

/**
 * Runs inside the dedicated worker owned by the current leader tab.
 */
export class UniqueSharedWorkerLeader<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    private readonly options: UniqueSharedWorkerLeaderOptions<WorkerDef, TabDef>;
    private readonly connectionsMutable: Array<UniqueSharedWorkerConnection<WorkerDef, TabDef>> =
        [];
    private readyCalled = false;

    constructor(key: string, options: UniqueSharedWorkerLeaderOptions<WorkerDef, TabDef>) {
        this.key = normalizeUniqueSharedWorkerKey(key);
        this.options = options;
    }

    private readonly key: string;

    get connections(): ReadonlyArray<UniqueSharedWorkerConnection<WorkerDef, TabDef>> {
        return this.connectionsMutable;
    }

    ready(): void {
        assert(!this.readyCalled, "UniqueSharedWorkerLeader.ready() called more than once");
        this.readyCalled = true;

        globalThis.addEventListener("message", event => {
            const ports = [...event.ports];
            void this.handleMessage(event.data, ports);
        });
    }

    private async handleMessage(data: unknown, ports: Array<MessagePort>): Promise<void> {
        const message = receiveUniqueSharedWorkerConnectPortMessage(data);
        if (message === null || message.key !== this.key) return;

        const port = ports[0];
        if (port === undefined) return;

        const workerUrl = normalizeUniqueSharedWorkerUrl(
            message.workerUrl ?? globalThis.location.href,
        );
        await this.connectPort(port, workerUrl);
    }

    private async connectPort(port: MessagePort, workerUrl: string): Promise<void> {
        let connection: UniqueSharedWorkerConnection<WorkerDef, TabDef> | undefined;

        try {
            const rpc = new WebWorkerRpc({
                callMethods: this.options.tabMethods,
                handleMethods: this.options.workerMethods,
                handlers: this.createHandlers(() => {
                    assert(connection !== undefined, "Connection used before initialization");
                    return connection;
                }),
                send: message => port.postMessage(message),
            });

            connection = new UniqueSharedWorkerConnection(rpc, () => port.close());
            this.connectionsMutable.push(connection);
            await this.options.onConnect?.(connection);

            port.onmessage = event => {
                const message = receiveUniqueSharedWorkerCloseMessage(event.data);
                if (message !== null) {
                    this.removeConnection(connection!);
                    port.close();
                    return;
                }
                rpc.handleMessage(event.data);
            };
            port.start();
            sendUniqueSharedWorkerReadyMessage(port, workerUrl);
        } catch (error) {
            if (connection !== undefined) {
                this.removeConnection(connection);
            }
            sendUniqueSharedWorkerSetupErrorMessage(
                port,
                error instanceof Error ? error.message : String(error),
            );
            port.close();
        }
    }

    private createHandlers(
        getConnection: () => UniqueSharedWorkerConnection<WorkerDef, TabDef>,
    ): WebWorkerRpcHandlers<WorkerDef> {
        const handlers: Record<string, (input: any) => Promise<any>> = {};
        const configuredHandlers = this.options.handlers as Record<
            string,
            (
                this: UniqueSharedWorkerLeader<WorkerDef, TabDef>,
                input: any,
                connection: UniqueSharedWorkerConnection<WorkerDef, TabDef>,
            ) => Promise<any>
        >;
        for (const name of Object.keys(this.options.workerMethods)) {
            handlers[name] = async input => {
                const handler = configuredHandlers[name]!;
                return await handler.call(this, input, getConnection());
            };
        }
        return handlers as WebWorkerRpcHandlers<WorkerDef>;
    }

    private removeConnection(connection: UniqueSharedWorkerConnection<WorkerDef, TabDef>): void {
        const index = this.connectionsMutable.indexOf(connection);
        if (index !== -1) {
            this.connectionsMutable.splice(index, 1);
        }
    }
}

function createDefaultUniqueSharedWorkerRuntime(): UniqueSharedWorkerRuntime {
    if (!("locks" in navigator)) {
        throw new UnavailableError("Unique shared worker requires navigator.locks");
    }
    if (!("serviceWorker" in navigator)) {
        throw new UnavailableError("Unique shared worker requires navigator.serviceWorker");
    }

    return {
        locks: navigator.locks,
        serviceWorker: {
            ready: navigator.serviceWorker.ready,
            addEventListener(type, handler) {
                navigator.serviceWorker.addEventListener(type, event => {
                    handler({
                        data: event.data,
                        ports: [...event.ports],
                    });
                });
            },
        },
        createBroadcastChannel(name) {
            const channel = new BroadcastChannel(name);
            return {
                postMessage(message) {
                    channel.postMessage(message);
                },
                get onmessage() {
                    return null;
                },
                set onmessage(handler: ((event: {data: unknown}) => void) | null) {
                    channel.onmessage = handler
                        ? event => {
                              handler({data: event.data});
                          }
                        : null;
                },
                close() {
                    channel.close();
                },
            };
        },
        createMessageChannel() {
            const channel = new MessageChannel();
            return {port1: wrapUniqueSharedWorkerPort(channel.port1), port2: channel.port2};
        },
        createWorker(url) {
            const worker = new Worker(url, {type: "module"});
            return {
                postMessage(message, transfer) {
                    if (transfer === undefined) {
                        worker.postMessage(message);
                    } else {
                        worker.postMessage(message, transfer);
                    }
                },
                terminate() {
                    worker.terminate();
                },
            };
        },
    };
}

function wrapUniqueSharedWorkerPort(port: MessagePort): UniqueSharedWorkerPort {
    return {
        postMessage(message, transfer) {
            if (transfer === undefined) {
                port.postMessage(message);
            } else {
                port.postMessage(message, transfer);
            }
        },
        get onmessage() {
            return null;
        },
        set onmessage(
            handler: ((event: {data: unknown; ports: Array<MessagePort>}) => void) | null,
        ) {
            port.onmessage = handler
                ? event => {
                      handler({
                          data: event.data,
                          ports: [...event.ports],
                      });
                  }
                : null;
        },
        start() {
            port.start();
        },
        close() {
            port.close();
        },
    };
}

function sendUniqueSharedWorkerLeaderClosingMessage(
    target: UniqueSharedWorkerBroadcastChannel,
    key: string,
): void {
    target.postMessage({
        type: "shared-unique-worker:leader-closing",
        key,
    } satisfies UniqueSharedWorkerBroadcastMessage);
}

function sendUniqueSharedWorkerNewLeaderMessage(
    target: UniqueSharedWorkerBroadcastChannel,
    key: string,
): void {
    target.postMessage({
        type: "shared-unique-worker:new-leader",
        key,
    } satisfies UniqueSharedWorkerBroadcastMessage);
}

function receiveUniqueSharedWorkerBroadcastMessage(
    data: unknown,
): UniqueSharedWorkerBroadcastMessage | null {
    return receiveUniqueSharedWorkerMessage(data) as UniqueSharedWorkerBroadcastMessage | null;
}

function sendUniqueSharedWorkerConnectPortMessage(
    target: UniqueSharedWorkerHandle,
    key: string,
    workerUrl: string,
    port: Transferable,
): void {
    target.postMessage(
        {
            type: "shared-unique-worker:worker-connect",
            key,
            workerUrl,
        } satisfies UniqueSharedWorkerConnectPortMessage,
        [port],
    );
}

function receiveUniqueSharedWorkerConnectPortMessage(
    data: unknown,
): UniqueSharedWorkerConnectPortMessage | null {
    return receiveUniqueSharedWorkerMessage(data) as UniqueSharedWorkerConnectPortMessage | null;
}

function sendUniqueSharedWorkerReadyMessage(port: MessagePort, workerUrl: string): void {
    port.postMessage({
        type: "shared-unique-worker:ready",
        workerUrl,
    } satisfies UniqueSharedWorkerReadyMessage);
}

function sendUniqueSharedWorkerSetupErrorMessage(port: MessagePort, message: string): void {
    port.postMessage({
        type: "shared-unique-worker:setup-error",
        message,
    } satisfies UniqueSharedWorkerSetupErrorMessage);
}

function sendUniqueSharedWorkerCloseMessage(port: UniqueSharedWorkerPort): void {
    port.postMessage({
        type: "shared-unique-worker:close",
    } satisfies UniqueSharedWorkerCloseMessage);
}

function receiveUniqueSharedWorkerCloseMessage(
    data: unknown,
): UniqueSharedWorkerCloseMessage | null {
    return receiveUniqueSharedWorkerMessage(data) as UniqueSharedWorkerCloseMessage | null;
}

function receiveUniqueSharedWorkerPortSetupMessage(
    data: unknown,
): UniqueSharedWorkerPortSetupMessage | null {
    const clientMessage = receiveSharedUniqueWorkerClientMessage(data);
    if (clientMessage !== null) return clientMessage;
    return receiveUniqueSharedWorkerMessage(data) as UniqueSharedWorkerPortSetupMessage | null;
}

function receiveUniqueSharedWorkerMessage(data: unknown): {readonly type: string} | null {
    const type = (data as {type?: unknown} | null)?.type;
    if (typeof type !== "string") return null;
    if (!type.startsWith("shared-unique-worker:")) return null;
    return data as {readonly type: string};
}

function normalizeUniqueSharedWorkerKey(key: string): string {
    return `UniqueSharedWorker(${key})`;
}

function normalizeUniqueSharedWorkerUrl(workerUrl: string | URL): string {
    return new URL(String(workerUrl), globalThis.location.href).href;
}

function createUniqueSharedWorkerLockHold(): {promise: Promise<void>; release: () => void} {
    let release!: () => void;
    const promise = new Promise<void>(resolve => {
        release = resolve;
    });
    return {promise, release};
}

function waitForUniqueSharedWorkerHandshake(
    port: UniqueSharedWorkerPort,
): Promise<{type: "ready"; workerUrl: string} | {type: "error"; error: Error}> {
    return new Promise(resolve => {
        port.onmessage = event => {
            const message = receiveUniqueSharedWorkerPortSetupMessage(event.data);
            if (message === null) return;

            switch (message.type) {
                case "shared-unique-worker:ready":
                    resolve({
                        type: "ready",
                        workerUrl: normalizeUniqueSharedWorkerUrl(message.workerUrl),
                    });
                    break;

                case "shared-unique-worker:setup-error":
                    resolve({
                        type: "error",
                        error: new FailedPreconditionError(message.message),
                    });
                    break;

                case "shared-unique-worker:connect-error":
                    resolve({
                        type: "error",
                        error: new UnavailableError(message.message),
                    });
                    break;

                case "shared-unique-worker:port":
                    break;
            }
        };
        port.start();
    });
}

function isMissingSharedUniqueWorkerLeaderError(error: Error): boolean {
    return error.message.startsWith("No shared unique worker leader for ");
}

async function delay(milliseconds: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, milliseconds));
}
