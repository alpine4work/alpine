import {DatabaseActionResultSchema} from "~/shared/databases/database_actions.js";
import type {DatabaseTableId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Wire format for the HTTP action endpoint response.
 * Used by the durable object to serialize action results
 * and by `fetchDatabaseAction` to deserialize them.
 *
 * `readPages` is keyed by {@link DatabaseTableId} since
 * each table is its own SQLite database on the client.
 */
export const DatabaseActionFetchResponseSchema = Schema.object({
    result: DatabaseActionResultSchema,
    readPages: Schema.map(
        Schema.id<DatabaseTableId>(),
        Schema.map(
            Schema.integer,
            Schema.object({
                timestamp: Schema.integer,
                data: Schema.bytes,
            }),
        ),
    ),
});
