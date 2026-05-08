import type {
    OpfsDirectoryHandle,
    OpfsFileHandle,
    OpfsSyncAccessHandle,
} from "~/client/web/databases/opfs.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";

/**
 * Creates an {@link OpfsSyncAccessHandle} backed by a
 * single growable in-memory `Uint8Array`. Suitable for
 * tests that exercise OPFS-backed code paths without
 * touching real OPFS.
 */
export function createInMemoryOpfsSyncAccessHandle(): OpfsSyncAccessHandle {
    let buffer = new Uint8Array(0);
    return {
        read(data, options) {
            const at = options?.at ?? 0;
            const available = Math.max(0, buffer.byteLength - at);
            const toCopy = Math.min(data.byteLength, available);
            if (toCopy > 0) {
                data.set(buffer.subarray(at, at + toCopy));
            }
            return toCopy;
        },
        write(data, options) {
            const at = options?.at ?? 0;
            const end = at + data.byteLength;
            if (end > buffer.byteLength) {
                const next = new Uint8Array(end);
                next.set(buffer);
                buffer = next;
            }
            buffer.set(data, at);
            return data.byteLength;
        },
        truncate(size) {
            if (size < buffer.byteLength) {
                buffer = buffer.slice(0, size);
            } else {
                const next = new Uint8Array(size);
                next.set(buffer);
                buffer = next;
            }
        },
        flush() {},
        close() {},
        getSize() {
            return buffer.byteLength;
        },
    };
}

/**
 * Creates an in-memory {@link OpfsDirectoryHandle}. Each
 * directory and file is backed by a `Map`, and file
 * contents persist across `getFileHandle` calls within
 * the same directory.
 */
export function createInMemoryOpfsDirectoryHandle(): OpfsDirectoryHandle {
    const dirs = new Map<string, OpfsDirectoryHandle>();
    const files = new Map<string, OpfsSyncAccessHandle>();
    return {
        async removeEntry(name: string) {
            dirs.delete(name);
            files.delete(name);
        },
        async getDirectoryHandle(name: string) {
            let dir = dirs.get(name);
            if (dir === undefined) {
                dir = createInMemoryOpfsDirectoryHandle();
                dirs.set(name, dir);
            }
            return dir;
        },
        async getFileHandle(name: string): Promise<OpfsFileHandle> {
            return {
                async createSyncAccessHandle() {
                    let handle = files.get(name);
                    if (handle === undefined) {
                        handle = createInMemoryOpfsSyncAccessHandle();
                        files.set(name, handle);
                    }
                    return handle;
                },
            };
        },
    };
}

/**
 * Reads the main table's `pages.bin` + `index.json`
 * files from a group dir into a flat array. Mirrors the
 * on-disk layout that {@link OpfsPageStore} writes
 * inside `groupDir/{mainTableId}/`.
 */
export async function extractOpfsPages(
    groupDir: OpfsDirectoryHandle,
): Promise<Array<{pageIndex: number; timestamp: number; data: Uint8Array}>> {
    const tableDir = await groupDir.getDirectoryHandle(databaseMainTableId);
    const pagesHandle = await (await tableDir.getFileHandle("pages.bin")).createSyncAccessHandle();
    const indexHandle = await (await tableDir.getFileHandle("index.json")).createSyncAccessHandle();

    const indexSize = indexHandle.getSize();
    if (indexSize === 0) return [];

    const raw = new Uint8Array(indexSize);
    indexHandle.read(raw, {at: 0});
    const entries = JSON.parse(new TextDecoder().decode(raw)) as Array<
        [number, {slot: number; timestamp: number}]
    >;

    return entries.map(([pageIndex, {slot, timestamp}]) => {
        const data = new Uint8Array(sqlitePageSize);
        pagesHandle.read(data, {at: slot * sqlitePageSize});
        return {pageIndex, timestamp, data};
    });
}

/**
 * Writes pages + index into a group dir's main table
 * subdirectory so that a subsequent `DatabaseClient.create`
 * opens an existing DB rather than creating a fresh one.
 */
export async function prepopulateOpfsPages(
    groupDir: OpfsDirectoryHandle,
    pages: ReadonlyArray<{pageIndex: number; timestamp: number; data: Uint8Array}>,
): Promise<void> {
    const tableDir = await groupDir.getDirectoryHandle(databaseMainTableId, {create: true});
    const pagesHandle = await (await tableDir.getFileHandle("pages.bin")).createSyncAccessHandle();
    const indexHandle = await (await tableDir.getFileHandle("index.json")).createSyncAccessHandle();

    const indexEntries: Array<[number, {slot: number; timestamp: number}]> = [];
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i]!;
        pagesHandle.write(page.data, {at: i * sqlitePageSize});
        indexEntries.push([page.pageIndex, {slot: i, timestamp: page.timestamp}]);
    }
    pagesHandle.flush();

    const json = new TextEncoder().encode(JSON.stringify(indexEntries, null, 2));
    indexHandle.write(json, {at: 0});
    indexHandle.flush();
}
