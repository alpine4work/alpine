import type {
    BrowserId,
    DatabaseTableId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";

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
 * (sent but not yet acknowledged). Pages are
 * partitioned by {@link DatabaseTableId} since a
 * client may have many independent table databases
 * attached.
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
        {
            connections: Set<WebSocketConnectionId>;
            pages: Map<DatabaseTableId, Map<number, PageStatus>>;
        }
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
     * Full replacement of the browser's known page set
     * across every table. All provided pages are marked
     * as confirmed. Clears any previously pending or
     * confirmed pages, including for tables not present
     * in `pagesByTable`.
     *
     * Called after `ensureCacheIsUpToDate` determines
     * which pages the client already has valid copies of.
     */
    setPages(
        browserId: BrowserId,
        pagesByTable: ReadonlyMap<DatabaseTableId, Iterable<number>>,
    ): void {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return;
        const next = new Map<DatabaseTableId, Map<number, PageStatus>>();
        for (const [tableId, indexes] of pagesByTable) {
            const tablePages = new Map<number, PageStatus>();
            for (const idx of indexes) {
                tablePages.set(idx, "confirmed");
            }
            next.set(tableId, tablePages);
        }
        entry.pages = next;
    }

    /**
     * Mark pages as confirmed. Called when the client
     * acknowledges receiving pages. If a page was
     * pending, it is promoted to confirmed.
     *
     * The `pagesByTable` keys come from untrusted client
     * input, so this only confirms pages for tables the
     * server has already tracked for this browser (via
     * {@link setPages} / {@link addPendingPages}). Tables
     * with no existing entry are ignored — a client can't
     * acknowledge pages it was never sent, and must not be
     * able to grow the per-browser page map with fabricated
     * table ids.
     */
    addPages(
        browserId: BrowserId,
        pagesByTable: ReadonlyMap<DatabaseTableId, ReadonlyArray<number>>,
    ): void {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return;
        for (const [tableId, indexes] of pagesByTable) {
            const tablePages = entry.pages.get(tableId);
            if (tablePages === undefined) continue;
            for (const idx of indexes) {
                tablePages.set(idx, "confirmed");
            }
        }
    }

    /**
     * Mark pages as pending (sent to client but not yet
     * acknowledged). Pages already marked confirmed are
     * not downgraded.
     */
    addPendingPages(
        browserId: BrowserId,
        pagesByTable: ReadonlyMap<DatabaseTableId, Iterable<number>>,
    ): void {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return;
        for (const [tableId, indexes] of pagesByTable) {
            const tablePages = this._getOrCreateTable(entry, tableId);
            for (const idx of indexes) {
                if (tablePages.get(idx) !== "confirmed") {
                    tablePages.set(idx, "pending");
                }
            }
        }
    }

    /**
     * Returns true if the browser might have this page
     * (either confirmed or pending). Used to decide
     * whether to include a page in changedPages events.
     * Returns false for unknown browsers.
     */
    clientMightHavePage(
        browserId: BrowserId,
        tableId: DatabaseTableId,
        pageIndex: number,
    ): boolean {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return false;
        return entry.pages.get(tableId)?.has(pageIndex) ?? false;
    }

    /**
     * Return a new map containing only the pages the
     * browser does NOT have confirmed, partitioned by
     * table. Pending pages are included (re-sent) since
     * the client may not have processed them yet. Tables
     * with no surviving pages are omitted.
     */
    filterReadPages(
        browserId: BrowserId,
        readPages: ReadonlyMap<
            DatabaseTableId,
            ReadonlyMap<number, {version: number; data: Uint8Array}>
        >,
    ): Map<DatabaseTableId, Map<number, {version: number; data: Uint8Array}>> {
        const entry = this._browsers.get(browserId);
        const filtered = new Map<
            DatabaseTableId,
            Map<number, {version: number; data: Uint8Array}>
        >();
        for (const [tableId, tablePages] of readPages) {
            const knownPages = entry?.pages.get(tableId);
            const out = new Map<number, {version: number; data: Uint8Array}>();
            for (const [pageIndex, value] of tablePages) {
                if (knownPages?.get(pageIndex) === "confirmed") continue;
                out.set(pageIndex, value);
            }
            if (out.size > 0) filtered.set(tableId, out);
        }
        return filtered;
    }

    private _getOrCreateTable(
        entry: {pages: Map<DatabaseTableId, Map<number, PageStatus>>},
        tableId: DatabaseTableId,
    ): Map<number, PageStatus> {
        let tablePages = entry.pages.get(tableId);
        if (tablePages === undefined) {
            tablePages = new Map();
            entry.pages.set(tableId, tablePages);
        }
        return tablePages;
    }
}
