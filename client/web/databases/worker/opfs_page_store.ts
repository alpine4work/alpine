import type {
    OpfsDirectoryHandle,
    OpfsSyncAccessHandle,
} from "~/client/web/databases/worker/opfs.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema, type SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * On-disk shape of `index.json`. The persisted file size is the canonical SQLite
 * file size in pages — sourced from the realtime protocol's `fileSizeInPages`
 * field via {@link OpfsPageStore.setServerFileSizeInPages} — so the cache can
 * serve a logically-correct file size after restart even when only a subset of
 * pages are cached locally.
 */
const indexSchema = Schema.object({
    fileSizeInPages: Schema.integer,
    pages: Schema.map(
        Schema.integer,
        Schema.object({
            slot: Schema.integer,
            version: Schema.integer,
        }),
    ),
});

/**
 * Sentinel byte written to the `dirty` file while `pages.bin` has un-synced
 * writes. Any non-empty `dirty` file means "a write was in progress"; the value
 * itself is irrelevant, so a single byte suffices.
 */
const dirtyMarker = new Uint8Array([1]);

/**
 * Durable per-table page cache stored in OPFS.
 *
 * Pages are persisted as dense {@link sqlitePageSize}-byte slots in a single
 * `pages.bin` file. An in-memory index maps page indices to slot positions and
 * versions, and is mirrored on disk in `index.json` alongside the canonical file
 * size in pages.
 *
 * The store is purely a read-through cache plus a server-driven write API ({@link
 * writePageIfNewer}, {@link deletePages}, {@link setServerFileSizeInPages}).
 * Optimistic SQL-driven writes live in the in-memory buffer owned by the
 * `Database` that consumes this store via `OpfsDatabaseStorage`.
 *
 * The canonical file size is supplied externally — by the realtime protocol, by
 * `ensureCacheIsUpToDate`, etc. — and persisted as part of the index. The store
 * never tries to derive size from cached page bytes (e.g. the SQLite header at
 * page-0 offset 28); doing so would couple the cache to SQLite's internal page
 * layout and break for tables whose canonical size shrinks below the cached
 * `maxPageIndex`.
 */
export class OpfsPageStore {
    private readonly index = new Map<number, {slot: number; version: number}>();
    /**
     * Pages dropped by {@link tombstonePages}, mapped to the version that was known to
     * exist when they were dropped. In-memory only: after a restart the page is simply
     * absent and cold-open validation re-fetches it.
     */
    private readonly tombstones = new Map<number, number>();
    private readonly pagesHandle: OpfsSyncAccessHandle;
    private readonly indexHandle: OpfsSyncAccessHandle;
    private readonly dirtyHandle: OpfsSyncAccessHandle;
    private nextSlot = 0;
    private maxPageIndex = -1;
    private knownDatabaseSizeInPages = 0;
    private dirty = false;

    private constructor(
        pagesHandle: OpfsSyncAccessHandle,
        indexHandle: OpfsSyncAccessHandle,
        dirtyHandle: OpfsSyncAccessHandle,
    ) {
        this.pagesHandle = pagesHandle;
        this.indexHandle = indexHandle;
        this.dirtyHandle = dirtyHandle;
    }

    static async create(dir: OpfsDirectoryHandle): Promise<OpfsPageStore> {
        // OPFS sync-access handles are exclusive: a leaked handle blocks every later open
        // of the same file. If any step after the first handle opens throws, close what
        // we've opened so far before propagating.
        const pagesFile = await dir.getFileHandle("pages.bin", {create: true});
        const pagesHandle = await pagesFile.createSyncAccessHandle();
        let indexHandle: OpfsSyncAccessHandle;
        try {
            const indexFile = await dir.getFileHandle("index.json", {create: true});
            indexHandle = await indexFile.createSyncAccessHandle();
        } catch (error) {
            pagesHandle.close();
            throw error;
        }
        let dirtyHandle: OpfsSyncAccessHandle;
        try {
            const dirtyFile = await dir.getFileHandle("dirty", {create: true});
            dirtyHandle = await dirtyFile.createSyncAccessHandle();
        } catch (error) {
            pagesHandle.close();
            indexHandle.close();
            throw error;
        }

        const store = new OpfsPageStore(pagesHandle, indexHandle, dirtyHandle);
        try {
            store.recoverOrLoadIndex();
        } catch (error) {
            pagesHandle.close();
            indexHandle.close();
            dirtyHandle.close();
            throw error;
        }
        return store;
    }

    /**
     * Read the durable page at `pageIndex`. Returns `null` if no copy exists locally.
     */
    readPage(pageIndex: number): {data: Uint8Array; version: number} | null {
        const entry = this.index.get(pageIndex);
        if (entry === undefined) return null;
        const data = new Uint8Array(sqlitePageSize);
        this.pagesHandle.read(data, {at: entry.slot * sqlitePageSize});
        return {data, version: entry.version};
    }

    /**
     * Current logical file size in bytes. Uses the server-reported size when known so
     * SQLite sees the full database even when only a subset of pages are cached
     * locally; otherwise falls back to the highest page index actually present.
     */
    getFileSize(): number {
        if (this.knownDatabaseSizeInPages > 0) {
            return this.knownDatabaseSizeInPages * sqlitePageSize;
        }
        return this.maxPageIndex < 0 ? 0 : (this.maxPageIndex + 1) * sqlitePageSize;
    }

    /**
     * Write a page if `version` is strictly newer than the local copy — or, for a page
     * dropped by {@link tombstonePages}, at least as new as the version the tombstone
     * recorded (receiving the full page at that version is exactly the cure). Returns
     * `true` if the local copy was replaced.
     *
     * Does _not_ update the cached file size — callers pair page writes with {@link
     * setServerFileSizeInPages} using the protocol's `fileSizeInPages` field.
     */
    writePageIfNewer(pageIndex: number, version: number, data: Uint8Array): boolean {
        const existing = this.index.get(pageIndex);
        if (existing !== undefined && existing.version >= version) {
            return false;
        }
        const tombstoneVersion = this.tombstones.get(pageIndex);
        if (tombstoneVersion !== undefined && version < tombstoneVersion) {
            return false;
        }
        this.tombstones.delete(pageIndex);
        this.writeSlot(pageIndex, version, data);
        return true;
    }

    /**
     * Drop pages from the index by index. The underlying slot data in `pages.bin`
     * becomes unreachable but harmless — it is reclaimed if a new page is written to
     * that slot later.
     *
     * Does _not_ update the cached file size; callers pair deletions with {@link
     * setServerFileSizeInPages}.
     */
    deletePages(pageIndexes: ReadonlySet<number>): void {
        for (const pageIndex of pageIndexes) {
            this.index.delete(pageIndex);
        }
        this.recomputeMaxPageIndex();
    }

    /**
     * Drop pages because a newer version (the map value) is known to exist but its
     * data couldn't be obtained — e.g. a realtime diff whose base didn't match the
     * cached page. Unlike {@link deletePages}, the version is remembered (in memory
     * only) so a late-arriving write below it — say, an `ensureCacheIsUpToDate`
     * response snapshotted before the diff was broadcast — can't resurrect the page at
     * a stale version; see {@link writePageIfNewer}. The page reads as missing until a
     * write at or above the recorded version lands (typically the server fallback
     * triggered by the next read).
     */
    tombstonePages(pages: ReadonlyMap<number, number>): void {
        for (const [pageIndex, version] of pages) {
            this.index.delete(pageIndex);
            const existing = this.tombstones.get(pageIndex);
            if (existing === undefined || existing < version) {
                this.tombstones.set(pageIndex, version);
            }
        }
        this.recomputeMaxPageIndex();
    }

    private recomputeMaxPageIndex(): void {
        this.maxPageIndex = -1;
        for (const pageIndex of this.index.keys()) {
            if (pageIndex > this.maxPageIndex) {
                this.maxPageIndex = pageIndex;
            }
        }
    }

    /**
     * Set the canonical file size in pages, supplied by the protocol
     * (`fileSizeInPages` on realtime page diffs and `ensureCacheIsUpToDate`
     * responses).
     */
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
        // `pages.bin` and `index.json` are now durable and mutually consistent, so it's
        // safe to clear the dirty sentinel. This must happen _after_ both flushes: if we
        // cleared first, a crash in between would leave a "clean" marker over torn page
        // bytes.
        this.markClean();
    }

    close(): void {
        // A graceful close is a clean shutdown: flush everything and clear the dirty
        // sentinel so the next open doesn't needlessly discard the cache.
        this.sync();
        this.pagesHandle.close();
        this.indexHandle.close();
        this.dirtyHandle.close();
    }

    /**
     * Test-only: write a page at `version` regardless of whether the version is older
     * than the existing copy. Used by test setup to materialize buffered writes via
     * `commitOptimisticPagesForTests`.
     */
    unsafeWritePageForTests(pageIndex: number, version: number, data: Uint8Array): void {
        assert(import.meta.jest, "unsafeWritePageForTests is test-only");
        this.writeSlot(pageIndex, version, data);
    }

    private writeSlot(pageIndex: number, version: number, data: Uint8Array): void {
        // Record that `pages.bin` has un-synced writes _before_ those bytes can become
        // durable, so an interrupted write is always caught on the next open. See {@link
        // markDirty}.
        this.markDirty();
        const existing = this.index.get(pageIndex);
        const slot = existing !== undefined ? existing.slot : this.nextSlot++;
        this.pagesHandle.write(data, {at: slot * sqlitePageSize});
        this.index.set(pageIndex, {slot, version});
        if (pageIndex > this.maxPageIndex) {
            this.maxPageIndex = pageIndex;
        }
    }

    /**
     * Light-weight corruption recovery on open.
     *
     * We don't journal page writes, so an interrupted write can tear a `pages.bin`
     * slot in place — leaving the index pointing at bytes that are neither the old nor
     * the new page. SQLite won't notice (the main DB file has no per-page checksums),
     * so the only safe move is to detect that a write was in flight and discard the
     * cache.
     *
     * The `dirty` sentinel is non-empty whenever `pages.bin` has un-synced writes (see
     * {@link markDirty} / {@link markClean}). If it's set at open, the previous
     * session died mid-write, so we conservatively wipe this table's cache. It's a
     * read-through cache — the client re-fetches discarded pages from the server on
     * demand. This is intentionally coarse: most interrupted writes don't actually
     * corrupt anything, but wiping is always correctness-safe and a clean re-sync is
     * cheap relative to serving silently-wrong data.
     */
    private recoverOrLoadIndex(): void {
        if (this.dirtyHandle.getSize() === 0) {
            this.loadIndex();
            return;
        }
        this.pagesHandle.truncate(0);
        this.pagesHandle.flush();
        this.indexHandle.truncate(0);
        this.indexHandle.flush();
        this.dirtyHandle.truncate(0);
        this.dirtyHandle.flush();
        // The in-memory index is already empty and `dirty` is already `false`, so we're
        // left in a consistent, clean state.
    }

    /**
     * Mark the store dirty: record on disk that `pages.bin` has writes that haven't
     * been durably synced yet. Flushed immediately so the marker is durable _before_
     * any page bytes can be — `flush()` is the only ordering barrier OPFS gives us
     * across files.
     *
     * Only flips on the clean -> dirty edge, so a stream of writes costs a single
     * extra flush, not one per write.
     */
    private markDirty(): void {
        if (this.dirty) return;
        this.dirtyHandle.write(dirtyMarker, {at: 0});
        this.dirtyHandle.flush();
        this.dirty = true;
    }

    /**
     * Mark the store clean: clear the dirty sentinel. Only call once `pages.bin` and
     * `index.json` are durable (see {@link sync}).
     */
    private markClean(): void {
        if (!this.dirty) return;
        this.dirtyHandle.truncate(0);
        this.dirtyHandle.flush();
        this.dirty = false;
    }

    private loadIndex(): void {
        const size = this.indexHandle.getSize();
        if (size === 0) return;

        let parsedIndex: {
            fileSizeInPages: number;
            pages: ReadonlyMap<number, {slot: number; version: number}>;
        };
        try {
            const data = new Uint8Array(size);
            this.indexHandle.read(data, {at: 0});
            const json = new TextDecoder().decode(data);
            const parsed = JSON.parse(json) as SchemaSerializedValue;
            parsedIndex = indexSchema.deserialize(parsed);
        } catch {
            // Corrupted index (e.g. worker crashed mid-write). Treat as empty — the client
            // will re-fetch pages from the server on demand.
            return;
        }

        for (const [pageIndex, entry] of parsedIndex.pages) {
            this.index.set(pageIndex, entry);
            if (entry.slot >= this.nextSlot) {
                this.nextSlot = entry.slot + 1;
            }
            if (pageIndex > this.maxPageIndex) {
                this.maxPageIndex = pageIndex;
            }
        }
        this.knownDatabaseSizeInPages = parsedIndex.fileSizeInPages;
    }

    private flushIndex(): void {
        const serialized = indexSchema.serialize({
            fileSizeInPages: this.knownDatabaseSizeInPages,
            pages: this.index,
        });
        const json = JSON.stringify(serialized, null, 2);
        const encoded = new TextEncoder().encode(json);
        this.indexHandle.truncate(0);
        this.indexHandle.write(encoded, {at: 0});
        this.indexHandle.flush();
    }
}
