import {pageDiffSchema} from "~/shared/databases/page_diff.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.js";

/**
 * The pages of a single database table, keyed by SQLite
 * page index. Each value is the page bytes plus the
 * timestamp at which the canonical server observed them.
 */
export const DatabaseTablePagesSchema = Schema.map(
    Schema.integer,
    Schema.object({
        timestamp: Schema.integer,
        data: Schema.bytes,
    }),
);

export type DatabaseTablePages = SchemaType<typeof DatabaseTablePagesSchema>;

/**
 * Pages spanning one or more database tables. Each table
 * is its own SQLite database (attached together on the
 * client), so the outer key is a {@link DatabaseTableId}
 * and the inner is {@link DatabaseTablePagesSchema}.
 */
export const DatabasePagesSchema = Schema.map(
    Schema.id<DatabaseTableId>(),
    DatabaseTablePagesSchema,
);

export type DatabasePages = SchemaType<typeof DatabasePagesSchema>;

/**
 * The page diffs for a single database table, keyed by
 * SQLite page index. Each value is the diff bytes plus
 * the timestamp at which the canonical server produced
 * them. Mirrors {@link DatabaseTablePagesSchema} for
 * realtime updates.
 */
export const DatabaseTablePageDiffsSchema = Schema.map(
    Schema.integer,
    Schema.object({
        timestamp: Schema.integer,
        diff: pageDiffSchema,
    }),
);

export type DatabaseTablePageDiffs = SchemaType<typeof DatabaseTablePageDiffsSchema>;

/**
 * Page diffs spanning one or more database tables.
 * Mirrors {@link DatabasePagesSchema} for realtime
 * updates.
 */
export const DatabasePageDiffsSchema = Schema.map(
    Schema.id<DatabaseTableId>(),
    DatabaseTablePageDiffsSchema,
);

export type DatabasePageDiffs = SchemaType<typeof DatabasePageDiffsSchema>;
