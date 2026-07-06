import {createInMemoryOpfsDirectoryHandle} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import type {OpfsDirectoryHandle} from "~/client/web/databases/worker/opfs.js";
import {OpfsPageStore} from "~/client/web/databases/worker/opfs_page_store.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";

function makePage(byte: number): Uint8Array {
    const data = new Uint8Array(sqlitePageSize);
    data.fill(byte);
    return data;
}

async function makeStore(): Promise<{store: OpfsPageStore; dir: OpfsDirectoryHandle}> {
    const dir = createInMemoryOpfsDirectoryHandle();
    const store = await OpfsPageStore.create(dir);
    return {store, dir};
}

describe("OpfsPageStore.writePageIfNewer", () => {
    test("writes when no entry exists", async () => {
        const {store} = await makeStore();
        expect(store.writePageIfNewer(0, 1, makePage(0xaa))).toBe(true);
    });

    test("rejects an older version", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 5, makePage(0xaa));
        expect(store.writePageIfNewer(0, 4, makePage(0xbb))).toBe(false);
    });

    test("rejects an equal version", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 5, makePage(0xaa));
        expect(store.writePageIfNewer(0, 5, makePage(0xbb))).toBe(false);
    });

    test("accepts a strictly newer version and replaces the slot", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 1, makePage(0xaa));
        expect(store.writePageIfNewer(0, 2, makePage(0xbb))).toBe(true);
        expect(store.readPage(0)).toEqual({data: makePage(0xbb), version: 2});
    });

    test("does not allocate a new slot on rewrite", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.writePageIfNewer(1, 1, makePage(0xbb));
        store.writePageIfNewer(0, 2, makePage(0xcc));
        // Slot 0 is still page 0, slot 1 still page 1.
        expect(store.pageEntries()).toEqual(
            expect.arrayContaining([
                {pageIndex: 0, version: 2},
                {pageIndex: 1, version: 1},
            ]),
        );
    });
});

describe("OpfsPageStore.readPage", () => {
    test("returns null for an unknown page", async () => {
        const {store} = await makeStore();
        expect(store.readPage(0)).toBeNull();
    });

    test("returns data + version after a write", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(3, 7, makePage(0xcd));
        expect(store.readPage(3)).toEqual({data: makePage(0xcd), version: 7});
    });
});

describe("OpfsPageStore.deletePages", () => {
    test("removes pages from the index", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.writePageIfNewer(1, 1, makePage(0xbb));
        store.deletePages(new Set([1]));
        expect(store.readPage(1)).toBeNull();
    });

    test("recomputes maxPageIndex so getFileSize falls back correctly", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.writePageIfNewer(2, 1, makePage(0xbb));
        // Two pages cached, max index = 2 → 3 pages.
        expect(store.getFileSize()).toBe(3 * sqlitePageSize);
        store.deletePages(new Set([2]));
        // Max index drops to 0 → 1 page.
        expect(store.getFileSize()).toBe(1 * sqlitePageSize);
    });

    test("does not change knownDatabaseSizeInPages", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.writePageIfNewer(1, 1, makePage(0xbb));
        // Server says the canonical file is 10 pages.
        store.setServerFileSizeInPages(10);
        store.deletePages(new Set([1]));
        // deletePages must not silently shrink the size — the server size remains the
        // source of truth.
        expect(store.getFileSize()).toBe(10 * sqlitePageSize);
    });

    test("a deleted page accepts a rewrite at any version", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 5, makePage(0xaa));
        store.deletePages(new Set([0]));
        // Plain deletion carries no version knowledge, so even an older write lands.
        expect(store.writePageIfNewer(0, 3, makePage(0xbb))).toBe(true);
    });
});

describe("OpfsPageStore.tombstonePages", () => {
    test("removes the page from the index", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.tombstonePages(new Map([[0, 3]]));
        expect(store.readPage(0)).toBeNull();
    });

    test("rejects a write below the tombstoned version", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 1, makePage(0xaa));
        // A version-3 diff couldn't apply; a late version-2 snapshot (e.g. an in-flight
        // ensureCacheIsUpToDate response) must not resurrect the page.
        store.tombstonePages(new Map([[0, 3]]));
        expect(store.writePageIfNewer(0, 2, makePage(0xbb))).toBe(false);
    });

    test("accepts a write at the tombstoned version and clears the tombstone", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.tombstonePages(new Map([[0, 3]]));
        // Receiving the full page at the version the tombstone recorded is the cure.
        expect({
            written: store.writePageIfNewer(0, 3, makePage(0xbb)),
            page: store.readPage(0),
        }).toEqual({
            written: true,
            page: {data: makePage(0xbb), version: 3},
        });
    });
});

describe("OpfsPageStore.getFileSize", () => {
    test("returns 0 when empty", async () => {
        const {store} = await makeStore();
        expect(store.getFileSize()).toBe(0);
    });

    test("falls back to maxPageIndex when no server size is known", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(4, 1, makePage(0xaa));
        expect(store.getFileSize()).toBe(5 * sqlitePageSize);
    });

    test("uses the server size when set, even if cache is sparse", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.setServerFileSizeInPages(100);
        expect(store.getFileSize()).toBe(100 * sqlitePageSize);
    });

    test("uses the server size even when 0 cached pages are present", async () => {
        const {store} = await makeStore();
        store.setServerFileSizeInPages(50);
        expect(store.getFileSize()).toBe(50 * sqlitePageSize);
    });
});

describe("OpfsPageStore.pageEntries", () => {
    test("returns a snapshot of cached pages", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.writePageIfNewer(2, 3, makePage(0xbb));
        expect(store.pageEntries().sort((a, b) => a.pageIndex - b.pageIndex)).toEqual([
            {pageIndex: 0, version: 1},
            {pageIndex: 2, version: 3},
        ]);
    });
});

describe("OpfsPageStore persistence", () => {
    test("round-trips pages, versions, and fileSizeInPages across reopen", async () => {
        const dir = createInMemoryOpfsDirectoryHandle();
        const store = await OpfsPageStore.create(dir);
        store.writePageIfNewer(0, 7, makePage(0xaa));
        store.writePageIfNewer(2, 9, makePage(0xbb));
        store.setServerFileSizeInPages(50);
        store.sync();

        const reopened = await OpfsPageStore.create(dir);
        expect(reopened.readPage(0)).toEqual({data: makePage(0xaa), version: 7});
        expect(reopened.readPage(2)).toEqual({data: makePage(0xbb), version: 9});
        expect(reopened.getFileSize()).toBe(50 * sqlitePageSize);
    });

    test("treats a corrupted index.json as empty", async () => {
        const dir = createInMemoryOpfsDirectoryHandle();
        const indexHandle = await (
            await dir.getFileHandle("index.json", {create: true})
        ).createSyncAccessHandle();
        // Garbage bytes that JSON.parse rejects.
        indexHandle.write(new TextEncoder().encode("{not valid json"), {at: 0});
        indexHandle.flush();

        const store = await OpfsPageStore.create(dir);
        expect(store.pageEntries()).toEqual([]);
        expect(store.getFileSize()).toBe(0);
    });

    test("discards the cache when a previous write was interrupted", async () => {
        const dir = createInMemoryOpfsDirectoryHandle();
        const store = await OpfsPageStore.create(dir);
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.sync();
        // A write that never reaches sync() leaves the dirty sentinel set, standing in for
        // a crash mid-write.
        store.writePageIfNewer(0, 2, makePage(0xbb));

        const reopened = await OpfsPageStore.create(dir);
        expect(reopened.pageEntries()).toEqual([]);
    });

    test("a clean close preserves the cache without an explicit sync", async () => {
        const dir = createInMemoryOpfsDirectoryHandle();
        const store = await OpfsPageStore.create(dir);
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.close();

        const reopened = await OpfsPageStore.create(dir);
        expect(reopened.readPage(0)).toEqual({data: makePage(0xaa), version: 1});
    });

    test("nextSlot recovers after reopen so new writes do not overwrite existing slots", async () => {
        const dir = createInMemoryOpfsDirectoryHandle();
        const store = await OpfsPageStore.create(dir);
        store.writePageIfNewer(0, 1, makePage(0xaa));
        store.writePageIfNewer(1, 1, makePage(0xbb));
        store.sync();

        const reopened = await OpfsPageStore.create(dir);
        // A brand-new page should land in a fresh slot.
        reopened.writePageIfNewer(2, 1, makePage(0xcc));
        expect(reopened.readPage(0)).toEqual({data: makePage(0xaa), version: 1});
        expect(reopened.readPage(1)).toEqual({data: makePage(0xbb), version: 1});
        expect(reopened.readPage(2)).toEqual({data: makePage(0xcc), version: 1});
    });
});

describe("OpfsPageStore.unsafeWritePageForTests", () => {
    test("overwrites without a version check", async () => {
        const {store} = await makeStore();
        store.writePageIfNewer(0, 10, makePage(0xaa));
        store.unsafeWritePageForTests(0, 1, makePage(0xbb));
        expect(store.readPage(0)).toEqual({data: makePage(0xbb), version: 1});
    });
});
