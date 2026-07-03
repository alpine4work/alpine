import {DatabaseActiveTabWorker} from "~/client/web/databases/database_active_tab_worker.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";

// Entry script for the databases unique worker. The host must attach before the
// first `connect-port` message can arrive, so OPFS initialization happens behind a
// promise while the message listener is installed synchronously.
const dir: Promise<OpfsDirectoryHandle> = (async () => {
    const root: OpfsDirectoryHandle = await (navigator.storage as any).getDirectory();
    return await root.getDirectoryHandle("databases", {create: true});
})();

const worker = new DatabaseActiveTabWorker(dir);
worker.host.listen();
