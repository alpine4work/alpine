import {SearchEntityUpdateSchema} from "~/server/search/core/search_entity_update.js";
import {Id} from "~/shared/id/id.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";

/**
 * The `IndexSearchEntity` job reads the specified entity and adds it to our search
 * entity index. It also updates any search entities that depend on the one we're
 * updating. For example, if you're re-indexing an account that updated their name
 * we'll need to also re-index any content in which the account is mentioned so you
 * can search for that content with the account's new name.
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

export type IndexSearchEntityDependentsJobDescription = SchemaType<
    typeof IndexSearchEntityDependentsJobDescriptionSchema
>;

export const IndexSearchEntityDependentsJobDescriptionSchema = Schema.object({
    type: Schema.value("IndexSearchEntityDependents"),
    spaceId: Schema.id<SpaceId>(),
    update: SearchEntityUpdateSchema,
    parentJobStartTime: Schema.date,
});

export type IndexSearchEntityEmbeddingChunksJobDescription = SchemaType<
    typeof IndexSearchEntityEmbeddingChunksJobDescriptionSchema
>;

export const IndexSearchEntityEmbeddingChunksJobDescriptionSchema = Schema.object({
    type: Schema.value("IndexSearchEntityEmbeddingChunks"),
    id: Schema.id<Id>(),
    spaceId: Schema.id<SpaceId>(),
    entityId: Schema.stringAs<SearchDynamicEntityId>(),
    forceMetadataUpdate: Schema.boolean.default(false),
});
