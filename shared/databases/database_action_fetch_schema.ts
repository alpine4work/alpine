import {DatabaseActionResultSchema} from "~/shared/databases/database_actions.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Wire format for the HTTP action endpoint response.
 * Used by the durable object to serialize action results
 * and by `fetchDatabaseAction` to deserialize them.
 */
export const DatabaseActionFetchResponseSchema = Schema.object({
    result: DatabaseActionResultSchema,
    readPages: Schema.map(
        Schema.integer,
        Schema.object({
            timestamp: Schema.integer,
            data: Schema.bytes,
        }),
    ),
});
