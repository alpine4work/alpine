import type {DatabaseDurableObjectStorage} from "~/server/databases/database_durable_object_storage.js";
import {noTruncates} from "~/server/databases/test_helpers/no_truncates.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Write `pages` for a single table through {@link
 * DatabaseDurableObjectStorage.writePages} with no truncates. Returns the batch's
 * write version.
 */
export function writePagesFor(
    doStorage: DatabaseDurableObjectStorage,
    tableId: DatabaseTableId,
    pages: ReadonlyMap<number, Uint8Array>,
): number {
    return doStorage.writePages(new Map([[tableId, pages]]), noTruncates);
}
