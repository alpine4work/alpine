import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Thrown when a query references a table whose per-db file is not attached to the
 * local SQLite connection. `Database` detects this from SQLite's name-resolution
 * error (client only) and raises it so the client can attach the table's per-db
 * file on demand and retry.
 *
 * Distinct from {@link PageMissingError}: a missing page means "fetch this page
 * from the server", whereas an unattached table means "attach the file and try
 * again locally" — only falling back to the server when the table's pages aren't
 * cached locally.
 */
export class DatabaseTableNotAttachedError extends Error {
    constructor(public readonly tableId: DatabaseTableId) {
        super(`Table ${tableId} is not attached`);
    }
}
