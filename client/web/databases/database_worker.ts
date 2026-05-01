import {DatabaseActiveTabWorker} from "~/client/web/databases/database_active_tab_manager.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";

const workerSelf = globalThis as unknown as {
    postMessage(message: unknown): void;
    onmessage: ((event: MessageEvent) => void) | null;
};

(async () => {
    const root: OpfsDirectoryHandle = await (navigator.storage as any).getDirectory();
    const dir = await root.getDirectoryHandle("databaseGroups", {create: true});

    const worker = new DatabaseActiveTabWorker(dir);
    const handler = worker.createMessageHandler(message => workerSelf.postMessage(message));

    workerSelf.onmessage = event => {
        handler(event.data, [...event.ports] as Array<any>);
    };

    workerSelf.postMessage({type: "ready"});
})();
