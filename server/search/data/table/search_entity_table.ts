import {
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
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
import {
    AccountId,
    ChannelId,
    DocumentId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
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
                         * The last time this search entity had a "view" search affinity interaction
                         * viewed. Useful for showing the user a "last opened" date.
                         */
                        lastViewedTime: Schema.date.nullable().default(null),

                        /**
                         * If this is a task search entity that's been marked as active and the account
                         * is assigned to the task then we add a bunch of points to rocket the task to
                         * the top of the search affinity list. Once the task is no longer active, we
                         * remove any points from that initial boost (after applying decay).
                         *
                         * This object will be set if we've applied the active task assignee boost to
                         * make sure we only apply the boost once.
                         *
                         * The object records the number of points we applied to boost the task (in
                         * case we change the amount of points) and the time at which the boost was
                         * applied so we can undo the boost later.
                         */
                        activeTaskAssignee: Schema.object({
                            points: Schema.float,
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
 * 30 days (~1 month) in milliseconds.
 */
export const monthDurationMs = 1000 * 60 * 60 * 24 * 30;

const searchAffinityExpirationPoints = 0.05;

/**
 * The number of points to add to a task's search affinity score for the task
 * assignee when the task is marked as active. We want active tasks to be at
 * the top of the task assignee's affinity list for a week or so. Since setting
 * a task to "active" is one of the highest signals we have that an entity is
 * currently important to a user.
 *
 * We want the task to be at the very top of a user's affinity list for about
 * a week and then in the top five in the second week. As of 2025-02-21 the
 * points of the top five entities in my (@calebmer's) search affinity list
 * are 71.47, 67.26, 51.62, 42.65, and 36.91. So after seven days this point
 * value needs to decay to something still over 71.47.
 *
 * 150 fits this criteria:
 *
 * - After  7 days it's 74.49
 * - After 14 days it's 36.99
 * - After 30 days it's  7.50
 */
const searchAffinityActiveTaskAssigneePoints = 150;

/**
 * The number of points to add to a document's search affinity score when the
 * document is first created. We want documents to be at the top of the
 * document creator's affinity list for two to three days. So the creator can
 * easily get back to the documents they just created.
 *
 * As of 2025-02-21 the points of the top five entities in my (@calebmer's)
 * search affinity list are 71.47, 67.26, 51.62, 42.65, and 36.91. So after
 * three days this point value needs to decay to something between 71.47 and
 * 42.65.
 *
 * 60 fits this criteria:
 *
 * - After  1 day  it's 54.29
 * - After  2 days it's 49.12
 * - After  3 days it's 44.45
 * - After  7 days it's 29.80
 * - After 14 days it's 14.80
 * - After 30 days it's  3.00
 */
const searchAffinityDocumentCreatorPoints = 60;

/**
 * Apply our exponential decay function to figure out how many affinity points
 * we currently have.
 *
 * Our function is `f(t) = e^-3t` where `t` is measured in months. This function
 * will decay 1 point to 0.05 (which we round down to 0) in 1 month.
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
    assert(points > searchAffinityExpirationPoints);

    return Math.log(points / searchAffinityExpirationPoints) * monthDurationMs;
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

/**
 * Same as `markSearchAffinityInteraction()` but for a special "create
 * document" interaction. This interaction may only be performed on the server
 * as it adds a lot of points we don't want the client to be able to add.
 */
export function markSearchAffinityCreateDocumentInteraction(
    context: ServerSessionActionContext,
    {
        spaceId,
        documentId,
    }: {
        spaceId: SpaceId;
        documentId: DocumentId;
    },
) {
    return addSearchAffinityPoints(context, {
        spaceId,
        affinityId: `Document:${documentId}`,
        points: searchAffinityDocumentCreatorPoints,
        isViewInteraction: false,
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
 * Adds a boost of search affinity points when a task is marked as active. This
 * should boost the task to the top of the account's search affinity list where
 * the task should stay for a while. This way whenever a user sees their search
 * affinity list, they're reminded of the tasks they're currently working on.
 * Without needing to open the task product.
 *
 * This function is idempotent. You may call it multiple times and we'll only
 * apply the boost once.
 *
 * You must call this function with a system actor since it may update search
 * affinity points on behalf of another user.
 */
export async function addSearchAffinityActiveTaskAssigneePoints(
    context: ServerSystemActionContext,
    {
        spaceId,
        assigneeId,
        taskId,
    }: {
        spaceId: SpaceId;
        assigneeId: AccountId;
        taskId: TaskId;
    },
) {
    // A system actor is required since we may be updating search affinity on
    // behalf of a user other than the one making the action. So we need a trusted
    // actor. For example, your manager may mark a task assigned to you as active
    // on your behalf.
    //
    // If Alice (a malicious user) tries to get Bob's attention by assigning them
    // to a task and setting it as active then Bob can simply unassign themselves
    // to remove the task from the top of their affinity list. This makes adding
    // affinity points to the assignee of an active task no more harmful then
    // sending a notification after an @ mention (which can be dismissed).
    context.actor.authorizeSystem();

    const currentTime = Date.now();

    await context.dynamo.retryTransaction(async context => {
        const item = await SearchEntityTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "SearchEntityAffinity",
            spaceId,
            accountId: assigneeId,
            entityId: `Task:${taskId}`,
        });

        const pointsIncrement = searchAffinityActiveTaskAssigneePoints;

        const points =
            (item ? getCurrentSearchAffinityPoints(currentTime, item) : 0) + pointsIncrement;

        if (!item) {
            await SearchEntityTable.createItem(
                context,
                {
                    partitionType: "Account",
                    sortRangeType: "SearchEntityAffinity",
                    spaceId,
                    accountId: assigneeId,
                    entityId: `Task:${taskId}`,
                    points,
                    pointsBucket: getSearchAffinityPointsBucket(points),
                    lastUpdatedTime: currentTime,
                    lastViewedTime: null,
                    expirationTime: new Date(
                        currentTime + Math.ceil(getSearchAffinityExpirationDuration(points)),
                    ),
                    activeTaskAssignee: {
                        points: pointsIncrement,
                        lastUpdatedTime: currentTime,
                    },
                },
                {isConditionCheckErrorRetriable: true},
            );
        } else if (item.activeTaskAssignee) {
            // If the item already has active task assignee points, make sure with a
            // [serializable isolation level][1] that the item version number is exactly
            // what we read. This makes sure our eventually consistent read didn't see an
            // outdated item.
            //
            // [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-isolation
            await DynamoTableSchema.executeTransaction(context, [
                SearchEntityTable.transactionUpdateLockVersionConditionCheck(
                    {
                        partitionType: "Account",
                        sortRangeType: "SearchEntityAffinity",
                        spaceId,
                        accountId: assigneeId,
                        entityId: `Task:${taskId}`,
                    },
                    item.updateLockVersion,
                ),
            ]);
        } else {
            await SearchEntityTable.directlyUpdateItem(context, {
                ...item,
                points,
                pointsBucket: getSearchAffinityPointsBucket(points),
                lastUpdatedTime: currentTime,
                expirationTime: new Date(
                    currentTime + Math.ceil(getSearchAffinityExpirationDuration(points)),
                ),
                activeTaskAssignee: {
                    points: pointsIncrement,
                    lastUpdatedTime: currentTime,
                },
            });
        }
    });
}

/**
 * Removes points from the boost provided by
 * `addSearchAffinityActiveTaskAssigneePoints()` when a task is marked as
 * inactive. This will set the search affinity item to the number of points it
 * would have if the item were never boosted in the first place.
 *
 * This function is idempotent. You may call it multiple times and we'll only
 * apply the boost once.
 *
 * You must call this function with a system actor since it may update search
 * affinity points on behalf of another user.
 */
export async function removeSearchAffinityActiveTaskAssigneePoints(
    context: ServerSystemActionContext,
    {
        spaceId,
        assigneeId,
        taskId,
    }: {
        spaceId: SpaceId;
        assigneeId: AccountId;
        taskId: TaskId;
    },
) {
    // A system actor is required since we may be updating search affinity on
    // behalf of a user other than the one making the action. So we need a trusted
    // actor. For example, your manager may mark a task assigned to you as active
    // on your behalf.
    //
    // If Alice (a malicious user) tries to get Bob's attention by assigning them
    // to a task and setting it as active then Bob can simply unassign themselves
    // to remove the task from the top of their affinity list. This makes adding
    // affinity points to the assignee of an active task no more harmful then
    // sending a notification after an @ mention (which can be dismissed).
    context.actor.authorizeSystem();

    const currentTime = Date.now();

    await context.dynamo.retryTransaction(async context => {
        const item = await SearchEntityTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "SearchEntityAffinity",
            spaceId,
            accountId: assigneeId,
            entityId: `Task:${taskId}`,
        });

        if (!item?.activeTaskAssignee) {
            // If the item already has active task assignee points, make sure with a
            // [serializable isolation level][1] that the item version number is exactly
            // what we read. This makes sure our eventually consistent read didn't see an
            // outdated item.
            //
            // [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-isolation
            await DynamoTableSchema.executeTransaction(context, [
                item
                    ? SearchEntityTable.transactionUpdateLockVersionConditionCheck(
                          {
                              partitionType: "Account",
                              sortRangeType: "SearchEntityAffinity",
                              spaceId,
                              accountId: assigneeId,
                              entityId: `Task:${taskId}`,
                          },
                          item.updateLockVersion,
                      )
                    : SearchEntityTable.transactionDoesNotExistConditionCheck({
                          partitionType: "Account",
                          sortRangeType: "SearchEntityAffinity",
                          spaceId,
                          accountId: assigneeId,
                          entityId: `Task:${taskId}`,
                      }),
            ]);
        } else {
            const points =
                getCurrentSearchAffinityPoints(currentTime, item) -
                getCurrentSearchAffinityPoints(currentTime, item.activeTaskAssignee);

            if (points <= searchAffinityExpirationPoints) {
                await SearchEntityTable.deleteItem(context, item);
            } else {
                await SearchEntityTable.directlyUpdateItem(context, {
                    ...item,
                    points,
                    pointsBucket: getSearchAffinityPointsBucket(points),
                    lastUpdatedTime: currentTime,
                    expirationTime: new Date(
                        currentTime + Math.ceil(getSearchAffinityExpirationDuration(points)),
                    ),
                    activeTaskAssignee: undefined,
                });
            }
        }
    });
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
        ) => Promise<unknown>;
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
                    if (currentPoints <= searchAffinityExpirationPoints) {
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
