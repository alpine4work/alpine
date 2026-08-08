import {slugifySqlName} from "~/shared/databases/internal/slugify_sql_name.js";
import type {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Resolve a unique SQLite table name for a human-readable `name` by probing the
 * server table store — no per-table file is read, so this stays O(candidates)
 * regardless of how many tables the group has (reading every file would churn the
 * attach LRU once the group outgrows SQLite's attach limit). Pass `excludeTableId`
 * when renaming so a rename to a slug variant of the table's current name resolves
 * to that same name.
 *
 * Server-only: the table store lives in the group's durable object, so calling
 * this on the client throws `DatabaseActionRequiresServerError`, routing the
 * action to the server.
 */
export function formatUniqueTableName({
    model,
    name,
    excludeTableId,
}: {
    model: DatabaseModel;
    name: string;
    excludeTableId?: DatabaseTableId;
}): string {
    const {tables} = model.ctx.server();
    const slug = slugifySqlName(name);
    if (!tables.isTableNameTaken(slug, excludeTableId)) return slug;
    for (let i = 2; ; i++) {
        const candidate = `${slug}_${i}`;
        if (!tables.isTableNameTaken(candidate, excludeTableId)) return candidate;
    }
}
