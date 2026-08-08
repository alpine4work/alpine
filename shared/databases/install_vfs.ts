import type {Sqlite3Static, WasmPointer} from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

/**
 * Per-file VFS operations. Returned by {@link VfsMethods.open}.
 *
 * - `data` in `read`/`write` is a zero-copy `Uint8Array` view of the WASM heap,
 *   valid only for the duration of the call.
 * - Methods throw on error. The helper catches exceptions and returns appropriate
 *   SQLite error codes.
 */
export interface VfsFile {
    /**
     * Reads `data.byteLength` bytes at `offset` into `data`. Returns `true` on
     * success, `false` for a short read (the implementer must zero-fill any remaining
     * bytes).
     */
    read(data: Uint8Array, offset: number): boolean;
    write(data: Uint8Array, offset: number): void;
    truncate(size: number): void;
    sync(): void;
    fileSize(): number;
    close(): void;
}

/**
 * Simplified VFS methods that an implementer provides. The helper handles struct
 * setup, WASM memory access, string conversion, and boilerplate methods (`xLock`,
 * `xUnlock`, `xFullPathname`, `xCurrentTime`, etc.).
 */
export interface VfsMethods {
    /**
     * Opens a file. Returns a {@link VfsFile} for per-file operations. `flags`
     * contains `SQLITE_OPEN_*` bits. Throw to reject the open (helper returns
     * `SQLITE_CANTOPEN`).
     */
    open(filename: string | null, flags: number): VfsFile;
    delete(filename: string, syncDir: number): void;
    /** Returns `true` if the file exists. */
    access(filename: string, flags: number): boolean;
}

/**
 * Handle returned by {@link installVfs} for retrieving errors that occurred inside
 * VFS callbacks. When a VfsFile or VfsMethods method throws, the helper stashes
 * the error and returns the appropriate SQLite error code. Call {@link takeError}
 * to retrieve (and clear) the stashed error after the SQLite call that triggered
 * it.
 */
export interface InstalledVfs {
    /** Returns and clears the stashed error, or `null`. */
    takeError(): unknown | null;
}

/**
 * Installs a custom SQLite VFS backed by the given {@link VfsMethods}. Handles all
 * struct setup, WASM memory access, string conversion, and boilerplate VFS
 * methods.
 *
 * The helper manages the `filePtr → VfsFile` mapping internally. All VfsFile
 * method calls are wrapped in try/catch — on exception, the error is stashed
 * (retrievable via the returned {@link InstalledVfs}) and the appropriate SQLite
 * error code is returned.
 */
export function installVfs(
    sqlite3: Sqlite3Static,
    name: string,
    methods: VfsMethods,
): InstalledVfs {
    const capi = sqlite3.capi;
    const wasm = sqlite3.wasm;

    const ioMethods = new capi.sqlite3_io_methods();
    ioMethods.iVersion = 1;

    const vfs = new capi.sqlite3_vfs();
    vfs.$iVersion = 2;
    const tmpFile = new capi.sqlite3_file();
    vfs.$szOsFile = tmpFile.structInfo.sizeof;
    tmpFile.dispose();
    vfs.$mxPathname = 512;

    const files = new Map<WasmPointer, VfsFile>();

    let stashedError: unknown | null = null;

    function stash(error: unknown): void {
        if (stashedError === null) {
            stashedError = error;
        }
    }

    // Pre-cast result codes to avoid `as` noise on every return.
    const ok = capi.SQLITE_OK as any;
    const ioErr = capi.SQLITE_IOERR as any;
    const ioErrShortRead = ((capi.SQLITE_IOERR as number) | (2 << 8)) as any;
    const cantOpen = capi.SQLITE_CANTOPEN as any;

    sqlite3.vfs.installVfs({
        io: {
            struct: ioMethods,
            applyArgcCheck: false,
            methods: {
                xClose(filePtr: WasmPointer) {
                    const file = files.get(filePtr);
                    if (file === undefined) return ok;
                    try {
                        file.close();
                    } catch (error) {
                        stash(error);
                    }
                    files.delete(filePtr);
                    return ok;
                },

                xRead(
                    filePtr: WasmPointer,
                    buf: WasmPointer,
                    iAmt: number,
                    iOfst: number | bigint,
                ) {
                    const file = files.get(filePtr);
                    if (file === undefined) return ioErr;
                    try {
                        const data = wasm.heap8u().subarray(buf, buf + iAmt);
                        return file.read(data, Number(iOfst)) ? ok : ioErrShortRead;
                    } catch (error) {
                        stash(error);
                        return ioErr;
                    }
                },

                xWrite(
                    filePtr: WasmPointer,
                    buf: WasmPointer,
                    iAmt: number,
                    iOfst: number | bigint,
                ) {
                    const file = files.get(filePtr);
                    if (file === undefined) return ioErr;
                    try {
                        const data = wasm.heap8u().subarray(buf, buf + iAmt);
                        file.write(data, Number(iOfst));
                        return ok;
                    } catch (error) {
                        stash(error);
                        return ioErr;
                    }
                },

                xTruncate(filePtr: WasmPointer, size: number | bigint) {
                    const file = files.get(filePtr);
                    if (file === undefined) return ioErr;
                    try {
                        // `size` is a SQLite `i64`, marshalled as a BigInt like `xRead`/`xWrite`'s
                        // `iOfst`. Normalize to a JS number so it doesn't poison downstream page
                        // arithmetic (e.g. `Math.floor(size / pageSize)` in storage).
                        file.truncate(Number(size));
                        return ok;
                    } catch (error) {
                        stash(error);
                        return ioErr;
                    }
                },

                xSync(filePtr: WasmPointer) {
                    const file = files.get(filePtr);
                    if (file === undefined) return ioErr;
                    try {
                        file.sync();
                        return ok;
                    } catch (error) {
                        stash(error);
                        return ioErr;
                    }
                },

                xFileSize(filePtr: WasmPointer, pSize: WasmPointer) {
                    const file = files.get(filePtr);
                    if (file === undefined) return ioErr;
                    try {
                        const size = file.fileSize();
                        const heap = wasm.heap8u();
                        const view = new DataView(heap.buffer, pSize, 8);
                        view.setBigInt64(0, BigInt(size), true);
                        return ok;
                    } catch (error) {
                        stash(error);
                        return ioErr;
                    }
                },

                xLock() {
                    return ok;
                },

                xUnlock() {
                    return ok;
                },

                xCheckReservedLock(_filePtr: WasmPointer, pResOut: WasmPointer) {
                    wasm.poke32(pResOut, 0);
                    return ok;
                },

                xFileControl() {
                    return capi.SQLITE_NOTFOUND as any;
                },

                xSectorSize() {
                    return 512 as any;
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
                    _vfsPtr: WasmPointer,
                    zName: WasmPointer,
                    filePtr: WasmPointer,
                    flags: number,
                    pOutputFlags: WasmPointer,
                ) {
                    try {
                        const filename = zName ? wasm.cstrToJs(zName) : null;
                        const file = methods.open(filename, flags);
                        files.set(filePtr, file);

                        const structFile = new capi.sqlite3_file(filePtr);
                        structFile.$pMethods = assertExists(ioMethods.pointer);

                        if (pOutputFlags) {
                            const view = new DataView(wasm.heap8u().buffer, pOutputFlags, 4);
                            view.setInt32(
                                0,
                                capi.SQLITE_OPEN_READWRITE | capi.SQLITE_OPEN_CREATE,
                                true,
                            );
                        }

                        return ok;
                    } catch (error) {
                        stash(error);
                        return cantOpen;
                    }
                },

                xDelete(_vfsPtr: WasmPointer, zName: WasmPointer, syncDir: number) {
                    try {
                        methods.delete(wasm.cstrToJs(zName) ?? "", syncDir);
                        return ok;
                    } catch (error) {
                        stash(error);
                        return ioErr;
                    }
                },

                xAccess(
                    _vfsPtr: WasmPointer,
                    zName: WasmPointer,
                    flags: number,
                    pResOut: WasmPointer,
                ) {
                    try {
                        const exists = methods.access(wasm.cstrToJs(zName) ?? "", flags);
                        wasm.poke32(pResOut, exists ? 1 : 0);
                        return ok;
                    } catch (error) {
                        stash(error);
                        return ioErr;
                    }
                },

                xFullPathname(
                    _vfsPtr: WasmPointer,
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
                    return ok;
                },

                xCurrentTime(_vfsPtr: WasmPointer, pTimeOut: WasmPointer) {
                    const now = Date.now() / 86_400_000 + 2_440_587.5;
                    wasm.poke64f(pTimeOut, now);
                    return ok;
                },

                xCurrentTimeInt64(_vfsPtr: WasmPointer, pTimeOut: WasmPointer) {
                    const now = Date.now() / 86_400_000 + 2_440_587.5;
                    wasm.poke64(pTimeOut, BigInt(Math.round(now * 86_400_000)));
                    return ok;
                },

                xGetLastError() {
                    return 0 as any;
                },

                xRandomness(_vfsPtr: WasmPointer, nByte: number, zOut: WasmPointer) {
                    const heap = wasm.heap8u();
                    const bytes = new Uint8Array(nByte);
                    crypto.getRandomValues(bytes);
                    heap.set(bytes, zOut);
                    return nByte as any;
                },

                xSleep() {
                    return ok;
                },
            },
        },
    });

    return {
        takeError(): unknown | null {
            const error = stashedError;
            stashedError = null;
            return error;
        },
    };
}
