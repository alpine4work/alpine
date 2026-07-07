import {slugifySqlName} from "~/shared/databases/internal/slugify_sql_name.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";

/**
 * Resolve a unique SQLite table name (and its salted hash) for a human-readable
 * `name` by probing the registry's `table_name_hash` index — no per-table file
 * is read, so this stays O(candidates) regardless of how many tables the group
 * has (reading every file would churn the attach LRU once the group outgrows
 * SQLite's attach limit). Pass `excludeTableId` when renaming so a rename to a
 * slug variant of the table's current name resolves to that same name.
 *
 * Lives in the action layer: `hashWithPrivateSalt` is
 * `DatabaseActionServerContext`'s method of the same name, so calling this on
 * the client throws `DatabaseActionRequiresServerError`, routing the action to
 * the server — only the group's durable object holds the salt. The resolved
 * name and hash are then passed into the model together, keeping them
 * consistent by construction.
 */
export function formatUniqueTableName({
    model,
    hashWithPrivateSalt,
    name,
    excludeTableId,
}: {
    model: {
        isTableNameHashTaken(tableNameHash: string, excludeTableId?: DatabaseTableId): boolean;
    };
    hashWithPrivateSalt: (value: string) => string;
    name: string;
    excludeTableId?: DatabaseTableId;
}): {tableName: string; tableNameHash: string} {
    const slug = slugifySqlName(name);
    const resolve = (candidate: string) => {
        const tableNameHash = hashWithPrivateSalt(candidate);
        if (model.isTableNameHashTaken(tableNameHash, excludeTableId)) return null;
        return {tableName: candidate, tableNameHash};
    };

    const unsuffixed = resolve(slug);
    if (unsuffixed !== null) return unsuffixed;
    for (let i = 2; ; i++) {
        const suffixed = resolve(`${slug}_${i}`);
        if (suffixed !== null) return suffixed;
    }
}
