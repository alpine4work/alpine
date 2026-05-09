import type {
    Database,
    Sqlite3Static,
    WasmPointer,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import {
    type DatabaseActionName,
    type DatabaseActionObject,
    type DatabaseActionOutput,
    databaseActions,
} from "~/shared/databases/database_actions.js";
import type {InstalledVfs, VfsFile} from "~/shared/databases/install_vfs.js";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {sql} from "~/shared/databases/sql.js";
import {trySqlite3WasmLoader} from "~/shared/databases/sqlite3_wasm_loader.js";
import type {SqliteWriteLevel} from "~/shared/databases/sqlite_authorizer.js";
import {
    isSqliteActionAllowed,
    sqliteAuthorizerActionName,
} from "~/shared/databases/sqlite_authorizer.js";
import {
    databaseMainTableId,
    pageAccessFlagRead,
    sqliteOpenPragmas,
    sqlitePageSize,
} from "~/shared/databases/sqlite_constants.js";
import {registerSqliteCustomFunctions} from "~/shared/databases/sqlite_custom_functions.js";
import {runSqliteMigrations} from "~/shared/databases/sqlite_migrations.js";
import {installTracing} from "~/shared/databases/sqlite_tracing.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema} from "~/shared/schema/schema.js";

const vfsNamePrefix = "alpine-server";
let vfsCounter = 0;

let sqlite3Promise: Promise<Sqlite3Static> | undefined;

type DatabaseServerAction =
    | {type: "idle"}
    | {
          type: "execute";
          allowWrites: SqliteWriteLevel;
          readPages: Map<number, {data: Uint8Array; version: number}>;
          changedPages: Map<number, DatabaseServerPageChange>;
          version: number;
      };

export interface DatabaseServerPageChange {
    before: Uint8Array;
    after: Uint8Array;
}

export interface DatabaseServerResult {
    rows: Array<Record<string, unknown>>;
    readPages: Map<number, {data: Uint8Array; version: number}>;
    changedPages: Map<number, DatabaseServerPageChange>;
}

/**
 * Runs a canonical SQLite database backed by a
 * {@link DatabaseServerStorage} implementation.
 */
export class DatabaseServer {
    private readonly db: Database;
    private readonly storage: DatabaseServerStorage;
    private readonly vfs: InstalledVfs;
    private action: DatabaseServerAction = {type: "idle"};
    private readonly tempFiles = new Map<string, VfsTempFile>();

    private constructor(sqlite3: Sqlite3Static, storage: DatabaseServerStorage) {
        this.storage = storage;

        const capi = sqlite3.capi;
        const name = `${vfsNamePrefix}-${vfsCounter++}`;

        this.vfs = installVfs(sqlite3, name, {
            open: (filename, flags) => {
                if (flags & capi.SQLITE_OPEN_MAIN_DB) {
                    return this.openMainDatabaseFile();
                }
                if (flags & (capi.SQLITE_OPEN_TEMP_DB | capi.SQLITE_OPEN_TEMP_JOURNAL)) {
                    const file = new VfsTempFile();
                    if (filename !== null) {
                        this.tempFiles.set(filename, file);
                    }
                    return file;
                }
                throw new UnimplementedError(
                    `Unsupported file type: flags=0x${flags.toString(16)}`,
                );
            },

            delete: filename => {
                this.tempFiles.delete(filename);
            },

            access: filename => {
                return this.tempFiles.has(filename);
            },
        });

        this.db = new sqlite3.oo1.DB("/db.sqlite3", "c", name);
        installTracing(this.db);

        capi.sqlite3_set_authorizer(
            this.db.pointer!,
            (_cbArg: WasmPointer, actionCode: number) => {
                const action = sqliteAuthorizerActionName(actionCode);
                if (action === undefined) {
                    return capi.SQLITE_DENY;
                }
                const writeLevel = this.action.type === "idle" ? null : this.action.allowWrites;
                return isSqliteActionAllowed(action, writeLevel)
                    ? capi.SQLITE_OK
                    : capi.SQLITE_DENY;
            },
            0,
        );

        registerSqliteCustomFunctions(sqlite3, this.db);

        for (const pragma of sqliteOpenPragmas) {
            this.db.exec(pragma);
        }
        this.db.exec("PRAGMA quick_check");
        runSqliteMigrations(this.db);

        // Seed a default table for new databases.
        const tableCount = sql`
            SELECT
                COUNT(*)
            FROM
                _alpine_tables
        `.selectValue(this.db, Schema.integer);
        if (tableCount === 0) {
            databaseActions.createTable.run(this.db, {name: "Table"});
        }

        this.db.exec("PRAGMA optimize");
    }

    static async create(storage: DatabaseServerStorage): Promise<DatabaseServer> {
        if (sqlite3Promise === undefined) {
            const instantiateWasm = trySqlite3WasmLoader();
            sqlite3Promise = sqlite3InitModule(instantiateWasm ? {instantiateWasm} : undefined);
        }
        const sqlite3 = await sqlite3Promise;
        return new DatabaseServer(sqlite3, storage);
    }

    execute(query: string, options: {allowWrites: SqliteWriteLevel}): DatabaseServerResult {
        const {
            result: rows,
            readPages,
            changedPages,
        } = this._executeInTransaction(options.allowWrites, db => {
            return sql.raw(query).selectAllUnknown(db);
        });
        return {rows, readPages, changedPages};
    }

    executeAction<N extends DatabaseActionName>(
        actionObject: DatabaseActionObject<N>,
    ): {
        result: DatabaseActionOutput<N>;
        readPages: Map<number, {data: Uint8Array; version: number}>;
        changedPages: Map<number, DatabaseServerPageChange>;
    } {
        const action = databaseActions[actionObject.name];
        return this._executeInTransaction(
            action.writeLevel,
            db => action.run(db, actionObject.input as any) as DatabaseActionOutput<N>,
        );
    }

    private _executeInTransaction<T>(
        writeLevel: SqliteWriteLevel,
        fn: (db: Database) => T,
    ): {
        result: T;
        readPages: Map<number, {data: Uint8Array; version: number}>;
        changedPages: Map<number, DatabaseServerPageChange>;
    } {
        this.action = {
            type: "execute",
            allowWrites: writeLevel,
            readPages: new Map(),
            changedPages: new Map(),
            version: 0,
        };
        this.db.exec("BEGIN");
        this.db.pageAccessHook((_pArg, pgno, flags) => {
            if (flags === pageAccessFlagRead && this.action.type === "execute") {
                const pageIndex = pgno - 1;
                if (!this.action.readPages.has(pageIndex)) {
                    // Page was in SQLite's cache (xRead wasn't
                    // called), so read from storage.
                    const page = this.storage.readPage(databaseMainTableId, pageIndex);
                    const data =
                        page !== null && page.data !== null
                            ? page.data
                            : new Uint8Array(sqlitePageSize);
                    const version = page?.version ?? 0;
                    this.action.readPages.set(pageIndex, {data: new Uint8Array(data), version});
                }
            }
        });
        try {
            const result = fn(this.db);

            // Run PRAGMA optimize after schema+data actions
            // so that any ANALYZE updates are included in the
            // committed page changes sent via realtime.
            if (writeLevel === "schema+data") {
                this.db.exec("PRAGMA optimize");
            }

            if (writeLevel !== "none") {
                this.db.exec("COMMIT");
                assert(this.action.type === "execute");

                // Update read pages with post-write data for
                // changed pages so callers see the latest state.
                for (const [pageIndex, change] of this.action.changedPages) {
                    this.action.readPages.set(pageIndex, {
                        data: change.after,
                        version: this.action.version,
                    });
                }
            }

            assert(this.action.type === "execute");
            return {
                result,
                readPages: this.action.readPages,
                changedPages: this.action.changedPages,
            };
        } catch (error) {
            if (writeLevel !== "none") {
                this.db.exec("ROLLBACK");
            }
            const stashed = this.vfs.takeError();
            if (stashed !== null) {
                if (stashed instanceof Error) {
                    stashed.cause = error;
                }
                throw stashed;
            }
            throw error;
        } finally {
            if (writeLevel === "none") {
                this.db.exec("ROLLBACK");
            }
            this.db.pageAccessHook(null);
            this.action = {type: "idle"};
            this.vfs.takeError();
            this.tempFiles.clear();
        }
    }

    private openMainDatabaseFile(): VfsFile {
        const pendingWrites = new Map<number, Uint8Array>();

        return {
            read: (data, offset) => {
                const pageIndex = Math.floor(offset / sqlitePageSize);
                assert(
                    Math.floor((offset + data.byteLength - 1) / sqlitePageSize) === pageIndex,
                    `read spans pages: offset=${offset} amount=${data.byteLength}`,
                );

                // Check pending writes first — if SQLite evicted a
                // dirty page from its cache, the buffered version is
                // the correct one.
                const pending = pendingWrites.get(pageIndex);
                if (pending !== undefined) {
                    const pageOffset = offset % sqlitePageSize;
                    data.set(pending.subarray(pageOffset, pageOffset + data.byteLength));
                    return true;
                }

                const fileSize = this.storage.getFileSize(databaseMainTableId);
                if (offset >= fileSize) {
                    data.fill(0);
                    return false;
                }

                const page = this.storage.readPage(databaseMainTableId, pageIndex);
                const pageData =
                    page !== null && page.data !== null
                        ? page.data
                        : new Uint8Array(sqlitePageSize);

                // Stash database pages so the pageAccessHook
                // doesn't double-read them.
                if (this.action.type === "execute" && !this.action.readPages.has(pageIndex)) {
                    this.action.readPages.set(pageIndex, {
                        data: new Uint8Array(pageData),
                        version: page?.version ?? 0,
                    });
                }

                const pageOffset = offset % sqlitePageSize;
                data.set(pageData.subarray(pageOffset, pageOffset + data.byteLength));
                return true;
            },

            write: (data, offset) => {
                assert(offset % sqlitePageSize === 0, `write offset ${offset} not page-aligned`);
                assert(
                    data.byteLength === sqlitePageSize,
                    `write amount ${data.byteLength} !== ${sqlitePageSize}`,
                );
                const pageIndex = offset / sqlitePageSize;

                if (this.action.type === "execute" && this.action.allowWrites !== "none") {
                    const existing = this.action.changedPages.get(pageIndex);
                    if (existing === undefined) {
                        // Capture the before state. Check pending
                        // writes first in case the page was written
                        // earlier in the same transaction.
                        const before =
                            pendingWrites.get(pageIndex) ??
                            this.storage.readPage(databaseMainTableId, pageIndex)?.data ??
                            new Uint8Array(sqlitePageSize);
                        this.action.changedPages.set(pageIndex, {
                            before: new Uint8Array(before),
                            after: new Uint8Array(data),
                        });
                    } else {
                        existing.after = new Uint8Array(data);
                    }
                }

                pendingWrites.set(pageIndex, new Uint8Array(data));
            },

            truncate: size => {
                this.storage.truncate(databaseMainTableId, size);
            },

            sync: () => {
                if (pendingWrites.size > 0) {
                    const version = this.storage.writePages(databaseMainTableId, pendingWrites);
                    pendingWrites.clear();
                    if (this.action.type === "execute") {
                        this.action.version = version;
                    }
                }
            },

            fileSize: () => {
                let size = this.storage.getFileSize(databaseMainTableId);
                for (const [index] of pendingWrites) {
                    const end = (index + 1) * sqlitePageSize;
                    if (end > size) size = end;
                }
                return size;
            },

            close: () => {},
        };
    }

    /** Exposed for tests only. Do not use in production code. */
    unsafeGetDbForTests(): Database {
        assert(import.meta.jest);
        return this.db;
    }

    close(): void {
        this.db.close();
    }
}
