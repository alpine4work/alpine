import {SearchEntityUpdateSchema} from "~/server/search/core/search_entity_update.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * The `IndexSearchEntity` job reads the specified entity and adds it to our
 * search entity index. It also updates any search entities that depend on the
 * one we're updating. For example, if you're re-indexing an account that
 * updated their name we'll need to also re-index any content in which the
 * account is mentioned so you can search for that content with the account's
 * new name.
 */
export type IndexSearchEntityJobDescription = SchemaType<
    typeof IndexSearchEntityJobDescriptionSchema
>;

export const IndexSearchEntityJobDescriptionSchema = Schema.object({
    type: Schema.value("IndexSearchEntity"),
    spaceId: Schema.id<SpaceId>(),
    update: SearchEntityUpdateSchema,
    parentJobStartTime: Schema.date.optional(),
});
