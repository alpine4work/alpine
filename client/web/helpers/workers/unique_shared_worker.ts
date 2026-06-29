import {WebWorkerRpcHandlers} from "~/client/web/helpers/workers/web_worker_rpc.js";
import {
    defineWebWorkerRpcMethods,
    WebWorkerRpcMethodDefinitions,
} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {SchemaType, Schema} from "~/shared/schema/schema.js";

interface UniqueSharedWorkerOptions<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    workerUrl: string;
    workerMethods: WorkerDef;
    tabMethods: TabDef;
    handlers: WebWorkerRpcHandlers<TabDef>;
    onReconnect?: () => void;
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
    onConnect?: (connection: UniqueSharedWorkerConnection<WorkerDef, TabDef>) => void;
    onDisconnect?: (connection: UniqueSharedWorkerConnection<WorkerDef, TabDef>) => void;
}

/**
 * Connects to a shared unique worker, or creates one if it doesn't exist.
 */
class UniqueSharedWorker<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    static async connect<
        WorkerDef extends WebWorkerRpcMethodDefinitions,
        TabDef extends WebWorkerRpcMethodDefinitions,
    >(key: string, options: UniqueSharedWorkerOptions<WorkerDef, TabDef>) {
        key = `UniqueSharedWorker(${key})`;
    }

    async call<K extends keyof WorkerDef>(
        method: K,
        input: SchemaType<WorkerDef[K]["inputSchema"]>,
    ): Promise<SchemaType<WorkerDef[K]["outputSchema"]>>;
}

/**
 * a leader instance inside a worker.
 */
class UniqueSharedWorkerLeader<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    constructor(
        private readonly key: string,
        options: UniqueSharedWorkerLeaderOptions<WorkerDef, TabDef>,
    ) {}

    connections: ReadonlyArray<UniqueSharedWorkerConnection<WorkerDef, TabDef>> = [];

    ready(): void;
}

class UniqueSharedWorkerConnection<
    WorkerDef extends WebWorkerRpcMethodDefinitions,
    TabDef extends WebWorkerRpcMethodDefinitions,
> {
    async call<K extends string & keyof TabDef>(
        method: K,
        input: SchemaType<TabDef[K]["inputSchema"]>,
    ): Promise<SchemaType<TabDef[K]["outputSchema"]>>;
}

// usage: in shared.js:
const workerMethods = defineWebWorkerRpcMethods({
    setValue: {
        input: {
            value: Schema.string,
        },
        output: {},
    },
});

const tabMethods = defineWebWorkerRpcMethods({
    onSomethingHappened: {
        input: {
            value: Schema.string,
        },
        output: {},
    },
});

// in tab.js:
const worker = await UniqueSharedWorker.connect("my-thing", {
    workerUrl: "...",
    workerMethods,
    tabMethods,
    handlers: {
        async onSomethingHappened({value}) {
            console.log("something happened!", value);
            return {};
        },
    },
});

// in worker.js:
new UniqueSharedWorkerLeader("my-thing", {
    workerMethods,
    tabMethods,
    handlers: {
        async setValue({value}) {
            for (const connection of this.connections) {
                await connection.call("onSomethingHappened", {value});
            }
            return {};
        },
    },
}).ready();
