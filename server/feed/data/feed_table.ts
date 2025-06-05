import {compareDesc} from "date-fns";
import {
    ServerActionContext,
    ServerSessionActionContextModules,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/core/is_dynamo_idempotent_parameter_mismatch_error.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {ErrorBase, InvalidArgumentError} from "~/shared/error/error.js";
import {FeedEntryCursor} from "~/shared/feed/feed_entry_cursor.js";
import {FeedEntryModel} from "~/shared/feed/feed_entry_model.js";
import {FeedEntry, FeedEntrySchema, getFeedEntryTime} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {Result} from "~/shared/helpers/control/result.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {Id} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

// Ideally block items are ~2kb in size each. From one basic experiment, 10
// post entries are 1.78kb as a minified JSON string. We'd really benefit from
// binary encoding here. We could put many more entries in a single block item.
const feedEntryBlockMaxEntryCount = 10;

const FeedCandidateEntrySchema = FeedEntrySchema.validation(
    "Welcome feed entry isn't allowed as feed candidate entry",
    (entry): entry is Exclude<FeedEntry, {type: "Welcome"}> => entry.type !== "Welcome",
);

const FeedTable = DynamoTableSchema.new({
    name: "Feed",
    partitions: [
        /**
         * Feed candidates are all the possible feed entries for a space. Whenever we
         * want to add something to the feed we add it to the feed candidates
         * partition for the space.
         *
         * To determine the entries in a user's personal feed we look at the recent
         * feed candidates, filter out entries the user doesn't have access to, rank
         * the entries (as of 2025-05-19 we only sort chronologically but eventually we
         * should use a [recommender system][1]), and add to the user's personal feed.
         *
         * `FeedAccountCandidates` is an account-specific candidate list.
         *
         * [1]: https://en.wikipedia.org/wiki/Recommender_system
         */
        {
            name: "FeedCandidates",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                /**
                 * Item with state required for adding feed candidates. Namely the next index
                 * in the feed candidate index sequence. Feed candidate entries are given an
                 * auto-incrementing index. This way when processing a user's personal feed we
                 * can say "find me all feed candidate entries after the last index I've seen".
                 */
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        nextIndex: Schema.integer.min(0),
                    }),
                },

                /**
                 * A feed candidate entry in (almost) chronological order. Some entries are
                 * only added after a delay (e.g. as of 2025-05-19 documents are added to feed
                 * ~15min after they are made public).
                 */
                {
                    name: "Entry",
                    sortKeyAttributes: {
                        // Entries are in reverse order so we can efficiently load the `Attributes`
                        // item along with the newest entries.
                        index: DynamoKeyAttributeSchema.integer.reverse(),
                    },
                    attributes: Schema.object({
                        entry: FeedCandidateEntrySchema,
                    }),
                },
            ],
        },

        /**
         * Same as `FeedCandidates` but for a single account. These candidates will
         * only ever be added to an individual account's feed. Useful for when an
         * account creates a private document. We'll add the private document to their
         * account candidates and not the space-wide candidates list.
         *
         * Why don't we add directly to an account's feed? Well right now (2025-05-27)
         * given feeds are purely chronological we certainly could directly add entries
         * to the account's feed. However, when we add feed ranking in the future
         * (which we will definitely do) we'll need feed account candidates anyway. So
         * might as well start with this partition given it's not too much extra
         * complexity.
         *
         * See `FeedCandidates` for detailed documentation. This partition follows
         * basically the same data structure.
         */
        {
            name: "FeedAccountCandidates",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        nextIndex: Schema.integer.min(0),
                    }),
                },
                {
                    name: "Entry",
                    sortKeyAttributes: {
                        index: DynamoKeyAttributeSchema.integer.reverse(),
                    },
                    attributes: Schema.object({
                        entry: FeedCandidateEntrySchema,
                    }),
                },
            ],
        },

        /**
         * An individual account's feed in a space. We calculate each feed from the
         * space's feed candidates.
         */
        {
            name: "Feed",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                /**
                 * Item with state for calculating the account's feed.
                 */
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The next index in the entry block index sequence. Not to be confused with
                         * the candidate index sequence.
                         */
                        nextIndex: Schema.integer.min(0),

                        /**
                         * The last `FeedCandidates` index we saw when calculating this account's feed.
                         * When we go to calculate new entries in the account's feed we'll start from
                         * this index and load all new candidates.
                         */
                        lastCandidateIndex: Schema.integer.min(0).nullable(),

                        /**
                         * The last `FeedAccountCandidates` index we saw when calculating this
                         * account's feed. When we go to calculate new entries in the account's feed
                         * we'll start from this index and load all new candidates.
                         */
                        lastAccountCandidateIndex: Schema.integer.min(0).nullable(),

                        /**
                         * The last time the account's feed was updated.
                         */
                        lastUpdatedTime: Schema.date,
                    }),
                },

                /**
                 * A block of entries in the account's feed. The first entry in the feed is the
                 * block with the highest `index` and index 0 in the block item's `entries`
                 * array.
                 *
                 * When we calculate the account's feed we only include feed entries the
                 * account has access to at calculation time. If an account loses access to an
                 * entity referenced in their feed then the item will disappear when they load
                 * the feed but it'll still technically be stored so if they gain access back
                 * they'll see the feed entry again. However, if an account doesn't have access
                 * at feed calculation time and later they're granted access to the entity then
                 * the entity will never show up in the account's feed.
                 *
                 * We put entries in a block as an optimization to save DynamoDB WCUs at the
                 * potential cost of some RCUs. Since writing one item is minimum 2 WCUs. So
                 * writing three separate entry items is 6 WCUs but writing one entry block
                 * item is 2 WCUs (as long as the item is under 1kb). The tradeoff is when
                 * reading the feed we may read more entries than necessary. We accept this
                 * tradeoff since entries are small. We can tune how much over-reading happens
                 * by changing `feedEntryBlockMaxEntryCount`. At most you'll read 9 entries
                 * extra since `feedEntryBlockMaxEntryCount` is 10.
                 */
                {
                    name: "EntryBlock",
                    sortKeyAttributes: {
                        // Entries are in reverse order so we can efficiently load the `Attributes`
                        // item along with the newest entries.
                        index: DynamoKeyAttributeSchema.integer.reverse(),
                    },
                    attributes: Schema.object({
                        /**
                         * The time when we added this entry block to the account's feed.
                         */
                        addedTime: Schema.date,

                        /**
                         * The feed entries in this block. Each entry block must have at least one
                         * entry.
                         */
                        entries: Schema.array(FeedEntrySchema)
                            .minLength(1)
                            .maxLength(feedEntryBlockMaxEntryCount),
                    }),
                },
            ],
        },
    ],
});

type FeedCandidatesEntryItem = DynamoTableItemType<typeof FeedTable, "FeedCandidates", "Entry">;
type FeedAccountCandidatesEntryItem = DynamoTableItemType<
    typeof FeedTable,
    "FeedAccountCandidates",
    "Entry"
>;
type FeedAttributesItem = DynamoTableItemType<typeof FeedTable, "Feed", "Attributes">;
type FeedEntryBlockItem = DynamoTableItemType<typeof FeedTable, "Feed", "EntryBlock">;

/**
 * Get the latest feed candidate entries in test files. This will throw an
 * error if you call it outside of Just unit tests.
 */
export async function getFeedCandidateEntriesForTest(
    context: ServerSystemActionContext,
    {limit}: {limit: number},
): Promise<Array<{index: number; entry: FeedEntry}>> {
    // Only allow this function to be called in unit tests! We don't perform any
    // authorization that the actor is allowed to see the returned candidates.
    assert(import.meta.jest);
    context.actor.authorizeSystem();

    return arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            FeedTable.query(context, {
                limit,
                partitionKey: {
                    partitionType: "FeedCandidates",
                    spaceId: context.actor.getSpaceId(),
                },
                startSortKey: {
                    sortRangeType: "Entry",
                    index: DynamoKeyAttributeSchema.integer.maxValue,
                },
                endSortKey: {
                    sortRangeType: "Entry",
                    index: DynamoKeyAttributeSchema.integer.minValue,
                },
            }),
            item => ({index: item.index, entry: item.entry}),
        ),
    );
}

/**
 * Get the latest feed candidate entries in test files. This will throw an
 * error if you call it outside of Just unit tests.
 */
export async function getFeedAccountCandidateEntriesForTest(
    context: ServerSystemActionContext,
    {accountId, limit}: {accountId: AccountId; limit: number},
): Promise<Array<{index: number; entry: FeedEntry}>> {
    // Only allow this function to be called in unit tests! We don't perform any
    // authorization that the actor is allowed to see the returned candidates.
    assert(import.meta.jest);
    context.actor.authorizeSystem();

    return arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            FeedTable.query(context, {
                limit,
                partitionKey: {
                    partitionType: "FeedAccountCandidates",
                    spaceId: context.actor.getSpaceId(),
                    accountId,
                },
                startSortKey: {
                    sortRangeType: "Entry",
                    index: DynamoKeyAttributeSchema.integer.maxValue,
                },
                endSortKey: {
                    sortRangeType: "Entry",
                    index: DynamoKeyAttributeSchema.integer.minValue,
                },
            }),
            item => ({index: item.index, entry: item.entry}),
        ),
    );
}

/**
 * Processes the `AddFeedCandidateEntry` job by calling
 * `addFeedCandidateEntry()`. The only difference is this function needs to be
 * idempotent since SQS jobs may be delivered multiple times.
 */
export async function processAddFeedCandidateEntryJob(
    context: ServerActionContext,
    {jobId, spaceId, entry}: {jobId: Id; spaceId: SpaceId; entry: FeedEntry},
) {
    try {
        await addFeedCandidateEntry(context, spaceId, entry, {clientRequestToken: jobId});
    } catch (error) {
        // Ignore idempotent parameter mismatch errors. That means we've already added
        // an entry. We don't want to add the entry again. SQS job handling must be
        // idempotent!
        if (isDynamoIdempotentParameterMismatchError(error)) return;

        throw error;
    }
}

/**
 * Add a feed candidate entry for the space. When accounts view their feed we
 * read candidate entries, rank them with some algorithm, and then add entries
 * to the top of the account's personal feed.
 */
export async function addFeedCandidateEntry(
    context: ServerActionContext,
    spaceId: SpaceId,
    entry: FeedEntry,
    {clientRequestToken}: {clientRequestToken?: string} = {},
) {
    await authorizeSpaceAccess(context, spaceId);

    if (entry.type === "Welcome") {
        throw new InvalidArgumentError("Can't add welcome feed entry as a feed candidate entry");
    }

    await context.dynamo.retryTransaction(async context => {
        const item = await FeedTable.getItemIfExists(context, {
            partitionType: "FeedCandidates",
            sortRangeType: "Attributes",
            spaceId,
        });

        const index = item?.nextIndex ?? 0;

        await DynamoTableSchema.executeTransaction(
            context,
            [
                item
                    ? FeedTable.transactionDirectlyUpdateItem({
                          ...item,
                          nextIndex: index + 1,
                      })
                    : FeedTable.transactionCreateItem(
                          {
                              partitionType: "FeedCandidates",
                              sortRangeType: "Attributes",
                              spaceId,
                              nextIndex: index + 1,
                          },
                          {isConditionCheckErrorRetriable: true},
                      ),

                // If your condition check on the `Attributes` item passes then we're
                // guaranteed there's no item with this `index` as a key. So we can safely
                // use create-or-replace to save some RCUs.
                FeedTable.transactionCreateOrReplaceItem({
                    partitionType: "FeedCandidates",
                    sortRangeType: "Entry",
                    spaceId,
                    index,
                    entry,
                }),
            ],
            {clientRequestToken},
        );
    });
}

/**
 * Processes the `AddFeedAccountCandidateEntry` job by calling
 * `addFeedAccountCandidateEntry()`. The only difference is this function needs
 * to be idempotent since SQS jobs may be delivered multiple times.
 */
export async function processAddFeedAccountCandidateEntryJob(
    context: ServerActionContext,
    {
        jobId,
        spaceId,
        accountId,
        entry,
    }: {
        jobId: Id;
        spaceId: SpaceId;
        accountId: AccountId;
        entry: FeedEntry;
    },
) {
    try {
        await addFeedAccountCandidateEntry(context, spaceId, accountId, entry, {
            clientRequestToken: jobId,
        });
    } catch (error) {
        // Ignore idempotent parameter mismatch errors. That means we've already added
        // an entry. We don't want to add the entry again. SQS job handling must be
        // idempotent!
        if (isDynamoIdempotentParameterMismatchError(error)) return;

        throw error;
    }
}

/**
 * Add a feed candidate entry for a single account in the space. When accounts
 * view their feed we read candidate entries, rank them with some algorithm,
 * and then add entries to the top of the account's personal feed.
 *
 * You probably want `addFeedCandidateEntry()`! This function adds a candidate
 * that may only ever be visible to a single account in the space.
 */
export async function addFeedAccountCandidateEntry(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    entry: FeedEntry,
    {clientRequestToken}: {clientRequestToken?: string} = {},
) {
    await authorizeSpaceAccess(context, spaceId);

    if (entry.type === "Welcome") {
        throw new InvalidArgumentError(
            "Can't add welcome feed entry as a feed account candidate entry",
        );
    }

    await context.dynamo.retryTransaction(async context => {
        const item = await FeedTable.getItemIfExists(context, {
            partitionType: "FeedAccountCandidates",
            sortRangeType: "Attributes",
            spaceId,
            accountId,
        });

        const index = item?.nextIndex ?? 0;

        await DynamoTableSchema.executeTransaction(
            context,
            [
                item
                    ? FeedTable.transactionDirectlyUpdateItem({
                          ...item,
                          nextIndex: index + 1,
                      })
                    : FeedTable.transactionCreateItem(
                          {
                              partitionType: "FeedAccountCandidates",
                              sortRangeType: "Attributes",
                              spaceId,
                              accountId,
                              nextIndex: index + 1,
                          },
                          {isConditionCheckErrorRetriable: true},
                      ),

                // If your condition check on the `Attributes` item passes then we're
                // guaranteed there's no item with this `index` as a key. So we can safely
                // use create-or-replace to save some RCUs.
                FeedTable.transactionCreateOrReplaceItem({
                    partitionType: "FeedAccountCandidates",
                    sortRangeType: "Entry",
                    spaceId,
                    accountId,
                    index,
                    entry,
                }),
            ],
            {clientRequestToken},
        );
    });
}

export type InternalFeedReadFunctions<ContextModules extends ServerSessionActionContextModules> = {
    /**
     * Authorize the feed entity. If not possible, return an `ok: false` result
     * instead of throwing an error.
     */
    readonly authorizeFeedEntryIfPossible: (
        context: Context<ContextModules>,
        entry: FeedEntry,
    ) => Promise<Result<unknown, ErrorBase>>;

    /**
     * Create a feed entry model from the feed entry. If the session actor has lost
     * access to the feed entry then return an error.
     */
    readonly createFeedEntryModelIfPossible: (
        context: Context<ContextModules>,
        spaceId: SpaceId,
        entry: FeedEntry,
    ) => Promise<Result<FeedEntryModel, ErrorBase>>;
};

/**
 * You shouldn't call this function. Call `getAndUpdateFeedEntries()` instead.
 *
 * The `//server/feed/data` package is a dependency of most other server
 * packages (e.g. `//server/forum/data` needs to depend on `//server/feed/data`
 * to add feed candidate entries). However, when reading a feed our reader
 * function needs to depend on all the packages that might have data in the
 * feed! (e.g. To show a document preview we need `//server/documents/data`
 * as a dependency.) So to avoid creating a cycle between packages we split
 * `//server/feed/data` into this, core, package and `//server/feed/read` which
 * depends on all the packages we need to render the feed (e.g.
 * `//server/forum/data`, `//server/documents/data`, etc.).
 */
export async function internalGetAndUpdateFeedEntries<
    ContextModules extends ServerSessionActionContextModules,
>(
    functions: InternalFeedReadFunctions<ContextModules>,
    context: Context<ContextModules>,
    {spaceId, limit}: {spaceId: SpaceId; limit: number},
): Promise<{
    startCursor: FeedEntryCursor | null;
    endCursor: FeedEntryCursor | null;
    hasMoreEntries: boolean;
    entries: Array<FeedEntryModel>;
}> {
    const {createFeedEntryModelIfPossible} = functions;

    await authorizeSpaceAccess(context, spaceId);

    const accountId = context.actor.getAccountId();

    const {feedItem, newEntryBlocks} = await context.tracer.withSpan(
        "Update feed entries",
        async context =>
            context.dynamo.retryTransaction(async context => {
                const feedItem = await FeedTable.getItemIfExists(context, {
                    partitionType: "Feed",
                    sortRangeType: "Attributes",
                    spaceId,
                    accountId,
                });

                const newEntryBlocks = await updateFeedEntries(
                    functions,
                    // Since this is in a `retryTransaction()` loop the type `Replace`s the
                    // `dynamo` context module (which we check in a `cast()`). We're ok treating
                    // this as `Context<ContextModules>` since practically there should be no
                    // difference.
                    cast<
                        Context<
                            Replace<
                                Replace<ContextModules, {tracer: TracerContextModule}>,
                                {dynamo: DynamoContextModule}
                            >
                        >
                    >(context) as Context<ContextModules>,
                    spaceId,
                    feedItem,
                );
                return {feedItem, newEntryBlocks};
            }),
    );

    let startCursor: FeedEntryCursor | null = null;
    let endCursor: FeedEntryCursor | null = null;
    let hasMoreEntries = false;
    const entryPromises: Array<Promise<FeedEntryModel | null>> = [];

    try {
        for (const entryBlock of newEntryBlocks) {
            if (entryPromises.length >= limit) {
                hasMoreEntries = true;
                break;
            }

            for (
                let entryBlockInnerIndex = 0;
                entryBlockInnerIndex < entryBlock.entries.length;
                entryBlockInnerIndex++
            ) {
                if (entryPromises.length >= limit) {
                    hasMoreEntries = true;
                    break;
                }

                const entry = entryBlock.entries[entryBlockInnerIndex]!;

                endCursor = [entryBlock.index, entryBlockInnerIndex];
                startCursor ??= endCursor;

                entryPromises.push(
                    createFeedEntryModelIfPossible(context, spaceId, entry).then(entryResult => {
                        if (!entryResult.ok) return null;
                        return entryResult.value;
                    }),
                );
            }
        }

        if (entryPromises.length < limit) {
            for await (const entryBlock of FeedTable.query(context, {
                // Entry blocks contain between 1 and 10 entries. So to fill our `entries`
                // array to `limit` we need to query at least `limit - entries.length` blocks
                // assuming each block has one item. We'll end query pagination early (via
                // `break`) if we find enough entries to fill the array.
                limit:
                    limit -
                    entryPromises.length +
                    // We need to over-fetch by at least one entry to determine whether
                    // `hasMoreEntries` is true.
                    1,

                partitionKey: {
                    partitionType: "Feed",
                    spaceId,
                    accountId,
                },
                startSortKey: {
                    sortRangeType: "EntryBlock",
                    index: (feedItem?.nextIndex ?? 0) - 1,
                },
            })) {
                if (entryPromises.length >= limit) {
                    hasMoreEntries = true;
                    break;
                }

                for (
                    let entryBlockInnerIndex = 0;
                    entryBlockInnerIndex < entryBlock.entries.length;
                    entryBlockInnerIndex++
                ) {
                    if (entryPromises.length >= limit) {
                        hasMoreEntries = true;
                        break;
                    }

                    const entry = entryBlock.entries[entryBlockInnerIndex]!;

                    endCursor = [entryBlock.index, entryBlockInnerIndex];
                    startCursor ??= endCursor;

                    entryPromises.push(
                        createFeedEntryModelIfPossible(context, spaceId, entry).then(
                            entryResult => {
                                if (!entryResult.ok) return null;
                                return entryResult.value;
                            },
                        ),
                    );
                }
            }
        }

        const entries = await runAllPromises(entryPromises);

        return {
            startCursor,
            endCursor,
            hasMoreEntries,
            entries: entries.filter(isNonNullable),
        };
    } catch (error) {
        // Make sure we don't destroy `context` until everything in `entryPromises` has
        // resolved.
        try {
            await runAllPromises(entryPromises);
        } catch (otherError) {
            throw createAggregateError([error, otherError]);
        }

        throw error;
    }
}

async function updateFeedEntries<ContextModules extends ServerSessionActionContextModules>(
    functions: InternalFeedReadFunctions<ContextModules>,
    context: Context<ContextModules>,
    spaceId: SpaceId,
    feedItem: FeedAttributesItem | null,
): Promise<ReadonlyArray<FeedEntryBlockItem>> {
    const {authorizeFeedEntryIfPossible} = functions;

    // Limit the number of feed candidates we look at. This does mean if the user
    // is joining the space for the first time or opening a space again after a
    // long time away they may miss some feed entries. We accept this possibility.
    // Long term this will be an algorithmic feed anyway with no guarantee that the
    // user will see everything.
    const limit = 500;

    const [candidateEntries, accountCandidateEntries] = await runAllPromises([
        parallelMapAsyncIterableToArray(
            FeedTable.query(context, {
                limit,
                partitionKey: {
                    partitionType: "FeedCandidates",
                    spaceId,
                },
                startSortKey: {
                    sortRangeType: "Entry",
                    index: DynamoKeyAttributeSchema.integer.maxValue,
                },
                endSortKey: {
                    sortRangeType: "Entry",
                    index: (feedItem?.lastCandidateIndex ?? -1) + 1,
                },
            }),
            async (
                item,
            ): Promise<
                | (FeedCandidatesEntryItem & {isUnauthorized?: undefined})
                | {isUnauthorized: true; index: number}
            > => {
                const result = await authorizeFeedEntryIfPossible(context, item.entry);
                if (!result.ok) return {isUnauthorized: true, index: item.index};
                return item;
            },
        ),
        parallelMapAsyncIterableToArray(
            FeedTable.query(context, {
                limit,
                partitionKey: {
                    partitionType: "FeedAccountCandidates",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                },
                startSortKey: {
                    sortRangeType: "Entry",
                    index: DynamoKeyAttributeSchema.integer.maxValue,
                },
                endSortKey: {
                    sortRangeType: "Entry",
                    index: (feedItem?.lastAccountCandidateIndex ?? -1) + 1,
                },
            }),
            async (
                item,
            ): Promise<
                | (FeedAccountCandidatesEntryItem & {isUnauthorized?: undefined})
                | {isUnauthorized: true; index: number}
            > => {
                const result = await authorizeFeedEntryIfPossible(context, item.entry);
                if (!result.ok) return {isUnauthorized: true, index: item.index};
                return item;
            },
        ),
    ]);

    const currentTime = new Date();
    const index = feedItem?.nextIndex ?? 0;

    let mergedCandidateEntries: Array<FeedEntry> = [];

    for (const entry of candidateEntries) {
        if (entry.isUnauthorized) continue;

        // If you create a private document, task collection, or channel then we add a
        // created event feed account candidate to the creator's personal feed. So
        // don't add subsequent share events to the creator's feed since the creator's
        // feed should already include an entry for the entity.
        if (
            entry.entry.type !== "Post" && // `type` is e.g. `Document`, `TaskCollection`, or `Channel`
            entry.entry.event !== "Created" && // `event` is e.g. `SharedWithAccessPolicyDefaultGrant`
            entry.entry.creatorId === context.actor.getAccountId()
        ) {
            continue;
        }

        mergedCandidateEntries.push(entry.entry);
    }

    for (const entry of accountCandidateEntries) {
        if (entry.isUnauthorized) continue;
        mergedCandidateEntries.push(entry.entry);
    }

    // After merging our candidate entries sort them again by time.
    mergedCandidateEntries.sort((entry1, entry2) =>
        compareDesc(getFeedEntryTime(entry1), getFeedEntryTime(entry2)),
    );

    // Make sure we don't have more than `limit` total candidates after merging our
    // candidate arrays.
    mergedCandidateEntries = mergedCandidateEntries.slice(0, limit);

    // If we're creating the account's feed then add a welcome entry to the end of
    // the feed.
    if (!feedItem) {
        mergedCandidateEntries.push({type: "Welcome", addedTime: currentTime});
    }

    const entryBlockFinalCount = Math.ceil(
        mergedCandidateEntries.length / feedEntryBlockMaxEntryCount,
    );
    const entryBlocks: Array<Replace<FeedEntryBlockItem, {entries: Array<FeedEntry>}>> = [];

    // TODO: In the future we should use a [recommender system][1] algorithm to
    // rank content for the feed instead of adding all items in chronological
    // order. For now we take candidate entries in the order they were added and
    // put them in the account's feed in the same order.
    //
    // [1]: https://en.wikipedia.org/wiki/Recommender_system
    for (const entry of mergedCandidateEntries) {
        if (
            entryBlocks.length === 0 ||
            entryBlocks[entryBlocks.length - 1]!.entries.length === feedEntryBlockMaxEntryCount
        ) {
            entryBlocks.push({
                partitionType: "Feed",
                sortRangeType: "EntryBlock",
                spaceId,
                accountId: context.actor.getAccountId(),
                index: index + (entryBlockFinalCount - entryBlocks.length - 1),
                addedTime: currentTime,
                entries: [],
            });
        }

        entryBlocks[entryBlocks.length - 1]!.entries.push(entry);
    }

    const newFeedItem: FeedAttributesItem = {
        partitionType: "Feed",
        sortRangeType: "Attributes",
        spaceId,
        accountId: context.actor.getAccountId(),
        nextIndex: index + entryBlocks.length,
        lastCandidateIndex: candidateEntries[0]?.index ?? feedItem?.lastCandidateIndex ?? null,
        lastAccountCandidateIndex:
            accountCandidateEntries[0]?.index ?? feedItem?.lastAccountCandidateIndex ?? null,
        lastUpdatedTime: currentTime,
        updateLockVersion: feedItem?.updateLockVersion,
    };

    if (entryBlocks.length === 0) {
        if (feedItem) {
            await FeedTable.directlyUpdateItem(context, newFeedItem);
        } else {
            await FeedTable.createItem(context, newFeedItem);
        }
    } else {
        await DynamoTableSchema.executeTransaction(context, [
            feedItem
                ? FeedTable.transactionDirectlyUpdateItem(newFeedItem)
                : FeedTable.transactionCreateItem(newFeedItem),

            ...entryBlocks.map(entryBlock => FeedTable.transactionCreateOrReplaceItem(entryBlock)),
        ]);
    }

    return entryBlocks;
}

/**
 * You shouldn't call this function. Call `getFeedEntries()` instead.
 *
 * The `//server/feed/data` package is a dependency of most other server
 * packages (e.g. `//server/forum/data` needs to depend on `//server/feed/data`
 * to add feed candidate entries). However, when reading a feed our reader
 * function needs to depend on all the packages that might have data in the
 * feed! (e.g. To show a document preview we need `//server/documents/data`
 * as a dependency.) So to avoid creating a cycle between packages we split
 * `//server/feed/data` into this, core, package and `//server/feed/read` which
 * depends on all the packages we need to render the feed (e.g.
 * `//server/forum/data`, `//server/documents/data`, etc.).
 */
export async function internalGetFeedEntries<
    ContextModules extends ServerSessionActionContextModules,
>(
    functions: InternalFeedReadFunctions<ContextModules>,
    context: Context<ContextModules>,
    {
        spaceId,
        limit,
        beforeCursor,
        afterCursor,
    }: {
        spaceId: SpaceId;
        limit: number;
        beforeCursor?: FeedEntryCursor;
        afterCursor?: FeedEntryCursor;
    },
): Promise<{
    startCursor: FeedEntryCursor | null;
    endCursor: FeedEntryCursor | null;
    hasMoreEntries: boolean;
    entries: Array<FeedEntryModel>;
}> {
    const {createFeedEntryModelIfPossible} = functions;

    await authorizeSpaceAccess(context, spaceId);

    let startCursor: FeedEntryCursor | null = null;
    let endCursor: FeedEntryCursor | null = null;
    let hasMoreEntries = false;
    const entryPromises: Array<Promise<FeedEntryModel | null>> = [];

    try {
        for await (const entryBlock of FeedTable.query(context, {
            // Each entry block contains at least one entry (and at most 10 entries as of
            // 2025-05-19) so to load at most `limit` entries we need to load at most
            // `limit` entry blocks in the worst case that each entry block has one entry.
            // If each entry block has 10 entries then we'll break out of the query once we
            // hit `limit` entries which will cancel `query()` async iterator pagination.
            //
            // We actually need `limit + 1` entry blocks for the case where we have an
            // `afterCursor` and each entry block has only one entry. We load the block
            // `afterCursor` points to since we don't know if `afterCursor` points to the
            // start, middle, or end of the block. If `afterCursor` points to the end of
            // the block then we need to load 1 additional block (the `+ 1` in `limit + 1`)
            // to meet our entry limit since we'll be skipping `afterCursor`'s block.
            // There's a test for this case so to learn more try removing the `+ 1` and
            // running `feed_table.test.ts` to see what breaks.
            limit:
                limit +
                (afterCursor ? 1 : 0) +
                // We need to over-fetch by at least one entry to determine whether
                // `hasMoreEntries` is true.
                1,

            partitionKey: {
                partitionType: "Feed",
                spaceId,
                accountId: context.actor.getAccountId(),
            },
            startSortKey: {
                sortRangeType: "EntryBlock",
                index: afterCursor ? afterCursor[0] : DynamoKeyAttributeSchema.integer.maxValue,
            },
            endSortKey: {
                sortRangeType: "EntryBlock",
                index: beforeCursor ? beforeCursor[0] : 0,
            },
        })) {
            if (entryPromises.length >= limit) {
                hasMoreEntries = true;
                break;
            }

            for (
                let entryBlockInnerIndex = 0;
                entryBlockInnerIndex < entryBlock.entries.length;
                entryBlockInnerIndex++
            ) {
                if (entryPromises.length >= limit) {
                    hasMoreEntries = true;
                    break;
                }

                // Ignore entries in the block before `afterCursor`...
                if (afterCursor) {
                    assert(entryBlock.index <= afterCursor[0]);

                    if (
                        entryBlock.index === afterCursor[0] &&
                        entryBlockInnerIndex <= afterCursor[1]
                    ) {
                        continue;
                    }
                }

                // Ignore entries in the block after `beforeCursor`...
                if (beforeCursor) {
                    assert(entryBlock.index >= beforeCursor[0]);

                    if (
                        entryBlock.index === beforeCursor[0] &&
                        entryBlockInnerIndex >= beforeCursor[1]
                    ) {
                        continue;
                    }
                }

                const entry = entryBlock.entries[entryBlockInnerIndex]!;

                endCursor = [entryBlock.index, entryBlockInnerIndex];
                startCursor ??= endCursor;

                entryPromises.push(
                    createFeedEntryModelIfPossible(context, spaceId, entry).then(entryResult => {
                        if (!entryResult.ok) return null;
                        return entryResult.value;
                    }),
                );
            }
        }

        const entries = await runAllPromises(entryPromises);

        return {
            startCursor,
            endCursor,
            hasMoreEntries,
            entries: entries.filter(isNonNullable),
        };
    } catch (error) {
        // Make sure we don't destroy `context` until everything in `entryPromises` has
        // resolved.
        try {
            await runAllPromises(entryPromises);
        } catch (otherError) {
            throw createAggregateError([error, otherError]);
        }

        throw error;
    }
}
