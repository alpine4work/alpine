import type {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Truncate a single table to `size` bytes through {@link
 * DatabaseDurableObjectStorage.writePages} with no page writes. Returns the
 * batch's write version.
 */
export function truncateFor(
    doStorage: DatabaseDurableObjectStorage,
    tableId: DatabaseTableId,
    size: number,
): number {
    return doStorage.writePages(new Map(), new Map([[tableId, size]]));
}
