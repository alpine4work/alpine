import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Id} from "~/shared/id/id.js";
import {AccountId, ChannelId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchAffinityEntityId, SearchDynamicEntityId} from "~/shared/search/search_entity_id.js";

const SearchAffinityEntityIdDynamoKeyAttributeSchema =
    DynamoKeyAttributeSchema.labelString<SearchAffinityEntityId>({
        // Some IDs (e.g. document comment threads) can be longer than 50 characters.
        maxLength: 256,
    });

const SearchDynamicEntityIdDynamoKeyAttributeSchema =
    DynamoKeyAttributeSchema.labelString<SearchDynamicEntityId>({
        // Some IDs (e.g. document comment threads) can be longer than 50 characters.
        maxLength: 256,
    });

export const SearchEntityTable = DynamoTableSchema.new({
    name: "SearchEntities",
    partitions: [
        {
            name: "Account",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    // NOTE(calebmer, 2024-03-19): Would love to rename this sort range
                    // `SearchAffinityEntity` instead of `SearchEntityAffinity` but can't rename since
                    // data is already stored in the database with this sort range type.
                    name: "SearchEntityAffinity",
                    sortKeyAttributes: {
                        entityId: SearchAffinityEntityIdDynamoKeyAttributeSchema,
                    },
                    withExpirationTime: "RequiredNullable",
                    attributes: Schema.object({
                        /**
                         * The number of affinity points this account has.
                         */
                        points: Schema.float,

                        /**
                         * The bucket this affinity item falls into. We place affinity scores in buckets
                         * for better query performance so we only need to query entities with the highest
                         * affinity scores.
                         *
                         * See `getSearchAffinityEntityPointsBucket()`.
                         */
                        pointsBucket: Schema.integer,

                        /**
                         * How quickly the points for this item erode. If 0 then points decay at a normal
                         * rate. If more than 0 then we'll decay points faster. Whenever we add points to
                         * an item, we decrease `erosion` by the same amount. Erosion is our way of adding
                         * items that rocket to the top of the search affinity list but quickly fall down
                         * if they receive no further interaction. This way if a user adds a quick
                         * "Untitled" document to write something inherently transient down, that document
                         * won't sit at the top of the affinity list for the next week or so.
                         */
                        erosion: Schema.float.min(0).default(0),

                        /**
                         * The last time we updated `points`. Used to determine how much decay we need to
                         * apply to `points`.
                         */
                        lastUpdatedTime: Schema.integer,

                        /**
                         * If this is non-null then the search entity is in the account's favorites list.
                         * The favorites list is ordered by `OrderKey`. We create an index on this table
                         * that's ordered by this `OrderKey` to efficiently access an account's favorites
                         * list.
                         *
                         * If `favoriteOrderKey` is non-null then this item should never expire.
                         * `expirationTime` will be set to null even if `points` is less than 0.05.
                         */
                        favoriteOrderKey: OrderKeySchema.nullable().default(null),

                        /**
                         * If this is a task search entity that's been marked as active and the account is
                         * assigned to the task then we add a bunch of points to rocket the task to the top
                         * of the search affinity list. Once the task is no longer active, we remove any
                         * points from that initial boost (after applying decay).
                         *
                         * This object will be set if we've applied the active task assignee boost to make
                         * sure we only apply the boost once.
                         *
                         * The object records the number of points we applied to boost the task (in case we
                         * change the amount of points) and the time at which the boost was applied so we
                         * can undo the boost later.
                         */
                        activeTaskAssignee: Schema.object({
                            points: Schema.float,
                            erosion: Schema.value(0).default(0),
                            lastUpdatedTime: Schema.integer,
                        }).optional(),
                    }),
                },
            ],
        },
        {
            name: "SpaceChannels",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    // NOTE(calebmer, 2025-03-26): Would love to rename this sort range
                    // `SearchAffinityEntity` instead of `SearchAffinity` but can't rename since data
                    // is already stored in the database with this sort range type.
                    name: "SearchAffinity",
                    sortKeyAttributes: {
                        channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        /**
                         * The number of affinity points this account has.
                         */
                        points: Schema.float,

                        /**
                         * The bucket this affinity item falls into. We place affinity scores in buckets
                         * for better query performance so we only need to query entities with the highest
                         * affinity scores.
                         *
                         * See `getSearchAffinityEntityPointsBucket()`.
                         */
                        pointsBucket: Schema.integer,

                        /**
                         * This property exists for compatibility with account affinities. Erosion will
                         * always be 0 (which has no effect).
                         */
                        erosion: Schema.value(0).default(0),

                        /**
                         * The last time we updated `points`. Used to determine how much decay we need to
                         * apply to `points`.
                         */
                        lastUpdatedTime: Schema.integer,

                        /**
                         * We add this key for type compatibility with account search affinity items. Some
                         * functions that operate on both account search affinity items and space search
                         * affinity items look for this property so we make it available but it's always
                         * set to null.
                         */
                        favoriteOrderKey: Schema.value(null).default(null),
                    }),
                },
            ],
        },
        {
            name: "SpaceTaskCollections",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    // NOTE(calebmer, 2025-03-26): Would love to rename this sort range
                    // `SearchAffinityEntity` instead of `SearchAffinity` but can't rename since data
                    // is already stored in the database with this sort range type.
                    name: "SearchAffinity",
                    sortKeyAttributes: {
                        collectionId: DynamoKeyAttributeSchema.id<TaskCollectionId>(),
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        /**
                         * The number of affinity points this account has.
                         */
                        points: Schema.float,

                        /**
                         * The bucket this affinity item falls into. We place affinity scores in buckets
                         * for better query performance so we only need to query entities with the highest
                         * affinity scores.
                         *
                         * See `getSearchAffinityEntityPointsBucket()`.
                         */
                        pointsBucket: Schema.integer,

                        /**
                         * This property exists for compatibility with account affinities. Erosion will
                         * always be 0 (which has no effect).
                         */
                        erosion: Schema.value(0).default(0),

                        /**
                         * The last time we updated `points`. Used to determine how much decay we need to
                         * apply to `points`.
                         */
                        lastUpdatedTime: Schema.integer,

                        /**
                         * We add this key for type compatibility with account search affinity items. Some
                         * functions that operate on both account search affinity items and space search
                         * affinity items look for this property so we make it available but it's always
                         * set to null.
                         */
                        favoriteOrderKey: Schema.value(null).default(null),
                    }),
                },
            ],
        },
        {
            name: "IndexSearchEntityEmbeddingChunksJob",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                entityId: SearchDynamicEntityIdDynamoKeyAttributeSchema,
            },
            sortRanges: [
                /**
                 * Distributed locking for the `IndexSearchEntityEmbeddingChunks` job. We need to
                 * guarantee only one process is processing the `IndexSearchEntityEmbeddingChunks`
                 * job at once. We also need to make sure `IndexSearchEntityEmbeddingChunks` jobs
                 * are run at least three minutes apart (the value of
                 * `searchEntityEmbeddingChunkIndexWaitForRefreshDelayMs` as of 2025-04-14) because
                 * we need to wait for OpenSearch to refresh between jobs so we can read previously
                 * written data with the OpenSearch `/_search` endpoint.
                 *
                 * We throttle `IndexSearchEntityEmbeddingChunks` jobs to a five minute throttle
                 * interval (as of 2025-04-14) even though it's larger than the required three
                 * minute refresh wait time since embedding search entities is expensive. So it's
                 * good to slow that down.
                 */
                {
                    name: "State",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * Once we finish processing a job we set `activeJob` to null and `previousJob` to
                         * the finished job.
                         */
                        previousJob: Schema.object({
                            id: Schema.id<Id>(),
                            startTime: Schema.date,
                            endTime: Schema.date,
                        }).nullable(),

                        /**
                         * The job that's currently running. There should only be one and exactly one
                         * active job running at a time across our entire fleet of servers. Before we start
                         * indexing embedding chunks, we first try to acquire the lock. If another process
                         * has the lock then we schedule an SQS message for the future (presumably after
                         * the other process releases the lock).
                         *
                         * The lock expires at `expirationTime`. This way if a process acquires the lock,
                         * then crashes, the lock will eventually expire and another process can acquire
                         * the lock. While our process has the lock we run an interval that continually
                         * updates the `expirationTime` pushing it further and further out. So if our
                         * Node.js process is continuing to run smoothly, the lock will never expire! The
                         * lock is only released once our processing code ends (lock is released
                         * immediately) or our Node.js process crashes (lock is released at
                         * `expirationTime`).
                         */
                        activeJob: Schema.object({
                            id: Schema.id<Id>(),
                            startTime: Schema.date,
                            expirationTime: Schema.date,
                        }).nullable(),

                        /**
                         * Jobs scheduled for the future. The `IndexSearchEntityEmbeddingChunks` job does
                         * nothing if it's `id` is not in this array. This forces you to schedule updates
                         * with `scheduleIndexSearchEntityEmbeddingChunksJob()` which will update this
                         * state.
                         *
                         * In theory there should only be one scheduled job at a time. In practice there
                         * may be edge cases where we have multiple scheduled jobs. We still make sure only
                         * one job runs at a time by using `activeJob` as a lock. If, for some reason, we
                         * update `scheduledJobs` but the SQS job never runs (e.g. the Node.js process
                         * crashes after updating DynamoDB but before sending a message to SQS) we clean
                         * out this when we acquire the `activeJob` lock when the job we're processing is
                         * later than any scheduled `startTime`s.
                         */
                        scheduledJobs: Schema.array(
                            Schema.object({
                                id: Schema.id<Id>(),
                                startTime: Schema.date,
                            }),
                        ).validation("Scheduled job `id`s must be unique", scheduledJobs => {
                            const ids = new Set<Id>();
                            for (const job of scheduledJobs) ids.add(job.id);
                            return ids.size === scheduledJobs.length;
                        }),
                    }),
                },
            ],
        },
    ],
});

export const AccountSearchAffinityEntitiesIndex = SearchEntityTable.addExpensiveFullIndex({
    // NOTE(calebmer, 2024-03-19): Would love to rename this index
    // `AccountSearchAffinityEntities` instead of `AccountAffinitiveSearchEntities` but
    // can't rename since data is already stored in the database with this sort range
    // type.
    name: "AccountAffinitiveSearchEntities",
    itemTypes: [{partitionType: "Account", sortRangeType: "SearchEntityAffinity"}],
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
    },
    sortKeyAttributes: {
        pointsBucket: DynamoKeyAttributeSchema.integer,
    },
});

export const SpaceChannelSearchAffinityEntitiesIndex = SearchEntityTable.addExpensiveFullIndex({
    // NOTE(calebmer, 2025-02-27): Would love to rename this index
    // `SpaceChannelSearchAffinityEntities` instead of `SpaceChannelsSearchAffinity`
    // but can't rename since data is already stored in the database with this sort
    // range type.
    name: "SpaceChannelsSearchAffinity",
    itemTypes: [{partitionType: "SpaceChannels", sortRangeType: "SearchAffinity"}],
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
    },
    sortKeyAttributes: {
        pointsBucket: DynamoKeyAttributeSchema.integer,
    },
});

export const SpaceTaskCollectionSearchAffinityEntitiesIndex =
    SearchEntityTable.addExpensiveFullIndex({
        // NOTE(calebmer, 2025-02-27): Would love to rename this index
        // `SpaceTaskCollectionSearchAffinityEntities` instead of
        // `SpaceTaskCollectionsSearchAffinity` but can't rename since data is already
        // stored in the database with this sort range type.
        name: "SpaceTaskCollectionsSearchAffinity",
        itemTypes: [{partitionType: "SpaceTaskCollections", sortRangeType: "SearchAffinity"}],
        partitionKeyAttributes: {
            spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
        },
        sortKeyAttributes: {
            pointsBucket: DynamoKeyAttributeSchema.integer,
        },
    });

export const AccountSearchFavoriteEntitiesIndex = SearchEntityTable.addIndex({
    // NOTE(calebmer, 2025-03-26): Would love to rename this index
    // `AccountSearchFavoriteEntities` instead of `AccountSearchAffinityFavorites` but
    // can't rename since data is already stored in the database with this sort range
    // type.
    name: "AccountSearchAffinityFavorites",
    itemTypes: [{partitionType: "Account", sortRangeType: "SearchEntityAffinity"}],
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
    },
    sortKeyAttributes: {
        favoriteOrderKey: DynamoKeyAttributeSchema.orderKey.nullable(),
        // Include the `entityId` in the index sort keys so if two items have the same
        // `favoriteOrderKey` we'll still get consistent ordering.
        entityId: SearchAffinityEntityIdDynamoKeyAttributeSchema,
    },
    // Only include favorited items in this index.
    filter: item => typeof item.favoriteOrderKey === "string",
});

export function getSearchEntityTableForTest() {
    assert(import.meta.jest);
    return SearchEntityTable;
}
