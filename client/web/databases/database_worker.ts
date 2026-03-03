import {databaseWorkerMethods} from "~/client/web/databases/database_worker_methods.js";
import {OpfsPageStore} from "~/client/web/databases/opfs_page_store.js";
import {WebWorkerRpc} from "~/client/web/helpers/workers/web_worker_rpc.js";
import type {Database} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import type {SchemaSerializedValue} from "~/shared/schema/schema.js";

const workerSelf = globalThis as unknown as {
    postMessage(message: unknown): void;
    onmessage: ((event: {data: unknown}) => void) | null;
};

let db: Database;

const rpc = new WebWorkerRpc({
    methods: databaseWorkerMethods,
    handlers: {
        executeQuery: async input => {
            const rows = db.exec(input.sql, {
                returnValue: "resultRows",
                rowMode: "object",
            }) as ReadonlyArray<SchemaSerializedValue>;
            return {rows};
        },
    },
    send: message => workerSelf.postMessage(message),
});

workerSelf.onmessage = event => {
    rpc.handleMessage(event.data);
};

sqlite3InitModule().then(async sqlite3 => {
    const pageStore = await OpfsPageStore.create();
    const vfsName = "alpine-client-opfs";

    installVfs(sqlite3, vfsName, {
        open: (_filename, flags) => {
            if (flags & sqlite3.capi.SQLITE_OPEN_MAIN_DB) {
                return pageStore;
            }
            return new VfsTempFile();
        },
        delete: () => {},
        access: () => false,
    });

    db = new sqlite3.oo1.DB("/db.sqlite3", "ct", vfsName);
    db.exec("PRAGMA page_size = 4096");
    db.exec("PRAGMA journal_mode = MEMORY");

    workerSelf.postMessage({type: "ready"});
});
