import {
    ServerActionContext,
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/core/is_dynamo_idempotent_parameter_mismatch_error.js";
import {FeedTable, feedEntryBlockMaxEntryCount} from "~/server/feed/internal/feed_table.js";
import {rankFeedEntries} from "~/server/feed/internal/rank_feed_entries.js";
import {getFileDocumentEntityModelIfPossible} from "~/server/files/data/get_document_file_entity_model_if_possible.js";
import {getFileChannelEntityModelIfPossible} from "~/server/files/data/get_file_channel_entity_model_if_possible.js";
import {getFileChatEntityModelIfPossible} from "~/server/files/data/get_file_chat_entity_model_if_possible.js";
import {getFileTaskCollectionEntityModelIfPossible} from "~/server/files/data/get_file_task_collection_entity_model_if_possible.js";
import {getFileTaskEntityModelIfPossible} from "~/server/files/data/get_file_task_entity_model_if_possible.js";
import {internalGetSearchAffinityEntities} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {
    AuthorizeSpaceAccessContext,
    authorizeSpaceAccess,
} from "~/server/spaces/authorize_space_access.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getSpaceAutoAddAccountsFromEmailDomains} from "~/server/spaces/get_space_auto_add_accounts_from_email_domains.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {createAggregateError} from "~/shared/error/aggregate_error.open_source.js";
import {ErrorBase, InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {FeedEntryCursor} from "~/shared/feed/feed_entry_cursor.js";
import {
    FeedChannelEntryModel,
    FeedChatEntryModel,
    FeedDocumentEntryModel,
    FeedEntryModel,
    FeedPostEntryModel,
    FeedTaskCollectionEntryModel,
    FeedTaskEntryModel,
    FeedWelcomeEntryModel,
} from "~/shared/feed/feed_entry_model.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";
import {Id} from "~/shared/id/id.open_source.js";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {parseSearchAffinityEntityId} from "~/shared/search/search_entity_id.js";
import {
    createTaskCollectionNotFoundError,
    createTaskNotFoundError,
} from "~/shared/tasks/task_error_messages.js";

/**
 * NOTE: this file is currently being split up. We do not anticipate adding more
 * methods here.
 */

type FeedCandidatesEntryItem = DynamoTableItemType<typeof FeedTable, "FeedCandidates", "Entry">;
type FeedAttributesItem = DynamoTableItemType<typeof FeedTable, "Feed", "Attributes">;
type FeedEntryBlockItem = DynamoTableItemType<typeof FeedTable, "Feed", "EntryBlock">;

/**
 * Get the latest feed candidate entries in test files. This will throw an error if
 * you call it outside of Just unit tests.
 */
export async function getFeedCandidateEntriesForTest(
    context: ServerSystemActionContext,
    {limit}: {limit: number},
): Promise<Array<{index: number; entry: FeedEntry}>> {
    // Only allow this function to be called in unit tests! We don't perform any
    // authorization that the actor is allowed to see the returned candidates.
    assert(process.env.NODE_ENV === "test");
    context.actor.authorizeSystem();

    return await arrayFromAsyncIterable(
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
 * Get the latest feed candidate entries in test files. This will throw an error if
 * you call it outside of Just unit tests.
 */
export async function getFeedAccountCandidateEntriesForTest(
    context: ServerSystemActionContext,
    {accountId, limit}: {accountId: AccountId; limit: number},
): Promise<Array<{index: number; entry: FeedEntry}>> {
    // Only allow this function to be called in unit tests! We don't perform any
    // authorization that the actor is allowed to see the returned candidates.
    assert(process.env.NODE_ENV === "test");
    context.actor.authorizeSystem();

    return await arrayFromAsyncIterable(
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
 * Processes the `AddFeedCandidateEntry` job by calling `addFeedCandidateEntry()`.
 * The only difference is this function needs to be idempotent since SQS jobs may
 * be delivered multiple times.
 */
export async function processAddFeedCandidateEntryJob(
    context: ServerActionContext,
    {jobId, spaceId, entry}: {jobId: Id; spaceId: SpaceId; entry: FeedEntry},
) {
    try {
        await addFeedCandidateEntry(context, spaceId, entry, {clientRequestToken: jobId});
    } catch (error) {
        // Ignore idempotent parameter mismatch errors. That means we've already added an
        // entry. We don't want to add the entry again. SQS job handling must be
        // idempotent!
        if (isDynamoIdempotentParameterMismatchError(error)) return;

        throw error;
    }
}

/**
 * Add a feed candidate entry for the space. When accounts view their feed we read
 * candidate entries, rank them with some algorithm, and then add entries to the
 * top of the account's personal feed.
 */
export async function addFeedCandidateEntry(
    context: AuthorizeSpaceAccessContext,
    spaceId: SpaceId,
    entry: FeedEntry,
    {clientRequestToken}: {clientRequestToken?: string} = {},
) {
    await authorizeSpaceAccess(context, spaceId);

    if (entry.type === "Welcome") {
        throw new InvalidArgumentError(
            "Can\u2019t add welcome feed entry as a feed candidate entry",
        );
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

                // If your condition check on the `Attributes` item passes then we're guaranteed
                // there's no item with this `index` as a key. So we can safely use
                // create-or-replace to save some RCUs.
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
 * `addFeedAccountCandidateEntry()`. The only difference is this function needs to
 * be idempotent since SQS jobs may be delivered multiple times.
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
        // Ignore idempotent parameter mismatch errors. That means we've already added an
        // entry. We don't want to add the entry again. SQS job handling must be
        // idempotent!
        if (isDynamoIdempotentParameterMismatchError(error)) return;

        throw error;
    }
}

/**
 * Add a feed candidate entry for a single account in the space. When accounts view
 * their feed we read candidate entries, rank them with some algorithm, and then
 * add entries to the top of the account's personal feed.
 *
 * You probably want `addFeedCandidateEntry()`! This function adds a candidate that
 * may only ever be visible to a single account in the space.
 */
export async function addFeedAccountCandidateEntry(
    context: AuthorizeSpaceAccessContext,
    spaceId: SpaceId,
    accountId: AccountId,
    entry: FeedEntry,
    {clientRequestToken}: {clientRequestToken?: string} = {},
) {
    const [, isBot] = await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        isBotSpaceAccount(context, spaceId, accountId),
    ]);

    // Bots don't have feeds. Noop if we're trying to add an account candidate entry
    // for a bot account.
    if (isBot) return;

    if (entry.type === "Welcome") {
        throw new InvalidArgumentError(
            "Can\u2019t add welcome feed entry as a feed account candidate entry",
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

                // If your condition check on the `Attributes` item passes then we're guaranteed
                // there's no item with this `index` as a key. So we can safely use
                // create-or-replace to save some RCUs.
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

/**
 * Gets the feed entries at the top of the session actor's feed. First we update
 * the actor's feed before returning entries.
 */
export async function getAndUpdateFeedEntries(
    context: ServerSessionActionContext,
    {
        spaceId,
        limit,
        overrideCurrentTimeForTest,
    }: {
        spaceId: SpaceId;
        limit: number;
        overrideCurrentTimeForTest?: Date;
    },
): Promise<{
    startCursor: FeedEntryCursor | null;
    endCursor: FeedEntryCursor | null;
    hasMoreEntries: boolean;
    entries: Array<FeedEntryModel>;
    wasFeedCreated: boolean;
}> {
    await authorizeSpaceAccess(context, spaceId);

    const accountId = context.actor.getAccountId();

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't have a feed. So don't allow reading/updating a feed for the bot
        // account.
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    const {feedItem, wasFeedCreated, newEntryBlocks} = await context.tracer.withSpan(
        "Update feed entries",
        async (context, span) =>
            await context.dynamo.retryTransaction(async context => {
                const feedItem = await FeedTable.getItemIfExists(context, {
                    partitionType: "Feed",
                    sortRangeType: "Attributes",
                    spaceId,
                    accountId,
                });

                const {wasCreated: wasFeedCreated, entryBlocks: newEntryBlocks} =
                    await updateFeedEntries(context, spaceId, feedItem, {
                        overrideCurrentTimeForTest,
                    });

                let entryCount = 0;
                for (const entryBlock of newEntryBlocks) {
                    entryCount += entryBlock.entries.length;
                }

                span.addData({
                    feed: {
                        // `true` if the feed was created and `undefined` if it wasn't to avoid taking
                        // space on subsequent requests.
                        wasCreated: wasFeedCreated ?? undefined,
                        // Include the number of new entries from this span.
                        entryCount,
                    },
                });

                return {feedItem, wasFeedCreated, newEntryBlocks};
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
                // Entry blocks contain between 1 and 10 entries. So to fill our `entries` array to
                // `limit` we need to query at least `limit - entries.length` blocks assuming each
                // block has one item. We'll end query pagination early (via `break`) if we find
                // enough entries to fill the array.
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
            wasFeedCreated,
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

async function updateFeedEntries(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    feedItem: FeedAttributesItem | null,
    {overrideCurrentTimeForTest}: {overrideCurrentTimeForTest: Date | undefined},
): Promise<{wasCreated: boolean; entryBlocks: ReadonlyArray<FeedEntryBlockItem>}> {
    if (overrideCurrentTimeForTest) {
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    const currentTime = overrideCurrentTimeForTest ?? new Date();

    // Limit the number of feed candidates we look at. This does mean if the user is
    // joining the space for the first time or opening a space again after a long time
    // away they may miss some feed entries. We accept this possibility. Long term this
    // will be an algorithmic feed anyway with no guarantee that the user will see
    // everything.
    const limit = 500;

    function getCreatorIdForEntry(
        entry: FeedEntry & {type: "Document" | "Task" | "TaskCollection" | "Channel" | "RoomChat"},
    ): AccountId | null {
        switch (entry.type) {
            case "Document":
            case "Task":
            case "TaskCollection":
                return entry.creator.id ?? null;
            case "Channel":
            case "RoomChat":
                return entry.creatorId ?? null;
            default:
                throw exhaustive(entry);
        }
    }

    const processEntry = async (
        item: Pick<FeedCandidatesEntryItem, "index" | "entry">,
    ): Promise<
        | (Pick<FeedCandidatesEntryItem, "index" | "entry"> & {isUnauthorized?: undefined})
        | {isUnauthorized: true; index: number}
    > => {
        if (item.entry.type !== "Post") {
            const excludeFromCreatorFeed =
                // If we were instructed to exclude this entry from the creator's feed, do that
                // filtering here.
                item.entry.excludeFromCreatorFeed ??
                // If you create a private document, task collection, or channel then we add a
                // created event feed account candidate to the creator's personal feed. So don't
                // add subsequent share events to the creator's feed since the creator's feed
                // should already include an entry for the entity.
                item.entry.event !== "Created";

            if (
                excludeFromCreatorFeed &&
                getCreatorIdForEntry(item.entry) === context.actor.getAccountId()
            ) {
                return {isUnauthorized: true, index: item.index};
            }
        }

        const result = await authorizeFeedEntryIfPossible(context, item.entry);
        if (!result.ok) return {isUnauthorized: true, index: item.index};
        return item;
    };

    const [candidateEntries, accountCandidateEntries, welcomeEntry, searchAffinityEntities] =
        await runAllPromises([
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
                processEntry,
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
                processEntry,
            ),

            // If we're creating the account's feed then add a welcome entry to the end of the
            // feed.
            !feedItem
                ? (async (): Promise<FeedEntry> => {
                      const items = await getSpaceAutoAddAccountsFromEmailDomains(
                          context,
                          spaceId,
                          // Use strong consistency to make sure we include the correct information in the
                          // welcome entry.
                          {consistency: "Strong"},
                      );

                      return {
                          type: "Welcome",
                          addedTime: currentTime,
                          emailDomainWithAutoAddAccountsEnabled:
                              items.find(item => item.isEnabled)?.emailDomain ?? null,
                      };
                  })()
                : null,

            // Fetch affinity data for ranking feed entries. We use affinities to prioritize
            // content from accounts/channels the user interacts with frequently. Use 2x the
            // search affinity limit used by `searchByAffinity` on the client (30) and get all
            // candidates to maximize the affinity data available for ranking.
            internalGetSearchAffinityEntities(context, {
                spaceId,
                limit: 60,
                withAllQueriedItems: true,
            }),
        ]);

    // Build maps for quick affinity lookups when scoring entries.
    const searchAffinityPointsByAccountId = new Map<AccountId, number>();
    const searchAffinityPointsByChannelId = new Map<ChannelId, number>();

    for (const {entityId, points} of searchAffinityEntities) {
        if (entityId === "TaskPersonal") continue;

        const entityIdObject = parseSearchAffinityEntityId(entityId);

        switch (entityIdObject.type) {
            case "Account":
                searchAffinityPointsByAccountId.set(entityIdObject.accountId, points);
                break;
            case "Channel":
                searchAffinityPointsByChannelId.set(entityIdObject.channelId, points);
                break;
        }
    }

    const index = feedItem?.nextIndex ?? 0;

    const mergedCandidateEntries: Array<FeedEntry> = [];

    for (const entry of candidateEntries) {
        if (entry.isUnauthorized) continue;
        mergedCandidateEntries.push(entry.entry);
    }

    for (const entry of accountCandidateEntries) {
        if (entry.isUnauthorized) continue;
        mergedCandidateEntries.push(entry.entry);
    }

    // Rank entries using affinity scores and diversity constraints.
    let rankedEntries = rankFeedEntries({
        entries: mergedCandidateEntries,
        searchAffinityPointsByAccountId,
        searchAffinityPointsByChannelId,
    });

    // Make sure we don't have more than `limit` total candidates after ranking our
    // candidate arrays.
    if (rankedEntries.length > limit) {
        rankedEntries = rankedEntries.slice(0, limit);
    }

    // If we're creating the account's feed then add a welcome entry to the end of the
    // feed.
    if (!feedItem) {
        rankedEntries.push(assertExists(welcomeEntry));
    }

    const entryBlockFinalCount = Math.ceil(rankedEntries.length / feedEntryBlockMaxEntryCount);
    const entryBlocks: Array<Replace<FeedEntryBlockItem, {entries: Array<FeedEntry>}>> = [];

    // Add ranked entries to entry blocks.
    for (const entry of rankedEntries) {
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

    return {wasCreated: !feedItem, entryBlocks};
}

/**
 * Paginate through an account's feed from top to bottom without updating the feed.
 * If you're loading the top of the account's feed generally you'll want
 * `getAndUpdateFeedEntries()` to make sure you're showing the latest stuff that's
 * been happening in the space.
 */
export async function getFeedEntries(
    context: ServerSessionActionContext,
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
    await authorizeSpaceAccess(context, spaceId);

    let startCursor: FeedEntryCursor | null = null;
    let endCursor: FeedEntryCursor | null = null;
    let hasMoreEntries = false;
    const entryPromises: Array<Promise<FeedEntryModel | null>> = [];

    try {
        for await (const entryBlock of FeedTable.query(context, {
            // Each entry block contains at least one entry (and at most 10 entries as of
            // 2025-05-19) so to load at most `limit` entries we need to load at most `limit`
            // entry blocks in the worst case that each entry block has one entry. If each
            // entry block has 10 entries then we'll break out of the query once we hit `limit`
            // entries which will cancel `query()` async iterator pagination.
            //
            // We actually need `limit + 1` entry blocks for the case where we have an
            // `afterCursor` and each entry block has only one entry. We load the block
            // `afterCursor` points to since we don't know if `afterCursor` points to the
            // start, middle, or end of the block. If `afterCursor` points to the end of the
            // block then we need to load 1 additional block (the `+ 1` in `limit + 1`) to meet
            // our entry limit since we'll be skipping `afterCursor`'s block. There's a test
            // for this case so to learn more try removing the `+ 1` and running
            // `feed_table.test.ts` to see what breaks.
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

        const entries = (await runAllPromises(entryPromises)).filter(isNonNullable);

        return {
            startCursor,
            endCursor,
            hasMoreEntries,
            entries,
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

/**
 * Authorize the feed entity. If not possible, return an `ok: false` result instead
 * of throwing an error.
 */
async function authorizeFeedEntryIfPossible(
    context: ServerSessionActionContext,
    entry: FeedEntry,
): Promise<Result<unknown, ErrorBase>> {
    switch (entry.type) {
        case "Welcome": {
            return okResult;
        }
        case "Post": {
            return await context.forumInjection.authorizeChannelAccessIfPossible(
                entry.channelId,
                "View",
            );
        }
        case "Document": {
            return await context.documentsInjection.authorizeDocumentAccessIfPossible(
                entry.documentId,
                "View",
            );
        }
        case "Task": {
            const result = await context.tasksInjection.authorizeTaskAccessIfPossible(
                entry.taskId,
                "View",
            );
            if (!result) throw createTaskNotFoundError(entry.taskId);
            return result;
        }
        case "TaskCollection": {
            const result = await context.tasksInjection.authorizeTaskCollectionAccessIfPossible(
                entry.collectionId,
                "View",
            );
            if (!result) throw createTaskCollectionNotFoundError(entry.collectionId);
            return result;
        }
        case "Channel": {
            return await context.forumInjection.authorizeChannelAccessIfPossible(
                entry.channelId,
                "View",
            );
        }
        case "RoomChat": {
            return await context.chatInjection.authorizeChatAccessIfPossible(entry.chatId, "View");
        }
        default:
            throw exhaustive(entry);
    }
}

/**
 * Create a feed entry model from the feed entry. If the session actor has lost
 * access to the feed entry then return an error.
 */
export async function createFeedEntryModelIfPossible(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    entry: FeedEntry,
): Promise<Result<FeedEntryModel, ErrorBase>> {
    switch (entry.type) {
        case "Welcome": {
            return {
                ok: true,
                value: new FeedWelcomeEntryModel({
                    addedTime: entry.addedTime,
                    emailDomainWithAutoAddAccountsEnabled:
                        entry.emailDomainWithAutoAddAccountsEnabled,
                }),
            };
        }
        case "Post": {
            const result = await context.forumInjection.getPostIfPossible(entry.postId);
            return mapResult(result, post => new FeedPostEntryModel({post}));
        }
        case "Document": {
            const [sharer, result] = await runAllPromises([
                getAccount(context, spaceId, entry.sharerId),
                getFileDocumentEntityModelIfPossible(context, entry.documentId),
            ]);

            return mapResult(
                result,
                document =>
                    new FeedDocumentEntryModel({
                        sharer,
                        sharedTime: entry.sharedTime,
                        event: entry.event,
                        document,
                    }),
            );
        }
        case "TaskCollection": {
            const [sharer, result] = await runAllPromises([
                getAccount(context, spaceId, entry.sharerId),
                getFileTaskCollectionEntityModelIfPossible(context, spaceId, entry.collectionId),
            ]);

            return mapResult(
                result,
                collection =>
                    new FeedTaskCollectionEntryModel({
                        sharer,
                        sharedTime: entry.sharedTime,
                        event: entry.event,
                        collection,
                    }),
            );
        }
        case "Task": {
            const [sharer, result] = await runAllPromises([
                getAccount(context, spaceId, entry.sharerId),
                getFileTaskEntityModelIfPossible(context, spaceId, entry.taskId),
            ]);

            return mapResult(
                result,
                task =>
                    new FeedTaskEntryModel({
                        sharer,
                        sharedTime: entry.sharedTime,
                        event: entry.event,
                        task,
                    }),
            );
        }
        case "Channel": {
            const [sharer, result] = await runAllPromises([
                getAccount(context, spaceId, entry.sharerId),
                getFileChannelEntityModelIfPossible(context, entry.channelId),
            ]);

            return mapResult(
                result,
                channel =>
                    new FeedChannelEntryModel({
                        sharer,
                        sharedTime: entry.sharedTime,
                        event: entry.event,
                        channel,
                    }),
            );
        }
        case "RoomChat": {
            const [sharer, result] = await runAllPromises([
                getAccount(context, spaceId, entry.sharerId),
                getFileChatEntityModelIfPossible(context, entry.chatId),
            ]);

            return mapResult(
                result,
                chat =>
                    new FeedChatEntryModel({
                        sharer,
                        sharedTime: entry.sharedTime,
                        event: entry.event,
                        chat,
                    }),
            );
        }
        default:
            throw exhaustive(entry);
    }
}
