import type {
    Database,
    Sqlite3Static,
    WasmPointer,
} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import type {DatabaseServerStorage} from "~/server/databases/database_server_storage.js";

const pageSize = 4096;
const vfsNamePrefix = "alpine-server";
let vfsCounter = 0;

let sqlite3Promise: Promise<Sqlite3Static> | undefined;

/**
 * Runs a canonical SQLite database backed by a
 * {@link DatabaseServerStorage} implementation.
 */
export class DatabaseServer {
    private readonly sqlite3: Sqlite3Static;
    private readonly db: Database;

    private constructor(sqlite3: Sqlite3Static, db: Database) {
        this.sqlite3 = sqlite3;
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

        return new DatabaseServer(sqlite3, db);
    }

    exec(sql: string): void {
        this.db.exec(sql);
    }

    selectArrays(sql: string): Array<Array<unknown>> {
        return this.db.exec(sql, {
            returnValue: "resultRows",
            rowMode: "array",
        });
    }

    selectValue(sql: string): unknown {
        return this.db.selectValue(sql);
    }

    close(): void {
        this.db.close();
    }
}

// ---------------------------------------------------------------------------
// VFS implementation
// ---------------------------------------------------------------------------

function installVfs(sqlite3: Sqlite3Static, storage: DatabaseServerStorage, name: string): void {
    const capi = sqlite3.capi;
    const wasm = sqlite3.wasm;

    // Track file size per open file. We use the sqlite3_file
    // pointer as key.
    const fileSizes = new Map<WasmPointer, number>();

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
                    fileSizes.delete(filePtr);
                    return capi.SQLITE_OK;
                },

                xRead(
                    filePtr: WasmPointer,
                    buf: WasmPointer,
                    iAmt: number,
                    iOfst: number | bigint,
                ) {
                    const offset = Number(iOfst);
                    const startPage = Math.floor(offset / pageSize);
                    const endPage = Math.floor((offset + iAmt - 1) / pageSize);
                    const indexes: Array<number> = [];
                    for (let i = startPage; i <= endPage; i++) {
                        indexes.push(i);
                    }
                    const pages = storage.getPages(indexes);

                    // Assemble the requested byte range from the pages.
                    const heap = wasm.heap8u();
                    let bytesWritten = 0;
                    for (let i = 0; i < pages.length; i++) {
                        const page = pages[i]!;
                        const pageStart = (startPage + i) * pageSize;
                        const srcStart = Math.max(offset - pageStart, 0);
                        const srcEnd = Math.min(offset + iAmt - pageStart, pageSize);
                        heap.set(page.subarray(srcStart, srcEnd), buf + bytesWritten);
                        bytesWritten += srcEnd - srcStart;
                    }

                    // If we read fewer bytes than requested, zero-fill
                    // the remainder and report a short read.
                    if (bytesWritten < iAmt) {
                        heap.fill(0, buf + bytesWritten, buf + iAmt);
                        return capi.SQLITE_IOERR_SHORT_READ;
                    }
                    return capi.SQLITE_OK;
                },

                xWrite(
                    filePtr: WasmPointer,
                    buf: WasmPointer,
                    iAmt: number,
                    iOfst: number | bigint,
                ) {
                    const offset = Number(iOfst);
                    const heap = wasm.heap8u();
                    const data = heap.slice(buf, buf + iAmt);

                    const startPage = Math.floor(offset / pageSize);
                    const endPage = Math.floor((offset + iAmt - 1) / pageSize);

                    // For writes that span multiple pages or start at a
                    // sub-page offset we need to read-modify-write.
                    const needsRMW = offset % pageSize !== 0 || iAmt % pageSize !== 0;

                    const pagesToWrite = new Map<number, Uint8Array>();

                    if (needsRMW) {
                        const indexes: Array<number> = [];
                        for (let i = startPage; i <= endPage; i++) {
                            indexes.push(i);
                        }
                        const existing = storage.getPages(indexes);
                        for (let i = 0; i < existing.length; i++) {
                            const pageIndex = startPage + i;
                            const page = new Uint8Array(existing[i]!);
                            const pageStart = pageIndex * pageSize;
                            const srcStart = Math.max(offset - pageStart, 0);
                            const srcEnd = Math.min(offset + iAmt - pageStart, pageSize);
                            const dataOffset = pageStart + srcStart - offset;
                            page.set(
                                data.subarray(dataOffset, dataOffset + (srcEnd - srcStart)),
                                srcStart,
                            );
                            pagesToWrite.set(pageIndex, page);
                        }
                    } else {
                        // Fast path: write is page-aligned.
                        const pageCount = iAmt / pageSize;
                        for (let i = 0; i < pageCount; i++) {
                            const off = i * pageSize;
                            pagesToWrite.set(startPage + i, data.slice(off, off + pageSize));
                        }
                    }

                    storage.setPages(pagesToWrite);

                    // Update tracked file size.
                    const end = offset + iAmt;
                    const current = fileSizes.get(filePtr) ?? 0;
                    if (end > current) {
                        fileSizes.set(filePtr, end);
                    }

                    return capi.SQLITE_OK;
                },

                xTruncate(filePtr: WasmPointer, size: number) {
                    fileSizes.set(filePtr, size);
                    return capi.SQLITE_OK;
                },

                xSync() {
                    return capi.SQLITE_OK;
                },

                xFileSize(filePtr: WasmPointer, pSize: WasmPointer) {
                    const size = fileSizes.get(filePtr) ?? 0;
                    wasm.poke64(pSize, BigInt(size));
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
                    fileSizes.set(filePtr, 0);
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
                    // Copy the input name directly as the "full" path.
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
                    // Julian day number for the current time.
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
