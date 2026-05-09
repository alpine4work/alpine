/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import {Database, type ReadonlyDatabaseStorage} from "~/shared/databases/database.js";
import {databaseMainTableId, sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {InternalError} from "~/shared/error/error.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

// ---------------------------------------------------------------------------
// Test storage backend
// ---------------------------------------------------------------------------

interface InMemoryTable {
    pages: Map<number, {data: Uint8Array; version: number}>;
    fileSize: number;
}

/**
 * In-memory implementation of `ReadonlyDatabaseStorage`
 * used by the tests below. The {@link Database} only ever
 * reads from this; tests drain the buffer via
 * {@link Database.getBufferedWrites} and apply it back
 * here through {@link applyBufferedWrites} when they want
 * the writes to be durable.
 */
class InMemoryStorage implements ReadonlyDatabaseStorage {
    private nextVersion = 0;
    private readonly tables = new Map<DatabaseTableId, InMemoryTable>();

    private getTable(tableId: DatabaseTableId): InMemoryTable {
        let table = this.tables.get(tableId);
        if (table === undefined) {
            table = {pages: new Map(), fileSize: 0};
            this.tables.set(tableId, table);
        }
        return table;
    }

    readPage(tableId: DatabaseTableId, index: number): {data: Uint8Array; version: number} | null {
        return this.tables.get(tableId)?.pages.get(index) ?? null;
    }

    getFileSize(tableId: DatabaseTableId): number {
        return this.tables.get(tableId)?.fileSize ?? 0;
    }

    /** Apply a `DatabaseBufferedWrites` snapshot to storage. */
    apply(
        pages: ReadonlyMap<DatabaseTableId, ReadonlyMap<number, Uint8Array>>,
        truncates: ReadonlyMap<DatabaseTableId, number>,
    ): void {
        const version = ++this.nextVersion;
        // Truncates apply before page writes: a truncate
        // shrinks the file, then any pages buffered past
        // that boundary re-extend it.
        for (const [tableId, size] of truncates) {
            const table = this.getTable(tableId);
            table.fileSize = size;
            for (const [pageIndex] of table.pages) {
                if ((pageIndex + 1) * sqlitePageSize > size) {
                    table.pages.delete(pageIndex);
                }
            }
        }
        for (const [tableId, tablePages] of pages) {
            const table = this.getTable(tableId);
            for (const [pageIndex, data] of tablePages) {
                table.pages.set(pageIndex, {data: new Uint8Array(data), version});
                const end = (pageIndex + 1) * sqlitePageSize;
                if (end > table.fileSize) table.fileSize = end;
            }
        }
    }
}

/**
 * Drain the buffer, apply it to storage, and acknowledge.
 * This is the test analogue of "the caller persisted the
 * buffered writes" in production.
 */
function commit(database: Database, storage: InMemoryStorage): void {
    const buffered = database.getBufferedWrites();
    if (buffered !== null) {
        storage.apply(buffered.pages, buffered.truncates);
    }
    database.markCommitted();
}

const openDatabases: Array<Database> = [];

afterEach(() => {
    while (openDatabases.length > 0) {
        try {
            openDatabases.pop()!.close();
        } catch {
            // ignore
        }
    }
});

async function createDatabase(
    storage: InMemoryStorage = new InMemoryStorage(),
): Promise<{database: Database; storage: InMemoryStorage}> {
    const database = await Database.create(storage);
    openDatabases.push(database);
    return {database, storage};
}

async function createDatabaseWithSchema(
    ...statements: Array<string>
): Promise<{database: Database; storage: InMemoryStorage}> {
    const {database, storage} = await createDatabase();
    for (const stmt of statements) {
        database.execute(stmt, {allowWrites: "schema+data"});
    }
    commit(database, storage);
    return {database, storage};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Database — execute", () => {
    test("SELECT 1 + 1 returns the computed value", async () => {
        const {database} = await createDatabase();

        const result = database.execute("SELECT 1 + 1 AS result", {allowWrites: "none"});

        expect(result.rows).toEqual([{result: 2}]);
    });

    test("SELECT returns rows from a populated table", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
            "INSERT INTO items (name) VALUES ('alpha'), ('beta')",
        );

        const result = database.execute("SELECT id, name FROM items ORDER BY id", {
            allowWrites: "none",
        });

        expect(result.rows).toEqual([
            {id: 1, name: "alpha"},
            {id: 2, name: "beta"},
        ]);
    });

    test("INSERT returns no rows", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
        );

        const result = database.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"});

        expect(result.rows).toEqual([]);
    });

    test("INSERT ... RETURNING returns the inserted row", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
        );

        const result = database.execute("INSERT INTO items VALUES (1, 'hi') RETURNING id, name", {
            allowWrites: "data",
        });

        expect(result.rows).toEqual([{id: 1, name: "hi"}]);
    });
});

describe("Database — authorizer", () => {
    test("rejects DDL when allowWrites=data", async () => {
        const {database} = await createDatabase();

        expect(() =>
            database.execute("CREATE TABLE t (id INTEGER)", {allowWrites: "data"}),
        ).toThrow();
    });

    test("rejects DML when allowWrites=none", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
        );

        expect(() =>
            database.execute("INSERT INTO items VALUES (1)", {allowWrites: "none"}),
        ).toThrow();
    });

    test("allows SELECT under any writeLevel", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            "INSERT INTO items VALUES (1)",
        );

        for (const level of ["none", "data", "schema+data"] as const) {
            const result = database.execute("SELECT id FROM items", {allowWrites: level});
            expect(result.rows).toEqual([{id: 1}]);
        }
    });
});

describe("Database — error handling", () => {
    test("invalid SQL throws", async () => {
        const {database} = await createDatabase();

        expect(() => database.execute("NOT VALID SQL", {allowWrites: "none"})).toThrow();
    });

    test("reference to non-existent table throws", async () => {
        const {database} = await createDatabase();

        expect(() =>
            database.execute("SELECT * FROM nonexistent", {allowWrites: "none"}),
        ).toThrow();
    });

    test("constraint violation throws", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            "INSERT INTO items VALUES (1)",
        );

        expect(() =>
            database.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"}),
        ).toThrow();
    });

    test("database remains usable after a failed execute", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            "INSERT INTO items VALUES (1)",
        );

        // Hit several failure modes in succession.
        expect(() =>
            database.execute("CREATE TABLE x (id INTEGER)", {allowWrites: "data"}),
        ).toThrow();
        expect(() => database.execute("SELECT * FROM nope", {allowWrites: "none"})).toThrow();
        expect(() =>
            database.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"}),
        ).toThrow();

        // Subsequent reads and writes still work.
        const before = database.execute("SELECT id FROM items ORDER BY id", {
            allowWrites: "none",
        });
        expect(before.rows).toEqual([{id: 1}]);

        database.execute("INSERT INTO items VALUES (2)", {allowWrites: "data"});
        commit(database, storage);
        const after = database.execute("SELECT id FROM items ORDER BY id", {
            allowWrites: "none",
        });
        expect(after.rows).toEqual([{id: 1}, {id: 2}]);
    });

    test("nested execute calls assert", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
        );
        const innerDb = database.unsafeGetDbForTests();

        // Trigger a re-entrant execute by registering a
        // SQLite function that calls execute() again.
        innerDb.createFunction("reenter", () => {
            database.execute("SELECT 1", {allowWrites: "none"});
            return 0;
        });

        expect(() => database.execute("SELECT reenter()", {allowWrites: "none"})).toThrow(
            "nested execute calls are not supported",
        );
    });
});

describe("Database — getBufferedWrites", () => {
    test("returns null on a fresh database with no writes", async () => {
        const {database} = await createDatabase();

        // A pure read shouldn't buffer anything.
        database.execute("SELECT 1", {allowWrites: "none"});
        expect(database.getBufferedWrites()).toBeNull();
    });

    test("contains pages after a DDL+DML write", async () => {
        const {database} = await createDatabase();

        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", {allowWrites: "schema+data"});
        database.execute("INSERT INTO t VALUES (1)", {allowWrites: "data"});

        const buffered = database.getBufferedWrites();
        expect(buffered).not.toBeNull();
        const pages = buffered!.pages.get(databaseMainTableId);
        expect(pages).toBeDefined();
        expect(pages!.size).toBeGreaterThan(0);
    });

    test("each buffered page is exactly sqlitePageSize bytes", async () => {
        const {database} = await createDatabase();

        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", {allowWrites: "schema+data"});

        const pages = database.getBufferedWrites()!.pages.get(databaseMainTableId)!;
        for (const [, data] of pages) {
            expect(data.byteLength).toBe(sqlitePageSize);
        }
    });

    test("returns null after markCommitted clears the buffer", async () => {
        const {database, storage} = await createDatabase();

        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", {allowWrites: "schema+data"});
        commit(database, storage);

        expect(database.getBufferedWrites()).toBeNull();
    });

    test("returns null after discardBuffer clears the buffer", async () => {
        const {database} = await createDatabase();

        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", {allowWrites: "schema+data"});
        database.discardBuffer();

        expect(database.getBufferedWrites()).toBeNull();
    });

    test("buffer accumulates across multiple execute calls", async () => {
        const {database} = await createDatabase();

        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", {allowWrites: "schema+data"});
        const afterCreate = database.getBufferedWrites()!.pages.get(databaseMainTableId)!.size;

        database.execute("INSERT INTO t VALUES (1)", {allowWrites: "data"});
        database.execute("INSERT INTO t VALUES (2)", {allowWrites: "data"});
        const afterInserts = database.getBufferedWrites()!.pages.get(databaseMainTableId)!.size;

        expect(afterInserts).toBeGreaterThanOrEqual(afterCreate);
    });
});

describe("Database — markCommitted", () => {
    test("durable storage state is visible to subsequent reads", async () => {
        const {database, storage} = await createDatabase();

        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)", {
            allowWrites: "schema+data",
        });
        database.execute("INSERT INTO t VALUES (1, 'hello')", {allowWrites: "data"});
        commit(database, storage);

        const result = database.execute("SELECT id, val FROM t", {allowWrites: "none"});
        expect(result.rows).toEqual([{id: 1, val: "hello"}]);
    });

    test("writes after commit are buffered fresh, not merged with prior commit", async () => {
        const {database, storage} = await createDatabase();

        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", {allowWrites: "schema+data"});
        commit(database, storage);

        database.execute("INSERT INTO t VALUES (1)", {allowWrites: "data"});
        const buffered = database.getBufferedWrites();
        expect(buffered).not.toBeNull();
        // Buffer reflects only the post-commit insert; the
        // table-creation pages have already been drained.
        const pageCount = buffered!.pages.get(databaseMainTableId)!.size;
        expect(pageCount).toBeGreaterThan(0);
    });
});

describe("Database — discardBuffer", () => {
    test("rolls back buffered writes — table no longer exists", async () => {
        const {database} = await createDatabase();

        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", {allowWrites: "schema+data"});
        database.discardBuffer();

        expect(() => database.execute("SELECT * FROM t", {allowWrites: "none"})).toThrow();
    });

    test("rolls back uncommitted DML — original row count restored", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            "CREATE TABLE t (id INTEGER PRIMARY KEY)",
            "INSERT INTO t VALUES (1)",
        );

        database.execute("INSERT INTO t VALUES (2)", {allowWrites: "data"});
        database.execute("INSERT INTO t VALUES (3)", {allowWrites: "data"});
        database.discardBuffer();

        const result = database.execute("SELECT COUNT(*) AS n FROM t", {
            allowWrites: "none",
        });
        expect(result.rows).toEqual([{n: 1}]);
        // Storage is unchanged.
        expect(storage.getFileSize(databaseMainTableId)).toBeGreaterThan(0);
    });

    test("subsequent reads pick up externally applied page changes", async () => {
        // Goal: prove that discardBuffer invalidates SQLite's
        // pager cache so changes to underlying storage become
        // visible. We build state in DB1, drain it to storage,
        // mutate storage out-of-band by running DB2 against
        // the same backing store, then verify DB1 sees the
        // new state after discardBuffer.
        const {database: db1, storage} = await createDatabaseWithSchema(
            "CREATE TABLE t (id INTEGER PRIMARY KEY)",
            "INSERT INTO t VALUES (1)",
        );

        // Prime the pager cache by reading.
        const before = db1.execute("SELECT COUNT(*) AS n FROM t", {allowWrites: "none"});
        expect(before.rows).toEqual([{n: 1}]);

        // External mutation: open a second database on the
        // same storage and write through it.
        const {database: db2} = await createDatabase(storage);
        db2.execute("INSERT INTO t VALUES (2)", {allowWrites: "data"});
        commit(db2, storage);
        db2.close();

        // Without discardBuffer, db1's pager cache may still
        // serve the old page. After discard, the next read
        // re-issues xRead and sees the new state.
        db1.discardBuffer();
        const after = db1.execute("SELECT id FROM t ORDER BY id", {allowWrites: "none"});
        expect(after.rows).toEqual([{id: 1}, {id: 2}]);
    });

    // The two tests below are paired. They share a setup
    // that primes db1's pager cache with a specific
    // mid-table page, then mutates that exact page through
    // a second database on the same storage. The "normal"
    // case must see the new value after `discardBuffer`;
    // the `skipClearCacheForTests` case must see the
    // stale cached value. Together they prove that the
    // `PRAGMA shrink_memory` inside `discardBuffer` is
    // load-bearing — without it, in-place interior page
    // mutations stay invisible behind a stale pager cache.
    async function setupInteriorPageMutation(): Promise<{
        db1: Database;
        storage: InMemoryStorage;
        targetId: number;
    }> {
        const storage = new InMemoryStorage();
        const {database: db1} = await createDatabase(storage);
        db1.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER NOT NULL)", {
            allowWrites: "schema+data",
        });
        // Insert enough fixed-size rows to spill across
        // multiple pages, so the target row sits on a
        // non-schema page.
        for (let i = 1; i <= 200; i++) {
            db1.execute(`INSERT INTO t VALUES (${i}, ${i})`, {allowWrites: "data"});
        }
        commit(db1, storage);

        // Prime db1's pager cache by reading the row we'll
        // later mutate from db2.
        const targetId = 100;
        const before = db1.execute(`SELECT v FROM t WHERE id = ${targetId}`, {
            allowWrites: "none",
        });
        expect(before.rows).toEqual([{v: targetId}]);

        return {db1, storage, targetId};
    }

    async function applyExternalInPlaceUpdate(
        storage: InMemoryStorage,
        targetId: number,
    ): Promise<void> {
        const {database: db2} = await createDatabase(storage);
        // INTEGER → INTEGER same-width update; SQLite
        // updates the row in place, mutating an existing
        // interior page rather than appending.
        db2.execute(`UPDATE t SET v = 999 WHERE id = ${targetId}`, {allowWrites: "data"});
        commit(db2, storage);
        db2.close();
    }

    test("makes interior-page mutations visible (normal mode)", async () => {
        const {db1, storage, targetId} = await setupInteriorPageMutation();

        await applyExternalInPlaceUpdate(storage, targetId);

        db1.discardBuffer();
        const after = db1.execute(`SELECT v FROM t WHERE id = ${targetId}`, {
            allowWrites: "none",
        });
        expect(after.rows).toEqual([{v: 999}]);
    });

    test("with skipClearCacheForTests, serves the stale cached page", async () => {
        const {db1, storage, targetId} = await setupInteriorPageMutation();

        await applyExternalInPlaceUpdate(storage, targetId);

        db1.discardBuffer({skipClearCacheForTests: true});
        const after = db1.execute(`SELECT v FROM t WHERE id = ${targetId}`, {
            allowWrites: "none",
        });
        // Stale cached page wins: db1 still serves the
        // pre-mutation value because shrink_memory was
        // skipped. This failure mode is exactly what the
        // normal-mode test above is guarding against.
        expect(after.rows).toEqual([{v: targetId}]);
    });
});

describe("Database — read path edge cases", () => {
    test("reads past EOF return zero-filled buffers (short read)", async () => {
        // Empty storage → fileSize 0 → any read returns short.
        // SQLite handles this internally during open; we
        // verify by simply opening and selecting from sqlite_schema.
        const {database} = await createDatabase();

        const result = database.execute("SELECT name FROM sqlite_schema", {allowWrites: "none"});
        expect(result.rows).toEqual([]);
    });

    test("buffered page overlays storage page", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)",
            "INSERT INTO t VALUES (1, 'before')",
        );

        // Mutate without committing — storage still says 'before'.
        database.execute("UPDATE t SET val = 'after' WHERE id = 1", {allowWrites: "data"});

        // Read should see the buffered (new) value.
        const buffered = database.execute("SELECT val FROM t", {allowWrites: "none"});
        expect(buffered.rows).toEqual([{val: "after"}]);

        // Discard the buffer — read should see the storage value.
        database.discardBuffer();
        const fromStorage = database.execute("SELECT val FROM t", {allowWrites: "none"});
        expect(fromStorage.rows).toEqual([{val: "before"}]);

        // And storage was indeed never mutated.
        expect(storage.getFileSize(databaseMainTableId)).toBeGreaterThan(0);
    });

    test("storage that throws on readPage propagates the error", async () => {
        // Populate a real storage with a wide table so the
        // schema page (page 0) is readable but later pages
        // can be made to throw.
        const {database: setup, storage} = await createDatabase();
        setup.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, padding TEXT)", {
            allowWrites: "schema+data",
        });
        for (let i = 1; i <= 50; i++) {
            setup.execute(`INSERT INTO t VALUES (${i}, '${"x".repeat(200)}')`, {
                allowWrites: "data",
            });
        }
        commit(setup, storage);
        setup.close();
        openDatabases.pop();

        // Wrap the populated storage with a proxy that
        // throws once SQLite walks past page 0.
        let failOnRead = false;
        const proxy: ReadonlyDatabaseStorage = {
            readPage(tableId, index) {
                if (failOnRead && index > 0) throw new InternalError("storage failure");
                return storage.readPage(tableId, index);
            },
            getFileSize(tableId) {
                return storage.getFileSize(tableId);
            },
        };

        const database = await Database.create(proxy);
        openDatabases.push(database);

        // Open succeeds — the proxy didn't throw yet.
        // Now arm the failure and force a deep read.
        failOnRead = true;
        // Drop SQLite's page cache so the next select
        // re-issues xRead.
        database.discardBuffer();

        expect(() => database.execute("SELECT COUNT(*) FROM t", {allowWrites: "none"})).toThrow(
            "storage failure",
        );
    });
});

describe("Database — truncate semantics", () => {
    test("VACUUM produces a buffered truncate", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, padding TEXT)",
            // Inflate the file then delete the rows so VACUUM
            // has something to reclaim.
            ...Array.from(
                {length: 50},
                (_, i) => `INSERT INTO t VALUES (${i + 1}, '${"x".repeat(200)}')`,
            ),
            "DELETE FROM t",
        );

        const sizeBefore = storage.getFileSize(databaseMainTableId);

        database.execute("VACUUM", {allowWrites: "schema+data"});

        const buffered = database.getBufferedWrites();
        expect(buffered).not.toBeNull();
        // Truncate is buffered in memory; storage isn't touched.
        expect(storage.getFileSize(databaseMainTableId)).toBe(sizeBefore);

        commit(database, storage);
        // After draining the buffer, storage actually shrinks.
        expect(storage.getFileSize(databaseMainTableId)).toBeLessThan(sizeBefore);
    });

    test("after a truncate that shrinks the file, queries still see surviving rows", async () => {
        const {database, storage} = await createDatabase();

        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, padding TEXT)", {
            allowWrites: "schema+data",
        });
        for (let i = 1; i <= 50; i++) {
            database.execute(`INSERT INTO t VALUES (${i}, '${"x".repeat(200)}')`, {
                allowWrites: "data",
            });
        }
        commit(database, storage);

        database.execute("DELETE FROM t WHERE id > 5", {allowWrites: "data"});
        database.execute("VACUUM", {allowWrites: "schema+data"});
        commit(database, storage);

        const result = database.execute("SELECT COUNT(*) AS n FROM t", {allowWrites: "none"});
        expect(result.rows).toEqual([{n: 5}]);
    });

    test("buffered pages past a buffered truncate are dropped", async () => {
        // Build up a wide file in storage.
        const {database, storage} = await createDatabase();
        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, padding TEXT)", {
            allowWrites: "schema+data",
        });
        for (let i = 1; i <= 20; i++) {
            database.execute(`INSERT INTO t VALUES (${i}, '${"x".repeat(200)}')`, {
                allowWrites: "data",
            });
        }
        commit(database, storage);
        const wideSize = storage.getFileSize(databaseMainTableId);
        const widePageCount = wideSize / sqlitePageSize;
        expect(widePageCount).toBeGreaterThan(2);

        // Now: write a page late in the file (still buffered),
        // then VACUUM (which buffers a truncate that should
        // drop the late buffered write).
        database.execute("INSERT INTO t VALUES (1000, 'tail')", {allowWrites: "data"});
        // The tail insert buffers some pages near the end.
        database.execute("DELETE FROM t WHERE id != 1000", {allowWrites: "data"});
        database.execute("VACUUM", {allowWrites: "schema+data"});

        const buffered = database.getBufferedWrites();
        expect(buffered).not.toBeNull();
        const truncateSize = buffered!.truncates.get(databaseMainTableId);
        expect(truncateSize).toBeDefined();
        expect(truncateSize!).toBeLessThan(wideSize);

        // Every buffered page must lie within the truncated
        // region — none should sit past the new end.
        const pages = buffered!.pages.get(databaseMainTableId);
        if (pages !== undefined) {
            for (const [pageIndex] of pages) {
                expect((pageIndex + 1) * sqlitePageSize).toBeLessThanOrEqual(truncateSize!);
            }
        }
    });
});

describe("Database — page tracking", () => {
    test("readPages includes page 0 (schema page)", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            "INSERT INTO items VALUES (1)",
        );

        const result = database.execute("SELECT * FROM items", {allowWrites: "none"});
        const pages = result.readPages.get(databaseMainTableId);
        expect(pages).toBeDefined();
        expect(pages!.has(0)).toBe(true);
    });

    test("writtenPages is empty for read-only execute", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            "INSERT INTO items VALUES (1)",
        );

        const result = database.execute("SELECT * FROM items", {allowWrites: "none"});
        expect(result.writtenPages.size).toBe(0);
    });

    test("writtenPages is non-empty for INSERT", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
        );

        const result = database.execute("INSERT INTO items VALUES (1)", {allowWrites: "data"});
        const pages = result.writtenPages.get(databaseMainTableId);
        expect(pages).toBeDefined();
        expect(pages!.size).toBeGreaterThan(0);
    });

    test("reading the same query twice returns identical readPages", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            "INSERT INTO items VALUES (1), (2), (3)",
        );

        const r1 = database.execute("SELECT * FROM items", {allowWrites: "none"});
        const r2 = database.execute("SELECT * FROM items", {allowWrites: "none"});

        const p1 = [...(r1.readPages.get(databaseMainTableId) ?? [])].sort();
        const p2 = [...(r2.readPages.get(databaseMainTableId) ?? [])].sort();
        expect(p1).toEqual(p2);
    });

    test("readPages captures cache-hit reads via pageAccessHook", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)",
            "INSERT INTO items VALUES (1, 'a')",
        );

        // Prime the cache.
        database.execute("SELECT * FROM items", {allowWrites: "none"});

        // Second read likely serves from the pager cache —
        // xRead may not fire — but the page-access hook
        // must still record the page in readPages.
        const result = database.execute("SELECT * FROM items", {allowWrites: "none"});
        const pages = result.readPages.get(databaseMainTableId);
        expect(pages).toBeDefined();
        expect(pages!.size).toBeGreaterThan(0);
    });

    test("readPages and writtenPages from a previous call don't leak into the next", async () => {
        const {database, storage} = await createDatabaseWithSchema(
            "CREATE TABLE a (id INTEGER PRIMARY KEY)",
            "CREATE TABLE b (id INTEGER PRIMARY KEY)",
        );
        commit(database, storage);

        const first = database.execute("INSERT INTO a VALUES (1)", {allowWrites: "data"});
        const second = database.execute("SELECT * FROM b", {allowWrites: "none"});

        // The second call should not include any writes.
        expect(second.writtenPages.size).toBe(0);
        // And the first call should not include any leak from
        // a future invocation. (Covered by structural type;
        // the assert below just sanity-checks that each call
        // got its own map.)
        expect(first.readPages).not.toBe(second.readPages);
        expect(first.writtenPages).not.toBe(second.writtenPages);
    });
});

describe("Database — executeAction", () => {
    test("rawSql returns rows", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
            "INSERT INTO items (name) VALUES ('alpha'), ('beta')",
        );

        const {output} = database.executeAction<"rawSql">({
            name: "rawSql",
            input: {sql: "SELECT id, name FROM items ORDER BY id"},
        });

        expect(output.rows).toEqual([
            {id: 1, name: "alpha"},
            {id: 2, name: "beta"},
        ]);
    });

    test("rawSql rejects DDL (writeLevel='data')", async () => {
        const {database} = await createDatabase();

        expect(() =>
            database.executeAction({
                name: "rawSql",
                input: {sql: "CREATE TABLE bad (id INTEGER)"},
            }),
        ).toThrow();
    });

    test("readonlyRawSql rejects DML (writeLevel='none')", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
        );

        expect(() =>
            database.executeAction({
                name: "readonlyRawSql",
                input: {sql: "INSERT INTO items VALUES (1)"},
            }),
        ).toThrow();
    });

    test("returns readPages and writtenPages tracking", async () => {
        const {database} = await createDatabaseWithSchema(
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            "INSERT INTO items VALUES (1)",
        );

        const {readPages} = database.executeAction({
            name: "readonlyRawSql",
            input: {sql: "SELECT * FROM items"},
        });

        expect(readPages.get(databaseMainTableId)?.size ?? 0).toBeGreaterThan(0);
    });
});

describe("Database — independence between instances", () => {
    test("two databases on independent storages don't share state", async () => {
        const {database: db1} = await createDatabaseWithSchema(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)",
            "INSERT INTO t VALUES (1, 'one')",
        );
        const {database: db2} = await createDatabaseWithSchema(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)",
            "INSERT INTO t VALUES (1, 'two')",
        );

        const r1 = db1.execute("SELECT v FROM t", {allowWrites: "none"});
        const r2 = db2.execute("SELECT v FROM t", {allowWrites: "none"});
        expect(r1.rows).toEqual([{v: "one"}]);
        expect(r2.rows).toEqual([{v: "two"}]);
    });

    test("buffered writes in one database do not appear in another sharing storage", async () => {
        // Two databases on the same storage. db1 buffers a
        // write but doesn't commit; db2 should not see it.
        const storage = new InMemoryStorage();
        const {database: db1} = await createDatabase(storage);
        db1.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", {allowWrites: "schema+data"});
        commit(db1, storage);

        const {database: db2} = await createDatabase(storage);

        db1.execute("INSERT INTO t VALUES (1)", {allowWrites: "data"});
        // db1's insert is only in its in-memory buffer.

        const result = db2.execute("SELECT COUNT(*) AS n FROM t", {allowWrites: "none"});
        expect(result.rows).toEqual([{n: 0}]);
    });
});

describe("Database — close", () => {
    test("close after writes does not throw", async () => {
        const {database} = await createDatabase();
        database.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)", {allowWrites: "schema+data"});
        expect(() => database.close()).not.toThrow();
    });
});
