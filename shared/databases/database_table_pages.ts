import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.js";

/**
 * Canonical representation of a batch of pages spanning
 * one or more database tables.
 *
 * The outer key is a {@link DatabaseTableId} — each table
 * is its own SQLite database (attached together on the
 * client). The inner key is the SQLite page index within
 * that table.
 *
 * Use this schema (and the inferred {@link DatabaseTablePages}
 * type) anywhere a per-table snapshot of page bytes needs
 * to cross a wire format, an RPC boundary, or a function
 * signature.
 */
export const DatabaseTablePagesSchema = Schema.map(
    Schema.id<DatabaseTableId>(),
    Schema.map(
        Schema.integer,
        Schema.object({
            timestamp: Schema.integer,
            data: Schema.bytes,
        }),
    ),
);

export type DatabaseTablePages = SchemaType<typeof DatabaseTablePagesSchema>;
