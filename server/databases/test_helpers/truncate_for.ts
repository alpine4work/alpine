import type {DatabaseServer} from "~/server/databases/database_server.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Truncate a single table to `size` bytes through {@link
 * DatabaseServer.writePages} with no page writes. Returns the batch's write
 * version.
 */
export function truncateFor(
    server: DatabaseServer,
    tableId: DatabaseTableId,
    size: number,
): number {
    return server.writePages(new Map(), new Map([[tableId, size]]));
}
