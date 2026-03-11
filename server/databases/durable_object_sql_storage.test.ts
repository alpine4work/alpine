/**
 * Tests for the SqlStorage and transactionSync polyfill patched
 * into `@miniflare/durable-objects`. Verifies that our better-sqlite3
 * backed implementation matches the Cloudflare SqlStorage API surface
 * used by {@link DatabaseDurableObjectStorage}.
 */

import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {DatabaseDurableObjectConnection} from "~/server/databases/database_durable_object_connection.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {cacheUpdateStalePageLimit, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";

// Cast to `any` because Miniflare's DurableObjectStorage type doesn't
// include our patched `sql` / `transactionSync` in the upstream .d.ts
// that TypeScript resolves for the global type.
let storage: any;

beforeEach(() => {
    storage = new DurableObjectStorage(new MemoryStorage());
});

describe("SqlStorage cursor API", () => {
    test("exec returns cursor with correct columnNames", () => {
        storage.sql.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
        // eslint-disable-next-line cyberworlds/string-quotes
        storage.sql.exec("INSERT INTO t VALUES (1, 'a')");

        const cursor = storage.sql.exec("SELECT id, name FROM t");

        expect(cursor.columnNames).toEqual(["id", "name"]);
    });

    test("next iterates rows and signals done", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");
        storage.sql.exec("INSERT INTO t VALUES (10)");
        storage.sql.exec("INSERT INTO t VALUES (20)");

        const cursor = storage.sql.exec("SELECT v FROM t ORDER BY v");

        expect(cursor.next()).toMatchObject({done: false, value: {v: 10}});
        expect(cursor.next()).toMatchObject({done: false, value: {v: 20}});
        expect(cursor.next()).toMatchObject({done: true});
    });

    test("toArray drains remaining rows", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");
        storage.sql.exec("INSERT INTO t VALUES (1)");
        storage.sql.exec("INSERT INTO t VALUES (2)");
        storage.sql.exec("INSERT INTO t VALUES (3)");

        const cursor = storage.sql.exec("SELECT v FROM t ORDER BY v");
        // Consume the first row via next(), then drain the rest.
        cursor.next();

        expect(cursor.toArray()).toEqual([{v: 2}, {v: 3}]);
    });

    test("one returns the single row", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");
        storage.sql.exec("INSERT INTO t VALUES (42)");

        expect(storage.sql.exec("SELECT v FROM t").one()).toEqual({v: 42});
    });

    test("one throws when zero rows", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");

        expect(() => storage.sql.exec("SELECT v FROM t").one()).toThrow("0");
    });

    test("one throws when more than one row", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");
        storage.sql.exec("INSERT INTO t VALUES (1)");
        storage.sql.exec("INSERT INTO t VALUES (2)");

        expect(() => storage.sql.exec("SELECT v FROM t").one()).toThrow("2");
    });

    test("Symbol.iterator works in for-of", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");
        storage.sql.exec("INSERT INTO t VALUES (1)");
        storage.sql.exec("INSERT INTO t VALUES (2)");

        const values: Array<number> = [];
        for (const row of storage.sql.exec("SELECT v FROM t ORDER BY v")) {
            values.push(row.v);
        }

        expect(values).toEqual([1, 2]);
    });

    test("rowsRead reflects number of rows returned by SELECT", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");
        storage.sql.exec("INSERT INTO t VALUES (1)");
        storage.sql.exec("INSERT INTO t VALUES (2)");

        const cursor = storage.sql.exec("SELECT v FROM t");

        expect(cursor.rowsRead).toBe(2);
    });

    test("rowsWritten reflects rows changed by INSERT", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");

        const cursor = storage.sql.exec("INSERT INTO t VALUES (1), (2), (3)");

        expect(cursor.rowsWritten).toBe(3);
    });
});

describe("data types and binding conversion", () => {
    test("string, number, and null round-trip", () => {
        storage.sql.exec("CREATE TABLE t (s TEXT, n REAL, nu TEXT)");
        storage.sql.exec("INSERT INTO t VALUES (?, ?, ?)", "hello", 3.14, null);

        expect(storage.sql.exec("SELECT * FROM t").one()).toEqual({
            s: "hello",
            n: 3.14,
            nu: null,
        });
    });

    test("ArrayBuffer blob round-trips as ArrayBuffer", () => {
        storage.sql.exec("CREATE TABLE t (data BLOB)");

        const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        storage.sql.exec("INSERT INTO t VALUES (?)", input.buffer);

        const row = storage.sql.exec("SELECT data FROM t").one();

        expect(row.data).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(row.data)).toEqual(input);
    });

    test("page-sized blob round-trips correctly", () => {
        storage.sql.exec("CREATE TABLE t (data BLOB)");

        const page = new Uint8Array(sqlitePageSize);
        page[0] = 0x53;
        page[1] = 0x51;
        page[sqlitePageSize - 1] = 0xff;
        storage.sql.exec("INSERT INTO t VALUES (?)", page.buffer);

        const row = storage.sql.exec("SELECT data FROM t").one();
        const result = new Uint8Array(row.data);

        expect(result.byteLength).toBe(sqlitePageSize);
        expect(result[0]).toBe(0x53);
        expect(result[1]).toBe(0x51);
        expect(result[sqlitePageSize - 1]).toBe(0xff);
    });
});

describe("transactionSync", () => {
    test("commits on success", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");

        storage.transactionSync(() => {
            storage.sql.exec("INSERT INTO t VALUES (1)");
            storage.sql.exec("INSERT INTO t VALUES (2)");
        });

        expect(storage.sql.exec("SELECT count(*) as c FROM t").one()).toEqual({
            c: 2,
        });
    });

    test("rolls back on thrown error", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");
        storage.sql.exec("INSERT INTO t VALUES (0)");

        expect(() =>
            storage.transactionSync(() => {
                storage.sql.exec("INSERT INTO t VALUES (1)");
                throw new Error("abort"); // eslint-disable-line cyberworlds/no-global-error
            }),
        ).toThrow("abort");

        expect(storage.sql.exec("SELECT count(*) as c FROM t").one()).toEqual({
            c: 1,
        });
    });

    test("returns the closure return value", () => {
        storage.sql.exec("CREATE TABLE t (v INTEGER)");
        storage.sql.exec("INSERT INTO t VALUES (42)");

        const result = storage.transactionSync(() => {
            return storage.sql.exec("SELECT v FROM t").one().v;
        });

        expect(result).toBe(42);
    });
});

describe("DatabaseDurableObjectStorage integration", () => {
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
});

// ---------------------------------------------------------------------------
// ensureCacheIsUpToDate handler tests
// ---------------------------------------------------------------------------

function createConnection(doStorage: DatabaseDurableObjectStorage) {
    return new DatabaseDurableObjectConnection({
        server: null as any,
        storage: null as any,
        durableObjectStorage: doStorage,
        processContext: null as any,
        sendEventToAll: () => {},
    });
}

async function ensureCacheIsUpToDate(
    conn: DatabaseDurableObjectConnection,
    pageTimestampsByIndex: ReadonlyMap<number, number>,
) {
    return conn.procedures.ensureCacheIsUpToDate(null as any, {pageTimestampsByIndex}, null as any);
}

function makePage(marker: number): Uint8Array {
    const data = new Uint8Array(sqlitePageSize);
    data[0] = marker;
    return data;
}

describe("ensureCacheIsUpToDate", () => {
    test("returns empty when all pages are up to date", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        doStorage.writePages(new Map([[0, makePage(0xaa)]]));
        const ts = doStorage.readPage(0)!.timestamp;
        const conn = createConnection(doStorage);

        const result = await ensureCacheIsUpToDate(conn, new Map([[0, ts]]));

        expect(result.updatedPages.size).toBe(0);
        expect(result.stalePageIndexes).toEqual([]);
    });

    test("returns updated pages when few are stale", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        doStorage.writePages(
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
            ]),
        );
        const ts0 = doStorage.readPage(0)!.timestamp;
        const conn = createConnection(doStorage);

        // Page 0 matches, page 1 has stale client timestamp
        const result = await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, ts0],
                [1, 999],
            ]),
        );

        expect(result.updatedPages.size).toBe(1);
        expect(result.updatedPages.has(1)).toBe(true);
        expect(result.updatedPages.get(1)!.data[0]).toBe(0xbb);
        expect(result.stalePageIndexes).toEqual([]);
    });

    test("returns stale indexes for pages not on server", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        doStorage.writePages(new Map([[0, makePage(0xaa)]]));
        const ts0 = doStorage.readPage(0)!.timestamp;
        const conn = createConnection(doStorage);

        // Page 5 doesn't exist on the server
        const result = await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, ts0],
                [5, 123],
            ]),
        );

        expect(result.updatedPages.size).toBe(0);
        expect(result.stalePageIndexes).toEqual([5]);
    });

    test("mixes updated pages and stale indexes", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        doStorage.writePages(new Map([[0, makePage(0xaa)]]));
        const conn = createConnection(doStorage);

        // Page 0 is stale (mismatched ts), page 5 is
        // missing on the server entirely.
        const result = await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, 999],
                [5, 123],
            ]),
        );

        expect(result.updatedPages.size).toBe(1);
        expect(result.updatedPages.has(0)).toBe(true);
        expect(result.stalePageIndexes).toEqual([5]);
    });

    test("falls back to all stale indexes when over limit", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        // Write exactly cacheUpdateStalePageLimit pages
        const pages = new Map<number, Uint8Array>();
        for (let i = 0; i < cacheUpdateStalePageLimit; i++) {
            pages.set(i, makePage(i & 0xff));
        }
        doStorage.writePages(pages);
        const conn = createConnection(doStorage);

        // All pages are stale (client has ts=0 for each)
        const clientTimestamps = new Map<number, number>();
        for (let i = 0; i < cacheUpdateStalePageLimit; i++) {
            clientTimestamps.set(i, 0);
        }

        const result = await ensureCacheIsUpToDate(conn, clientTimestamps);

        // Exactly at the limit — should dump all into
        // stalePageIndexes, updatedPages empty.
        expect(result.updatedPages.size).toBe(0);
        expect(result.stalePageIndexes.length).toBe(cacheUpdateStalePageLimit);
    });

    test("under limit returns all as updated pages", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        const count = cacheUpdateStalePageLimit - 1;
        const pages = new Map<number, Uint8Array>();
        for (let i = 0; i < count; i++) {
            pages.set(i, makePage(i & 0xff));
        }
        doStorage.writePages(pages);
        const conn = createConnection(doStorage);

        // All pages stale
        const clientTimestamps = new Map<number, number>();
        for (let i = 0; i < count; i++) {
            clientTimestamps.set(i, 0);
        }

        const result = await ensureCacheIsUpToDate(conn, clientTimestamps);

        expect(result.updatedPages.size).toBe(count);
        expect(result.stalePageIndexes).toEqual([]);
    });

    test("returns stale indexes for tombstoned pages", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        doStorage.writePages(
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
            ]),
        );
        const ts0 = doStorage.readPage(0)!.timestamp;
        const ts1 = doStorage.readPage(1)!.timestamp;

        // Truncate page 1 away.
        doStorage.truncate(1 * sqlitePageSize);

        const conn = createConnection(doStorage);
        const result = await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, ts0],
                [1, ts1],
            ]),
        );

        // Page 0 matches, page 1 is a tombstone — should be stale.
        expect(result.updatedPages.size).toBe(0);
        expect(result.stalePageIndexes).toEqual([1]);
    });

    test("over limit with trailing pages puts everything in stale indexes", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        // Write one more than the limit
        const count = cacheUpdateStalePageLimit + 1;
        const pages = new Map<number, Uint8Array>();
        for (let i = 0; i < count; i++) {
            pages.set(i, makePage(i & 0xff));
        }
        doStorage.writePages(pages);
        const conn = createConnection(doStorage);

        const clientTimestamps = new Map<number, number>();
        for (let i = 0; i < count; i++) {
            clientTimestamps.set(i, 0);
        }

        const result = await ensureCacheIsUpToDate(conn, clientTimestamps);

        // All pages should be in stalePageIndexes, none
        // in updatedPages — it's all-or-nothing.
        expect(result.updatedPages.size).toBe(0);
        expect(result.stalePageIndexes.length).toBe(count);
    });
});
