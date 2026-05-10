import {OpfsDatabaseStorage} from "~/client/web/databases/opfs_database_storage.js";
import {createInMemoryOpfsDirectoryHandle} from "~/client/web/databases/test_helpers/in_memory_opfs.js";
import {PageMissingError} from "~/shared/databases/page_missing_error.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

const tableA = "tableA" as DatabaseTableId;
const tableB = "tableB" as DatabaseTableId;

function makePage(byte: number): Uint8Array {
    const data = new Uint8Array(sqlitePageSize);
    data.fill(byte);
    return data;
}

describe("OpfsDatabaseStorage.create", () => {
    test("registers a per-table store under the group dir", async () => {
        const storage = new OpfsDatabaseStorage(createInMemoryOpfsDirectoryHandle());
        const store = await storage.create(tableA);
        expect(storage.get(tableA)).toBe(store);
    });

    test("throws when called twice for the same tableId", async () => {
        const storage = new OpfsDatabaseStorage(createInMemoryOpfsDirectoryHandle());
        await storage.create(tableA);
        await expect(storage.create(tableA)).rejects.toThrow(
            "page store for table tableA already exists",
        );
    });

    test("supports multiple tables under the same group dir", async () => {
        const storage = new OpfsDatabaseStorage(createInMemoryOpfsDirectoryHandle());
        const a = await storage.create(tableA);
        const b = await storage.create(tableB);
        expect(a).not.toBe(b);
        expect([...storage].map(([id]) => id).sort()).toEqual([tableA, tableB].sort());
    });
});

describe("OpfsDatabaseStorage.get", () => {
    test("returns undefined for an unregistered table", async () => {
        const storage = new OpfsDatabaseStorage(createInMemoryOpfsDirectoryHandle());
        expect(storage.get(tableA)).toBeUndefined();
    });
});

describe("OpfsDatabaseStorage.readPage", () => {
    test("returns the cached page when present", async () => {
        const storage = new OpfsDatabaseStorage(createInMemoryOpfsDirectoryHandle());
        const store = await storage.create(tableA);
        store.writePageIfNewer(0, 1, makePage(0xaa));

        expect(storage.readPage(tableA, 0)).toEqual({data: makePage(0xaa), version: 1});
    });

    test("returns null when the index is past the file end (EOF)", async () => {
        const storage = new OpfsDatabaseStorage(createInMemoryOpfsDirectoryHandle());
        const store = await storage.create(tableA);
        store.setServerFileSizeInPages(2);

        // Index 5 is well past the canonical 2-page file.
        expect(storage.readPage(tableA, 5)).toBeNull();
    });

    test("throws PageMissingError when the page is within the canonical size but not cached", async () => {
        const storage = new OpfsDatabaseStorage(createInMemoryOpfsDirectoryHandle());
        const store = await storage.create(tableA);
        store.setServerFileSizeInPages(10);

        expect(() => storage.readPage(tableA, 3)).toThrow(PageMissingError);
    });

    test("asserts when the table is unknown", async () => {
        const storage = new OpfsDatabaseStorage(createInMemoryOpfsDirectoryHandle());
        expect(() => storage.readPage(tableA, 0)).toThrow("readPage for unknown table: tableA");
    });
});

describe("OpfsDatabaseStorage.getFileSize", () => {
    test("delegates to the underlying store", async () => {
        const storage = new OpfsDatabaseStorage(createInMemoryOpfsDirectoryHandle());
        const store = await storage.create(tableA);
        store.setServerFileSizeInPages(7);

        expect(storage.getFileSize(tableA)).toBe(7 * sqlitePageSize);
    });

    test("asserts when the table is unknown", async () => {
        const storage = new OpfsDatabaseStorage(createInMemoryOpfsDirectoryHandle());
        expect(() => storage.getFileSize(tableA)).toThrow("getFileSize for unknown table: tableA");
    });
});
