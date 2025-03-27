import {OpensearchSearchHitExplanationSchema} from "~/shared/opensearch/opensearch_search_hit_explanation.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchEntityIdSchema} from "~/shared/search/search_entity_id.js";
import {SearchEntityMediaModelSchema} from "~/shared/search/search_entity_media_model.js";

/**
 * Search result returned by `searchByKeywords()` and `searchBySemantics()`.
 */
export type SearchEntityResult = SchemaType<typeof SearchEntityResultSchema>;

export const SearchEntityResultSchema = Schema.object({
    id: SearchEntityIdSchema,
    score: Schema.float,
    title: Schema.string.nullable(),
    bodyTextSnippet: Schema.array(
        Schema.object({
            isHighlighted: Schema.boolean,
            text: Schema.string,
        }),
    ),
    media: SearchEntityMediaModelSchema.nullable(),
    explanation: OpensearchSearchHitExplanationSchema.optional(),
});
