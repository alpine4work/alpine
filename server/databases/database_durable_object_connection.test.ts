import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {BrowserPageTracker} from "~/server/databases/browser_page_tracker.js";
import {DatabaseDurableObjectConnection} from "~/server/databases/database_durable_object_connection.js";
import {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {truncateFor} from "~/server/databases/test_helpers/truncate_for.js";
import {writePagesFor} from "~/server/databases/test_helpers/write_pages_for.js";
import {
    cacheUpdateStalePageLimit,
    databaseMainTableId,
    sqlitePageSize,
} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import type {
    BrowserId,
    DatabaseMutationId,
    DatabaseTableId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";

let storage: any;

beforeEach(() => {
    storage = new DurableObjectStorage(new MemoryStorage());
});

function createConnection(doStorage: DatabaseDurableObjectStorage) {
    return new DatabaseDurableObjectConnection({
        server: null as any,
        storage: null as any,
        durableObjectStorage: doStorage,
        processContext: null as any,
        sendEventToAll: () => {},
        browserId: generateId<BrowserId>(),
        connectionId: generateId<WebSocketConnectionId>(),
        browserPageTracker: new BrowserPageTracker(),
    });
}

async function ensureCacheIsUpToDate(
    conn: DatabaseDurableObjectConnection,
    pageVersionsByIndex: ReadonlyMap<number, number>,
) {
    const result = await conn.procedures.ensureCacheIsUpToDate(
        null as any,
        {pageVersionsByIndex: new Map([[databaseMainTableId, pageVersionsByIndex]])},
        null as any,
    );
    return (
        result.tables.get(databaseMainTableId) ?? {
            updatedPages: new Map<number, {version: number; data: Uint8Array}>(),
            stalePageIndexes: [] as ReadonlyArray<number>,
            fileSizeInPages: 0,
        }
    );
}

async function acknowledgePages(
    conn: DatabaseDurableObjectConnection,
    pageIndexes: ReadonlyArray<number>,
) {
    return conn.procedures.acknowledgePages(
        null as any,
        {pageIndexes: new Map([[databaseMainTableId, pageIndexes]])},
        null as any,
    );
}

function makePage(marker: number): Uint8Array {
    const data = new Uint8Array(sqlitePageSize);
    data[0] = marker;
    return data;
}

describe("ensureCacheIsUpToDate", () => {
    test("returns empty when all pages are up to date", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        writePagesFor(doStorage, databaseMainTableId, new Map([[0, makePage(0xaa)]]));
        const ts = doStorage.readPage(databaseMainTableId, 0)!.version;
        const conn = createConnection(doStorage);

        const result = await ensureCacheIsUpToDate(conn, new Map([[0, ts]]));

        expect(result.updatedPages.size).toBe(0);
        expect(result.stalePageIndexes).toEqual([]);
    });

    test("returns updated pages when few are stale", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        writePagesFor(
            doStorage,
            databaseMainTableId,
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
            ]),
        );
        const version0 = doStorage.readPage(databaseMainTableId, 0)!.version;
        const conn = createConnection(doStorage);

        // Page 0 matches, page 1 has stale client version
        const result = await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, version0],
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
        writePagesFor(doStorage, databaseMainTableId, new Map([[0, makePage(0xaa)]]));
        const version0 = doStorage.readPage(databaseMainTableId, 0)!.version;
        const conn = createConnection(doStorage);

        // Page 5 doesn't exist on the server
        const result = await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, version0],
                [5, 123],
            ]),
        );

        expect(result.updatedPages.size).toBe(0);
        expect(result.stalePageIndexes).toEqual([5]);
    });

    test("mixes updated pages and stale indexes", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        writePagesFor(doStorage, databaseMainTableId, new Map([[0, makePage(0xaa)]]));
        const conn = createConnection(doStorage);

        // Page 0 is stale (mismatched ts), page 5 is missing on the server entirely.
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
        writePagesFor(doStorage, databaseMainTableId, pages);
        const conn = createConnection(doStorage);

        // All pages are stale (client has ts=0 for each)
        const clientVersions = new Map<number, number>();
        for (let i = 0; i < cacheUpdateStalePageLimit; i++) {
            clientVersions.set(i, 0);
        }

        const result = await ensureCacheIsUpToDate(conn, clientVersions);

        // Exactly at the limit — should dump all into stalePageIndexes. Page 0 is always
        // included in updatedPages so the client has the schema.
        expect(result.updatedPages.size).toBe(1);
        expect(result.updatedPages.has(0)).toBe(true);
        expect(result.stalePageIndexes.length).toBe(cacheUpdateStalePageLimit);
    });

    test("under limit returns all as updated pages", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);

        const count = cacheUpdateStalePageLimit - 1;
        const pages = new Map<number, Uint8Array>();
        for (let i = 0; i < count; i++) {
            pages.set(i, makePage(i & 0xff));
        }
        writePagesFor(doStorage, databaseMainTableId, pages);
        const conn = createConnection(doStorage);

        // All pages stale
        const clientVersions = new Map<number, number>();
        for (let i = 0; i < count; i++) {
            clientVersions.set(i, 0);
        }

        const result = await ensureCacheIsUpToDate(conn, clientVersions);

        expect(result.updatedPages.size).toBe(count);
        expect(result.stalePageIndexes).toEqual([]);
    });

    test("returns stale indexes for tombstoned pages", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        writePagesFor(
            doStorage,
            databaseMainTableId,
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
            ]),
        );
        const version0 = doStorage.readPage(databaseMainTableId, 0)!.version;
        const version1 = doStorage.readPage(databaseMainTableId, 1)!.version;

        // Truncate page 1 away.
        truncateFor(doStorage, databaseMainTableId, 1 * sqlitePageSize);

        const conn = createConnection(doStorage);
        const result = await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, version0],
                [1, version1],
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
        writePagesFor(doStorage, databaseMainTableId, pages);
        const conn = createConnection(doStorage);

        const clientVersions = new Map<number, number>();
        for (let i = 0; i < count; i++) {
            clientVersions.set(i, 0);
        }

        const result = await ensureCacheIsUpToDate(conn, clientVersions);

        // All pages should be in stalePageIndexes. Page 0 is always included in
        // updatedPages so the client has the schema.
        expect(result.updatedPages.size).toBe(1);
        expect(result.updatedPages.has(0)).toBe(true);
        expect(result.stalePageIndexes.length).toBe(count);
    });
});

// ---------------------------------------------------------------------------
// Per-browser page tracking integration tests
// ---
//
// ---

function createTrackedConnection(
    doStorage: DatabaseDurableObjectStorage,
    tracker: BrowserPageTracker,
    browserId: BrowserId,
) {
    const connectionId = generateId<WebSocketConnectionId>();
    return new DatabaseDurableObjectConnection({
        server: null as any,
        storage: null as any,
        durableObjectStorage: doStorage,
        processContext: null as any,
        sendEventToAll: () => {},
        browserId,
        connectionId,
        browserPageTracker: tracker,
    });
}

describe("per-browser page tracking", () => {
    test("acknowledgePages ignores pages for tables the server never sent", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        // A client fabricates a tableId it was never sent and acknowledges pages for it.
        // The server must not create tracker state for an unknown table — otherwise an
        // untrusted client can grow the per-browser page map without bound.
        const bogusTableId = generateChronologicalId<DatabaseTableId>();
        await conn.procedures.acknowledgePages(
            null as any,
            {pageIndexes: new Map([[bogusTableId, [0, 1, 2]]])},
            null as any,
        );

        expect(tracker.clientMightHavePage(browserId, bogusTableId, 0)).toBe(false);
    });

    test("acknowledgePages ignores page indexes the server never sent", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        // The server sent only page 0. A client acks page 0 plus a never-sent index; the
        // unsent page must not be tracked — otherwise an untrusted client can grow the
        // per-browser page map with out-of-range indexes.
        tracker.addPendingPages(browserId, new Map([[databaseMainTableId, [0]]]));
        await acknowledgePages(conn, [0, 999]);

        expect(tracker.clientMightHavePage(browserId, databaseMainTableId, 999)).toBe(false);
    });

    test("ensureCacheIsUpToDate sets matching pages as confirmed in tracker", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        writePagesFor(
            doStorage,
            databaseMainTableId,
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
                [2, makePage(0xcc)],
            ]),
        );
        const version0 = doStorage.readPage(databaseMainTableId, 0)!.version;
        const version1 = doStorage.readPage(databaseMainTableId, 1)!.version;

        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        // Page 0 and 1 match, page 2 is stale (wrong ts)
        await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, version0],
                [1, version1],
                [2, 999],
            ]),
        );

        // Pages 0 and 1 are confirmed (skipped by filterReadPages). Page 2 was returned as
        // updatedPages → pending (not skipped by filterReadPages).
        const allPages = new Map([
            [
                databaseMainTableId,
                new Map([
                    [0, {version: 1, data: new Uint8Array(1)}],
                    [1, {version: 1, data: new Uint8Array(1)}],
                    [2, {version: 1, data: new Uint8Array(1)}],
                ]),
            ],
        ]);
        const filtered = tracker.filterReadPages(browserId, allPages);
        expect(filtered.get(databaseMainTableId)?.size).toBe(1);
        expect(filtered.get(databaseMainTableId)?.has(2)).toBe(true);
    });

    test("ensureCacheIsUpToDate marks updatedPages as pending in tracker", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        writePagesFor(
            doStorage,
            databaseMainTableId,
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
            ]),
        );
        const version0 = doStorage.readPage(databaseMainTableId, 0)!.version;

        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        // Page 0 matches, page 1 is stale
        await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, version0],
                [1, 999],
            ]),
        );

        // Page 1 is pending (sent as updatedPages). Acknowledge it — should promote to
        // confirmed.
        await acknowledgePages(conn, [1]);

        // Now page 1 is confirmed (skipped)
        const allPages = new Map([
            [
                databaseMainTableId,
                new Map([
                    [0, {version: 1, data: new Uint8Array(1)}],
                    [1, {version: 1, data: new Uint8Array(1)}],
                ]),
            ],
        ]);
        expect(tracker.filterReadPages(browserId, allPages).size).toBe(0);
    });

    test("acknowledgePages confirms pages in tracker", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        // The server sends these pages first (marking them pending) before the client can
        // acknowledge them — acks for never-sent pages are ignored.
        tracker.addPendingPages(browserId, new Map([[databaseMainTableId, [5, 6, 7]]]));
        await acknowledgePages(conn, [5, 6, 7]);

        // Acknowledged pages are confirmed — skipped by filterReadPages
        const pages = new Map([
            [
                databaseMainTableId,
                new Map([
                    [5, {version: 1, data: new Uint8Array(1)}],
                    [6, {version: 1, data: new Uint8Array(1)}],
                    [8, {version: 1, data: new Uint8Array(1)}],
                ]),
            ],
        ]);
        const filtered = tracker.filterReadPages(browserId, pages);
        expect(filtered.get(databaseMainTableId)?.size).toBe(1);
        expect(filtered.get(databaseMainTableId)?.has(8)).toBe(true);
    });

    test("ensureCacheIsUpToDate confirms pages for every client table, not just the main table", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const attachedTableId = generateChronologicalId<DatabaseTableId>();
        writePagesFor(doStorage, databaseMainTableId, new Map([[0, makePage(0xaa)]]));
        writePagesFor(doStorage, attachedTableId, new Map([[0, makePage(0xbb)]]));
        const mainVersion0 = doStorage.readPage(databaseMainTableId, 0)!.version;
        const attachedVersion0 = doStorage.readPage(attachedTableId, 0)!.version;

        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        // The client validates pages for both its main table and an attached table in a
        // single call. Both tables' matching pages must be confirmed in the tracker —
        // validating the main table must not wipe the attached table's state.
        await conn.procedures.ensureCacheIsUpToDate(
            null as any,
            {
                pageVersionsByIndex: new Map([
                    [databaseMainTableId, new Map([[0, mainVersion0]])],
                    [attachedTableId, new Map([[0, attachedVersion0]])],
                ]),
            },
            null as any,
        );

        // The attached table's matching page is confirmed, so filterReadPages skips it
        // (returns nothing for that table).
        const allPages = new Map([
            [attachedTableId, new Map([[0, {version: 1, data: new Uint8Array(1)}]])],
        ]);
        expect(tracker.filterReadPages(browserId, allPages).size).toBe(0);
    });

    test("handleClose unregisters connection from tracker", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        tracker.setPages(browserId, new Map([[databaseMainTableId, [0, 1]]]));
        conn.handleClose();

        // After close, entry should be deleted (last connection). filterReadPages returns
        // everything for an unknown browser.
        const pages = new Map([
            [databaseMainTableId, new Map([[0, {version: 1, data: new Uint8Array(1)}]])],
        ]);
        expect(tracker.filterReadPages(browserId, pages)).toEqual(pages);
    });

    test("two connections from same browser share page set", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn1 = createTrackedConnection(doStorage, tracker, browserId);
        const conn2 = createTrackedConnection(doStorage, tracker, browserId);

        // The server sends these pages first (marking them pending) before either
        // connection acknowledges them.
        tracker.addPendingPages(browserId, new Map([[databaseMainTableId, [0, 1, 2, 3]]]));
        await acknowledgePages(conn1, [0, 1]);
        await acknowledgePages(conn2, [2, 3]);

        const pages = new Map([
            [
                databaseMainTableId,
                new Map([
                    [0, {version: 1, data: new Uint8Array(1)}],
                    [1, {version: 1, data: new Uint8Array(1)}],
                    [2, {version: 1, data: new Uint8Array(1)}],
                    [3, {version: 1, data: new Uint8Array(1)}],
                    [4, {version: 1, data: new Uint8Array(1)}],
                ]),
            ],
        ]);
        const filtered = tracker.filterReadPages(browserId, pages);
        expect(filtered.get(databaseMainTableId)?.size).toBe(1);
        expect(filtered.get(databaseMainTableId)?.has(4)).toBe(true);
    });

    test("closing one of two connections preserves page set", () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn1 = createTrackedConnection(doStorage, tracker, browserId);
        createTrackedConnection(doStorage, tracker, browserId);

        tracker.setPages(browserId, new Map([[databaseMainTableId, [0, 1]]]));
        conn1.handleClose();

        // Entry should still exist — conn2 is still open
        const pages = new Map([
            [
                databaseMainTableId,
                new Map([
                    [0, {version: 1, data: new Uint8Array(1)}],
                    [1, {version: 1, data: new Uint8Array(1)}],
                ]),
            ],
        ]);
        expect(tracker.filterReadPages(browserId, pages).size).toBe(0);
    });

    test("transformEvent filters pages to only those the client might have", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        writePagesFor(
            doStorage,
            databaseMainTableId,
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
                [2, makePage(0xcc)],
            ]),
        );
        const version0 = doStorage.readPage(databaseMainTableId, 0)!.version;
        const version1 = doStorage.readPage(databaseMainTableId, 1)!.version;

        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        // Client has pages 0 and 1 confirmed
        await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, version0],
                [1, version1],
                [2, 999],
            ]),
        );

        // Simulate a realtime event touching pages 0, 1, 3
        const eventStub = {
            type: "PagesChanged" as const,
            pageDiffs: new Map([
                [
                    databaseMainTableId,
                    {
                        diffs: new Map([
                            [0, {version: 1, diff: []}],
                            [1, {version: 1, diff: []}],
                            [3, {version: 1, diff: []}],
                        ]),
                        fileSizeInPages: 4,
                    },
                ],
            ]),
            mutationId: generateId<DatabaseMutationId>(),
        };
        const event = await conn.transformEvent(null as any, eventStub);
        assert(event.type === "PagesChanged", "expected PagesChanged event");

        // Page 0: confirmed → included Page 1: confirmed → included Page 2: pending (sent
        // as updatedPages) but not in event → N/A Page 3: not tracked → excluded
        const main = event.pageDiffs.get(databaseMainTableId);
        expect([...(main?.diffs.keys() ?? [])]).toEqual([0, 1]);
    });

    test("transformEvent includes pending pages", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        writePagesFor(
            doStorage,
            databaseMainTableId,
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
            ]),
        );
        const version0 = doStorage.readPage(databaseMainTableId, 0)!.version;

        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        // Page 0 matches (confirmed), page 1 stale (pending)
        await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, version0],
                [1, 999],
            ]),
        );

        const eventStub = {
            type: "PagesChanged" as const,
            pageDiffs: new Map([
                [
                    databaseMainTableId,
                    {
                        diffs: new Map([
                            [0, {version: 1, diff: []}],
                            [1, {version: 1, diff: []}],
                        ]),
                        fileSizeInPages: 2,
                    },
                ],
            ]),
            mutationId: generateId<DatabaseMutationId>(),
        };
        const event = await conn.transformEvent(null as any, eventStub);
        assert(event.type === "PagesChanged", "expected PagesChanged event");

        // Both included: page 0 confirmed, page 1 pending
        const main = event.pageDiffs.get(databaseMainTableId);
        expect([...(main?.diffs.keys() ?? [])]).toEqual([0, 1]);
    });

    test("transformEvent omits tables with no forwardable pages", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        // No ensureCacheIsUpToDate — tracker has no pages
        const eventStub = {
            type: "PagesChanged" as const,
            pageDiffs: new Map([
                [
                    databaseMainTableId,
                    {
                        diffs: new Map([
                            [0, {version: 1, diff: []}],
                            [1, {version: 1, diff: []}],
                        ]),
                        fileSizeInPages: 2,
                    },
                ],
            ]),
            mutationId: generateId<DatabaseMutationId>(),
        };
        const event = await conn.transformEvent(null as any, eventStub);
        assert(event.type === "PagesChanged", "expected PagesChanged event");

        // Every diff was filtered out, so the table entry is dropped entirely rather than
        // forwarded as an empty entry that would trigger a wasted client sync().
        expect(event.pageDiffs.has(databaseMainTableId)).toBe(false);
    });

    test("ensureCacheIsUpToDate replaces page set on each call", async () => {
        const doStorage = new DatabaseDurableObjectStorage(storage.sql);
        writePagesFor(
            doStorage,
            databaseMainTableId,
            new Map([
                [0, makePage(0xaa)],
                [1, makePage(0xbb)],
            ]),
        );
        const version0 = doStorage.readPage(databaseMainTableId, 0)!.version;
        const version1 = doStorage.readPage(databaseMainTableId, 1)!.version;

        const tracker = new BrowserPageTracker();
        const browserId = generateId<BrowserId>();
        const conn = createTrackedConnection(doStorage, tracker, browserId);

        // First sync: both pages match
        await ensureCacheIsUpToDate(
            conn,
            new Map([
                [0, version0],
                [1, version1],
            ]),
        );

        // Second sync: only page 0 sent (page 1 not in client cache)
        await ensureCacheIsUpToDate(conn, new Map([[0, version0]]));

        // Tracker should only know about page 0 now
        const pages = new Map([
            [
                databaseMainTableId,
                new Map([
                    [0, {version: 1, data: new Uint8Array(1)}],
                    [1, {version: 1, data: new Uint8Array(1)}],
                ]),
            ],
        ]);
        const filtered = tracker.filterReadPages(browserId, pages);
        expect(filtered.get(databaseMainTableId)?.size).toBe(1);
        expect(filtered.get(databaseMainTableId)?.has(1)).toBe(true);
    });
});
