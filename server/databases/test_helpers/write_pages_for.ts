import type {DatabaseServer} from "~/server/databases/database_server.js";
import {noTruncates} from "~/server/databases/test_helpers/no_truncates.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Write `pages` for a single table through {@link DatabaseServer.writePages} with
 * no truncates. Returns the batch's write version.
 */
export function writePagesFor(
    server: DatabaseServer,
    tableId: DatabaseTableId,
    pages: ReadonlyMap<number, Uint8Array>,
): number {
    return server.writePages(new Map([[tableId, pages]]), noTruncates);
}
