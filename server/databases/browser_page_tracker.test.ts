import {BrowserPageTracker} from "~/server/databases/browser_page_tracker.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import type {
    BrowserId,
    DatabaseTableId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";

function bid(): BrowserId {
    return generateId<BrowserId>();
}

function cid(): WebSocketConnectionId {
    return generateId<WebSocketConnectionId>();
}

function tid(): DatabaseTableId {
    return generateChronologicalId<DatabaseTableId>();
}

function pageData(marker: number): {version: number; data: Uint8Array} {
    return {version: marker, data: new Uint8Array([marker])};
}

function singleTable(
    tableId: DatabaseTableId,
    pages: ReadonlyArray<[number, {version: number; data: Uint8Array}]>,
): Map<DatabaseTableId, Map<number, {version: number; data: Uint8Array}>> {
    return new Map([[tableId, new Map(pages)]]);
}

function singleTableIndexes(
    tableId: DatabaseTableId,
    indexes: Iterable<number>,
): Map<DatabaseTableId, Iterable<number>> {
    return new Map([[tableId, indexes]]);
}

function singleTableArray(
    tableId: DatabaseTableId,
    indexes: ReadonlyArray<number>,
): Map<DatabaseTableId, ReadonlyArray<number>> {
    return new Map([[tableId, indexes]]);
}

describe("BrowserPageTracker", () => {
    // -- registerConnection / unregisterConnection ----------------------------

    test("filterReadPages returns all pages for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        const t = tid();
        const pages = singleTable(t, [
            [0, pageData(1)],
            [1, pageData(2)],
        ]);

        const filtered = tracker.filterReadPages(bid(), pages);

        expect(filtered).toEqual(pages);
    });

    test("registerConnection creates an empty page set", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());

        const pages = singleTable(t, [
            [0, pageData(1)],
            [1, pageData(2)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        expect(filtered).toEqual(pages);
    });

    test("unregisterConnection deletes entry when last connection closes", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        const c = cid();
        tracker.registerConnection(b, c);
        tracker.setPages(b, singleTableIndexes(t, [0, 1, 2]));

        tracker.unregisterConnection(b, c);

        // Entry is gone — filterReadPages returns everything
        const pages = singleTable(t, [[0, pageData(1)]]);
        expect(tracker.filterReadPages(b, pages)).toEqual(pages);
    });

    test("unregisterConnection preserves entry when other connections remain", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        const c1 = cid();
        const c2 = cid();
        tracker.registerConnection(b, c1);
        tracker.registerConnection(b, c2);
        tracker.setPages(b, singleTableIndexes(t, [0, 1]));

        tracker.unregisterConnection(b, c1);

        // Entry still exists — page 0 is still tracked
        const pages = singleTable(t, [[0, pageData(1)]]);
        expect(tracker.filterReadPages(b, pages).size).toBe(0);
    });

    test("unregisterConnection is a no-op for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        // Should not throw
        tracker.unregisterConnection(bid(), cid());
    });

    // -- setPages -------------------------------------------------------------

    test("setPages replaces the page set entirely", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());

        tracker.setPages(b, singleTableIndexes(t, [0, 1, 2]));
        tracker.setPages(b, singleTableIndexes(t, [3, 4]));

        const pages = singleTable(t, [
            [0, pageData(0)],
            [3, pageData(3)],
            [4, pageData(4)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        // Page 0 should now be returned (not in new set), pages 3 and 4 should be filtered
        // out.
        expect(filtered.get(t)?.size).toBe(1);
        expect(filtered.get(t)?.has(0)).toBe(true);
    });

    test("setPages clears pending pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());

        tracker.addPendingPages(b, singleTableIndexes(t, [5, 6]));
        tracker.setPages(b, singleTableIndexes(t, [0]));

        // Page 5 was pending, now gone. Should be included in filtered results (not
        // skipped).
        const pages = singleTable(t, [
            [0, pageData(0)],
            [5, pageData(5)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);
        expect(filtered.get(t)?.size).toBe(1);
        expect(filtered.get(t)?.has(5)).toBe(true);
    });

    test("setPages drops pages from tables not present in the replacement", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t1 = tid();
        const t2 = tid();
        tracker.registerConnection(b, cid());

        tracker.setPages(b, new Map([[t1, [0, 1]] as const, [t2, [0]] as const]));
        // Replacement only mentions t1 — t2 should be cleared
        tracker.setPages(b, singleTableIndexes(t1, [0, 1]));

        const pages = new Map([
            [t1, new Map([[0, pageData(0)]])],
            [t2, new Map([[0, pageData(0)]])],
        ]);
        const filtered = tracker.filterReadPages(b, pages);
        expect(filtered.has(t1)).toBe(false);
        expect(filtered.get(t2)?.has(0)).toBe(true);
    });

    test("setPages is a no-op for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        // Should not throw
        tracker.setPages(bid(), singleTableIndexes(tid(), [0, 1]));
    });

    // -- addPages -------------------------------------------------------------

    test("addPages incrementally adds to the page set", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());

        tracker.setPages(b, singleTableIndexes(t, [0]));
        // The server sends pages 1 and 2 before the client can acknowledge them.
        tracker.addPendingPages(b, singleTableIndexes(t, [1, 2]));
        tracker.addPages(b, singleTableArray(t, [1, 2]));

        const pages = singleTable(t, [
            [0, pageData(0)],
            [1, pageData(1)],
            [2, pageData(2)],
            [3, pageData(3)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        expect(filtered.get(t)?.size).toBe(1);
        expect(filtered.get(t)?.has(3)).toBe(true);
    });

    test("addPages ignores page indexes that were never sent", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());

        // Only page 0 was ever sent (pending). A client that acknowledges an unsent index
        // must not add it — that would let untrusted input grow the page map.
        tracker.addPendingPages(b, singleTableIndexes(t, [0]));
        tracker.addPages(b, singleTableArray(t, [0, 999]));

        expect(tracker.clientMightHavePage(b, t, 999)).toBe(false);
    });

    test("addPages promotes pending pages to confirmed", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());

        tracker.addPendingPages(b, singleTableIndexes(t, [1, 2]));

        // Pending pages are not skipped by filterReadPages
        const pages = singleTable(t, [
            [1, pageData(1)],
            [2, pageData(2)],
        ]);
        expect(tracker.filterReadPages(b, pages).get(t)?.size).toBe(2);

        // Acknowledge them
        tracker.addPages(b, singleTableArray(t, [1, 2]));

        // Now they are confirmed and skipped
        expect(tracker.filterReadPages(b, pages).size).toBe(0);
    });

    test("addPages is a no-op for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        // Should not throw
        tracker.addPages(bid(), singleTableArray(tid(), [0, 1]));
    });

    // -- addPendingPages ------------------------------------------------------

    test("addPendingPages marks pages as pending", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());

        tracker.addPendingPages(b, singleTableIndexes(t, [1, 2]));

        // Pending pages are NOT skipped by filterReadPages
        const pages = singleTable(t, [
            [1, pageData(1)],
            [2, pageData(2)],
        ]);
        expect(tracker.filterReadPages(b, pages).get(t)?.size).toBe(2);
    });

    test("addPendingPages does not downgrade confirmed pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());

        tracker.setPages(b, singleTableIndexes(t, [1])); // confirmed
        tracker.addPendingPages(b, singleTableIndexes(t, [1])); // should NOT downgrade

        // Page 1 should still be skipped (confirmed)
        const pages = singleTable(t, [[1, pageData(1)]]);
        expect(tracker.filterReadPages(b, pages).size).toBe(0);
    });

    test("addPendingPages is a no-op for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        // Should not throw
        tracker.addPendingPages(bid(), singleTableIndexes(tid(), [0, 1]));
    });

    // -- clientMightHavePage ---------------------------------------------------

    test("clientMightHavePage returns true for confirmed pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());
        tracker.setPages(b, singleTableIndexes(t, [0, 1]));

        expect(tracker.clientMightHavePage(b, t, 0)).toBe(true);
        expect(tracker.clientMightHavePage(b, t, 1)).toBe(true);
        expect(tracker.clientMightHavePage(b, t, 2)).toBe(false);
    });

    test("clientMightHavePage returns true for pending pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());
        tracker.addPendingPages(b, singleTableIndexes(t, [3]));

        expect(tracker.clientMightHavePage(b, t, 3)).toBe(true);
        expect(tracker.clientMightHavePage(b, t, 4)).toBe(false);
    });

    test("clientMightHavePage returns false for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        expect(tracker.clientMightHavePage(bid(), tid(), 0)).toBe(false);
    });

    test("clientMightHavePage returns false for unknown table", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t1 = tid();
        const t2 = tid();
        tracker.registerConnection(b, cid());
        tracker.setPages(b, singleTableIndexes(t1, [0]));

        expect(tracker.clientMightHavePage(b, t1, 0)).toBe(true);
        expect(tracker.clientMightHavePage(b, t2, 0)).toBe(false);
    });

    // -- filterReadPages ------------------------------------------------------

    test("filterReadPages excludes only confirmed pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());
        tracker.setPages(b, singleTableIndexes(t, [1, 3]));

        const pages = singleTable(t, [
            [0, pageData(0)],
            [1, pageData(1)],
            [2, pageData(2)],
            [3, pageData(3)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        expect([...(filtered.get(t)?.keys() ?? [])].sort()).toEqual([0, 2]);
    });

    test("filterReadPages includes pending pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());
        tracker.setPages(b, singleTableIndexes(t, [0]));
        tracker.addPendingPages(b, singleTableIndexes(t, [1]));

        const pages = singleTable(t, [
            [0, pageData(0)],
            [1, pageData(1)],
            [2, pageData(2)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        // Page 0 skipped (confirmed), pages 1 and 2 included
        expect([...(filtered.get(t)?.keys() ?? [])].sort()).toEqual([1, 2]);
    });

    test("filterReadPages returns empty map when all pages are confirmed", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        tracker.registerConnection(b, cid());
        tracker.setPages(b, singleTableIndexes(t, [0, 1]));

        const pages = singleTable(t, [
            [0, pageData(0)],
            [1, pageData(1)],
        ]);
        expect(tracker.filterReadPages(b, pages).size).toBe(0);
    });

    test("filterReadPages partitions filtering across tables", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t1 = tid();
        const t2 = tid();
        tracker.registerConnection(b, cid());
        // Confirm page 0 in t1; t2 has nothing confirmed.
        tracker.setPages(b, singleTableIndexes(t1, [0]));

        const pages = new Map([
            [
                t1,
                new Map([
                    [0, pageData(0)],
                    [1, pageData(1)],
                ]),
            ],
            [
                t2,
                new Map([
                    [0, pageData(0)],
                    [1, pageData(1)],
                ]),
            ],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        // t1: page 0 confirmed, page 1 returned
        expect([...(filtered.get(t1)?.keys() ?? [])]).toEqual([1]);
        // t2: nothing confirmed, both returned
        expect([...(filtered.get(t2)?.keys() ?? [])].sort()).toEqual([0, 1]);
    });

    // -- Multi-browser isolation ----------------------------------------------

    test("page sets are isolated between browsers", () => {
        const tracker = new BrowserPageTracker();
        const b1 = bid();
        const b2 = bid();
        const t = tid();
        tracker.registerConnection(b1, cid());
        tracker.registerConnection(b2, cid());

        tracker.setPages(b1, singleTableIndexes(t, [0, 1]));
        tracker.setPages(b2, singleTableIndexes(t, [2, 3]));

        const pages = singleTable(t, [
            [0, pageData(0)],
            [1, pageData(1)],
            [2, pageData(2)],
            [3, pageData(3)],
        ]);

        const filtered1 = tracker.filterReadPages(b1, pages);
        expect([...(filtered1.get(t)?.keys() ?? [])].sort()).toEqual([2, 3]);

        const filtered2 = tracker.filterReadPages(b2, pages);
        expect([...(filtered2.get(t)?.keys() ?? [])].sort()).toEqual([0, 1]);
    });

    // -- Connection refcounting -----------------------------------------------

    test("closing all connections clears page set for reconnection", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const t = tid();
        const c1 = cid();
        const c2 = cid();
        tracker.registerConnection(b, c1);
        tracker.registerConnection(b, c2);
        tracker.setPages(b, singleTableIndexes(t, [0, 1, 2]));

        tracker.unregisterConnection(b, c1);
        tracker.unregisterConnection(b, c2);

        // Re-register — should start with empty page set
        tracker.registerConnection(b, cid());
        const pages = singleTable(t, [[0, pageData(0)]]);
        expect(tracker.filterReadPages(b, pages)).toEqual(pages);
    });
});
