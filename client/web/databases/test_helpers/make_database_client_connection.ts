import type {DatabaseClientConnection} from "~/client/web/databases/worker/database_client.js";

/**
 * Builds a {@link DatabaseClientConnection} with safe defaults for every method,
 * letting tests override only what they care about. The defaults are:
 *
 * - `executeActionServer`: never resolves (preserves optimistic mutations in the
 *   queue).
 * - `registerTables`: resolves to an empty registration result.
 * - `reportError`, `close`: no-ops.
 */
export function makeDatabaseClientConnection(
    overrides: Partial<DatabaseClientConnection> = {},
): DatabaseClientConnection {
    return {
        executeActionServer: () => new Promise(() => {}),
        registerTables: () => Promise.resolve({tables: new Map(), tableAccess: new Map()}),
        reportError: () => {},
        close: () => {},
        ...overrides,
    };
}
