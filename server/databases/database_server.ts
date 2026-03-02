import type {
    Database,
    Sqlite3Static,
    WasmPointer,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
import type {VfsFile} from "~/shared/databases/install_vfs.js";
import {installVfs} from "~/shared/databases/install_vfs.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

const pageSize = 4096;
const vfsNamePrefix = "alpine-server";
let vfsCounter = 0;

let sqlite3Promise: Promise<Sqlite3Static> | undefined;

type DatabaseServerAction = {type: "idle"} | {type: "query"; pages: Map<number, Uint8Array>};

export interface DatabaseServerQueryResult {
    rows: Array<Record<string, unknown>>;
    pages: Map<number, Uint8Array>;
}

// Action codes denied by the authorizer during query mode.
// prettier-ignore
const queryDenyActionCodes = new Set([
    1,  // SQLITE_CREATE_INDEX
    2,  // SQLITE_CREATE_TABLE
    3,  // SQLITE_CREATE_TEMP_INDEX
    4,  // SQLITE_CREATE_TEMP_TABLE
    5,  // SQLITE_CREATE_TEMP_TRIGGER
    6,  // SQLITE_CREATE_TEMP_VIEW
    7,  // SQLITE_CREATE_TRIGGER
    8,  // SQLITE_CREATE_VIEW
    9,  // SQLITE_DELETE
    10, // SQLITE_DROP_INDEX
    11, // SQLITE_DROP_TABLE
    12, // SQLITE_DROP_TEMP_INDEX
    13, // SQLITE_DROP_TEMP_TABLE
    14, // SQLITE_DROP_TEMP_TRIGGER
    15, // SQLITE_DROP_TEMP_VIEW
    16, // SQLITE_DROP_TRIGGER
    17, // SQLITE_DROP_VIEW
    18, // SQLITE_INSERT
    19, // SQLITE_PRAGMA
    23, // SQLITE_UPDATE
    26, // SQLITE_ALTER_TABLE
    27, // SQLITE_REINDEX
    30, // SQLITE_DROP_VTABLE
]);

class DatabaseFile implements VfsFile {
    private readonly storage: DatabaseServerStorage;
    private readonly getAction: () => DatabaseServerAction;

    constructor(storage: DatabaseServerStorage, getAction: () => DatabaseServerAction) {
        this.storage = storage;
        this.getAction = getAction;
    }

    read(data: Uint8Array, offset: number): boolean {
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

        // When in query mode, stash database pages so the
        // pageAccessHook doesn't double-read them.
        const action = this.getAction();
        if (action.type === "query" && !action.pages.has(pageIndex)) {
            action.pages.set(pageIndex, new Uint8Array(page));
        }

        const pageOffset = offset % pageSize;
        data.set(page.subarray(pageOffset, pageOffset + data.byteLength));
        return true;
    }

    write(data: Uint8Array, offset: number): void {
        assert(offset % pageSize === 0, `write offset ${offset} not page-aligned`);
        assert(data.byteLength === pageSize, `write amount ${data.byteLength} !== ${pageSize}`);
        this.storage.writePage(offset / pageSize, new Uint8Array(data));
    }

    truncate(size: number): void {
        this.storage.truncate(size);
    }

    sync(): void {
        this.storage.flush();
    }

    fileSize(): number {
        return this.storage.getFileSize();
    }

    close(): void {}
}

class TempFile implements VfsFile {
    private pages = new Map<number, Uint8Array>();
    private size = 0;

    read(data: Uint8Array, offset: number): boolean {
        if (offset >= this.size) {
            data.fill(0);
            return false;
        }

        const pageIndex = Math.floor(offset / pageSize);
        assert(
            Math.floor((offset + data.byteLength - 1) / pageSize) === pageIndex,
            `read spans pages: offset=${offset} amount=${data.byteLength}`,
        );

        const page = this.pages.get(pageIndex) ?? new Uint8Array(pageSize);
        const pageOffset = offset % pageSize;
        data.set(page.subarray(pageOffset, pageOffset + data.byteLength));
        return true;
    }

    write(data: Uint8Array, offset: number): void {
        // Temp files may have arbitrary write offsets
        // (e.g. journal headers), so we do byte-level
        // read-modify-write into pages.
        let remaining = data.byteLength;
        let srcOffset = 0;
        let dstOffset = offset;
        while (remaining > 0) {
            const pageIndex = Math.floor(dstOffset / pageSize);
            const pageOffset = dstOffset % pageSize;
            const chunkSize = Math.min(remaining, pageSize - pageOffset);
            const page = this.pages.get(pageIndex) ?? new Uint8Array(pageSize);
            page.set(data.subarray(srcOffset, srcOffset + chunkSize), pageOffset);
            this.pages.set(pageIndex, page);
            srcOffset += chunkSize;
            dstOffset += chunkSize;
            remaining -= chunkSize;
        }
        const end = offset + data.byteLength;
        if (end > this.size) {
            this.size = end;
        }
    }

    truncate(size: number): void {
        this.size = size;
    }

    sync(): void {}

    fileSize(): number {
        return this.size;
    }

    close(): void {}
}

/**
 * Runs a canonical SQLite database backed by a
 * {@link DatabaseServerStorage} implementation.
 */
export class DatabaseServer {
    private readonly db: Database;
    private readonly storage: DatabaseServerStorage;
    private action: DatabaseServerAction = {type: "idle"};
    private stashedError: unknown | null = null;
    private readonly tempFiles = new Set<TempFile>();

    private constructor(sqlite3: Sqlite3Static, storage: DatabaseServerStorage) {
        this.storage = storage;

        const capi = sqlite3.capi;
        const name = `${vfsNamePrefix}-${vfsCounter++}`;

        const stashError = (error: unknown): void => {
            if (this.stashedError === null) {
                this.stashedError = error;
            }
        };

        installVfs(sqlite3, name, {
            open: (_filename, flags) => {
                if (flags & capi.SQLITE_OPEN_MAIN_DB) {
                    return new DatabaseFile(storage, () => this.action);
                }
                if (flags & (capi.SQLITE_OPEN_TEMP_DB | capi.SQLITE_OPEN_TEMP_JOURNAL)) {
                    const file = new TempFile();
                    this.tempFiles.add(file);
                    return file;
                }
                const error = new UnimplementedError(
                    `Unsupported file type: flags=0x${flags.toString(16)}`,
                );
                stashError(error);
                throw error;
            },

            delete() {},

            access() {
                return false;
            },
        });

        this.db = new sqlite3.oo1.DB("/db.sqlite3", "ct", name);

        capi.sqlite3_set_authorizer(
            this.db.pointer!,
            (_cbArg: WasmPointer, actionCode: number) => {
                if (this.action.type === "idle") {
                    return capi.SQLITE_OK;
                }
                if (queryDenyActionCodes.has(actionCode)) {
                    return capi.SQLITE_DENY;
                }
                return capi.SQLITE_OK;
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
        this.db.pageAccessHook((pgno: number, flags: number) => {
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
            const stashed = this.stashedError;
            if (stashed !== null) {
                this.stashedError = null;
                if (stashed instanceof Error) {
                    stashed.cause = error;
                }
                throw stashed;
            }
            throw error;
        } finally {
            this.db.pageAccessHook(null);
            this.action = {type: "idle"};
            this.stashedError = null;
            this.tempFiles.clear();
            this.db.exec("ROLLBACK");
        }
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
