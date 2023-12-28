import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchEntityAffinityId} from "~/shared/search/search_entity_affinity_id.js";
import {SearchEntityAffinityInteraction} from "~/shared/search/search_entity_affinity_interaction.js";

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
                    name: "SearchEntityAffinity",
                    sortKeyAttributes: {
                        entityId:
                            DynamoKeyAttributeSchema.labelString as DynamoKeyAttributeSchema<SearchEntityAffinityId>,
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
                         * See `getSearchEntityAffinityPointsBucket()`.
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
export function getSearchEntityAffinityPointsBucket(points: number): number {
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
 * Our function is `f(t) = e^-t` where `t` is measured in months. This function
 * will decay 1 point to 0.05 (which we round down to 0) in 3 months.
 */
export function getCurrentSearchEntityAccountAffinityPoints(
    currentTime: number,
    {points, lastUpdatedTime}: {points: number; lastUpdatedTime: number},
): number {
    const elapsedTime = currentTime - lastUpdatedTime;

    return points * Math.exp(-(elapsedTime / monthDurationMs));
}

/**
 * Return the time in milliseconds for `points` to decay to 0.05 (which we
 * round down to 0). We set an expiration time on our item with this number.
 */
export function getSearchEntityAccountAffinityExpirationDuration(points: number): number {
    // Any number less than this is negative.
    assert(points > 0.05);

    return Math.log(points / 0.05) * monthDurationMs;
}

/**
 * Add some points to an account's affinity score for an entity. 1 point will
 * decay to 0 after 3 months (more accurately, 90 days).
 *
 * We don't let you directly pass in a point number. Instead you must pass in a
 * `SearchEntityAffinityInteraction` object. This interaction object abstracts
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
export function markSearchEntityAffinityInteraction(
    context: ServerSessionActionContext,
    {
        spaceId,
        entityId,
        interaction,
    }: {
        spaceId: SpaceId;
        entityId: SearchEntityAffinityId;
        interaction: SearchEntityAffinityInteraction;
    },
) {
    let points: number;
    switch (interaction.type) {
        case "View": {
            points = 1;
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

    return addSearchEntityAffinityPoints(context, {
        spaceId,
        entityId,
        points,
    });
}

async function addSearchEntityAffinityPoints(
    context: ServerSessionActionContext,
    {
        spaceId,
        entityId,
        points,
    }: {
        spaceId: SpaceId;
        entityId: SearchEntityAffinityId;
        points: number;
    },
) {
    // Optimization: We don't authorize whether the actor has access to the entity.
    // Since this is a personal score it doesn't really matter if the user gives
    // themselves affinity points to an entity they don't have access to.

    const currentTime = Date.now();

    await SearchEntityTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "SearchEntityAffinity",
            spaceId,
            accountId: context.actor.getAccountId(),
            entityId,
        },
        affinityItem => {
            let newPoints = affinityItem
                ? getCurrentSearchEntityAccountAffinityPoints(currentTime, affinityItem)
                : 0;

            newPoints += points;

            const expirationDuration = Math.ceil(
                getSearchEntityAccountAffinityExpirationDuration(newPoints),
            );
            const expirationTime = new Date(currentTime + expirationDuration);

            const newPointsBucket = getSearchEntityAffinityPointsBucket(newPoints);

            return {
                ...affinityItem,
                partitionType: "Account",
                sortRangeType: "SearchEntityAffinity",
                spaceId,
                accountId: context.actor.getAccountId(),
                entityId,
                points: newPoints,
                pointsBucket: newPointsBucket,
                lastUpdatedTime: currentTime,
                expirationTime,
            };
        },
    );
}

/**
 * We iterate through the `AccountAffinitiveSearchEntitiesIndex` index until we
 * see the points bucket change. Instead of reading the max 1 MB DynamoDB page
 * read 100 items at a time and we'll interrupt pagination once we have the
 * data we need.
 *
 * Worst-case we may need to iterate through all account affinity items.
 */
export const accountAffinitiveSearchEntitiesQueryPageLimit = 100;

export const getAffinitiveSearchEntityIdsEarlyReturnTestCounter = new TestCounter<AccountId>();

/**
 * Get `SearchEntityId`s that are meaningful to the actor.
 *
 * In theory, affinities are always getting exponentially smaller but we store
 * items that represent a snapshot of the points value in time. We sort our
 * DynamoDB index based on point buckets. However, the item's position in our
 * index might be lower as the item's points have decayed. An item may be lower
 * in our index but will never be higher. So we need to search enough of our
 * index to be confident we actually have the top affinitive entities.
 *
 * Labeled "internal" since you should be calling
 * `getAffinitiveSearchEntities()`. This function returns affinitive entities
 * along with extra information about them like the entity's title. This
 * function also doesn't filter out entities the account has lost access to!
 * While this function isn't unsafe with regards to permissions (it's fine to
 * know the `SearchEntityId` of something you used to have access to) it isn't
 * the most convenient function.
 */
export async function internalGetAffinitiveSearchEntityIds(
    context: ServerSessionActionContext,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<
    Array<{
        entityId: SearchEntityAffinityId;
        points: number;
    }>
> {
    await authorizeSpaceAccess(context, spaceId);

    const accountId = context.actor.getAccountId();
    const currentTime = Date.now();
    let lastIterationPointsBucket: number | null = null;

    const candidateItems: Array<{
        entityId: SearchEntityAffinityId;
        points: number;
        pointsBucket: number;
    }> = [];

    for await (const item of AccountAffinitiveSearchEntitiesIndex.query(context, {
        partitionKey: {
            accountId,
            spaceId,
        },
        descending: true,
        limit: "All",
        pageLimit: accountAffinitiveSearchEntitiesQueryPageLimit,
    })) {
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
                getAffinitiveSearchEntityIdsEarlyReturnTestCounter.incrementForTest(accountId);
                return candidateItems.slice(0, limit);
            }
        }

        lastIterationPointsBucket = item.pointsBucket;

        const currentPoints = getCurrentSearchEntityAccountAffinityPoints(currentTime, item);
        const currentPointsBucket = getSearchEntityAffinityPointsBucket(currentPoints);

        candidateItems.push({
            entityId: item.entityId,
            points: currentPoints,
            pointsBucket: currentPointsBucket,
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
                        await SearchEntityTable.deleteItem(context, item);
                    } else {
                        await SearchEntityTable.directlyUpdateItem(context, {
                            ...item,
                            points: currentPoints,
                            pointsBucket: currentPointsBucket,
                            lastUpdatedTime: currentTime,
                            expirationTime: new Date(
                                currentTime +
                                    getSearchEntityAccountAffinityExpirationDuration(currentPoints),
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
