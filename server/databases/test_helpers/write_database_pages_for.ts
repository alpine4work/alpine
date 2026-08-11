import type {DatabaseServer} from "~/server/databases/database_server.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Write `pages` for a single table through {@link DatabaseServer.writePages} with
 * no truncates. Returns the batch's write version.
 */
export function writeDatabasePagesFor(
    server: DatabaseServer,
    tableId: DatabaseTableId,
    pages: ReadonlyMap<number, Uint8Array>,
): number {
    return server.writePages(new Map([[tableId, pages]]), emptyMap);
}
