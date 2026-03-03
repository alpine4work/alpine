import {DatabaseClient} from "~/client/web/databases/database_client.js";
import {databaseWorkerMethods} from "~/client/web/databases/database_worker_methods.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {WebWorkerRpc} from "~/client/web/helpers/workers/web_worker_rpc.js";
import type {SchemaSerializedValue} from "~/shared/schema/schema.js";

const workerSelf = globalThis as unknown as {
    postMessage(message: unknown): void;
    onmessage: ((event: MessageEvent) => void) | null;
};

function createRpcHandler(
    client: DatabaseClient,
    send: (message: unknown) => void,
): WebWorkerRpc<typeof databaseWorkerMethods> {
    return new WebWorkerRpc({
        methods: databaseWorkerMethods,
        handlers: {
            executeQuery: async input => {
                const rows = client.executeQuery(input.sql) as ReadonlyArray<SchemaSerializedValue>;
                return {rows};
            },
        },
        send,
    });
}

(async () => {
    const dir: OpfsDirectoryHandle = await (navigator.storage as any).getDirectory();
    const client = await DatabaseClient.create(dir);

    const mainRpc = createRpcHandler(client, message => workerSelf.postMessage(message));

    workerSelf.onmessage = event => {
        const data = event.data;
        if (data?.type === "port") {
            // New remote connection from a follower tab
            const port: MessagePort = event.ports[0]!;
            const remoteRpc = createRpcHandler(client, message => port.postMessage(message));
            port.onmessage = e => remoteRpc.handleMessage(e.data);
            port.start();
        } else {
            mainRpc.handleMessage(data);
        }
    };

    workerSelf.postMessage({type: "ready"});
})();
