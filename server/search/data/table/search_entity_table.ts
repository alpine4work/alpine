import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {Id, assertId} from "~/shared/id/id.js";
import {AccountId, ChannelId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchAffinityId} from "~/shared/search/search_affinity_id.js";
import {SearchAffinityInteraction} from "~/shared/search/search_affinity_interaction.js";

const SearchEntityTable = DynamoTableSchema.new({
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
                    // `SearchAffinity` instead of `SearchEntityAffinity` but can't rename since
                    // data is already stored in the database with this sort range type.
                    name: "SearchEntityAffinity",
                    sortKeyAttributes: {
                        // NOTE(calebmer, 2024-03-19): Would love to rename this attribute `affinityId`
                        // instead of `entityId` but can't rename since data is already stored in the
                        // database with this key name.
                        entityId:
                            DynamoKeyAttributeSchema.labelString as DynamoKeyAttributeSchema<SearchAffinityId>,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        /**
                         * The number of affinity points this account has.
                         */
                        points: Schema.float,

                        /**
                         * The bucket this affinity item falls into. We place affinity scores in
                         * buckets for better query performance so we only need to query entities
                         * with the highest affinity scores.
                         *
                         * See `getSearchAffinityPointsBucket()`.
                         */
                        pointsBucket: Schema.integer,

                        /**
                         * The last time we updated `points`. Used to determine how much decay we need
                         * to apply to `points`.
                         */
                        lastUpdatedTime: Schema.integer,

                        /**
                         * The last time this search entity was viewed. Useful for showing the user a
                         * "last opened" date.
                         */
                        lastViewedTime: Schema.date.nullable().default(null),
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
                         * The bucket this affinity item falls into. We place affinity scores in
                         * buckets for better query performance so we only need to query entities
                         * with the highest affinity scores.
                         *
                         * See `getSearchAffinityPointsBucket()`.
                         */
                        pointsBucket: Schema.integer,

                        /**
                         * The last time we updated `points`. Used to determine how much decay we need
                         * to apply to `points`.
                         */
                        lastUpdatedTime: Schema.integer,
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
                         * The bucket this affinity item falls into. We place affinity scores in
                         * buckets for better query performance so we only need to query entities
                         * with the highest affinity scores.
                         *
                         * See `getSearchAffinityPointsBucket()`.
                         */
                        pointsBucket: Schema.integer,

                        /**
                         * The last time we updated `points`. Used to determine how much decay we need
                         * to apply to `points`.
                         */
                        lastUpdatedTime: Schema.integer,
                    }),
                },
            ],
        },
    ],
});

// NOTE(calebmer, 2024-03-19): Would love to rename this sort range
// `AccountSearchAffinity` instead of `AccountAffinitiveSearchEntities` but
// can't rename since data is already stored in the database with this sort
// range type.
const AccountAffinitiveSearchEntitiesIndex = SearchEntityTable.addExpensiveFullIndex({
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

const SpaceChannelsSearchAffinityIndex = SearchEntityTable.addExpensiveFullIndex({
    name: "SpaceChannelsSearchAffinity",
    itemTypes: [{partitionType: "SpaceChannels", sortRangeType: "SearchAffinity"}],
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
    },
    sortKeyAttributes: {
        pointsBucket: DynamoKeyAttributeSchema.integer,
    },
});

const SpaceTaskCollectionsSearchAffinityIndex = SearchEntityTable.addExpensiveFullIndex({
    name: "SpaceTaskCollectionsSearchAffinity",
    itemTypes: [{partitionType: "SpaceTaskCollections", sortRangeType: "SearchAffinity"}],
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
    },
    sortKeyAttributes: {
        pointsBucket: DynamoKeyAttributeSchema.integer,
    },
});

export function getSearchEntityTableForTest() {
    assert(import.meta.jest);
    return SearchEntityTable;
}

/**
 * Get the bucket our affinity points fall into. We have more buckets near the
 * lower end of the points distribution since it represents items experiencing
 * a slow death.
 *
 * We want to make sure an entity doesn't change buckets too often (since that
 * increases write costs) while still having small enough buckets that are
 * efficient to query (to decrease read costs).
 */
export function getSearchAffinityPointsBucket(points: number): number {
    if (points < 1) return 0;
    if (points < 3) return 1;
    if (points < 5) return 3;
    return Math.floor(points / 5) * 5;
}

/**
 * 30 days (~1 month) in milliseconds
 */
export const monthDurationMs = 1000 * 60 * 60 * 24 * 30;

/**
 * Apply our exponential decay function to figure out how many affinity points
 * we currently have.
 *
 * Our function is `f(t) = e^-3t` where `t` is measured in months. This function
 * will decay 1 point to 0.05 (which we round down to 0) in 1 months.
 */
export function getCurrentSearchAffinityPoints(
    currentTime: number,
    {points, lastUpdatedTime}: {points: number; lastUpdatedTime: number},
): number {
    const elapsedTime = currentTime - lastUpdatedTime;

    return points * Math.exp(-(3 * (elapsedTime / monthDurationMs)));
}

/**
 * Return the time in milliseconds for `points` to decay to 0.05 (which we
 * round down to 0). We set an expiration time on our item with this number.
 */
export function getSearchAffinityExpirationDuration(points: number): number {
    // Any number less than this is negative.
    assert(points > 0.05);

    return Math.log(points / 0.05) * monthDurationMs;
}

/**
 * Add some points to an account's affinity score for an entity. 1 point will
 * decay to 0 after 3 months (more accurately, 90 days).
 *
 * We don't let you directly pass in a point number. Instead you must pass in a
 * `SearchAffinityInteraction` object. This interaction object abstracts
 * away the point count so the caller only needs to think about what kind of
 * interaction it was, not the right point total relative to all other point
 * counts.
 *
 * Sometimes this function is called from the server. Sometimes this function
 * is called from the client. It doesn't really matter. Wherever is more
 * convenient is fine. Usually, calling this function after an update on the
 * server is most convenient since you guarantee an affinity update after the
 * actual database update. However, sometimes it's useful to throttle calls to
 * this function (e.g. typing in a document) which is easiest to do on
 * the client.
 */
// TODO(calebmer): I wonder if we should add a "mobile multiplier" to some of
// these interactions. Since all of these interactions are harder to do on
// mobile that must mean it's worth more to the user?
export function markSearchAffinityInteraction(
    context: ServerSessionActionContext,
    {
        spaceId,
        affinityId,
        interaction,
    }: {
        spaceId: SpaceId;
        affinityId: SearchAffinityId;
        interaction: SearchAffinityInteraction;
    },
) {
    let points: number;
    switch (interaction.type) {
        case "View": {
            points = 1;
            break;
        }
        case "VeryLowIntentUpdate": {
            points = 0.0625;
            break;
        }
        case "LowIntentUpdate": {
            points = 0.2;
            break;
        }
        case "MediumIntentUpdate": {
            points = 1;
            break;
        }
        case "HighIntentUpdate": {
            points = 3;
            break;
        }
        default:
            throw exhaustive(interaction);
    }

    return addSearchAffinityPoints(context, {
        spaceId,
        affinityId,
        points,
        isViewInteraction: interaction.type === "View",
    });
}

async function addSearchAffinityPoints(
    context: ServerSessionActionContext,
    {
        spaceId,
        affinityId,
        points,
        isViewInteraction,
    }: {
        spaceId: SpaceId;
        affinityId: SearchAffinityId;
        points: number;
        isViewInteraction: boolean;
    },
) {
    // Optimization: We don't authorize whether the actor has access to the entity.
    // Since this is a personal score it doesn't really matter if the user gives
    // themselves affinity points to an entity they don't have access to.

    const currentTime = Date.now();

    const channelId = affinityId.startsWith("Channel:")
        ? assertId<ChannelId>(affinityId.slice(8))
        : null;
    const collectionId = affinityId.startsWith("TaskCollection:")
        ? assertId<TaskCollectionId>(affinityId.slice(15))
        : null;

    await runAllPromises([
        SearchEntityTable.updateItem(
            context,
            {
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId,
                accountId: context.actor.getAccountId(),
                entityId: affinityId,
            },
            affinityItem => {
                let newPoints = affinityItem
                    ? getCurrentSearchAffinityPoints(currentTime, affinityItem)
                    : 0;

                newPoints += points;

                const expirationDuration = Math.ceil(
                    getSearchAffinityExpirationDuration(newPoints),
                );
                const expirationTime = new Date(currentTime + expirationDuration);

                const newPointsBucket = getSearchAffinityPointsBucket(newPoints);

                return {
                    ...affinityItem,
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                    entityId: affinityId,
                    points: newPoints,
                    pointsBucket: newPointsBucket,
                    lastUpdatedTime: currentTime,
                    lastViewedTime: isViewInteraction
                        ? new Date(currentTime)
                        : affinityItem?.lastViewedTime ?? null,
                    expirationTime,
                };
            },
        ),

        // We maintain a space-wide affinity list for channels. So when a user is
        // selecting a channel to post in we have a good recommended list of channels.
        //
        // View interactions don't contribute to the space-wide channel affinity list.
        // Since viewing a channel is personal and not observable by others. If a user
        // reads every post in a channel over the course of a couple hours, that isn't
        // good signal that the channel will be useful to everyone in the organization.
        channelId && !isViewInteraction
            ? SearchEntityTable.updateItem(
                  context,
                  {
                      partitionType: "SpaceChannels",
                      sortRangeType: "SearchAffinity",
                      spaceId,
                      channelId,
                  },
                  affinityItem => {
                      let newPoints = affinityItem
                          ? getCurrentSearchAffinityPoints(currentTime, affinityItem)
                          : 0;

                      newPoints += points;

                      const expirationDuration = Math.ceil(
                          getSearchAffinityExpirationDuration(newPoints),
                      );
                      const expirationTime = new Date(currentTime + expirationDuration);

                      const newPointsBucket = getSearchAffinityPointsBucket(newPoints);

                      return {
                          ...affinityItem,
                          partitionType: "SpaceChannels",
                          sortRangeType: "SearchAffinity",
                          spaceId,
                          accountId: context.actor.getAccountId(),
                          channelId,
                          points: newPoints,
                          pointsBucket: newPointsBucket,
                          lastUpdatedTime: currentTime,
                          expirationTime,
                      };
                  },
              )
            : null,

        // We maintain a space-wide affinity list for task collections. So when a user
        // is selecting collections for their tasks we have a good recommended list of
        // collections.
        //
        // View interactions don't contribute to the space-wide task collection
        // affinity list.
        collectionId && !isViewInteraction
            ? SearchEntityTable.updateItem(
                  context,
                  {
                      partitionType: "SpaceTaskCollections",
                      sortRangeType: "SearchAffinity",
                      spaceId,
                      collectionId,
                  },
                  affinityItem => {
                      let newPoints = affinityItem
                          ? getCurrentSearchAffinityPoints(currentTime, affinityItem)
                          : 0;

                      newPoints += points;

                      const expirationDuration = Math.ceil(
                          getSearchAffinityExpirationDuration(newPoints),
                      );
                      const expirationTime = new Date(currentTime + expirationDuration);

                      const newPointsBucket = getSearchAffinityPointsBucket(newPoints);

                      return {
                          ...affinityItem,
                          partitionType: "SpaceTaskCollections",
                          sortRangeType: "SearchAffinity",
                          spaceId,
                          accountId: context.actor.getAccountId(),
                          collectionId,
                          points: newPoints,
                          pointsBucket: newPointsBucket,
                          lastUpdatedTime: currentTime,
                          expirationTime,
                      };
                  },
              )
            : null,
    ]);
}

/**
 * We iterate through the `AccountAffinitiveSearchEntitiesIndex` index until we
 * see the points bucket change. Instead of reading the max 1 MB DynamoDB page
 * read 100 items at a time and we'll interrupt pagination once we have the
 * data we need.
 *
 * Worst-case we may need to iterate through all account affinity items.
 */
export const searchAffinityQueryPageLimit = 100;

export const getSearchAffinitiesEarlyReturnTestCounter = new TestCounter<AccountId>();

/**
 * Get `SearchEntityId`s that are meaningful to the actor.
 *
 * Labeled "internal" since you should be calling `searchByAffinity()`. This
 * function returns affinitive entities along with extra information about them
 * like the entity's title. This function also doesn't filter out entities the
 * account has lost access to! While this function isn't unsafe with regards to
 * permissions (it's fine to know the `SearchEntityId` of something you used to
 * have access to) it isn't the most convenient function.
 */
export async function internalGetSearchAffinities(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<{
        affinityId: SearchAffinityId;
        points: number;
        lastViewedTime: Date | null;
    }>
> {
    const accountId = context.actor.getAccountId();

    const results = await internalGetSearchAffinitiesBase(context, {
        spaceId,
        limit,
        queryItems: () =>
            AccountAffinitiveSearchEntitiesIndex.query(context, {
                partitionKey: {
                    accountId,
                    spaceId,
                },
                descending: true,
                limit: "All",
                pageLimit: searchAffinityQueryPageLimit,
            }),
        deleteItem: item => SearchEntityTable.deleteItem(context, item),
        directlyUpdateItem: (item, newAttributes) =>
            SearchEntityTable.directlyUpdateItem(context, {...item, ...newAttributes}),
    });

    return results.map(result => ({
        affinityId: result.item.entityId,
        points: result.points,
        lastViewedTime: result.item.lastViewedTime,
    }));
}

/**
 * Get `ChannelId`s that are meaningful in the provided space.
 *
 * Labeled "internal" and "dangerous" since we don't do any filtering that the
 * channel still exists or the actor has access. It would be bad to give the
 * user a list of `ChannelId`s they don't have access to! While they couldn't
 * do anything with those `ChannelId`s (they couldn't open it via URL, they'd
 * get a `PermissionDeniedError`) an attacker may be able to use information
 * about popular private channels to infer something they shouldn't know.
 */
export async function internalDangerouslyGetSpaceChannelSearchAffinities(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<{
        points: number;
        item: {channelId: ChannelId};
    }>
> {
    return internalGetSearchAffinitiesBase(context, {
        spaceId,
        limit,
        queryItems: () =>
            SpaceChannelsSearchAffinityIndex.query(context, {
                partitionKey: {spaceId},
                descending: true,
                limit: "All",
                pageLimit: searchAffinityQueryPageLimit,
            }),
        deleteItem: item => SearchEntityTable.deleteItem(context, item),
        directlyUpdateItem: (item, newAttributes) =>
            SearchEntityTable.directlyUpdateItem(context, {...item, ...newAttributes}),
    });
}

/**
 * Get `TaskCollectionId`s that are meaningful in the provided space.
 *
 * Labeled "internal" and "dangerous" since we don't do any filtering that the
 * collection still exists or the actor has access. It would be bad to give the
 * user a list of `TaskCollectionId`s they don't have access to! While they
 * couldn't do anything with those `TaskCollectionId`s (they couldn't open it
 * via URL, they'd get a `PermissionDeniedError`) an attacker may be able to
 * use information about popular private collections to infer something they
 * shouldn't know.
 */
export async function internalDangerouslyGetSpaceTaskCollectionSearchAffinities(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<{
        points: number;
        item: {collectionId: TaskCollectionId};
    }>
> {
    return internalGetSearchAffinitiesBase(context, {
        spaceId,
        limit,
        queryItems: () =>
            SpaceTaskCollectionsSearchAffinityIndex.query(context, {
                partitionKey: {spaceId},
                descending: true,
                limit: "All",
                pageLimit: searchAffinityQueryPageLimit,
            }),
        deleteItem: item => SearchEntityTable.deleteItem(context, item),
        directlyUpdateItem: (item, newAttributes) =>
            SearchEntityTable.directlyUpdateItem(context, {...item, ...newAttributes}),
    });
}

/**
 * Base function for reading a search affinity index.
 *
 * In theory, affinities are always getting exponentially smaller but we store
 * items that represent a snapshot of the points value in time. We sort our
 * DynamoDB index based on point buckets. However, the item's position in our
 * index might be lower as the item's points have decayed. An item may be lower
 * in our index but will never be higher. So we need to search enough of our
 * index to be confident we actually have the top affinitive entities.
 */
async function internalGetSearchAffinitiesBase<
    Item extends {
        points: number;
        pointsBucket: number;
        lastUpdatedTime: number;
    },
>(
    context: ServerSessionActionContext,
    {
        spaceId,
        limit,
        queryItems,
        deleteItem,
        directlyUpdateItem,
    }: {
        spaceId: SpaceId;
        limit: number;
        queryItems: () => AsyncIterableIterator<Item>;
        deleteItem: (item: Item) => Promise<void>;
        directlyUpdateItem: (
            item: Item,
            newAttributes: {
                points: number;
                pointsBucket: number;
                lastUpdatedTime: number;
                expirationTime: Date;
            },
        ) => Promise<void>;
    },
): Promise<
    Array<{
        points: number;
        item: Item;
    }>
> {
    await authorizeSpaceAccess(context, spaceId);

    const accountId = context.actor.getAccountId();
    const currentTime = Date.now();
    let lastIterationPointsBucket: number | null = null;

    const candidateItems: Array<{
        points: number;
        pointsBucket: number;
        item: Item;
    }> = [];

    for await (const item of queryItems()) {
        // When iteration enters a new `pointsBucket` check if we can return...
        if (
            lastIterationPointsBucket !== null &&
            lastIterationPointsBucket !== item.pointsBucket &&
            candidateItems.length >= limit
        ) {
            candidateItems.sort((a, b) => b.points - a.points);

            const limitCandidateItem = candidateItems[limit - 1]!;

            // If we've entered a point bucket that's smaller than the last candidate item
            // we'd return for `limit` (`limitCandidateItem`) then we know even if we
            // continued iterating to the end of the account's affinities we won't find
            // items with a higher score than `limitCandidateItem`. So we can return!
            if (limitCandidateItem.pointsBucket > item.pointsBucket) {
                getSearchAffinitiesEarlyReturnTestCounter.incrementForTest(accountId);
                return candidateItems.slice(0, limit);
            }
        }

        lastIterationPointsBucket = item.pointsBucket;

        const currentPoints = getCurrentSearchAffinityPoints(currentTime, item);
        const currentPointsBucket = getSearchAffinityPointsBucket(currentPoints);

        candidateItems.push({
            points: currentPoints,
            pointsBucket: currentPointsBucket,
            item,
        });

        // If the item moved buckets and hasn't been updated in half a month, then
        // update the item in DynamoDB to its current bucket location. This helps keep
        // this function efficient as account affinities are kept roughly sorted in the
        // database.
        if (
            currentPointsBucket !== item.pointsBucket &&
            currentTime - item.lastUpdatedTime > monthDurationMs / 2
        ) {
            context.process.waitUntil(async () => {
                try {
                    if (currentPoints <= 0.05) {
                        await deleteItem(item);
                    } else {
                        await directlyUpdateItem(item, {
                            points: currentPoints,
                            pointsBucket: currentPointsBucket,
                            lastUpdatedTime: currentTime,
                            expirationTime: new Date(
                                currentTime + getSearchAffinityExpirationDuration(currentPoints),
                            ),
                        });
                    }
                } catch (error) {
                    // If a concurrent writer updated the item before we could, don't bother
                    // retrying. The writer should have updated points to the current time for us.
                    if (isDynamoConditionCheckError(error)) return;

                    throw error;
                }
            });
        }
    }

    candidateItems.sort((a, b) => b.points - a.points);
    return candidateItems.slice(0, limit);
}

type GetSearchEntityAffinityIdType<
    SearchAffinityIdType extends SearchAffinityId,
    IdType extends Id,
> = SearchAffinityIdType extends `${infer AffinityType}:${IdType}` ? AffinityType : never;

async function querySessionActorSearchEntityAffinities<IdType extends Id>(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    affinityType: GetSearchEntityAffinityIdType<SearchAffinityId, IdType>,
): Promise<Array<IdType>> {
    const currentTime = Date.now();

    const items = await arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            SearchEntityTable.query(context, {
                partitionKey: {
                    partitionType: "Account",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                },
                startSortKey: {
                    sortRangeType: "SearchEntityAffinity",
                    entityId:
                        `${affinityType}:${DynamoKeyAttributeSchema.id.getMinValue<IdType>()}` as SearchAffinityId,
                },
                endSortKey: {
                    sortRangeType: "SearchEntityAffinity",
                    entityId:
                        `${affinityType}:${DynamoKeyAttributeSchema.id.getMaxValue<IdType>()}` as SearchAffinityId,
                },
                limit: "All",
            }),
            item => ({
                entityId: item.entityId,
                points: getCurrentSearchAffinityPoints(currentTime, item),
            }),
        ),
    );

    items.sort((a, b) => b.points - a.points);

    // NOTE(calebmer): We don't delete items below 0.05 points or update items that
    // moved point buckets in this function. That's because the DynamoDB TTL should
    // automatically expire items (so we don't have to) and the points bucket
    // doesn't matter for the performance of this function. So spare the points
    // bucket update cost.
    return items.map(item => item.entityId.slice(affinityType.length + 1) as IdType);
}

/**
 * Get all accounts our actor has an affinity for sorted by affinity score in
 * the context of a space. We display accounts in this order when the user goes
 * to mention someone or send a message.
 *
 * `AccountId`s in the returned array may no longer be a part of the space.
 * Hence the name "possibly stale".
 */
export async function getPossiblyStaleAccountSearchAffinityIds(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<Array<AccountId>> {
    return querySessionActorSearchEntityAffinities<AccountId>(context, spaceId, "Account");
}

/**
 * Get all channels our actor has an affinity for sorted by affinity score in
 * the context of a space. We display channels in this order when the user is
 * selecting a channel to post in.
 *
 * The actor may not have access to all returned `ChannelId`s. They probably
 * had access at some point in time in order to collect affinity points but you
 * need to make sure the actor currently has access before returning
 * `ChannelId`s to them. Hence the name "possibly stale".
 */
export async function getPossiblyStaleChannelSearchAffinityIds(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<Array<ChannelId>> {
    return querySessionActorSearchEntityAffinities<ChannelId>(context, spaceId, "Channel");
}

/**
 * Get all task collections our actor has an affinity for sorted by affinity
 * score. We display collections in this order when the user is selecting a
 * collection for a task.
 *
 * The actor may not have access to all returned `TaskCollectionId`s. They
 * probably had access at some point in time in order to collect affinity
 * points but you need to make sure the actor currently has access before
 * returning `TaskCollectionId`s to them. Hence the name "possibly stale".
 */
export async function getPossiblyStaleTaskCollectionSearchAffinityIds(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<Array<TaskCollectionId>> {
    return querySessionActorSearchEntityAffinities<TaskCollectionId>(
        context,
        spaceId,
        "TaskCollection",
    );
}
