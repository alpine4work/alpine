import type {
    Database,
    Sqlite3Static,
    WasmPointer,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import type {InstalledVfs, VfsFile} from "~/shared/databases/install_vfs.js";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

const pageSize = 4096;
const vfsNamePrefix = "alpine-server";
let vfsCounter = 0;

let sqlite3Promise: Promise<Sqlite3Static> | undefined;

type DatabaseServerAction =
    | {type: "idle"}
    | {type: "query"; pages: Map<number, Uint8Array>}
    | {type: "mutate"; changedPages: Map<number, DatabaseServerPageChange>};

export interface DatabaseServerQueryResult {
    rows: Array<Record<string, unknown>>;
    pages: Map<number, Uint8Array>;
}

export interface DatabaseServerPageChange {
    before: Uint8Array;
    after: Uint8Array;
}

export interface DatabaseServerMutateResult {
    rows: Array<Record<string, unknown>>;
    changedPages: Map<number, DatabaseServerPageChange>;
}

// Mapping from SQLite authorizer action codes to
// human-readable names.
// prettier-ignore
const authorizerActionNames = [
    undefined,             // 0
    "create-index",        // 1  SQLITE_CREATE_INDEX
    "create-table",        // 2  SQLITE_CREATE_TABLE
    "create-temp-index",   // 3  SQLITE_CREATE_TEMP_INDEX
    "create-temp-table",   // 4  SQLITE_CREATE_TEMP_TABLE
    "create-temp-trigger", // 5  SQLITE_CREATE_TEMP_TRIGGER
    "create-temp-view",    // 6  SQLITE_CREATE_TEMP_VIEW
    "create-trigger",      // 7  SQLITE_CREATE_TRIGGER
    "create-view",         // 8  SQLITE_CREATE_VIEW
    "delete",              // 9  SQLITE_DELETE
    "drop-index",          // 10 SQLITE_DROP_INDEX
    "drop-table",          // 11 SQLITE_DROP_TABLE
    "drop-temp-index",     // 12 SQLITE_DROP_TEMP_INDEX
    "drop-temp-table",     // 13 SQLITE_DROP_TEMP_TABLE
    "drop-temp-trigger",   // 14 SQLITE_DROP_TEMP_TRIGGER
    "drop-temp-view",      // 15 SQLITE_DROP_TEMP_VIEW
    "drop-trigger",        // 16 SQLITE_DROP_TRIGGER
    "drop-view",           // 17 SQLITE_DROP_VIEW
    "insert",              // 18 SQLITE_INSERT
    "pragma",              // 19 SQLITE_PRAGMA
    "read",                // 20 SQLITE_READ
    "select",              // 21 SQLITE_SELECT
    "transaction",         // 22 SQLITE_TRANSACTION
    "update",              // 23 SQLITE_UPDATE
    "attach",              // 24 SQLITE_ATTACH
    "detach",              // 25 SQLITE_DETACH
    "alter-table",         // 26 SQLITE_ALTER_TABLE
    "reindex",             // 27 SQLITE_REINDEX
    "analyze",             // 28 SQLITE_ANALYZE
    "create-vtable",       // 29 SQLITE_CREATE_VTABLE
    "drop-vtable",         // 30 SQLITE_DROP_VTABLE
    "function",            // 31 SQLITE_FUNCTION
    "savepoint",           // 32 SQLITE_SAVEPOINT
    "recursive",           // 33 SQLITE_RECURSIVE
] as const;

type AuthorizerAction = Exclude<(typeof authorizerActionNames)[number], undefined>;

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

        this.db = new sqlite3.oo1.DB("/db.sqlite3", "ct", name);

        capi.sqlite3_set_authorizer(
            this.db.pointer!,
            (_cbArg: WasmPointer, actionCode: number) => {
                const action = authorizerActionNames[actionCode];
                if (action === undefined) {
                    return capi.SQLITE_DENY;
                }
                return this.isAllowed(action) ? capi.SQLITE_OK : capi.SQLITE_DENY;
            },
            0,
        );

        this.db.exec(`PRAGMA page_size = ${pageSize}`);
        this.db.exec("PRAGMA journal_mode = OFF");
    }

    static async create(storage: DatabaseServerStorage): Promise<DatabaseServer> {
        if (sqlite3Promise === undefined) {
            sqlite3Promise = sqlite3InitModule();
        }
        const sqlite3 = await sqlite3Promise;
        return new DatabaseServer(sqlite3, storage);
    }

    query(sql: string): DatabaseServerQueryResult {
        this.db.exec("BEGIN");
        this.action = {type: "query", pages: new Map()};
        this.db.pageAccessHook((_pArg, pgno, flags) => {
            if (flags === 1 && this.action.type === "query") {
                const pageIndex = pgno - 1;
                if (!this.action.pages.has(pageIndex)) {
                    // Page was in SQLite's cache (xRead wasn't
                    // called), so read from storage.
                    this.action.pages.set(
                        pageIndex,
                        new Uint8Array(this.storage.readPage(pageIndex)),
                    );
                }
            }
        });
        try {
            const rows = this.db.exec(sql, {
                returnValue: "resultRows",
                rowMode: "object",
            }) as Array<Record<string, unknown>>;
            const pages = (this.action as {type: "query"; pages: Map<number, Uint8Array>}).pages;
            return {rows, pages};
        } catch (error) {
            const stashed = this.vfs.takeError();
            if (stashed !== null) {
                if (stashed instanceof Error) {
                    stashed.cause = error;
                }
                throw stashed;
            }
            throw error;
        } finally {
            this.db.exec("ROLLBACK");
            this.db.pageAccessHook(null);
            this.action = {type: "idle"};
            this.vfs.takeError();
            this.tempFiles.clear();
        }
    }

    mutate(sql: string): DatabaseServerMutateResult {
        this.action = {type: "mutate", changedPages: new Map()};
        this.db.exec("BEGIN");
        try {
            const rows = this.db.exec(sql, {
                returnValue: "resultRows",
                rowMode: "object",
            }) as Array<Record<string, unknown>>;
            this.db.exec("COMMIT");
            const changedPages = (
                this.action as {
                    type: "mutate";
                    changedPages: Map<number, DatabaseServerPageChange>;
                }
            ).changedPages;
            return {rows, changedPages};
        } catch (error) {
            try {
                this.db.exec("ROLLBACK");
            } catch {
                // With journal_mode=OFF, ROLLBACK may not be
                // able to undo partial writes.
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
            this.action = {type: "idle"};
            this.vfs.takeError();
            this.tempFiles.clear();
        }
    }

    private isAllowed(action: AuthorizerAction): boolean {
        if (this.action.type === "idle") {
            return true;
        }
        switch (this.action.type) {
            case "query":
                switch (action) {
                    case "read":
                    case "select":
                    case "transaction":
                    case "function":
                    case "recursive":
                        return true;
                    default:
                        return false;
                }
            case "mutate":
                return action !== "pragma";
        }
    }

    private openMainDatabaseFile(): VfsFile {
        return {
            read: (data, offset) => {
                const fileSize = this.storage.getFileSize();

                if (offset >= fileSize) {
                    data.fill(0);
                    return false;
                }

                const pageIndex = Math.floor(offset / pageSize);
                assert(
                    Math.floor((offset + data.byteLength - 1) / pageSize) === pageIndex,
                    `read spans pages: offset=${offset} amount=${data.byteLength}`,
                );

                const page = this.storage.readPage(pageIndex);

                // When in query mode, stash database pages so
                // the pageAccessHook doesn't double-read them.
                if (this.action.type === "query" && !this.action.pages.has(pageIndex)) {
                    this.action.pages.set(pageIndex, new Uint8Array(page));
                }

                const pageOffset = offset % pageSize;
                data.set(page.subarray(pageOffset, pageOffset + data.byteLength));
                return true;
            },

            write: (data, offset) => {
                assert(offset % pageSize === 0, `write offset ${offset} not page-aligned`);
                assert(
                    data.byteLength === pageSize,
                    `write amount ${data.byteLength} !== ${pageSize}`,
                );
                const pageIndex = offset / pageSize;

                if (this.action.type === "mutate") {
                    const existing = this.action.changedPages.get(pageIndex);
                    if (existing === undefined) {
                        this.action.changedPages.set(pageIndex, {
                            before: new Uint8Array(this.storage.readPage(pageIndex)),
                            after: new Uint8Array(data),
                        });
                    } else {
                        existing.after = new Uint8Array(data);
                    }
                }

                this.storage.writePage(pageIndex, new Uint8Array(data));
            },

            truncate: size => {
                this.storage.truncate(size);
            },

            sync: () => {
                this.storage.flush();
            },

            fileSize: () => {
                return this.storage.getFileSize();
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
