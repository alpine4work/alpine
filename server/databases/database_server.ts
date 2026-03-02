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

/**
 * Runs a canonical SQLite database backed by a
 * {@link DatabaseServerStorage} implementation.
 */
export class DatabaseServer {
    private readonly db: Database;

    private constructor(db: Database) {
        this.db = db;
    }

    static async create(storage: DatabaseServerStorage): Promise<DatabaseServer> {
        if (sqlite3Promise === undefined) {
            sqlite3Promise = sqlite3InitModule();
        }
        const sqlite3 = await sqlite3Promise;

        const name = `${vfsNamePrefix}-${vfsCounter++}`;
        installVfs(sqlite3, storage, name);

        const db = new sqlite3.oo1.DB("/db.sqlite3", "ct", name);
        db.exec(`PRAGMA page_size = ${pageSize}`);
        db.exec("PRAGMA journal_mode = OFF");

        return new DatabaseServer(db);
    }

    /** Exposed for tests only. Do not use in production code. */
    unsafeGetDb(): Database {
        return this.db;
    }

    close(): void {
        this.db.close();
    }
}

// ---------------------------------------------------------------------------
// VFS implementation
// ---------------------------------------------------------------------------

type VfsFile =
    | {type: "database"}
    | {type: "temp"; pages: Map<number, Uint8Array>; fileSize: number};

function installVfs(sqlite3: Sqlite3Static, storage: DatabaseServerStorage, name: string): void {
    const capi = sqlite3.capi;
    const wasm = sqlite3.wasm;

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

                xRead(
                    filePtr: WasmPointer,
                    buf: WasmPointer,
                    iAmt: number,
                    iOfst: number | bigint,
                ) {
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
                            : (file.pages.get(pageIndex) ?? new Uint8Array(pageSize));
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
                        assert(offset % pageSize === 0, `xWrite offset ${offset} not page-aligned`);
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
                            page.set(heap.subarray(srcOffset, srcOffset + chunkSize), pageOffset);
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
