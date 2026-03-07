import type {OpfsDirectoryHandle, OpfsSyncAccessHandle} from "~/client/web/databases/opfs.js";
import type {VfsFile} from "~/shared/databases/install_vfs.js";
import {PageMissingError} from "~/shared/databases/page_missing_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema, type SchemaSerializedValue} from "~/shared/schema/schema.js";

const pageSize = 4096;

const indexSchema = Schema.map(
    Schema.integer,
    Schema.object({
        slot: Schema.integer,
        timestamp: Schema.float,
    }),
);

/**
 * A {@link VfsFile} that stores database pages in OPFS.
 *
 * Pages are stored as dense 4096-byte slots in a single
 * `pages.bin` file. An in-memory index maps page indices
 * to slot positions and timestamps.
 *
 * Reads go to OPFS on-demand (SQLite's page cache handles
 * repeat reads). Writes are write-through.
 */
export class OpfsPageStore implements VfsFile {
    private readonly index = new Map<number, {slot: number; timestamp: number}>();
    private readonly pagesHandle: OpfsSyncAccessHandle;
    private readonly indexHandle: OpfsSyncAccessHandle;
    private nextSlot = 0;
    private maxPageIndex = -1;
    private knownDatabaseSizeInPages = 0;
    private readonly optimisticPages = new Map<number, Uint8Array>();
    private inOptimistic = false;
    private activeWriteSet: Set<number> | null = null;

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
     * Runs `cb` with writes directed to the optimistic
     * overlay. Returns the set of page indices written.
     */
    optimistic(cb: () => void): ReadonlySet<number> {
        this.inOptimistic = true;
        const writtenPages = new Set<number>();
        this.activeWriteSet = writtenPages;
        try {
            cb();
        } finally {
            this.inOptimistic = false;
            this.activeWriteSet = null;
        }
        return writtenPages;
    }

    /**
     * Returns the overlay data for a page, or undefined
     * if it's not in the optimistic overlay.
     */
    getOptimisticPage(pageIndex: number): Uint8Array | undefined {
        return this.optimisticPages.get(pageIndex);
    }

    clearOptimisticPages(): void {
        this.optimisticPages.clear();
    }

    hasOptimisticPages(): boolean {
        return this.optimisticPages.size > 0;
    }

    read(data: Uint8Array, offset: number): boolean {
        const currentSize = this.fileSize();
        if (offset >= currentSize) {
            data.fill(0);
            return false;
        }

        const pageIndex = Math.floor(offset / pageSize);
        assert(
            Math.floor((offset + data.byteLength - 1) / pageSize) === pageIndex,
            `read spans pages: offset=${offset} amount=${data.byteLength}`,
        );

        const overlay = this.optimisticPages.get(pageIndex);
        if (overlay !== undefined) {
            const pageOffset = offset % pageSize;
            data.set(overlay.subarray(pageOffset, pageOffset + data.byteLength));
            return true;
        }

        const entry = this.index.get(pageIndex);
        if (entry === undefined) {
            throw new PageMissingError(pageIndex);
        }

        const pageOffset = offset % pageSize;
        this.pagesHandle.read(data, {at: entry.slot * pageSize + pageOffset});
        return true;
    }

    write(data: Uint8Array, offset: number): void {
        assert(offset % pageSize === 0, `write offset ${offset} not page-aligned`);
        assert(data.byteLength === pageSize, `write amount ${data.byteLength} !== ${pageSize}`);

        const pageIndex = offset / pageSize;

        if (this.inOptimistic) {
            this.optimisticPages.set(pageIndex, new Uint8Array(data));
            this.activeWriteSet?.add(pageIndex);
            if (pageIndex > this.maxPageIndex) {
                this.maxPageIndex = pageIndex;
            }
            return;
        }

        assert(!this.hasOptimisticPages(), "cannot write to OPFS while optimistic pages exist");

        const existing = this.index.get(pageIndex);
        const slot = existing !== undefined ? existing.slot : this.nextSlot++;

        this.pagesHandle.write(data, {at: slot * pageSize});
        this.index.set(pageIndex, {slot, timestamp: Date.now()});

        if (pageIndex > this.maxPageIndex) {
            this.maxPageIndex = pageIndex;
        }
    }

    truncate(size: number): void {
        const newMaxPage = size > 0 ? size / pageSize - 1 : -1;

        for (const pageIndex of this.index.keys()) {
            if (pageIndex > newMaxPage) {
                this.index.delete(pageIndex);
            }
        }

        if (this.index.size === 0) {
            this.pagesHandle.truncate(0);
            this.nextSlot = 0;
            this.maxPageIndex = -1;
        } else {
            this.maxPageIndex = -1;
            for (const pageIndex of this.index.keys()) {
                if (pageIndex > this.maxPageIndex) {
                    this.maxPageIndex = pageIndex;
                }
            }
        }
    }

    sync(): void {
        if (this.inOptimistic) return;
        assert(!this.hasOptimisticPages(), "cannot sync OPFS while optimistic pages exist");
        this.pagesHandle.flush();
        this.flushIndex();
    }

    fileSize(): number {
        let size: number;
        if (this.knownDatabaseSizeInPages > 0) {
            size = this.knownDatabaseSizeInPages * pageSize;
        } else {
            size = this.maxPageIndex < 0 ? 0 : (this.maxPageIndex + 1) * pageSize;
        }
        for (const pageIndex of this.optimisticPages.keys()) {
            const end = (pageIndex + 1) * pageSize;
            if (end > size) size = end;
        }
        return size;
    }

    close(): void {
        this.flushIndex();
        this.pagesHandle.close();
        this.indexHandle.close();
    }

    private loadIndex(): void {
        const size = this.indexHandle.getSize();
        if (size === 0) return;

        const data = new Uint8Array(size);
        this.indexHandle.read(data, {at: 0});
        const json = new TextDecoder().decode(data);
        const parsed = JSON.parse(json) as SchemaSerializedValue;
        const index = indexSchema.deserialize(parsed);

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
        // (offset 28, 4 bytes big-endian) so fileSize() is
        // accurate immediately after restart.
        const page0 = this.index.get(0);
        if (page0 !== undefined) {
            const header = new Uint8Array(32);
            this.pagesHandle.read(header, {at: page0.slot * pageSize});
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

    /**
     * Writes a page to the store only if the incoming
     * timestamp is strictly newer than the local copy.
     * Also updates the known database size from page 1's
     * header when page 0 is written.
     */
    writePageIfNewer(pageIndex: number, timestamp: number, data: Uint8Array): boolean {
        assert(!this.hasOptimisticPages(), "cannot write to OPFS while optimistic pages exist");
        const existing = this.index.get(pageIndex);
        if (existing !== undefined && existing.timestamp >= timestamp) {
            return false;
        }

        const slot = existing !== undefined ? existing.slot : this.nextSlot++;
        this.pagesHandle.write(data, {at: slot * pageSize});
        this.index.set(pageIndex, {slot, timestamp});

        if (pageIndex > this.maxPageIndex) {
            this.maxPageIndex = pageIndex;
        }

        // Page 0 (SQLite page 1) contains the database size
        // in pages at offset 28 (4 bytes, big-endian).
        if (pageIndex === 0 && data.byteLength >= 32) {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            this.knownDatabaseSizeInPages = view.getUint32(28, false);
        }

        return true;
    }

    /**
     * Reads the full page data for a given page index.
     * Returns null if the page is not in the store.
     */
    readPage(pageIndex: number): Uint8Array | null {
        const entry = this.index.get(pageIndex);
        if (entry === undefined) return null;
        const data = new Uint8Array(pageSize);
        this.pagesHandle.read(data, {at: entry.slot * pageSize});
        return data;
    }

    isEmpty(): boolean {
        return this.index.size === 0 && this.optimisticPages.size === 0;
    }

    /**
     * Returns the set of stored pages with their timestamps.
     * Useful for understanding which pages are cached locally
     * and how old they are (e.g., for sync decisions).
     */
    pageEntries(): Array<{pageIndex: number; timestamp: number}> {
        const entries: Array<{pageIndex: number; timestamp: number}> = [];
        for (const [pageIndex, {timestamp}] of this.index) {
            entries.push({pageIndex, timestamp});
        }
        return entries;
    }
}
