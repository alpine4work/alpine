import type {BrowserId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";

/**
 * Tracks which SQLite pages each browser already
 * has cached in OPFS. Used to avoid re-sending pages
 * the client already possesses.
 *
 * Entries are reference-counted by WebSocket
 * connections: when the last connection for a browser
 * closes, the entry is deleted (assuming the browser
 * tab closed and OPFS may be stale on next visit).
 */
export class BrowserPageTracker {
    private readonly _browsers = new Map<
        BrowserId,
        {connections: Set<WebSocketConnectionId>; pages: Set<number>}
    >();

    registerConnection(browserId: BrowserId, connectionId: WebSocketConnectionId): void {
        let entry = this._browsers.get(browserId);
        if (entry === undefined) {
            entry = {connections: new Set(), pages: new Set()};
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
     * Called after `syncCachePages` (initial) determines
     * which pages the client already has valid copies of.
     */
    setPages(browserId: BrowserId, pageIndexes: Iterable<number>): void {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return;
        entry.pages = new Set(pageIndexes);
    }

    /**
     * Incrementally add pages the client has
     * acknowledged receiving.
     */
    addPages(browserId: BrowserId, pageIndexes: ReadonlyArray<number>): void {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return;
        for (const idx of pageIndexes) {
            entry.pages.add(idx);
        }
    }

    /**
     * Return a new map containing only the pages the
     * browser does NOT already have.
     */
    filterReadPages(
        browserId: BrowserId,
        readPages: ReadonlyMap<number, {timestamp: number; data: Uint8Array}>,
    ): Map<number, {timestamp: number; data: Uint8Array}> {
        const entry = this._browsers.get(browserId);
        if (entry === undefined) return new Map(readPages);
        const filtered = new Map<number, {timestamp: number; data: Uint8Array}>();
        for (const [pageIndex, value] of readPages) {
            if (!entry.pages.has(pageIndex)) {
                filtered.set(pageIndex, value);
            }
        }
        return filtered;
    }
}
