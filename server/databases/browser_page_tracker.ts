import type {BrowserId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";

/**
 * Two-tier status for tracked pages:
 * - `"confirmed"` — the client has acknowledged
 *   receiving this page.
 * - `"pending"` — the server sent this page but
 *   the client hasn't acknowledged it yet.
 */
type PageStatus = "confirmed" | "pending";

/**
 * Tracks which SQLite pages each browser already
 * has cached in OPFS, with two confidence tiers:
 * **confirmed** (client acknowledged) and **pending**
 * (sent but not yet acknowledged).
 *
 * - `filterReadPages` skips only confirmed pages,
 *   so pending pages are re-sent if needed.
 * - Future per-client realtime filtering should
 *   include both confirmed and pending pages
 *   (anything the client might have).
 *
 * Entries are reference-counted by WebSocket
 * connections: when the last connection for a browser
 * closes, the entry is deleted (assuming the browser
 * tab closed and OPFS may be stale on next visit).
 */
export class BrowserPageTracker {
    private readonly _browsers = new Map<
        BrowserId,
        {connections: Set<WebSocketConnectionId>; pages: Map<number, PageStatus>}
    >();

    registerConnection(browserId: BrowserId, connectionId: WebSocketConnectionId): void {
        let entry = this._browsers.get(browserId);
        if (entry === undefined) {
            entry = {connections: new Set(), pages: new Map()};
            this._browsers.set(browserId, entry);
        }
        entry.connections.add(connectionId);
    }

    unregisterConnection(browserId: BrowserId, connectionId: WebSocketConnectionId): void {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return;
        entry.connections.delete(connectionId);
        if (entry.connections.size === 0) {
            this._browsers.delete(browserId);
        }
    }

    /**
     * Full replacement of the browser's known page set.
     * All provided pages are marked as confirmed.
     * Clears any previously pending pages.
     *
     * Called after `ensureCacheIsUpToDate` determines
     * which pages the client already has valid copies of.
     */
    setPages(browserId: BrowserId, pageIndexes: Iterable<number>): void {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return;
        const pages = new Map<number, PageStatus>();
        for (const idx of pageIndexes) {
            pages.set(idx, "confirmed");
        }
        entry.pages = pages;
    }

    /**
     * Mark pages as confirmed. Called when the client
     * acknowledges receiving pages. If a page was
     * pending, it is promoted to confirmed.
     */
    addPages(browserId: BrowserId, pageIndexes: ReadonlyArray<number>): void {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return;
        for (const idx of pageIndexes) {
            entry.pages.set(idx, "confirmed");
        }
    }

    /**
     * Mark pages as pending (sent to client but not yet
     * acknowledged). Pages already marked confirmed are
     * not downgraded.
     */
    addPendingPages(browserId: BrowserId, pageIndexes: Iterable<number>): void {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return;
        for (const idx of pageIndexes) {
            if (entry.pages.get(idx) !== "confirmed") {
                entry.pages.set(idx, "pending");
            }
        }
    }

    /**
     * Return a new map containing only the pages the
     * browser does NOT have confirmed. Pending pages
     * are included (re-sent) since the client may not
     * have processed them yet.
     */
    filterReadPages(
        browserId: BrowserId,
        readPages: ReadonlyMap<number, {timestamp: number; data: Uint8Array}>,
    ): Map<number, {timestamp: number; data: Uint8Array}> {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return new Map(readPages);
        const filtered = new Map<number, {timestamp: number; data: Uint8Array}>();
        for (const [pageIndex, value] of readPages) {
            if (entry.pages.get(pageIndex) !== "confirmed") {
                filtered.set(pageIndex, value);
            }
        }
        return filtered;
    }
}
