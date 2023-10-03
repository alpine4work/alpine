import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

/**
 * Limit of search results we'll fetch on the client. We don't lazy load more
 * when the user scrolls, instead the user needs to narrow their search.
 *
 * This is enough to give the user some choice while they scroll while not
 * using too many resources.
 */
export const taskCollectionSearchResultLimit = 20;

export type TaskCollectionModelSearchResult = SchemaType<
    typeof TaskCollectionModelSearchResultSchema
>;

export const TaskCollectionModelSearchResultSchema = Schema.object({
    /**
     * The score used to sort search results. Scores from different endpoints may
     * not be comparable to each other. For instance the score from
     * `getAffinitiveTaskCollections()` are the collection's affinity points while
     * the score from `searchTaskCollections()` is the score computed by
     * OpenSearch. These have two different scales.
     */
    score: Schema.float,

    /**
     * The number of open tasks in the collection.
     */
    openTaskCount: Schema.integer,

    /**
     * The last time a task was added to the collection.
     */
    lastTaskAddedTime: HybridLogicalTimeSchema.nullable(),

    /**
     * The collection's data. We don't usually put collections from search results
     * in `TaskClientStore` because we don't have a realtime subscription for these
     * collections.
     */
    collection: TaskCollectionModel.schema,
});
