import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

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

        doStorage.writePages(databaseMainTableId, new Map([[0, page]]));

        const {data: read, version} = doStorage.readPage(databaseMainTableId, 0)!;

        expect(read![0]).toBe(0xab);
        expect(read![sqlitePageSize - 1]).toBe(0xcd);
        expect(read!.byteLength).toBe(sqlitePageSize);
        expect(version).toBeGreaterThan(0);
    });

    test("readPage returns null for unwritten index", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        expect(doStorage.readPage(databaseMainTableId, 99)).toBeNull();
    });

    test("getFileSize reflects written pages", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        expect(doStorage.getFileSize(databaseMainTableId)).toBe(0);

        doStorage.writePages(
            databaseMainTableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        expect(doStorage.getFileSize(databaseMainTableId)).toBe(3 * sqlitePageSize);
    });

    test("truncate writes tombstones for pages at or beyond the threshold", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        doStorage.writePages(
            databaseMainTableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        doStorage.truncate(databaseMainTableId, 1 * sqlitePageSize);

        // Pages 1 and 2 should be tombstones; page 0 survives.
        const page1 = doStorage.readPage(databaseMainTableId, 1);
        expect(page1).not.toBeNull();
        expect(page1!.data).toBeNull();
        expect(page1!.version).toBeGreaterThan(0);

        const page2 = doStorage.readPage(databaseMainTableId, 2);
        expect(page2).not.toBeNull();
        expect(page2!.data).toBeNull();

        expect(doStorage.getFileSize(databaseMainTableId)).toBe(1 * sqlitePageSize);
    });

    test("readPage returns tombstone after truncate", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        doStorage.writePages(databaseMainTableId, new Map([[0, new Uint8Array(sqlitePageSize)]]));
        doStorage.truncate(databaseMainTableId, 0);

        const page = doStorage.readPage(databaseMainTableId, 0);
        expect(page).not.toBeNull();
        expect(page!.data).toBeNull();
        expect(page!.version).toBeGreaterThan(0);
    });

    test("getFileSize is correct after truncate", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        doStorage.writePages(
            databaseMainTableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        expect(doStorage.getFileSize(databaseMainTableId)).toBe(3 * sqlitePageSize);
        doStorage.truncate(databaseMainTableId, 2 * sqlitePageSize);
        expect(doStorage.getFileSize(databaseMainTableId)).toBe(2 * sqlitePageSize);
    });

    test("writePages after truncate correctly extends file size", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        doStorage.writePages(
            databaseMainTableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
            ]),
        );
        doStorage.truncate(databaseMainTableId, 1 * sqlitePageSize);
        expect(doStorage.getFileSize(databaseMainTableId)).toBe(1 * sqlitePageSize);

        // Write a page beyond the current file size.
        doStorage.writePages(databaseMainTableId, new Map([[3, new Uint8Array(sqlitePageSize)]]));
        expect(doStorage.getFileSize(databaseMainTableId)).toBe(4 * sqlitePageSize);
    });

    test("writePages returns the version it stamped onto the rows", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        const returned = doStorage.writePages(
            databaseMainTableId,
            new Map([[0, new Uint8Array(sqlitePageSize)]]),
        );

        const {version} = doStorage.readPage(databaseMainTableId, 0)!;
        expect(returned).toBe(version);
    });

    test("consecutive writes have strictly increasing versions", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        const versions: Array<number> = [];
        for (let i = 0; i < 50; i++) {
            versions.push(
                doStorage.writePages(
                    databaseMainTableId,
                    new Map([[i, new Uint8Array(sqlitePageSize)]]),
                ),
            );
        }

        for (let i = 1; i < versions.length; i++) {
            expect(versions[i]!).toBe(versions[i - 1]! + 1);
        }
    });

    test("truncate version is strictly greater than prior writePages version", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        const writeVersion = doStorage.writePages(
            databaseMainTableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
            ]),
        );
        doStorage.truncate(databaseMainTableId, 0);

        const tombstoneVersion = doStorage.readPage(databaseMainTableId, 0)!.version;
        expect(tombstoneVersion).toBeGreaterThan(writeVersion);
    });

    test("readPage returns the latest version when a page is rewritten", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        const first = new Uint8Array(sqlitePageSize);
        first[0] = 0x11;
        const second = new Uint8Array(sqlitePageSize);
        second[0] = 0x22;

        doStorage.writePages(databaseMainTableId, new Map([[0, first]]));
        doStorage.writePages(databaseMainTableId, new Map([[0, second]]));

        const {data} = doStorage.readPage(databaseMainTableId, 0)!;
        expect(data![0]).toBe(0x22);
    });

    test("getLastWriteVersion recovers MAX(version) on cold load", () => {
        // Seed the underlying storage via one instance, then
        // construct a fresh instance over the same SqlStorage
        // (simulating a Durable Object restart). The next
        // write must produce a version strictly greater than
        // the previously-persisted one.
        const first = new DatabaseDurableObjectStorage(storage.sql);
        const seedVersion = first.writePages(
            databaseMainTableId,
            new Map([[0, new Uint8Array(sqlitePageSize)]]),
        );

        const reloaded = new DatabaseDurableObjectStorage(storage.sql);
        const nextVersion = reloaded.writePages(
            databaseMainTableId,
            new Map([[1, new Uint8Array(sqlitePageSize)]]),
        );

        expect(nextVersion).toBeGreaterThan(seedVersion);
    });

    test("getFileSize ignores tombstones in the interior of the file", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        // Write three pages, then tombstone the middle page
        // by writing a tombstone row directly so we can probe
        // the size query without going through truncate (which
        // would tombstone the trailing pages too).
        doStorage.writePages(
            databaseMainTableId,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
                [2, new Uint8Array(sqlitePageSize)],
            ]),
        );

        // Force a fresh `getFileSize` query (don't trust the
        // fileSizes cache) by constructing a new instance over
        // the same backing storage. Then write a tombstone for
        // page 1 directly.
        const reloaded = new DatabaseDurableObjectStorage(storage.sql);
        const sqliteIdRow = storage.sql
            .exec(
                "SELECT sqlite_id FROM database_table_ids WHERE database_table_id = ?",
                databaseMainTableId,
            )
            .next();
        expect(sqliteIdRow.done).toBe(false);
        const sqliteId = sqliteIdRow.value.sqlite_id;
        storage.sql.exec(
            "INSERT INTO pages (sqlite_id, page_index, version, data) VALUES (?, ?, ?, NULL)",
            sqliteId,
            1,
            999_999,
        );

        // Page 2 is still the highest live page — file size
        // should still reflect three pages, not one.
        expect(reloaded.getFileSize(databaseMainTableId)).toBe(3 * sqlitePageSize);
    });

    test("pages from different tables are isolated", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const tableA = generateChronologicalId<DatabaseTableId>();
        const tableB = generateChronologicalId<DatabaseTableId>();

        const pageA = new Uint8Array(sqlitePageSize);
        pageA[0] = 0xa1;
        const pageB = new Uint8Array(sqlitePageSize);
        pageB[0] = 0xb2;

        doStorage.writePages(tableA, new Map([[0, pageA]]));
        doStorage.writePages(tableB, new Map([[0, pageB]]));

        expect(doStorage.readPage(tableA, 0)!.data![0]).toBe(0xa1);
        expect(doStorage.readPage(tableB, 0)!.data![0]).toBe(0xb2);
    });

    test("file size is tracked per table", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const tableA = generateChronologicalId<DatabaseTableId>();
        const tableB = generateChronologicalId<DatabaseTableId>();

        doStorage.writePages(
            tableA,
            new Map([
                [0, new Uint8Array(sqlitePageSize)],
                [1, new Uint8Array(sqlitePageSize)],
            ]),
        );
        doStorage.writePages(tableB, new Map([[0, new Uint8Array(sqlitePageSize)]]));

        expect(doStorage.getFileSize(tableA)).toBe(2 * sqlitePageSize);
        expect(doStorage.getFileSize(tableB)).toBe(1 * sqlitePageSize);
    });

    test("versions are tracked per table", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const tableA = generateChronologicalId<DatabaseTableId>();
        const tableB = generateChronologicalId<DatabaseTableId>();

        const a1 = doStorage.writePages(tableA, new Map([[0, new Uint8Array(sqlitePageSize)]]));
        const a2 = doStorage.writePages(tableA, new Map([[1, new Uint8Array(sqlitePageSize)]]));
        const b1 = doStorage.writePages(tableB, new Map([[0, new Uint8Array(sqlitePageSize)]]));

        expect(a2).toBe(a1 + 1);
        expect(b1).toBe(1);
    });

    test("readPage on unknown table returns null without registering an id", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const unknown = generateChronologicalId<DatabaseTableId>();

        expect(doStorage.readPage(unknown, 0)).toBeNull();

        const cursor = storage.sql.exec(
            "SELECT COUNT(*) AS c FROM database_table_ids WHERE database_table_id = ?",
            unknown,
        );
        expect(cursor.next().value.c).toBe(0);
    });
});
