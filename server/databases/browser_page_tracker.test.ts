import {BrowserPageTracker} from "~/server/databases/browser_page_tracker.js";
import {generateId} from "~/shared/id/id.js";
import type {BrowserId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";

function bid(): BrowserId {
    return generateId<BrowserId>();
}

function cid(): WebSocketConnectionId {
    return generateId<WebSocketConnectionId>();
}

function pageData(marker: number): {timestamp: number; data: Uint8Array} {
    return {timestamp: marker, data: new Uint8Array([marker])};
}

describe("BrowserPageTracker", () => {
    // -- registerConnection / unregisterConnection ----------------------------

    test("filterReadPages returns all pages for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        const pages = new Map([
            [0, pageData(1)],
            [1, pageData(2)],
        ]);

        const filtered = tracker.filterReadPages(bid(), pages);

        expect(filtered).toEqual(pages);
    });

    test("registerConnection creates an empty page set", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());

        const pages = new Map([
            [0, pageData(1)],
            [1, pageData(2)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        expect(filtered).toEqual(pages);
    });

    test("unregisterConnection deletes entry when last connection closes", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const c = cid();
        tracker.registerConnection(b, c);
        tracker.setPages(b, [0, 1, 2]);

        tracker.unregisterConnection(b, c);

        // Entry is gone — filterReadPages returns everything
        const pages = new Map([[0, pageData(1)]]);
        expect(tracker.filterReadPages(b, pages)).toEqual(pages);
    });

    test("unregisterConnection preserves entry when other connections remain", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const c1 = cid();
        const c2 = cid();
        tracker.registerConnection(b, c1);
        tracker.registerConnection(b, c2);
        tracker.setPages(b, [0, 1]);

        tracker.unregisterConnection(b, c1);

        // Entry still exists — page 0 is still tracked
        const pages = new Map([[0, pageData(1)]]);
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
        tracker.registerConnection(b, cid());

        tracker.setPages(b, [0, 1, 2]);
        tracker.setPages(b, [3, 4]);

        const pages = new Map([
            [0, pageData(0)],
            [3, pageData(3)],
            [4, pageData(4)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        // Page 0 should now be returned (not in new set),
        // pages 3 and 4 should be filtered out.
        expect(filtered.size).toBe(1);
        expect(filtered.has(0)).toBe(true);
    });

    test("setPages clears pending pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());

        tracker.addPendingPages(b, [5, 6]);
        tracker.setPages(b, [0]);

        // Page 5 was pending, now gone. Should be included
        // in filtered results (not skipped).
        const pages = new Map([
            [0, pageData(0)],
            [5, pageData(5)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);
        expect(filtered.size).toBe(1);
        expect(filtered.has(5)).toBe(true);
    });

    test("setPages is a no-op for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        // Should not throw
        tracker.setPages(bid(), [0, 1]);
    });

    // -- addPages -------------------------------------------------------------

    test("addPages incrementally adds to the page set", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());

        tracker.setPages(b, [0]);
        tracker.addPages(b, [1, 2]);

        const pages = new Map([
            [0, pageData(0)],
            [1, pageData(1)],
            [2, pageData(2)],
            [3, pageData(3)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        expect(filtered.size).toBe(1);
        expect(filtered.has(3)).toBe(true);
    });

    test("addPages promotes pending pages to confirmed", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());

        tracker.addPendingPages(b, [1, 2]);

        // Pending pages are not skipped by filterReadPages
        const pages = new Map([
            [1, pageData(1)],
            [2, pageData(2)],
        ]);
        expect(tracker.filterReadPages(b, pages).size).toBe(2);

        // Acknowledge them
        tracker.addPages(b, [1, 2]);

        // Now they are confirmed and skipped
        expect(tracker.filterReadPages(b, pages).size).toBe(0);
    });

    test("addPages is a no-op for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        // Should not throw
        tracker.addPages(bid(), [0, 1]);
    });

    // -- addPendingPages ------------------------------------------------------

    test("addPendingPages marks pages as pending", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());

        tracker.addPendingPages(b, [1, 2]);

        // Pending pages are NOT skipped by filterReadPages
        const pages = new Map([
            [1, pageData(1)],
            [2, pageData(2)],
        ]);
        expect(tracker.filterReadPages(b, pages).size).toBe(2);
    });

    test("addPendingPages does not downgrade confirmed pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());

        tracker.setPages(b, [1]); // confirmed
        tracker.addPendingPages(b, [1]); // should NOT downgrade

        // Page 1 should still be skipped (confirmed)
        const pages = new Map([[1, pageData(1)]]);
        expect(tracker.filterReadPages(b, pages).size).toBe(0);
    });

    test("addPendingPages is a no-op for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        // Should not throw
        tracker.addPendingPages(bid(), [0, 1]);
    });

    // -- clientMightHavePage ---------------------------------------------------

    test("clientMightHavePage returns true for confirmed pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());
        tracker.setPages(b, [0, 1]);

        expect(tracker.clientMightHavePage(b, 0)).toBe(true);
        expect(tracker.clientMightHavePage(b, 1)).toBe(true);
        expect(tracker.clientMightHavePage(b, 2)).toBe(false);
    });

    test("clientMightHavePage returns true for pending pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());
        tracker.addPendingPages(b, [3]);

        expect(tracker.clientMightHavePage(b, 3)).toBe(true);
        expect(tracker.clientMightHavePage(b, 4)).toBe(false);
    });

    test("clientMightHavePage returns false for unknown browser", () => {
        const tracker = new BrowserPageTracker();
        expect(tracker.clientMightHavePage(bid(), 0)).toBe(false);
    });

    // -- filterReadPages ------------------------------------------------------

    test("filterReadPages excludes only confirmed pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());
        tracker.setPages(b, [1, 3]);

        const pages = new Map([
            [0, pageData(0)],
            [1, pageData(1)],
            [2, pageData(2)],
            [3, pageData(3)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        expect([...filtered.keys()].sort()).toEqual([0, 2]);
    });

    test("filterReadPages includes pending pages", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());
        tracker.setPages(b, [0]);
        tracker.addPendingPages(b, [1]);

        const pages = new Map([
            [0, pageData(0)],
            [1, pageData(1)],
            [2, pageData(2)],
        ]);
        const filtered = tracker.filterReadPages(b, pages);

        // Page 0 skipped (confirmed), pages 1 and 2 included
        expect([...filtered.keys()].sort()).toEqual([1, 2]);
    });

    test("filterReadPages returns empty map when all pages are confirmed", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        tracker.registerConnection(b, cid());
        tracker.setPages(b, [0, 1]);

        const pages = new Map([
            [0, pageData(0)],
            [1, pageData(1)],
        ]);
        expect(tracker.filterReadPages(b, pages).size).toBe(0);
    });

    // -- Multi-browser isolation ----------------------------------------------

    test("page sets are isolated between browsers", () => {
        const tracker = new BrowserPageTracker();
        const b1 = bid();
        const b2 = bid();
        tracker.registerConnection(b1, cid());
        tracker.registerConnection(b2, cid());

        tracker.setPages(b1, [0, 1]);
        tracker.setPages(b2, [2, 3]);

        const pages = new Map([
            [0, pageData(0)],
            [1, pageData(1)],
            [2, pageData(2)],
            [3, pageData(3)],
        ]);

        const filtered1 = tracker.filterReadPages(b1, pages);
        expect([...filtered1.keys()].sort()).toEqual([2, 3]);

        const filtered2 = tracker.filterReadPages(b2, pages);
        expect([...filtered2.keys()].sort()).toEqual([0, 1]);
    });

    // -- Connection refcounting -----------------------------------------------

    test("closing all connections clears page set for reconnection", () => {
        const tracker = new BrowserPageTracker();
        const b = bid();
        const c1 = cid();
        const c2 = cid();
        tracker.registerConnection(b, c1);
        tracker.registerConnection(b, c2);
        tracker.setPages(b, [0, 1, 2]);

        tracker.unregisterConnection(b, c1);
        tracker.unregisterConnection(b, c2);

        // Re-register — should start with empty page set
        tracker.registerConnection(b, cid());
        const pages = new Map([[0, pageData(0)]]);
        expect(tracker.filterReadPages(b, pages)).toEqual(pages);
    });
});
