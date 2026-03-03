import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {OpfsPageStore} from "~/client/web/databases/opfs_page_store.js";
import type {Database, Sqlite3Static} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import {assert} from "~/shared/helpers/control/assert.js";

const vfsNamePrefix = "alpine-client";
let vfsCounter = 0;
let sqlite3Promise: Promise<Sqlite3Static> | undefined;

/**
 * Client-side SQLite database backed by OPFS page
 * storage. Mirrors the {@link DatabaseServer} pattern
 * but allows mutations (no authorizer or rollback
 * isolation).
 *
 * Inject the result of `navigator.storage.getDirectory()`
 * to construct. For tests, pass an in-memory mock.
 */
export class DatabaseClient {
    private readonly db: Database;

    private constructor(sqlite3: Sqlite3Static, pageStore: OpfsPageStore) {
        const vfsName = `${vfsNamePrefix}-${vfsCounter++}`;

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

        this.db = new sqlite3.oo1.DB("/db.sqlite3", "ct", vfsName);
        this.db.exec("PRAGMA page_size = 4096");
        this.db.exec("PRAGMA journal_mode = MEMORY");
    }

    static async create(dir: OpfsDirectoryHandle): Promise<DatabaseClient> {
        if (sqlite3Promise === undefined) {
            sqlite3Promise = sqlite3InitModule();
        }
        const sqlite3 = await sqlite3Promise;

        const dbDir = await dir.getDirectoryHandle("databases", {create: true});
        const pageStore = await OpfsPageStore.create(dbDir);

        return new DatabaseClient(sqlite3, pageStore);
    }

    executeQuery(sql: string): ReadonlyArray<Record<string, unknown>> {
        return this.db.exec(sql, {
            returnValue: "resultRows",
            rowMode: "object",
        }) as ReadonlyArray<Record<string, unknown>>;
    }

    /** Exposed for tests only. Do not use in production code. */
    unsafeGetDbForTests(): Database {
        assert(import.meta.jest);
        return this.db;
    }
}
