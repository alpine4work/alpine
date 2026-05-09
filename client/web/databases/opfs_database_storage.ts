import type {OpfsDirectoryHandle, OpfsSyncAccessHandle} from "~/client/web/databases/opfs.js";
import type {ReadonlyDatabaseStorage} from "~/shared/databases/database.js";
import {PageMissingError} from "~/shared/databases/page_missing_error.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema, type SchemaSerializedValue} from "~/shared/schema/schema.js";

const indexSchema = Schema.map(
    Schema.integer,
    Schema.object({
        slot: Schema.integer,
        version: Schema.integer,
    }),
);

/**
 * Owns the per-table {@link OpfsPageStore}s backing one
 * {@link DatabaseClient} and adapts them to the
 * {@link ReadonlyDatabaseStorage} interface that
 * {@link Database} reads through.
 *
 * Pages requested within the table's known file size but
 * not present locally throw {@link PageMissingError} so
 * the client can fall back to the server. Pages past the
 * end of the file return `null` (zero-fill / EOF).
 */
export class OpfsDatabaseStorage implements ReadonlyDatabaseStorage {
    private readonly groupDir: OpfsDirectoryHandle;
    private readonly stores = new Map<DatabaseTableId, OpfsPageStore>();

    constructor(groupDir: OpfsDirectoryHandle) {
        this.groupDir = groupDir;
    }

    /**
     * Open the {@link OpfsPageStore} for `tableId` inside
     * the group dir's `{tableId}/` subdirectory and
     * register it.
     */
    async create(tableId: DatabaseTableId): Promise<OpfsPageStore> {
        assert(!this.stores.has(tableId), `page store for table ${tableId} already exists`);
        const tableDir = await this.groupDir.getDirectoryHandle(tableId, {create: true});
        const store = await OpfsPageStore.create(tableDir);
        this.stores.set(tableId, store);
        return store;
    }

    get(tableId: DatabaseTableId): OpfsPageStore | undefined {
        return this.stores.get(tableId);
    }

    [Symbol.iterator](): IterableIterator<[DatabaseTableId, OpfsPageStore]> {
        return this.stores.entries();
    }

    // -- ReadonlyDatabaseStorage --------------------------------------------

    readPage(tableId: DatabaseTableId, index: number): {data: Uint8Array; version: number} | null {
        const store = this.stores.get(tableId);
        assert(store !== undefined, `readPage for unknown table: ${tableId}`);

        const entry = store.readPage(index);
        if (entry !== null) return entry;

        // Page is within the file the server says exists,
        // but not in the local cache — signal a miss so
        // the client falls back to the server.
        const fileSize = store.getFileSize();
        if (index * sqlitePageSize < fileSize) {
            throw new PageMissingError(index);
        }
        return null;
    }

    getFileSize(tableId: DatabaseTableId): number {
        const store = this.stores.get(tableId);
        assert(store !== undefined, `getFileSize for unknown table: ${tableId}`);
        return store.getFileSize();
    }
}

/**
 * Durable per-table page cache stored in OPFS.
 *
 * Pages are persisted as dense {@link sqlitePageSize}-byte
 * slots in a single `pages.bin` file. An in-memory index
 * maps page indices to slot positions and versions, and is
 * mirrored on disk in `index.json`.
 *
 * The store is purely a read-through cache plus a
 * server-driven write API ({@link writePageIfNewer},
 * {@link deletePages}, {@link setServerFileSizeInPages}).
 * Optimistic SQL-driven writes live in the in-memory
 * buffer owned by the {@link Database} that consumes this
 * store via {@link OpfsDatabaseStorage}.
 */
export class OpfsPageStore {
    private readonly index = new Map<number, {slot: number; version: number}>();
    private readonly pagesHandle: OpfsSyncAccessHandle;
    private readonly indexHandle: OpfsSyncAccessHandle;
    private nextSlot = 0;
    private maxPageIndex = -1;
    private knownDatabaseSizeInPages = 0;

    private constructor(pagesHandle: OpfsSyncAccessHandle, indexHandle: OpfsSyncAccessHandle) {
        this.pagesHandle = pagesHandle;
        this.indexHandle = indexHandle;
    }

    static async create(dir: OpfsDirectoryHandle): Promise<OpfsPageStore> {
        const pagesFile = await dir.getFileHandle("pages.bin", {create: true});
        const pagesHandle = await pagesFile.createSyncAccessHandle();
        const indexFile = await dir.getFileHandle("index.json", {create: true});
        const indexHandle = await indexFile.createSyncAccessHandle();

        const store = new OpfsPageStore(pagesHandle, indexHandle);
        store.loadIndex();
        return store;
    }

    /**
     * Read the durable page at `pageIndex`. Returns `null`
     * if no copy exists locally.
     */
    readPage(pageIndex: number): {data: Uint8Array; version: number} | null {
        const entry = this.index.get(pageIndex);
        if (entry === undefined) return null;
        const data = new Uint8Array(sqlitePageSize);
        this.pagesHandle.read(data, {at: entry.slot * sqlitePageSize});
        return {data, version: entry.version};
    }

    /**
     * Current logical file size in bytes. Uses the
     * server-reported size when known so SQLite sees the
     * full database even when only a subset of pages are
     * cached locally; otherwise falls back to the highest
     * page index actually present.
     */
    getFileSize(): number {
        if (this.knownDatabaseSizeInPages > 0) {
            return this.knownDatabaseSizeInPages * sqlitePageSize;
        }
        return this.maxPageIndex < 0 ? 0 : (this.maxPageIndex + 1) * sqlitePageSize;
    }

    /**
     * Write a page if `version` is strictly newer than the
     * local copy. Updates the cached database size when
     * page 0 is written. Returns `true` if the local copy
     * was replaced.
     */
    writePageIfNewer(pageIndex: number, version: number, data: Uint8Array): boolean {
        const existing = this.index.get(pageIndex);
        if (existing !== undefined && existing.version >= version) {
            return false;
        }

        const slot = existing !== undefined ? existing.slot : this.nextSlot++;
        this.pagesHandle.write(data, {at: slot * sqlitePageSize});
        this.index.set(pageIndex, {slot, version});

        if (pageIndex > this.maxPageIndex) {
            this.maxPageIndex = pageIndex;
        }

        // Page 0 (SQLite page 1) carries the database size in
        // pages at offset 28 (4 bytes, big-endian).
        if (pageIndex === 0 && data.byteLength >= 32) {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            this.knownDatabaseSizeInPages = view.getUint32(28, false);
        }

        return true;
    }

    /**
     * Drop pages from the index by index. The underlying
     * slot data in `pages.bin` becomes unreachable but
     * harmless — it is reclaimed if a new page is written
     * to that slot later.
     */
    deletePages(pageIndexes: ReadonlySet<number>): void {
        for (const pageIndex of pageIndexes) {
            this.index.delete(pageIndex);
        }
        this.maxPageIndex = -1;
        for (const pageIndex of this.index.keys()) {
            if (pageIndex > this.maxPageIndex) {
                this.maxPageIndex = pageIndex;
            }
        }
        this.knownDatabaseSizeInPages = 0;
        const page0 = this.index.get(0);
        if (page0 !== undefined) {
            const header = new Uint8Array(32);
            this.pagesHandle.read(header, {at: page0.slot * sqlitePageSize});
            const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
            this.knownDatabaseSizeInPages = view.getUint32(28, false);
        }
    }

    setServerFileSizeInPages(sizeInPages: number): void {
        this.knownDatabaseSizeInPages = sizeInPages;
    }

    /** Snapshot of every cached page with its version. */
    pageEntries(): Array<{pageIndex: number; version: number}> {
        const entries: Array<{pageIndex: number; version: number}> = [];
        for (const [pageIndex, {version}] of this.index) {
            entries.push({pageIndex, version});
        }
        return entries;
    }

    /** Flush in-flight writes + index to OPFS. */
    sync(): void {
        this.pagesHandle.flush();
        this.flushIndex();
    }

    close(): void {
        this.flushIndex();
        this.pagesHandle.close();
        this.indexHandle.close();
    }

    /**
     * Test-only: write a page at `version` regardless of
     * whether the version is older than the existing copy.
     * Used by test setup to materialize buffered writes.
     */
    unsafeWritePageForTests(pageIndex: number, version: number, data: Uint8Array): void {
        assert(import.meta.jest, "unsafeWritePageForTests is test-only");
        const existing = this.index.get(pageIndex);
        const slot = existing !== undefined ? existing.slot : this.nextSlot++;
        this.pagesHandle.write(data, {at: slot * sqlitePageSize});
        this.index.set(pageIndex, {slot, version});
        if (pageIndex > this.maxPageIndex) {
            this.maxPageIndex = pageIndex;
        }
        if (pageIndex === 0 && data.byteLength >= 32) {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            this.knownDatabaseSizeInPages = view.getUint32(28, false);
        }
    }

    private loadIndex(): void {
        const size = this.indexHandle.getSize();
        if (size === 0) return;

        let index: ReadonlyMap<number, {slot: number; version: number}>;
        try {
            const data = new Uint8Array(size);
            this.indexHandle.read(data, {at: 0});
            const json = new TextDecoder().decode(data);
            const parsed = JSON.parse(json) as SchemaSerializedValue;
            index = indexSchema.deserialize(parsed);
        } catch {
            // Corrupted index (e.g. worker crashed mid-write).
            // Treat as empty — the client will re-fetch pages
            // from the server on demand.
            return;
        }

        for (const [pageIndex, entry] of index) {
            this.index.set(pageIndex, entry);
            if (entry.slot >= this.nextSlot) {
                this.nextSlot = entry.slot + 1;
            }
            if (pageIndex > this.maxPageIndex) {
                this.maxPageIndex = pageIndex;
            }
        }

        // Read the database size from cached page 0's header
        // (offset 28, 4 bytes big-endian) so getFileSize is
        // accurate immediately after restart.
        const page0 = this.index.get(0);
        if (page0 !== undefined) {
            const header = new Uint8Array(32);
            this.pagesHandle.read(header, {at: page0.slot * sqlitePageSize});
            const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
            this.knownDatabaseSizeInPages = view.getUint32(28, false);
        }
    }

    private flushIndex(): void {
        const serialized = indexSchema.serialize(this.index);
        const json = JSON.stringify(serialized, null, 2);
        const encoded = new TextEncoder().encode(json);
        this.indexHandle.truncate(0);
        this.indexHandle.write(encoded, {at: 0});
        this.indexHandle.flush();
    }
}
