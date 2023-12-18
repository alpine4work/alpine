import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchEntityIdSchema} from "~/shared/search/search_entity_id.js";

/**
 * A search result object representing one of many different kinds of content
 * types in our system. Returned by one of our search endpoints.
 */
export type SearchResult = SchemaType<typeof SearchResultSchema>;

export const SearchResultSchema = Schema.object({
    entityId: SearchEntityIdSchema,
    score: Schema.float, // NOCOMMIT: In debug mode we need more info?
    title: Schema.string.nullable(),
    bodyTextSnippet: Schema.array(
        Schema.object({
            isHighlighted: Schema.boolean,
            text: Schema.string,
        }),
    ),
});
