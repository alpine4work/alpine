import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";

let storage: any;

beforeEach(() => {
    storage = new DurableObjectStorage(new MemoryStorage());
});

describe("DatabaseDurableObjectStorage", () => {
    test("construct, write pages, read them back", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        const page = new Uint8Array(sqlitePageSize);
        page[0] = 0xab;
        page[sqlitePageSize - 1] = 0xcd;

        doStorage.writePages(new Map([[0, page]]));

        const {data: read, timestamp} = doStorage.readPage(0)!;

        expect(read![0]).toBe(0xab);
        expect(read![sqlitePageSize - 1]).toBe(0xcd);
        expect(read!.byteLength).toBe(sqlitePageSize);
        expect(timestamp).toBeGreaterThan(0);
    });

    test("readPage returns null for unwritten index", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        expect(doStorage.readPage(99)).toBeNull();
    });

    test("getFileSize reflects written pages", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        expect(doStorage.getFileSize()).toBe(0);

        doStorage.writePages(
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        expect(doStorage.getFileSize()).toBe(3 * sqlitePageSize);
    });

    test("truncate writes tombstones for pages at or beyond the threshold", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        doStorage.writePages(
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        doStorage.truncate(1 * sqlitePageSize);

        // Pages 1 and 2 should be tombstones; page 0 survives.
        const page1 = doStorage.readPage(1);
        expect(page1).not.toBeNull();
        expect(page1!.data).toBeNull();
        expect(page1!.timestamp).toBeGreaterThan(0);

        const page2 = doStorage.readPage(2);
        expect(page2).not.toBeNull();
        expect(page2!.data).toBeNull();

        expect(doStorage.getFileSize()).toBe(1 * sqlitePageSize);
    });

    test("readPage returns tombstone after truncate", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        doStorage.writePages(new Map([[0, new Uint8Array(sqlitePageSize)]]));
        doStorage.truncate(0);

        const page = doStorage.readPage(0);
        expect(page).not.toBeNull();
        expect(page!.data).toBeNull();
        expect(page!.timestamp).toBeGreaterThan(0);
    });

    test("getFileSize is correct after truncate", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        doStorage.writePages(
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        expect(doStorage.getFileSize()).toBe(3 * sqlitePageSize);
        doStorage.truncate(2 * sqlitePageSize);
        expect(doStorage.getFileSize()).toBe(2 * sqlitePageSize);
    });

    test("writePages after truncate correctly extends file size", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        doStorage.writePages(
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
            ]),
        );
        doStorage.truncate(1 * sqlitePageSize);
        expect(doStorage.getFileSize()).toBe(1 * sqlitePageSize);

        // Write a page beyond the current file size.
        doStorage.writePages(new Map([[3, new Uint8Array(sqlitePageSize)]]));
        expect(doStorage.getFileSize()).toBe(4 * sqlitePageSize);
    });

    test("writePages returns the timestamp it stamped onto the rows", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        const returned = doStorage.writePages(new Map([[0, new Uint8Array(sqlitePageSize)]]));

        const {timestamp} = doStorage.readPage(0)!;
        expect(returned).toBe(timestamp);
    });

    test("consecutive writes have strictly increasing timestamps", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        // Many writes in a tight loop. With Date.now() at
        // millisecond resolution, several of these will land in
        // the same wall-clock millisecond — the `prev + 1`
        // branch is what guarantees monotonicity.
        const timestamps: Array<number> = [];
        for (let i = 0; i < 50; i++) {
            timestamps.push(doStorage.writePages(new Map([[i, new Uint8Array(sqlitePageSize)]])));
        }

        for (let i = 1; i < timestamps.length; i++) {
            expect(timestamps[i]!).toBeGreaterThan(timestamps[i - 1]!);
        }
    });

    test("truncate timestamp is strictly greater than prior writePages timestamp", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        const writeTs = doStorage.writePages(
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
            ]),
        );
        doStorage.truncate(0);

        const tombstoneTs = doStorage.readPage(0)!.timestamp;
        expect(tombstoneTs).toBeGreaterThan(writeTs);
    });

    test("readPage returns the latest version when a page is rewritten", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        const first = new Uint8Array(sqlitePageSize);
        first[0] = 0x11;
        const second = new Uint8Array(sqlitePageSize);
        second[0] = 0x22;

        doStorage.writePages(new Map([[0, first]]));
        doStorage.writePages(new Map([[0, second]]));

        const {data} = doStorage.readPage(0)!;
        expect(data![0]).toBe(0x22);
    });

    test("getLastWriteTimestamp recovers MAX(timestamp) on cold load", () => {
        // Seed the underlying storage via one instance, then
        // construct a fresh instance over the same SqlStorage
        // (simulating a Durable Object restart). The next
        // write must produce a timestamp strictly greater than
        // the previously-persisted one.
        const first = new DatabaseDurableObjectStorage(storage.sql);
        const seedTs = first.writePages(new Map([[0, new Uint8Array(sqlitePageSize)]]));

        const reloaded = new DatabaseDurableObjectStorage(storage.sql);
        const nextTs = reloaded.writePages(new Map([[1, new Uint8Array(sqlitePageSize)]]));

        expect(nextTs).toBeGreaterThan(seedTs);
    });

    test("getFileSize ignores tombstones in the interior of the file", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        // Write three pages, then tombstone the middle page
        // by truncating-and-rewriting around it.
        doStorage.writePages(
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        // Force a fresh `getFileSize` query (don't trust the
        // _fileSize cache) by constructing a new instance over
        // the same backing storage. Then write a tombstone
        // for page 1 directly so we can probe the size query.
        const reloaded = new DatabaseDurableObjectStorage(storage.sql);
        storage.sql.exec(
            "INSERT INTO pages (page_index, timestamp, data) VALUES (?, ?, NULL)",
            1,
            Date.now() + 1000,
        );

        // Page 2 is still the highest live page — file size
        // should still reflect three pages, not one.
        expect(reloaded.getFileSize()).toBe(3 * sqlitePageSize);
    });
});
