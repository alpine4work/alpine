import type {DatabaseClientConnection} from "~/client/web/databases/database_client.js";

/**
 * Builds a {@link DatabaseClientConnection} with safe
 * defaults for every method, letting tests override only
 * what they care about. The defaults are:
 *
 * - `executeActionServer`: never resolves (preserves
 *   optimistic mutations in the queue).
 * - `ensureCacheIsUpToDate`: resolves to an empty cache.
 * - `acknowledgePages`, `reportError`: no-ops.
 */
export function makeDatabaseClientConnection(
    overrides: Partial<DatabaseClientConnection> = {},
): DatabaseClientConnection {
    return {
        executeActionServer: () => new Promise(() => {}),
        ensureCacheIsUpToDate: () => Promise.resolve({tables: new Map()}),
        acknowledgePages: () => {},
        reportError: () => {},
        ...overrides,
    };
}
