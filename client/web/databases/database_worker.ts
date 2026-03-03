import {databaseWorkerMethods} from "~/client/web/databases/database_worker_methods.js";
import {WebWorkerRpc} from "~/client/web/helpers/workers/web_worker_rpc.js";
import type {Database, Sqlite3Static} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import type {SchemaSerializedValue} from "~/shared/schema/schema.js";

const workerSelf = globalThis as unknown as {
    postMessage(message: unknown): void;
    onmessage: ((event: {data: unknown}) => void) | null;
};

let db: Database;

function initDatabase(sqlite3: Sqlite3Static): Database {
    const vfsName = "alpine-client-memory";

    installVfs(sqlite3, vfsName, {
        open: () => new VfsTempFile(),
        delete: () => {},
        access: () => false,
    });

    const database = new sqlite3.oo1.DB("/db.sqlite3", "ct", vfsName);
    database.exec("PRAGMA page_size = 4096");
    database.exec("PRAGMA journal_mode = MEMORY");
    return database;
}

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

sqlite3InitModule().then(sqlite3 => {
    db = initDatabase(sqlite3);
    workerSelf.postMessage({type: "ready"});
});
