import {DatabaseActiveTabWorker} from "~/client/web/databases/database_active_tab_manager.js";
import {DatabaseClient} from "~/client/web/databases/database_client.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";

const workerSelf = globalThis as unknown as {
    postMessage(message: unknown): void;
    onmessage: ((event: MessageEvent) => void) | null;
};

(async () => {
    const dir: OpfsDirectoryHandle = await (navigator.storage as any).getDirectory();
    const client = await DatabaseClient.create(dir);

    const worker = new DatabaseActiveTabWorker(client);
    const handler = worker.createMessageHandler(message => workerSelf.postMessage(message));

    workerSelf.onmessage = event => {
        handler(event.data, [...event.ports] as Array<any>);
    };

    workerSelf.postMessage({type: "ready"});
})();
