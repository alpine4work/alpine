import {readUniqueWorkerMessage} from "~/client/web/helpers/workers/unique_worker_message.js";
import {WebWorkerRpc, WebWorkerRpcHandlers} from "~/client/web/helpers/workers/web_worker_rpc.js";
import {WebWorkerRpcMethodDefinitions} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SchemaType} from "~/shared/schema/schema.js";

/**
 * Handlers for tab → worker calls. Unlike plain {@link WebWorkerRpc} handlers,
 * these also receive the connection the call arrived on, so worker-side state can
 * be scoped per tab and results can be pushed back to the right tab.
 */
export type UniqueWorkerHostHandlers<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> = {
    readonly [K in keyof WorkerDef]: (
        input: SchemaType<WorkerDef[K]["inputSchema"]>,
        connection: UniqueWorkerHostConnection<WorkerDef, TabDef>,
    ) => Promise<SchemaType<WorkerDef[K]["outputSchema"]>>;
};

export interface UniqueWorkerHostOptions<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    /** Methods tabs can call on this worker. */
    workerMethods: WorkerDef;
    /** Methods this worker can call on connected tabs. */
    tabMethods: TabDef;
    handlers: UniqueWorkerHostHandlers<WorkerDef, TabDef>;
    onConnect?(connection: UniqueWorkerHostConnection<WorkerDef, TabDef>): void;
    onDisconnect?(connection: UniqueWorkerHostConnection<WorkerDef, TabDef>): void;
}

/**
 * One connected tab, as seen from inside the dedicated worker. Use {@link call} to
 * push worker → tab notifications.
 */
export class UniqueWorkerHostConnection<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    constructor(private readonly rpc: WebWorkerRpc<TabDef, WorkerDef>) {}

    async call<K extends string & keyof TabDef>(
        method: K,
        input: SchemaType<TabDef[K]["inputSchema"]>,
    ): Promise<SchemaType<TabDef[K]["outputSchema"]>> {
        return await this.rpc.call(method, input);
    }
}

/**
 * Runs inside the dedicated worker owned by the current leader tab. Accepts
 * connection ports — the leader tab's own port and follower ports relayed through
 * the broker — and serves typed RPC on each. All connections are treated
 * identically; the host doesn't know or care which tab is the leader.
 *
 * Wire it up in the worker entry script:
 *
 * ```ts
 * const host = new UniqueWorkerHost({...});
 * host.listen();
 * ```
 *
 * Tests call {@link handleMessage} directly instead of {@link listen}.
 */
export class UniqueWorkerHost<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    private readonly connectionsMutable: Array<UniqueWorkerHostConnection<WorkerDef, TabDef>> = [];

    constructor(private readonly options: UniqueWorkerHostOptions<WorkerDef, TabDef>) {}

    /** All currently connected tabs. */
    get connections(): ReadonlyArray<UniqueWorkerHostConnection<WorkerDef, TabDef>> {
        return this.connectionsMutable;
    }

    /**
     * Process one message posted to the worker. Only `connect-port` messages (with
     * their transferred port) are meaningful; everything else is ignored.
     */
    handleMessage(data: unknown, ports: ReadonlyArray<MessagePort>): void {
        const message = readUniqueWorkerMessage(data);
        if (message === null || message.type !== "unique-worker:connect-port") return;
        const port = ports[0];
        if (port === undefined) return;
        this.connectPort(port);
    }

    /** Attach to the real worker global scope. */
    listen(): void {
        globalThis.addEventListener("message", event => {
            const messageEvent = event as MessageEvent;
            this.handleMessage(messageEvent.data, [...messageEvent.ports]);
        });
    }

    private connectPort(port: MessagePort): void {
        const rpc: WebWorkerRpc<TabDef, WorkerDef> = new WebWorkerRpc({
            callMethods: this.options.tabMethods,
            handleMethods: this.options.workerMethods,
            handlers: this.createRpcHandlers(() => connection),
            send: message => port.postMessage(message),
        });
        const connection = new UniqueWorkerHostConnection<WorkerDef, TabDef>(rpc);

        const disconnect = () => {
            const index = this.connectionsMutable.indexOf(connection);
            if (index === -1) return;
            this.connectionsMutable.splice(index, 1);
            this.options.onDisconnect?.(connection);
            port.close();
        };

        port.onmessage = event => {
            const message = readUniqueWorkerMessage(event.data);
            if (message !== null) {
                if (message.type === "unique-worker:close-port") {
                    disconnect();
                }
                return;
            }
            rpc.handleMessage(event.data);
        };
        // `close` fires when the other side's context is destroyed. Not supported by every
        // browser yet; where it's missing, crashed tabs are cleaned up only by their own
        // `close-port` message (i.e. never), which just leaks the connection entry.
        port.addEventListener("close", disconnect);
        port.start();

        this.connectionsMutable.push(connection);
        this.options.onConnect?.(connection);
        port.postMessage({type: "unique-worker:ready"});
    }

    private createRpcHandlers(
        getConnection: () => UniqueWorkerHostConnection<WorkerDef, TabDef>,
    ): WebWorkerRpcHandlers<WorkerDef> {
        const handlers: Record<string, (input: any) => Promise<any>> = {};
        for (const name of Object.keys(this.options.workerMethods)) {
            const handler = assertExists(this.options.handlers[name]);
            handlers[name] = async input => await handler(input, getConnection());
        }
        return handlers as WebWorkerRpcHandlers<WorkerDef>;
    }
}
