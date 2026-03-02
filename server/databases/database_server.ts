import type {
    Database,
    Sqlite3Static,
    WasmPointer,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";
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

/**
 * Runs a canonical SQLite database backed by a
 * {@link DatabaseServerStorage} implementation.
 */
export class DatabaseServer {
    private readonly db: Database;
    private readonly storage: DatabaseServerStorage;
    private action: DatabaseServerAction = {type: "idle"};

    private constructor(sqlite3: Sqlite3Static, storage: DatabaseServerStorage) {
        this.storage = storage;

        const capi = sqlite3.capi;
        const name = `${vfsNamePrefix}-${vfsCounter++}`;
        this.installVfs(sqlite3, name);

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
        } finally {
            this.db.pageAccessHook(null);
            this.action = {type: "idle"};
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

    // -------------------------------------------------------------------
    // VFS installation
    // -------------------------------------------------------------------

    private installVfs(sqlite3: Sqlite3Static, name: string): void {
        const capi = sqlite3.capi;
        const wasm = sqlite3.wasm;
        const {storage} = this;

        const files = new Map<number, VfsFile>();

        const ioMethods = new sqlite3.capi.sqlite3_io_methods();
        ioMethods.iVersion = 1;

        const vfs = new sqlite3.capi.sqlite3_vfs();
        vfs.$iVersion = 2;
        const tmpFile = new sqlite3.capi.sqlite3_file();
        vfs.$szOsFile = tmpFile.structInfo.sizeof;
        tmpFile.dispose();
        vfs.$mxPathname = 512;

        sqlite3.vfs.installVfs({
            io: {
                struct: ioMethods,
                applyArgcCheck: false,
                methods: {
                    xClose(filePtr: WasmPointer) {
                        files.delete(filePtr);
                        return capi.SQLITE_OK;
                    },

                    xRead: (
                        filePtr: WasmPointer,
                        buf: WasmPointer,
                        iAmt: number,
                        iOfst: number | bigint,
                    ) => {
                        const file = files.get(filePtr);
                        assert(file !== undefined, "xRead: unknown file handle");

                        const offset = Number(iOfst);
                        const heap = wasm.heap8u();

                        const fileSize =
                            file.type === "database" ? storage.getFileSize() : file.fileSize;

                        // Reading beyond the file returns short read.
                        // This happens when SQLite probes the header of
                        // a newly created (empty) database.
                        if (offset >= fileSize) {
                            heap.fill(0, buf, buf + iAmt);
                            return capi.SQLITE_IOERR_SHORT_READ;
                        }

                        // SQLite does sub-page reads (e.g. the 100-byte
                        // file header or the change counter at byte 24)
                        // so we only assert the read fits in one page.
                        const pageIndex = Math.floor(offset / pageSize);
                        assert(
                            Math.floor((offset + iAmt - 1) / pageSize) === pageIndex,
                            `xRead spans pages: offset=${offset} amount=${iAmt}`,
                        );

                        const page =
                            file.type === "database"
                                ? storage.readPage(pageIndex)
                                : file.pages.get(pageIndex) ?? new Uint8Array(pageSize);

                        // When in query mode, stash database pages so
                        // the pageAccessHook doesn't double-read them.
                        if (
                            file.type === "database" &&
                            this.action.type === "query" &&
                            !this.action.pages.has(pageIndex)
                        ) {
                            this.action.pages.set(pageIndex, new Uint8Array(page));
                        }

                        const pageOffset = offset % pageSize;
                        heap.set(page.subarray(pageOffset, pageOffset + iAmt), buf);
                        return capi.SQLITE_OK;
                    },

                    xWrite(
                        filePtr: WasmPointer,
                        buf: WasmPointer,
                        iAmt: number,
                        iOfst: number | bigint,
                    ) {
                        const file = files.get(filePtr);
                        assert(file !== undefined, "xWrite: unknown file handle");

                        const offset = Number(iOfst);
                        const heap = wasm.heap8u();

                        if (file.type === "database") {
                            assert(
                                offset % pageSize === 0,
                                `xWrite offset ${offset} not page-aligned`,
                            );
                            assert(iAmt === pageSize, `xWrite amount ${iAmt} !== ${pageSize}`);

                            const pageIndex = offset / pageSize;
                            const data = heap.slice(buf, buf + iAmt);
                            storage.writePage(pageIndex, data);
                        } else {
                            // Temp files may have arbitrary write
                            // offsets (e.g. journal headers), so we do
                            // byte-level read-modify-write into pages.
                            let remaining = iAmt;
                            let srcOffset = buf;
                            let dstOffset = offset;
                            while (remaining > 0) {
                                const pageIndex = Math.floor(dstOffset / pageSize);
                                const pageOffset = dstOffset % pageSize;
                                const chunkSize = Math.min(remaining, pageSize - pageOffset);
                                const page = file.pages.get(pageIndex) ?? new Uint8Array(pageSize);
                                page.set(
                                    heap.subarray(srcOffset, srcOffset + chunkSize),
                                    pageOffset,
                                );
                                file.pages.set(pageIndex, page);
                                srcOffset += chunkSize;
                                dstOffset += chunkSize;
                                remaining -= chunkSize;
                            }
                            const end = offset + iAmt;
                            if (end > file.fileSize) {
                                file.fileSize = end;
                            }
                        }
                        return capi.SQLITE_OK;
                    },

                    xTruncate(filePtr: WasmPointer, size: number) {
                        const file = files.get(filePtr);
                        assert(file !== undefined, "xTruncate: unknown file handle");

                        if (file.type === "database") {
                            storage.truncate(size);
                        } else {
                            file.fileSize = size;
                        }
                        return capi.SQLITE_OK;
                    },

                    xSync(filePtr: WasmPointer) {
                        const file = files.get(filePtr);
                        assert(file !== undefined, "xSync: unknown file handle");

                        if (file.type === "database") {
                            storage.flush();
                        }
                        return capi.SQLITE_OK;
                    },

                    xFileSize(filePtr: WasmPointer, pSize: WasmPointer) {
                        const file = files.get(filePtr);
                        assert(file !== undefined, "xFileSize: unknown file handle");

                        const fileSize =
                            file.type === "database" ? storage.getFileSize() : file.fileSize;
                        wasm.poke64(pSize, BigInt(fileSize));
                        return capi.SQLITE_OK;
                    },

                    xLock() {
                        return capi.SQLITE_OK;
                    },

                    xUnlock() {
                        return capi.SQLITE_OK;
                    },

                    xCheckReservedLock(filePtr: WasmPointer, pResOut: WasmPointer) {
                        wasm.poke32(pResOut, 0);
                        return capi.SQLITE_OK;
                    },

                    xFileControl() {
                        return capi.SQLITE_NOTFOUND;
                    },

                    xSectorSize() {
                        return pageSize as any;
                    },

                    xDeviceCharacteristics() {
                        return 0;
                    },
                },
            },

            vfs: {
                struct: vfs,
                name,
                applyArgcCheck: false,
                methods: {
                    xOpen(
                        vfsPtr: WasmPointer,
                        zName: WasmPointer,
                        filePtr: WasmPointer,
                        flags: number,
                        pOutputFlags: WasmPointer,
                    ) {
                        const file = new sqlite3.capi.sqlite3_file(filePtr);
                        file.$pMethods = ioMethods.pointer!;

                        if (flags & capi.SQLITE_OPEN_MAIN_DB) {
                            files.set(filePtr, {type: "database"});
                        } else {
                            files.set(filePtr, {
                                type: "temp",
                                pages: new Map(),
                                fileSize: 0,
                            });
                        }

                        if (pOutputFlags) {
                            wasm.poke32(
                                pOutputFlags,
                                capi.SQLITE_OPEN_READWRITE | capi.SQLITE_OPEN_CREATE,
                            );
                        }
                        return capi.SQLITE_OK;
                    },

                    xDelete() {
                        return capi.SQLITE_OK;
                    },

                    xAccess(
                        vfsPtr: WasmPointer,
                        zName: WasmPointer,
                        flags: number,
                        pResOut: WasmPointer,
                    ) {
                        wasm.poke32(pResOut, 0);
                        return capi.SQLITE_OK;
                    },

                    xFullPathname(
                        vfsPtr: WasmPointer,
                        zName: WasmPointer,
                        nOut: number,
                        zOut: WasmPointer,
                    ) {
                        const fullName = wasm.cstrToJs(zName);
                        const heap = wasm.heap8u();
                        const encoder = new TextEncoder();
                        const encoded = encoder.encode(fullName ?? "");
                        const len = Math.min(encoded.length, nOut - 1);
                        heap.set(encoded.subarray(0, len), zOut);
                        heap[zOut + len] = 0;
                        return capi.SQLITE_OK;
                    },

                    xCurrentTime(vfsPtr: WasmPointer, pTimeOut: WasmPointer) {
                        const now = Date.now() / 86_400_000 + 2_440_587.5;
                        wasm.poke64f(pTimeOut, now);
                        return capi.SQLITE_OK;
                    },

                    xCurrentTimeInt64(vfsPtr: WasmPointer, pTimeOut: WasmPointer) {
                        const now = Date.now() / 86_400_000 + 2_440_587.5;
                        wasm.poke64(pTimeOut, BigInt(Math.round(now * 86_400_000)));
                        return capi.SQLITE_OK;
                    },

                    xGetLastError() {
                        return 0 as any;
                    },

                    xRandomness(vfsPtr: WasmPointer, nByte: number, zOut: WasmPointer) {
                        const heap = wasm.heap8u();
                        const bytes = new Uint8Array(nByte);
                        crypto.getRandomValues(bytes);
                        heap.set(bytes, zOut);
                        return nByte as any;
                    },

                    xSleep() {
                        return capi.SQLITE_OK;
                    },
                },
            },
        });
    }
}

// ---------------------------------------------------------------------------
// VFS file types
// ---------------------------------------------------------------------------

type VfsFile =
    | {type: "database"}
    | {type: "temp"; pages: Map<number, Uint8Array>; fileSize: number};
