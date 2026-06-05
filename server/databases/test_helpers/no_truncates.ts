import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Shared empty truncate map for
 * {@link DatabaseDurableObjectStorage.writePages} calls
 * that only write pages and never truncate.
 */
export const noTruncates: ReadonlyMap<DatabaseTableId, number> = new Map();
