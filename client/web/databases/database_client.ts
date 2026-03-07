import type {QueryServerResult} from "~/client/web/databases/database_rpc_methods.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/opfs.js";
import {OpfsPageStore} from "~/client/web/databases/opfs_page_store.js";
import type {Database, Sqlite3Static} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {InstalledVfs} from "~/shared/databases/install_vfs.js";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {PageMissingError} from "~/shared/databases/page_missing_error.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import {assert} from "~/shared/helpers/control/assert.js";

const vfsNamePrefix = "alpine-client";
let vfsCounter = 0;
let sqlite3Promise: Promise<Sqlite3Static> | undefined;

/**
 * Represents a connected tab's route to the server.
 * Passed into {@link DatabaseClient.executeQuery} so
 * server fallbacks route through the correct tab's
 * WebSocket connection.
 */
export interface DatabaseClientConnection {
    queryServer(sql: string): Promise<QueryServerResult>;
}

/**
 * Client-side SQLite database backed by OPFS page
 * storage. Handles server fallback transparently:
 * when a local query hits a missing page, calls
 * {@link DatabaseClientConnection.queryServer} to
 * fetch pages from the server, stores them locally,
 * and returns the server's result.
 *
 * Inject the result of `navigator.storage.getDirectory()`
 * to construct. For tests, pass an in-memory mock.
 */
export class DatabaseClient {
    private readonly db: Database;
    private readonly vfs: InstalledVfs;
    private readonly pageStore: OpfsPageStore;

    private constructor(sqlite3: Sqlite3Static, pageStore: OpfsPageStore) {
        this.pageStore = pageStore;
        const vfsName = `${vfsNamePrefix}-${vfsCounter++}`;

        this.vfs = installVfs(sqlite3, vfsName, {
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

    /**
     * Execute a query. If the local OPFS store is empty or
     * missing pages, transparently falls back to the server
     * via the connection's {@link DatabaseClientConnection.queryServer},
     * stores the returned pages locally, and returns the
     * server result.
     */
    async executeQuery(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<ReadonlyArray<Record<string, unknown>>> {
        if (this.isEmpty()) {
            try {
                return await this.executeQueryViaServer(conn, sql);
            } catch {
                // Server unavailable — fall through to local
            }
        }
        try {
            return this.executeQueryLocally(sql);
        } catch (error) {
            if (error instanceof PageMissingError) {
                return this.executeQueryViaServer(conn, sql);
            }
            throw error;
        }
    }

    /**
     * Write pages received from realtime events into the
     * local OPFS store, skipping pages that are already at
     * a newer timestamp.
     */
    writePagesFromRealtime(
        pages: ReadonlyArray<{pageIndex: number; timestamp: number; data: Uint8Array}>,
    ): void {
        for (const page of pages) {
            this.pageStore.writePageIfNewer(page.pageIndex, page.timestamp, page.data);
        }
        this.pageStore.sync();
    }

    isEmpty(): boolean {
        return this.pageStore.isEmpty();
    }

    private executeQueryLocally(sql: string): ReadonlyArray<Record<string, unknown>> {
        try {
            return this.db.exec(sql, {
                returnValue: "resultRows",
                rowMode: "object",
            }) as ReadonlyArray<Record<string, unknown>>;
        } catch (error) {
            const stashed = this.vfs.takeError();
            if (stashed !== null) {
                if (stashed instanceof Error) {
                    stashed.cause = error;
                }
                throw stashed;
            }
            throw error;
        }
    }

    private async executeQueryViaServer(
        conn: DatabaseClientConnection,
        sql: string,
    ): Promise<ReadonlyArray<Record<string, unknown>>> {
        const result = await conn.queryServer(sql);
        this.writePagesFromRealtime(result.pages);
        return result.rows as ReadonlyArray<Record<string, unknown>>;
    }

    /** Exposed for tests only. Do not use in production code. */
    unsafeGetDbForTests(): Database {
        assert(import.meta.jest);
        return this.db;
    }
}
