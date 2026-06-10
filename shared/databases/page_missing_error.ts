import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Thrown when SQLite needs local page data the client doesn't have, signalling
 * that the query should be retried via the server. Raised in two cases:
 *
 * - The client-side VFS read a page within a table's known file size that isn't in
 *   the local OPFS page store.
 * - A query referenced a table whose per-db file isn't attached locally (so the
 *   client holds none of its pages, not even page 0). `Database` detects this from
 *   SQLite's name-resolution error and raises it with `pageIndex` 0.
 */
export class PageMissingError extends Error {
    constructor(
        public readonly pageIndex: number,
        public readonly tableId?: DatabaseTableId,
    ) {
        super(
            tableId === undefined
                ? `Page ${pageIndex} not in local store`
                : `Page ${pageIndex} of table ${tableId} not in local store`,
        );
    }
}
