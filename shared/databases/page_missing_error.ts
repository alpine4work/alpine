/**
 * Thrown by the client-side VFS when SQLite reads a page
 * that is not in the local OPFS page store. Signals that
 * the query should be retried via the server.
 */
export class PageMissingError extends Error {
    constructor(public readonly pageIndex: number) {
        super(`Page ${pageIndex} not in local store`);
    }
}
