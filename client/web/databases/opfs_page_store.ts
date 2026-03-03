import type {OpfsDirectoryHandle, OpfsSyncAccessHandle} from "~/client/web/databases/opfs.js";
import type {VfsFile} from "~/shared/databases/install_vfs.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema} from "~/shared/schema/schema.js";

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

    private constructor(pagesHandle: OpfsSyncAccessHandle, indexHandle: OpfsSyncAccessHandle) {
        this.pagesHandle = pagesHandle;
        this.indexHandle = indexHandle;
    }

    static async create(dir: OpfsDirectoryHandle): Promise<OpfsPageStore> {
        const pagesFile = await dir.getFileHandle("pages.bin", {create: true});
        const pagesHandle = await pagesFile.createSyncAccessHandle();
        const indexFile = await dir.getFileHandle("index.json", {create: true});
        const indexHandle = await indexFile.createSyncAccessHandle();

        // TODO: Load existing data instead of clearing on
        // every start.
        pagesHandle.truncate(0);
        indexHandle.truncate(0);

        return new OpfsPageStore(pagesHandle, indexHandle);
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

        const entry = this.index.get(pageIndex);
        if (entry === undefined) {
            // Sparse hole — page not stored, return zeros.
            data.fill(0);
            return true;
        }

        const pageOffset = offset % pageSize;
        this.pagesHandle.read(data, {at: entry.slot * pageSize + pageOffset});
        return true;
    }

    write(data: Uint8Array, offset: number): void {
        assert(offset % pageSize === 0, `write offset ${offset} not page-aligned`);
        assert(data.byteLength === pageSize, `write amount ${data.byteLength} !== ${pageSize}`);

        const pageIndex = offset / pageSize;
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
        this.pagesHandle.flush();
        this.flushIndex();
    }

    fileSize(): number {
        return this.maxPageIndex < 0 ? 0 : (this.maxPageIndex + 1) * pageSize;
    }

    close(): void {
        this.flushIndex();
        this.pagesHandle.close();
        this.indexHandle.close();
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
