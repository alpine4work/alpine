import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionCountByAccountIdInContent,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {EdgeServiceContextModuleBase} from "~/server/context/edge_service_context_module.js";
import {
    ServerActionContext,
    ServerActionContextModules,
    ServerSessionActionContext,
    ServerSessionActionContextModules,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {
    DynamoGeneralRealtimeTableItemType,
    DynamoGeneralRealtimeTableSchema,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {getMessageChangeLogExpirationTimeFromChangeTime} from "~/server/messaging/helpers/get_message_change_log_expiration_time_from_change_time.js";
import {
    getNotificationMessageContentSnippet,
    getNotificationPostContentSnippet,
} from "~/server/notifications/core/get_notification_content_snippet.js";
import {markSearchAffinityInteraction} from "~/server/search/data/table/search_entity_table.js";
import {
    authorizeSpaceAccess,
    getAccount,
    isAccountMemberOfSpace,
} from "~/server/spaces/spaces_table.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {
    DynamoGeneralRealtimeBackfillResult,
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeIndexQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {ChannelModel, ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {ChannelBroadcastRealtimeEventTransactionSchema} from "~/shared/forum/channel_realtime_protocol.js";
import {PostContent, PostContentSchema} from "~/shared/forum/post_content_schema.js";
import {
    PostCommentModel,
    PostModel,
    maxPostPreviewCommentAuthorCount,
} from "~/shared/forum/post_model.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ContentMentionAccountId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema.js";
import {
    MessageContent,
    MessageContentSchema,
    emptyMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessagePayload, MessagePayloadSchema} from "~/shared/messaging/message_model.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Schema} from "~/shared/schema/schema.js";

const ForumRealtimeTable = DynamoGeneralRealtimeTableSchema.new({
    // Disable table-level realtime queries
    // (e.g. `ForumRealtimeTable.realtimeQuery()`) to reduce the number of WCUs
    // whenever an update is made to this table since we only ever query through
    // an index.
    isTableRealtimeQueryDisabled: true,

    name: "ForumRealtime",
    partitions: [
        {
            name: "Channel",
            partitionKeyAttributes: {
                channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        /** When was this channel created? */
                        createdTime: Schema.date,

                        /** Account who created the channel. */
                        creatorId: Schema.id<AccountId>().nullable().default(null),

                        /** The name of this channel. */
                        name: LabelStringSchema,

                        /** A description for the channel which will appear in a sidebar. */
                        description: MessageContentSchema.default(emptyMessageContent),
                    }),
                },
            ],
        },
        {
            name: "Post",
            partitionKeyAttributes: {
                postId: DynamoKeyAttributeSchema.id<PostId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        createdTime: Schema.date,

                        /** What channel was this post created in? */
                        channelId: Schema.id<ChannelId>(),

                        /** Which account created this post? */
                        authorId: Schema.id<AccountId>(),

                        /** The contents of this post. */
                        content: PostContentSchema,

                        /** The last time at which the post's content was updated. */
                        contentUpdatedTime: Schema.date.nullable().default(null),

                        /**
                         * Information regarding the post's comments. Nested in an object so we can
                         * update it at once.
                         *
                         * We don't send general realtime update events when `commentsSummary` changes.
                         * This is taken care of by
                         * `transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent()`. We do
                         * this to save a bunch of WCUs. Recording an event containing the full post
                         * content for every new comment would be wildly inefficient.
                         */
                        commentsSummary: Schema.object({
                            /**
                             * The index of the next comment.
                             */
                            nextCommentIndex: Schema.integer.min(0),

                            /**
                             * The last time a comment was changed. This should equal the `changeTime` of
                             * the highest item in `CommentChangeLog`.
                             */
                            lastChangeTime: Schema.date.nullable().default(null),

                            /**
                             * All the accounts which have commented on the post and the number of comments
                             * they have made. The map is ordered by when the account first commented on
                             * the post.
                             *
                             * This map can grow unbounded. When a user deletes a comment it leaves a
                             * gravestone so comment counts should never be decremented.
                             */
                            commentCountByAuthorId: Schema.map(
                                Schema.id<AccountId>(),
                                Schema.integer.min(1),
                            ),

                            /**
                             * All the accounts which have been mentioned at some point in the post's
                             * comments or post's content and how many times the account was mentioned.
                             *
                             * Accounts that exist in the map with a mention count of zero have a
                             * special meaning:
                             *
                             * - If an account exists in the map they were mentioned at some point
                             * - If an account exists in the map with a mention count of zero then they
                             *   were mentioned at some point but all mentions have been removed by updates
                             * - If an account does not exist in the map they were never mentioned in
                             *   the post
                             *
                             * While this is in `commentsSummary` it also includes mentions from the post
                             * content. We put it in `commentsSummary` so we can update it atomically as a
                             * single attribute with other comment information.
                             */
                            mentionCountByAccountId: Schema.map(
                                Schema.id<ContentMentionAccountId>(),
                                Schema.integer.min(0),
                            ).default(new Map()),
                        }),
                    }),
                },
            ],
        },
    ],
    modelSchema: createModelUnionSchema({
        Channel: ChannelModel,
        Post: PostModel,
    }),
    models: {
        Channel: {
            Attributes: {
                build: (context, item) => createChannelModelFromItem(context, item),
            },
        },
        Post: {
            Attributes: {
                build: (context, item) =>
                    createPostModelFromItem(
                        context,
                        getChannelPreview(context, item.channelId),
                        item,
                    ),
            },
        },
    },
    sendEventTransaction: (
        context: Context<ServerActionContextModules & {edge: EdgeServiceContextModuleBase}>,
        readTime,
        eventTransaction,
    ) => sendForumRealtimeEventTransaction(context, readTime, eventTransaction),
});

async function sendForumRealtimeEventTransaction(
    context: Context<ServerActionContextModules & {edge: EdgeServiceContextModuleBase}>,
    readTime: Date,
    eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<ChannelModel | PostModel>>,
) {
    // Split up event transactions so we send everything in a `ChannelId` to
    // that channel and nothing else. We have to split for security: if two
    // channels are updated in the same transaction, a user connected to
    // channel 1 shouldn't get realtime events for channel 2 which they don't
    // have access to.
    //
    // This means clients may see a glitch where an atomic update across two
    // channels is applied separately. This is fine as in practice we don't
    // have any cross-channel updates it's critical for users to see
    // atomically.
    const eventTransactionByChannelId = new Map<
        ChannelId,
        Array<DynamoGeneralRealtimeEvent<ChannelModel | PostModel>>
    >();

    for (const event of eventTransaction) {
        getOrSetDefaultMapValue(
            eventTransactionByChannelId,
            event.item.model instanceof ChannelModel
                ? event.item.model.id
                : event.item.model.channel.id,
            () => [],
        ).push(event);
    }

    await runAllPromises(
        Array.from(eventTransactionByChannelId, async ([channelId, eventTransaction]) => {
            await context.edge.broadcastToDurableObject(
                `/api/durable-objects/channels/${channelId}`,
                {
                    serviceName: "ChannelRealtimeService",
                    route: "/api/durable-objects/channels/:channelId",
                    body: ChannelBroadcastRealtimeEventTransactionSchema.serialize({
                        readTime,
                        eventTransaction,
                    }),
                },
            );
        }),
    );
}

// We use an index with join queries since it reduces write/storage costs
// (compared to `addExpensiveFullIndex()`) and the read performance sacrifice
// isn't that bad since most of the time posts will be viewed through home feed
// or inbox anyway (vs querying a channel).
const ChannelPostsIndex = ForumRealtimeTable.addIndexWithQueryJoin({
    name: "ChannelPosts",
    itemTypes: [{partitionType: "Post", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
    },
    sortKeyAttributes: {
        createdTime: DynamoKeyAttributeSchema.date,
    },
});

// Contains forum data that's not covered by our general realtime system. For
// instance, post comments are covered by our messaging realtime system.
const ForumTable = DynamoTableSchema.new({
    name: "Forum",
    partitions: [
        // NOTE(calebmer, 2024-04-11): Forum used to not use general realtime. Since
        // this date I've migrated data into a table with general realtime support. The
        // old index and partition types remain for backwards compatibility. Ideally
        // we'd fully delete this code someday.
        {
            name: "Channel",
            partitionKeyAttributes: {
                channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        createdTime: Schema.date,
                        creatorId: Schema.id<AccountId>().nullable().default(null),
                        name: LabelStringSchema,
                        description: MessageContentSchema.default(emptyMessageContent),
                    }),
                },
            ],
        },
        {
            name: "Post",
            partitionKeyAttributes: {
                postId: DynamoKeyAttributeSchema.id<PostId>(),
            },
            sortRanges: [
                // NOTE(calebmer, 2024-04-11): Forum used to not use general realtime. Since
                // this date I've migrated data into a table with general realtime support. The
                // old index and partition types remain for backwards compatibility. Ideally
                // we'd fully delete this code someday.
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        channelId: Schema.id<ChannelId>(),
                        createdTime: Schema.date,
                        authorId: Schema.id<AccountId>(),
                        content: PostContentSchema,
                        contentUpdatedTime: Schema.date.nullable().default(null),
                        commentsSummary: Schema.object({
                            nextCommentIndex: Schema.integer.min(0),
                            lastChangeTime: Schema.date.nullable().default(null),
                            commentCountByAuthorId: Schema.map(
                                Schema.id<AccountId>(),
                                Schema.integer.min(1),
                            ),
                            mentionCountByAccountId: Schema.map(
                                Schema.id<ContentMentionAccountId>(),
                                Schema.integer.min(0),
                            ).default(new Map()),
                        }),
                    }),
                },

                /**
                 * Comments on a post. Has all the attributes needed for a message in
                 * `MessageInterface`.
                 */
                {
                    name: "Comments",
                    sortKeyAttributes: {
                        commentIndex: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        authorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        payload: MessagePayloadSchema,
                    }),
                },

                /**
                 * We keep a log of changes to comments so that when backfilling for realtime
                 * we can send any missed updates between the last time data was loaded and
                 * the backfill.
                 *
                 * `changeTime` should be monotonically increasing which is managed by
                 * `lastChangeTime` in `commentsSummary`.
                 *
                 * This log does not include when comments are created, only updated or
                 * deleted. Because comment indexes are dense we can take the last seen comment
                 * index and load comments after that to backfill.
                 *
                 * Log items will expire after a certain amount of time. If a client hasn't
                 * backfilled in a long time it will need to fully reload since we won't know
                 * what changed.
                 */
                {
                    name: "CommentChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        commentIndex: Schema.integer,
                        change: Schema.union({
                            UpdateContent: Schema.object({
                                type: Schema.value("UpdateContent"),
                                content: MessageContentSchema,
                                // `contentUpdatedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                            Delete: Schema.object({
                                type: Schema.value("Delete"),
                                // `deletedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                        }),
                    }),
                },
            ],
        },
    ],
});

// NOTE(calebmer, 2024-04-11): Forum used to not use general realtime. Since
// this date I've migrated data into a table with general realtime support. The
// old index and partition types remain for backwards compatibility. Ideally
// we'd fully delete this code someday.
ForumTable.addIndex({
    name: "ChannelPosts",
    itemTypes: [{partitionType: "Post", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
    },
    sortKeyAttributes: {
        createdTime: DynamoKeyAttributeSchema.date,
        // Include the post ID in the index sort key so if two posts have the same
        // created time we have a deterministic ordering between them.
        postId: DynamoKeyAttributeSchema.id<PostId>(),
    },
});

type ChannelAttributesItem = DynamoGeneralRealtimeTableItemType<
    typeof ForumRealtimeTable,
    "Channel",
    "Attributes"
>;

type PostAttributesItem = DynamoGeneralRealtimeTableItemType<
    typeof ForumRealtimeTable,
    "Post",
    "Attributes"
>;

type PostCommentItem = DynamoTableItemType<typeof ForumTable, "Post", "Comments">;

/**
 * Scan every channel and post in our database. Use when migrating data.
 */
export async function* expensiveScanEveryChannelAndPostForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<
    | {type: "Channel"; spaceId: SpaceId; channelId: ChannelId}
    | {type: "Post"; spaceId: SpaceId; postId: PostId}
> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    for await (const item of ForumRealtimeTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Channel", sortRangeType: "Attributes"},
            {partitionType: "Post", sortRangeType: "Attributes"},
        ],
    })) {
        if (item.partitionType === "Channel") {
            if (item.sortRangeType !== "Attributes") continue;
            yield {type: "Channel", spaceId: item.spaceId, channelId: item.channelId};
        } else if (item.partitionType === "Post") {
            if (item.sortRangeType !== "Attributes") continue;
            yield {type: "Post", spaceId: item.spaceId, postId: item.postId};
        }
    }
}

/**
 * Scan every post comment in our database. Use when migrating data.
 *
 * Separate from `expensiveScanEveryChannelAndPostForMigration()` since post
 * comments and posts/channels are backed by different underlying tables.
 */
export async function* expensiveScanEveryPostCommentForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<{
    getSpaceId: () => Promise<SpaceId>;
    postId: PostId;
    commentIndex: number;
}> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    const spaceIdByPostId = new Map<PostId, Promise<SpaceId>>();

    for await (const item of ForumTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [{partitionType: "Post", sortRangeType: "Comments"}],
    })) {
        if (item.partitionType === "Post" && item.sortRangeType === "Comments") {
            yield {
                getSpaceId: () =>
                    getOrSetDefaultMapValue(spaceIdByPostId, item.postId, async () => {
                        const postItem = await ForumRealtimeTable.getPartialItem(
                            context,
                            {
                                partitionType: "Post",
                                sortRangeType: "Attributes",
                                postId: item.postId,
                            },
                            {attributes: ["spaceId"]},
                        );
                        return postItem.spaceId;
                    }),
                postId: item.postId,
                commentIndex: item.commentIndex,
            };
        }
    }
}

/**
 * Move channel and post data from `ForumTable` into `ForumRealtimeTable`.
 *
 * IMPORTANT: This is not a good example of a migration if you need to do
 * something similar in the future! Since I (@calebmer) am running this
 * migration in private alpha I'm ok with having a bit of downtime. This
 * migration requires some downtime and has other risks given briefly after
 * the deploy new code will be reading from `ForumRealtimeTable` but this
 * migration won't have been run.
 */
export async function runMoveForumChannelsAndPostsMigration(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    let n = 0;
    const mutexes = createArrayWithLength(8, () => new Mutex());

    let hasError = false;
    let firstError: unknown;
    let hasSystemError = false;
    let firstSystemError: unknown;

    for await (const item of ForumTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Channel", sortRangeType: "Attributes"},
            {partitionType: "Post", sortRangeType: "Attributes"},
        ],
    })) {
        if (
            (item.partitionType === "Channel" && item.sortRangeType === "Attributes") ||
            (item.partitionType === "Post" && item.sortRangeType === "Attributes")
        ) {
            const mutex = mutexes[n++ % mutexes.length]!;

            void mutex.withLock(async () => {
                try {
                    await DynamoTableSchema.executeTransaction(context, [
                        ForumTable.transactionDeleteItem(item),
                        ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheckAndWithoutEvent(
                            item,
                        ),
                    ]);
                } catch (error) {
                    // eslint-disable-next-line no-console
                    console.error("Migration transaction failed:", error);

                    if (!hasError) {
                        hasError = true;
                        firstError = error;
                    }

                    if (!hasSystemError && isSystemError(error)) {
                        hasSystemError = true;
                        firstSystemError = error;
                    }
                }
            });
        }
    }

    await runAllPromises(mutexes.map(mutex => mutex.waitForUnlock()));

    if (hasSystemError) throw firstSystemError;
    if (hasError) throw firstError;
}

export async function seedTestChannels(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
) {
    assert(process.env.NODE_ENV !== "production");
    const {testChannelId, defaultSpaceId} = getDynamoSeedConstants();

    // We're ok not sending a realtime event when seeding.
    const {wasCreated} = await ForumRealtimeTable.dangerouslyCreateItemIfNoneExistsWithoutEvent(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Attributes",
            channelId: testChannelId,
            spaceId: defaultSpaceId,
            createdTime: new Date(),
            creatorId: null,
            name: "Test",
            description: emptyMessageContent,
        },
    );

    if (wasCreated) {
        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: defaultSpaceId,
            update: {
                type: "Channel",
                channelId: testChannelId,
                // Nothing depends on this entity when it's created. Don't bother trying to
                // reindex dependencies.
                updatedTraits: {type: "None"},
            },
        });
    }
}

/**
 * Create a new channel.
 */
export async function createChannel(
    context: Context<ServerSessionActionContextModules & {edge: EdgeServiceContextModuleBase}>,
    {spaceId, name}: {spaceId: SpaceId; name: string},
): Promise<{
    id: ChannelId;
    createdTime: Date;
}> {
    await authorizeSpaceAccess(context, spaceId);

    const channelItem: ChannelAttributesItem = {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId: generateId(),
        spaceId,
        createdTime: new Date(),
        creatorId: context.actor.getAccountId(),
        name,
        description: emptyMessageContent,
    };

    await ForumRealtimeTable.createItem(context, channelItem);

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Channel",
            channelId: channelItem.channelId,
            // Nothing depends on this entity when it's created. Don't bother trying to
            // reindex dependencies.
            updatedTraits: {type: "None"},
        },
    });

    context.process.waitUntil(
        markSearchAffinityInteraction(context, {
            spaceId,
            affinityId: `Channel:${channelItem.channelId}`,
            interaction: {type: "HighIntentUpdate"},
        }),
    );

    return {
        id: channelItem.channelId,
        createdTime: channelItem.createdTime,
    };
}

/**
 * Gets the channel object with the provided ID. Returns null if the channel
 * doesn't exist, returns a `Result` with a `PermissionDeniedError` if access
 * isn't authorized.
 *
 * Sometimes calling code wants to handle these error cases by discarding the
 * channel instead of returning null.
 */
export async function getChannelIfPossible(
    context: ServerActionContext,
    channelId: ChannelId,
): Promise<Result<ChannelModel, PermissionDeniedError> | null> {
    const channelItem = await ForumRealtimeTable.getItemIfExists(context, {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId,
    });
    if (!channelItem) return null;

    try {
        await authorizeSpaceAccess(context, channelItem.spaceId);
    } catch (error) {
        if (error instanceof PermissionDeniedError) {
            return {ok: false, error};
        } else {
            throw error;
        }
    }

    return {
        ok: true,
        value: await createChannelModelFromItem(context, channelItem),
    };
}

async function createChannelModelFromItem(
    context: ServerActionContext,
    item: {
        readonly channelId: ChannelId;
        readonly spaceId: SpaceId;
        readonly createdTime: Date;
        readonly name: string;
        readonly description: MessageContent;
    },
): Promise<ChannelModel> {
    return new ChannelModel({
        id: item.channelId,
        spaceId: item.spaceId,
        createdTime: item.createdTime,
        name: item.name,
        description: {
            doc: item.description,
            references: await getContentReferencesForNode(context, item.spaceId, item.description),
        },
    });
}

/**
 * Gets the channel object with the provided ID. Returns null if the channel
 * doesn't exist or throws if you don't have access to the channel.
 */
export async function getChannelIfExists(
    context: ServerActionContext,
    channelId: ChannelId,
): Promise<ChannelModel | null> {
    const channel = await getChannelIfPossible(context, channelId);
    if (!channel) return null;
    return unwrapResult(channel);
}

/**
 * Gets the channel object with the provided ID. Throws if the channel doesn't
 * exist or you don't have access to the channel.
 */
export async function getChannel(
    context: ServerActionContext,
    channelId: ChannelId,
): Promise<ChannelModel> {
    const channel = await getChannelIfExists(context, channelId);
    if (!channel) throw new NotFoundError("Channel not found");
    return channel;
}

const ChannelPreviewCache = new ContextCache<ChannelId, ChannelPreviewModel | null>();

export function getChannelPreviewIfExists(
    context: ServerActionContext,
    id: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<ChannelPreviewModel | null> {
    const get = async () => {
        const channelItem = await ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Channel",
                sortRangeType: "Attributes",
                channelId: id,
            },
            {
                attributes: ["spaceId", "createdTime", "name"],
                consistency,
            },
        );
        if (!channelItem) return null;

        await authorizeSpaceAccess(context, channelItem.spaceId);

        return new ChannelPreviewModel({
            id: channelItem.channelId,
            spaceId: channelItem.spaceId,
            createdTime: channelItem.createdTime,
            name: channelItem.name,
        });
    };

    if (consistency === "Strong") {
        const getPromise = get();
        ChannelPreviewCache.set(context, id, getPromise);
        return getPromise;
    } else {
        return ChannelPreviewCache.get(context, id, get);
    }
}

/**
 * Gets a preview channel object with the provided ID. Returns null if the
 * channel doesn't exist and throws an error if the channel exists but you
 * don't have access to the channel.
 */
export async function getChannelPreview(
    context: ServerActionContext,
    id: ChannelId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<ChannelPreviewModel> {
    const channel = await getChannelPreviewIfExists(context, id, options);
    if (!channel) throw new NotFoundError("Channel not found");
    return channel;
}

/**
 * Get the channel name and description content without references. Used for
 * building a search entity which will load content references on its own in a
 * way that tracks dependencies.
 */
export async function getChannelNameAndDescriptionContent(
    context: ServerActionContext,
    id: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<{
    name: string;
    description: MessageContent;
    createdTime: Date;
    creatorId: AccountId | null;
}> {
    const channelItem = await ForumRealtimeTable.getItem(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Attributes",
            channelId: id,
        },
        {consistency},
    );

    await authorizeSpaceAccess(context, channelItem.spaceId);

    return {
        name: channelItem.name,
        description: channelItem.description,
        createdTime: channelItem.createdTime,
        creatorId: channelItem.creatorId,
    };
}

/**
 * Authorize that the current user has access to a channel. Implicitly also authorizes
 * that the current user has access to the space the channel is in.
 *
 * This function is mostly strongly consistent. It's safe to use in strongly
 * consistent contexts. If an account just got access this function will pass
 * with strong consistency. If an account lost access we have to wait for
 * DynamoDB's eventual consistency lag before this function will start
 * throwing.
 */
export async function authorizeChannelAccess(
    context: ServerActionContext,
    id: ChannelId,
): Promise<{spaceId: SpaceId}> {
    let channel = await getChannelPreview(context, id);

    if (!channel) {
        channel = await getChannelPreview(context, id, {consistency: "Strong"});
    }

    if (!channel) {
        throw new NotFoundError("Channel not found");
    }

    return {spaceId: channel.spaceId};
}

/**
 * Updates the name of the channel.
 */
export async function updateChannelName(
    context: Context<ServerActionContextModules & {edge: EdgeServiceContextModuleBase}>,
    {
        channelId,
        name,
    }: {
        channelId: ChannelId;
        name: string;
    },
) {
    // Give the user a nice error message if there was an error validating the new
    // channel name.
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    let spaceId: SpaceId | null = null;

    await ForumRealtimeTable.updateItem(
        context,
        {partitionType: "Channel", sortRangeType: "Attributes", channelId},
        async channelItem => {
            if (!channelItem) throw new NotFoundError("Channel not found");
            spaceId = channelItem.spaceId;
            await authorizeSpaceAccess(context, spaceId);

            return {
                ...channelItem,
                name,
            };
        },
    );

    assert(spaceId);

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Channel",
            channelId,
            updatedTraits: {type: "Some", traits: ["Preview"]},
        },
    });
}

/**
 * Updates the description of the channel.
 */
export async function updateChannelDescription(
    context: Context<ServerActionContextModules & {edge: EdgeServiceContextModuleBase}>,
    {
        channelId,
        description,
    }: {
        channelId: ChannelId;
        description: MessageContent;
    },
) {
    let spaceId: SpaceId | null = null;

    await ForumRealtimeTable.updateItem(
        context,
        {partitionType: "Channel", sortRangeType: "Attributes", channelId},
        async channelItem => {
            if (!channelItem) throw new NotFoundError("Channel not found");
            spaceId = channelItem.spaceId;
            await authorizeSpaceAccess(context, spaceId);

            return {
                ...channelItem,
                description,
            };
        },
    );

    assert(spaceId);

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Channel",
            channelId,
            updatedTraits: {type: "Some", traits: []},
        },
    });
}

/**
 * Get the latest posts in a channel in reverse chronological order. The newest
 * post will be the first in the array.
 */
export async function getChannelPosts(
    context: Context<ServerActionContextModules & {edge: EdgeServiceContextModuleBase}>,
    {
        channelId,
        limit,
        beforeCursor,
    }: {
        channelId: ChannelId;
        limit: number;
        beforeCursor: DynamoIndexCursor | null;
    },
): Promise<DynamoGeneralRealtimeIndexQueryResult<PostModel>> {
    const [, result] = await runAllPromises([
        authorizeChannelAccess(context, channelId),
        ChannelPostsIndex.realtimeQuery(context, {
            partitionKey: {channelId},
            limit,
            paginate: {type: "FromEnd", beforeCursor},
        }),
    ]);

    return result;
}

/**
 * Backfill any realtime updates to catch up our client after it's been
 * disconnected from realtime.
 */
export async function backfillChannelPosts(
    context: Context<ServerSessionActionContextModules & {edge: EdgeServiceContextModuleBase}>,
    {channelId, readTime}: {channelId: ChannelId; readTime: Date},
): Promise<DynamoGeneralRealtimeBackfillResult<PostModel>> {
    const [, result] = await runAllPromises([
        authorizeChannelAccess(context, channelId),
        ChannelPostsIndex.backfillRealtimeQuery(context, {
            partitionKey: {channelId},
            readTime,
        }),
    ]);

    return result;
}

/**
 * Create a new post by the current account in the provided channel.
 */
export async function createPost(
    context: ServerSessionActionContext,
    {channelId, content}: {channelId: ChannelId; content: PostContent},
): Promise<{
    id: PostId;
    spaceId: SpaceId;
    createdTime: Date;
}> {
    const channel = await getChannelPreview(context, channelId);

    const mentionCountByAccountId = getMentionCountByAccountIdInContent(content);

    const postItem: PostAttributesItem = {
        partitionType: "Post",
        sortRangeType: "Attributes",
        postId: generateId(),
        spaceId: channel.spaceId,
        channelId: channel.id,
        // NOTE(calebmer): Our tests override `Date.now()` to mock a fake time. So use
        // this slightly awkward form to let tests mock different times for post
        // creation.
        createdTime: new Date(Date.now()),
        authorId: context.actor.getAccountId(),
        content,
        contentUpdatedTime: null,
        commentsSummary: {
            nextCommentIndex: 0,
            lastChangeTime: null,
            commentCountByAuthorId: new Map(),
            mentionCountByAccountId,
        },
    };

    await ForumRealtimeTable.createItem(context, postItem);

    const mentionedAccountIds = getMentionedAccountIdsInContent(content);

    context.jobs.send({
        type: "NotificationEvent",
        event: {
            type: "CreatePost",
            id: generateId(),
            spaceId: channel.spaceId,
            channelId: postItem.channelId,
            postId: postItem.postId,
            createdTime: postItem.createdTime,
            authorId: postItem.authorId,
            mentionedAccountIds,
            contentSnippet: getNotificationPostContentSnippet(content),
        },
    });

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId: channel.spaceId,
        update: {
            type: "Post",
            postId: postItem.postId,
            // Nothing depends on this entity when it's created. Don't bother trying to
            // reindex dependencies.
            updatedTraits: {type: "None"},
        },
    });

    // Posting in a channel accrues affinity points to the channel the post was
    // made in. Choosing a channel to post in probably means the channel is
    // relevant to you.
    //
    // We don't give posts themselves affinity points. That's because posts are
    // fairly short lived (a couple days). However, we give channels affinity
    // points so you could quickly jump to a channel if you're looking for a
    // certain post inside the channel.
    context.process.waitUntil(
        markSearchAffinityInteraction(context, {
            spaceId: channel.spaceId,
            affinityId: `Channel:${channel.id}`,
            interaction: {type: "MediumIntentUpdate"},
        }),
    );

    // Increase affinity points for all mentioned accounts with a high intent
    // update since the user clearly wants the attention of the mentioned accounts.
    //
    // (If a mentioned account doesn't have access to this message should that
    // still be a high intent update? For now we say yes since the user is
    // explicitly choosing to reference them.)
    for (const mentionedAccountId of mentionedAccountIds) {
        context.process.waitUntil(async () => {
            if (await isAccountMemberOfSpace(context, channel.spaceId, mentionedAccountId)) {
                await markSearchAffinityInteraction(context, {
                    spaceId: channel.spaceId,
                    affinityId: `Account:${mentionedAccountId as AccountId}`,
                    interaction: {type: "HighIntentUpdate"},
                });
            }
        });
    }

    return {
        id: postItem.postId,
        spaceId: channel.spaceId,
        createdTime: postItem.createdTime,
    };
}

/**
 * Gets the post with the provided `PostId`.
 */
export async function getPost(context: ServerActionContext, id: PostId): Promise<PostModel> {
    const postItem = await ForumRealtimeTable.getItem(context, {
        partitionType: "Post",
        sortRangeType: "Attributes",
        postId: id,
    });

    return createPostModelFromItem(
        context,
        getChannelPreview(context, postItem.channelId),
        postItem,
    );
}

export async function getPostContentAndChannel(
    context: ServerActionContext,
    id: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<{
    createdTime: Date;
    authorId: AccountId;
    content: PostContent;
    channel: ChannelPreviewModel;
}> {
    const postItem = await ForumRealtimeTable.getItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId: id,
        },
        {consistency},
    );

    const channel = await getChannelPreview(context, postItem.channelId, {consistency});

    return {
        createdTime: postItem.createdTime,
        authorId: postItem.authorId,
        content: postItem.content,
        channel,
    };
}

async function createPostModelFromItem(
    context: ServerActionContext,
    channelPromise: MaybePromise<ChannelPreviewModel>,
    item: {
        readonly postId: PostId;
        readonly spaceId: SpaceId;
        readonly createdTime: Date;
        readonly channelId: ChannelId;
        readonly authorId: AccountId;
        readonly content: PostContent;
        readonly contentUpdatedTime: Date | null;
        readonly commentsSummary: {
            readonly commentCountByAuthorId: ReadonlyMap<AccountId, number>;
            readonly lastChangeTime: Date | null;
        };
    },
): Promise<PostModel> {
    const [channel, author, previewCommentAuthors, contentReferences] = await runAllPromises([
        channelPromise,
        getAccount(context, item.spaceId, item.authorId),
        runAllPromises(
            Array.from(
                sliceIterable(
                    item.commentsSummary.commentCountByAuthorId.keys(),
                    0,
                    maxPostPreviewCommentAuthorCount,
                ),
                accountId => getAccount(context, item.spaceId, accountId),
            ),
        ),
        getContentReferencesForNode(context, item.spaceId, item.content),
    ]);

    assert(channel.id === item.channelId);

    return new PostModel({
        id: item.postId,
        spaceId: item.spaceId,
        channel,
        createdTime: item.createdTime,
        author,
        content: {
            doc: item.content,
            references: contentReferences,
        },
        contentUpdatedTime: item.contentUpdatedTime,
        commentCount: reduceIterable(
            item.commentsSummary.commentCountByAuthorId.values(),
            (commentCount, authorCommentCount) => commentCount + authorCommentCount,
            0,
        ),
        lastCommentChangeTime: item.commentsSummary.lastChangeTime,
        commentAuthorCount: item.commentsSummary.commentCountByAuthorId.size,
        previewCommentAuthors,
    });
}

/**
 * Get the `ChannelPreviewModel` for a post and the `AccountModel` who authored
 * the post.
 */
export async function getPostAuthorAndChannelPreview(context: ServerActionContext, postId: PostId) {
    const postItem = await ForumRealtimeTable.getPartialItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            attributes: ["spaceId", "authorId", "channelId"],
        },
    );

    const [author, channel] = await runAllPromises([
        getAccount(context, postItem.spaceId, postItem.authorId),
        getChannelPreview(context, postItem.channelId),
    ]);

    return {author, channel};
}

/**
 * Get accounts subscribed to notifications for the provided `PostId`.
 */
export async function getPostNotificationSubscribers(
    context: ServerSystemActionContext,
    id: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<{
    accountIds: ReadonlySet<AccountId | ContentMentionAccountId>;
    postCreatedTime: Date;
}> {
    const postItem = await ForumRealtimeTable.getPartialItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId: id,
        },
        {
            attributes: ["createdTime", "authorId", "spaceId", "channelId", "commentsSummary"],
            consistency,
        },
    );

    const accountIds = new Set<ContentMentionAccountId>(
        concatIterables(
            [postItem.authorId],
            postItem.commentsSummary.commentCountByAuthorId.keys(),
            postItem.commentsSummary.mentionCountByAccountId.keys(),
        ),
    );

    return {
        accountIds,
        postCreatedTime: postItem.createdTime,
    };
}

/**
 * Update the contents of a post if you are the post's author.
 */
export async function updatePostContent(
    context: Context<ServerSessionActionContextModules & {edge: EdgeServiceContextModuleBase}>,
    {postId, content}: {postId: PostId; content: PostContent},
): Promise<{contentUpdatedTime: Date}> {
    let spaceId: SpaceId | null = null;
    let contentUpdatedTime: Date | null = null;

    await ForumRealtimeTable.updateItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        async postItem => {
            if (!postItem) throw new NotFoundError("Post not found");
            await authorizeChannelAccess(context, postItem.channelId);

            if (postItem.authorId !== context.actor.getAccountId())
                throw new PermissionDeniedError("Can only update post comments you authored");

            spaceId = postItem.spaceId;

            contentUpdatedTime = new Date(
                postItem.contentUpdatedTime
                    ? Math.max(postItem.contentUpdatedTime.getTime() + 1, Date.now())
                    : Date.now(),
            );

            return {
                ...postItem,
                content,
                contentUpdatedTime,
                commentsSummary: {
                    ...postItem.commentsSummary,
                    mentionCountByAccountId:
                        applyMentionCountByAccountIdDifferenceFromContentUpdate(
                            postItem.commentsSummary.mentionCountByAccountId,
                            postItem.content,
                            content,
                        ),
                },
            };
        },
    );

    assert(spaceId);
    assert(contentUpdatedTime);

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Post",
            postId,
            updatedTraits: {type: "Some", traits: []},
        },
    });

    return {contentUpdatedTime};
}

/**
 * Get all the authors on a post to a certain limit.
 */
export async function getPostCommentAuthors(
    context: ServerActionContext,
    {postId, limit}: {postId: PostId; limit: number},
): Promise<Array<AccountModel>> {
    const postItem = await ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            attributes: ["spaceId", "channelId", "commentsSummary"],
        },
    );
    if (!postItem) throw new NotFoundError("Post not found");

    await authorizeChannelAccess(context, postItem.channelId);

    return runAllPromises(
        Array.from(
            sliceIterable(postItem.commentsSummary.commentCountByAuthorId.keys(), 0, limit),
            accountId => getAccount(context, postItem.spaceId, accountId),
        ),
    );
}

/**
 * Authorizes that the session user can access the provided post.
 * Implicitly also authorizes that the session user can access the channel the
 * post is in and the space the channel is in.
 *
 * This function is mostly strongly consistent. It's safe to use in strongly
 * consistent contexts. If an account just got access this function will pass
 * with strong consistency. If an account lost access we have to wait for
 * DynamoDB's eventual consistency lag before this function will start
 * throwing.
 */
export async function authorizePostAccess(
    context: ServerActionContext,
    id: PostId,
): Promise<{spaceId: SpaceId}> {
    let postItem = await ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId: id,
        },
        {
            attributes: ["spaceId", "channelId"],
        },
    );

    if (!postItem) {
        postItem = await ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId: id,
            },
            {
                attributes: ["spaceId", "channelId"],
                consistency: "Strong",
            },
        );
    }

    if (!postItem) throw new NotFoundError("Post not found");

    await authorizeChannelAccess(context, postItem.channelId);

    return {spaceId: postItem.spaceId};
}

/**
 * Add a new comment to a post.
 */
export async function createPostComment(
    context: ServerSessionActionContext,
    {
        postId,
        parentCommentIndex,
        content,
    }: {
        postId: PostId;
        parentCommentIndex: number | null;
        content: MessageContent;
    },
): Promise<{
    index: number;
    createdTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [postItem] = await runAllPromiseThunks(
            async () => {
                const postItem = await ForumRealtimeTable.getPartialItemIfExists(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "Attributes",
                        postId,
                    },
                    {
                        attributes: [
                            "spaceId",
                            "channelId",
                            "commentsSummary",
                            "updateLockVersion",
                        ],
                    },
                );
                if (!postItem) throw new NotFoundError("Post not found");
                await authorizeChannelAccess(context, postItem.channelId);

                return postItem;
            },
            async () => {
                if (typeof parentCommentIndex !== "number") return;

                const parentCommentItem = await ForumTable.getPartialItemIfExists(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "Comments",
                        postId,
                        commentIndex: parentCommentIndex,
                    },
                    {
                        attributes: [],
                    },
                );
                if (!parentCommentItem) throw new NotFoundError("Post parent comment not found");
            },
        );

        const commentIndex = postItem.commentsSummary.nextCommentIndex;
        const createdTime = new Date();
        const authorId = context.actor.getAccountId();

        const newCommentCountByAuthorId = new Map(postItem.commentsSummary.commentCountByAuthorId);
        newCommentCountByAuthorId.set(authorId, (newCommentCountByAuthorId.get(authorId) ?? 0) + 1);

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            postItem.commentsSummary.mentionCountByAccountId,
            null,
            content,
        );

        await DynamoTableSchema.executeTransaction(context, [
            ForumTable.transactionCreateItem({
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
                authorId,
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: parentCommentIndex,
                    content,
                    contentUpdatedTime: null,
                },
            }),
            // Ok for us to not tell the client about a comment summary update through our
            // general realtime system. Instead, comment counts will be updated through the
            // messaging realtime system.
            ForumRealtimeTable.transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex + 1,
                    lastChangeTime: postItem.commentsSummary.lastChangeTime,
                    commentCountByAuthorId: newCommentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),
        ]);

        const mentionedAccountIds = getMentionedAccountIdsInContent(content);

        context.jobs.send({
            type: "NotificationEvent",
            event: {
                type: "CreatePostComment",
                id: generateId(),
                spaceId: postItem.spaceId,
                postId,
                commentIndex,
                createdTime,
                authorId,
                mentionedAccountIds,
                contentSnippet: getNotificationMessageContentSnippet(content),
            },
        });

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: postItem.spaceId,
            update: {
                type: "PostComment",
                postId,
                commentIndex,
                // Nothing depends on this entity when it's created. Don't bother trying to
                // reindex dependencies.
                updatedTraits: {type: "None"},
            },
        });

        // Creating a comment on a post accrues affinity points to the channel the post
        // was made in. If you're interacting with a post this probably means the topic
        // of the post (the channel) is relevant to you as well.
        //
        // We don't give posts themselves affinity points. That's because posts are
        // fairly short lived (a couple days). However, we give channels affinity
        // points so you could quickly jump to a channel if you're looking for a
        // certain post inside the channel.
        context.process.waitUntil(
            markSearchAffinityInteraction(context, {
                spaceId: postItem.spaceId,
                affinityId: `Channel:${postItem.channelId}`,
                interaction:
                    content.nodeSize < 50
                        ? {type: "LowIntentUpdate"}
                        : {type: "MediumIntentUpdate"},
            }),
        );

        // Increase affinity points for all mentioned accounts with a high intent
        // update since the user clearly wants the attention of the mentioned accounts.
        //
        // (If a mentioned account doesn't have access to this message should that
        // still be a high intent update? For now we say yes since the user is
        // explicitly choosing to reference them.)
        for (const mentionedAccountId of mentionedAccountIds) {
            context.process.waitUntil(async () => {
                if (await isAccountMemberOfSpace(context, postItem.spaceId, mentionedAccountId)) {
                    await markSearchAffinityInteraction(context, {
                        spaceId: postItem.spaceId,
                        affinityId: `Account:${mentionedAccountId as AccountId}`,
                        interaction: {type: "HighIntentUpdate"},
                    });
                }
            });
        }

        return {
            index: commentIndex,
            createdTime,
        };
    });
}

/**
 * Get a single post comment.
 */
export async function getPostComment(
    context: ServerActionContext,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<PostCommentModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizePostAccess(context, postId),
        ForumTable.getItem(context, {
            partitionType: "Post",
            sortRangeType: "Comments",
            postId,
            commentIndex,
        }),
    ]);

    return createPostCommentModelFromItem(context, spaceId, item);
}

/**
 * Get a single post comment's payload.
 */
export async function getPostCommentPayload(
    context: ServerActionContext,
    {
        postId,
        commentIndex,
        consistency = "Eventual",
    }: {
        postId: PostId;
        commentIndex: number;
        consistency?: DynamoReadConsistency;
    },
): Promise<{
    createdTime: Date;
    authorId: AccountId;
    payload: MessagePayload;
}> {
    const [, item] = await runAllPromises([
        authorizePostAccess(context, postId),
        ForumTable.getItem(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            },
            {consistency},
        ),
    ]);

    return {
        createdTime: item.createdTime,
        authorId: item.authorId,
        payload: item.payload,
    };
}

async function createPostCommentModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    item: PostCommentItem,
): Promise<PostCommentModel> {
    const [author, payload] = await runAllPromises([
        getAccount(context, spaceId, item.authorId),
        createMessagePayloadModel(context, spaceId, item.payload),
    ]);

    return new PostCommentModel({
        postId: item.postId,
        index: item.commentIndex,
        author,
        createdTime: item.createdTime,
        payload,
    });
}

/**
 * Update the content on one of your post comments.
 */
export function updatePostCommentContent(
    context: ServerSessionActionContext,
    {
        postId,
        commentIndex,
        content,
    }: {
        postId: PostId;
        commentIndex: number;
        content: MessageContent;
    },
): Promise<{
    contentUpdatedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [postItem, commentItem] = await runAllPromises([
            ForumRealtimeTable.getPartialItemIfExists(
                context,
                {
                    partitionType: "Post",
                    sortRangeType: "Attributes",
                    postId,
                },
                {
                    attributes: [
                        "channelId",
                        "createdTime",
                        "commentsSummary",
                        "updateLockVersion",
                    ],
                },
            ),
            ForumTable.getItemIfExists(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

        if (!postItem) throw new NotFoundError("Post not found");
        if (!commentItem) throw new NotFoundError("Post comment not found");

        const {spaceId} = await authorizeChannelAccess(context, postItem.channelId);

        if (commentItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only update post comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not update comments with a non-content payload");

        const contentUpdatedTime = new Date(
            Math.max(
                (postItem.commentsSummary.lastChangeTime ?? postItem.createdTime).getTime() + 1,
                Date.now(),
            ),
        );

        // `lastChangeTime` should always be greater than or equal
        // to `contentUpdatedTime`.
        assert(
            !commentItem.payload.contentUpdatedTime ||
                contentUpdatedTime > commentItem.payload.contentUpdatedTime,
        );

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            postItem.commentsSummary.mentionCountByAccountId,
            commentItem.payload.content,
            content,
        );

        await DynamoTableSchema.executeTransaction(context, [
            ForumTable.transactionDirectlyUpdateItem({
                ...commentItem,
                payload: {
                    ...commentItem.payload,
                    content,
                    contentUpdatedTime,
                },
            }),
            // Ok for us to not tell the client about a comment summary update through our
            // general realtime system. Instead, comment counts will be updated through the
            // messaging realtime system.
            ForumRealtimeTable.transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex,
                    lastChangeTime: contentUpdatedTime,
                    commentCountByAuthorId: postItem.commentsSummary.commentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),
            // Create-or-replace is safe because the change time is guaranteed to be unique
            // and monotonically increasing.
            ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "CommentChangeLog",
                postId,
                changeTime: contentUpdatedTime,
                commentIndex: commentItem.commentIndex,
                change: {
                    type: "UpdateContent",
                    content,
                },
                expirationTime: getMessageChangeLogExpirationTimeFromChangeTime(contentUpdatedTime),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId,
            update: {
                type: "PostComment",
                postId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {contentUpdatedTime};
    });
}

/**
 * Delete a single post comment.
 */
export function deletePostComment(
    context: ServerSessionActionContext,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<{deletedTime: Date}> {
    return context.dynamo.retryTransaction(async context => {
        const [postItem, commentItem] = await runAllPromises([
            ForumRealtimeTable.getItemIfExists(context, {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            }),
            ForumTable.getItemIfExists(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

        if (!postItem) throw new NotFoundError("Post not found");
        if (!commentItem) throw new NotFoundError("Post comment not found");

        const {spaceId} = await authorizeChannelAccess(context, postItem.channelId);

        if (commentItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only delete post comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not delete comments with a non-content payload");

        const deletedTime = new Date(
            Math.max(
                (postItem.commentsSummary.lastChangeTime ?? postItem.createdTime).getTime() + 1,
                Date.now(),
            ),
        );

        // `lastChangeTime` should always be greater than or equal
        // to `deletedTime`.
        assert(
            !commentItem.payload.contentUpdatedTime ||
                deletedTime > commentItem.payload.contentUpdatedTime,
        );

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            postItem.commentsSummary.mentionCountByAccountId,
            commentItem.payload.content,
            null,
        );

        await DynamoTableSchema.executeTransaction(context, [
            ForumTable.transactionDirectlyUpdateItem({
                ...commentItem,
                payload: {type: "Deleted", deletedTime},
            }),
            // Ok for us to not tell the client about a comment summary update through our
            // general realtime system. Instead, comment counts will be updated through the
            // messaging realtime system.
            ForumRealtimeTable.transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex,
                    lastChangeTime: deletedTime,
                    commentCountByAuthorId: postItem.commentsSummary.commentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),
            // Create-or-replace is safe because the change time is guaranteed to be unique
            // and monotonically increasing.
            ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "CommentChangeLog",
                postId,
                changeTime: deletedTime,
                commentIndex: commentItem.commentIndex,
                change: {type: "Delete"},
                expirationTime: getMessageChangeLogExpirationTimeFromChangeTime(deletedTime),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId,
            update: {
                type: "PostComment",
                postId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {deletedTime};
    });
}

/**
 * Gets both the post model and the first few comments for the post in
 * one request.
 */
export async function getPostAndInitialComments(
    context: ServerActionContext,
    {
        postId,
        commentLimit,
    }: {
        postId: PostId;
        commentLimit: number;
    },
): Promise<{
    post: PostModel;
    initialComments: Array<PostCommentModel>;
    initialOtherReferencedComments: Array<PostCommentModel>;
}> {
    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable = ForumTable.query(context, {
        partitionKey: {
            partitionType: "Post",
            postId,
        },
        startSortKey: {
            sortRangeType: "Comments",
            commentIndex: 0,
        },
        endSortKey: {
            sortRangeType: "Comments",
            commentIndex: Number.MAX_SAFE_INTEGER,
        },
        // Add one to the limit for the post attributes item.
        limit: commentLimit + 1,
    });

    // Important that this comes after the query call since we want to load the
    // query and post item in parallel.
    const postItem = await ForumRealtimeTable.getItem(context, {
        partitionType: "Post",
        sortRangeType: "Attributes",
        postId,
    });

    const commentPromises: Array<Promise<PostCommentModel>> = [];

    const commentIndexes = new Set<number>();
    const parentCommentIndexes = new Set<number>();

    for await (const item of queryIterable) {
        commentIndexes.add(item.commentIndex);

        if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null)
            parentCommentIndexes.add(item.payload.parentMessageIndex);

        commentPromises.push(createPostCommentModelFromItem(context, postItem.spaceId, item));
    }

    const [post, comments, otherReferencedComments] = await runAllPromises([
        createPostModelFromItem(context, getChannelPreview(context, postItem.channelId), postItem),
        runAllPromises(commentPromises),
        runAllPromises(
            filterMapIterable(parentCommentIndexes, parentCommentIndex => {
                if (commentIndexes.has(parentCommentIndex)) return null;

                return (async () => {
                    const commentItem = await ForumTable.getItemIfExists(context, {
                        partitionType: "Post",
                        sortRangeType: "Comments",
                        postId,
                        commentIndex: parentCommentIndex,
                    });
                    if (!commentItem) throw new InternalError("Parent comment not found");

                    return createPostCommentModelFromItem(context, postItem.spaceId, commentItem);
                })();
            }),
        ),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        post:
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            post.commentCount < lastCommentIndex + 1
                ? post.clone({commentCount: lastCommentIndex + 1})
                : post,
        initialComments: comments,
        initialOtherReferencedComments: otherReferencedComments,
    };
}

/**
 * Paginate through post comments from start to finish.
 */
export async function getPostCommentsFromStart(
    context: ServerActionContext,
    {
        postId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        postId: PostId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<PostCommentModel>;
    otherReferencedComments: Array<PostCommentModel>;
    lastCommentChangeTime: Date | null;
}> {
    const postItemPromise = ForumRealtimeTable.getPartialItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            attributes: ["spaceId", "channelId", "commentsSummary"],
        },
    );

    const [postItem, {comments, otherReferencedComments}] = await runAllPromises([
        postItemPromise,
        getPostCommentsFromStartAssumingAuthorizedPost(context, {
            postId,
            getSpaceId: () => postItemPromise.then(({spaceId}) => spaceId),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
        postItemPromise.then(({channelId}) => authorizeChannelAccess(context, channelId)),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            reduceIterable(
                postItem.commentsSummary.commentCountByAuthorId.values(),
                (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                0,
            ),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
        otherReferencedComments,
        lastCommentChangeTime: postItem.commentsSummary.lastChangeTime,
    };
}

async function getPostCommentsFromStartAssumingAuthorizedPost(
    context: ServerActionContext,
    {
        postId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency = "Eventual",
    }: {
        postId: PostId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<{
    comments: Array<PostCommentModel>;
    otherReferencedComments: Array<PostCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const commentItems = await arrayFromAsyncIterable(
        ForumTable.query(context, {
            partitionKey: {
                partitionType: "Post",
                postId,
            },
            startSortKey: {
                sortRangeType: "Comments",
                commentIndex: typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
            },
            endSortKey: {
                sortRangeType: "Comments",
                commentIndex:
                    typeof beforeCommentIndex === "number"
                        ? beforeCommentIndex - 1
                        : Number.MAX_SAFE_INTEGER,
            },
            limit,
            consistency,
        }),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.commentIndex;
    const endCommentIndex = commentItems[commentItems.length - 1]!.commentIndex;

    const spaceId = await getSpaceId();

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<PostCommentModel> = [];

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await ForumTable.getItemIfExists(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "Comments",
                        postId,
                        commentIndex,
                    },
                    {consistency},
                );
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                    loadOtherReferencedComment(item.payload.parentMessageIndex);
                }

                otherReferencedComments.push(
                    await createPostCommentModelFromItem(context, spaceId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                loadOtherReferencedComment(item.payload.parentMessageIndex);
            }

            // Don't propagate `consistency` when loading model references. We
            // accept references can have eventual consistency.
            return createPostCommentModelFromItem(context, spaceId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A
    // referenced comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}

/**
 * Paginate through post comments from finish to start.
 */
export async function getPostCommentsFromEnd(
    context: ServerActionContext,
    {
        postId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        postId: PostId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<PostCommentModel>;
    otherReferencedComments: Array<PostCommentModel>;
    lastCommentChangeTime: Date | null;
}> {
    const postItemPromise = ForumRealtimeTable.getPartialItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            attributes: ["spaceId", "channelId", "commentsSummary"],
        },
    );

    const [postItem, {comments, otherReferencedComments}] = await runAllPromises([
        postItemPromise,
        getPostCommentsFromEndAssumingAuthorizedPost(context, {
            postId,
            getSpaceId: () => postItemPromise.then(({spaceId}) => spaceId),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
        postItemPromise.then(({channelId}) => authorizeChannelAccess(context, channelId)),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            reduceIterable(
                postItem.commentsSummary.commentCountByAuthorId.values(),
                (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                0,
            ),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
        otherReferencedComments,
        lastCommentChangeTime: postItem.commentsSummary.lastChangeTime,
    };
}

async function getPostCommentsFromEndAssumingAuthorizedPost(
    context: ServerActionContext,
    {
        postId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        postId: PostId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    comments: Array<PostCommentModel>;
    otherReferencedComments: Array<PostCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const commentItems = await arrayFromAsyncIterable(
        typeof beforeCommentIndex !== "number" || beforeCommentIndex > 0
            ? ForumTable.query(context, {
                  partitionKey: {
                      partitionType: "Post",
                      postId,
                  },
                  startSortKey: {
                      sortRangeType: "Comments",
                      commentIndex:
                          typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
                  },
                  endSortKey: {
                      sortRangeType: "Comments",
                      commentIndex:
                          typeof beforeCommentIndex === "number"
                              ? beforeCommentIndex - 1
                              : Number.MAX_SAFE_INTEGER,
                  },
                  limit,
                  // Scan backwards from `endSortKey` to `startSortKey` so we can get comments
                  // at the end instead of start.
                  descending: true,
              })
            : (async function* () {})(),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const endCommentIndex = commentItems[0]!.commentIndex;
    const startCommentIndex = commentItems[commentItems.length - 1]!.commentIndex;

    const spaceId = await getSpaceId();

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<PostCommentModel> = [];

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await ForumTable.getItemIfExists(context, {
                    partitionType: "Post",
                    sortRangeType: "Comments",
                    postId,
                    commentIndex,
                });
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                    loadOtherReferencedComment(item.payload.parentMessageIndex);
                }

                otherReferencedComments.push(
                    await createPostCommentModelFromItem(context, spaceId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                loadOtherReferencedComment(item.payload.parentMessageIndex);
            }
            return createPostCommentModelFromItem(context, spaceId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A
    // referenced comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    // We queried in descending order so put comments back in the right order.
    comments.reverse();

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}

export type PostCommentChangesResult =
    | {
          type: "Available";
          changes: Array<MessageChange>;
      }
    | {
          type: "Unavailable";
      };

/**
 * Backfills any missing comments or comment updates for a client. The client
 * provides what it knows to be the comment count and last change time then we
 * return any new comments or changes since then.
 *
 * We run this when the client establishes a new realtime connection to catch
 * the client up between their last data load and the time the realtime
 * connection was established.
 *
 * `newCommentLimit` allows you to load some new comments that the client
 * may be missing but only up to the limit.
 *
 * We do not keep a log of post comment changes around forever, so it's
 * possible that you get an `Unavailable` result for
 * `commentChangesResult`. When this happens you should throw away all data
 * your client has loaded and try loading the data again.
 */
export async function backfillPostComments(
    context: ServerActionContext,
    {
        postId,
        clientCommentCount,
        clientLastCommentChangeTime,
        newCommentLimit,
    }: {
        postId: PostId;
        clientCommentCount: number;
        clientLastCommentChangeTime: Date | null;
        newCommentLimit: number;
    },
): Promise<{
    commentCount: number;
    lastCommentChangeTime: Date | null;
    newComments: Array<PostCommentModel>;
    newOtherReferencedComments: Array<PostCommentModel>;
    commentChangesResult: PostCommentChangesResult;
}> {
    const postItemPromise = ForumRealtimeTable.getPartialItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            attributes: ["spaceId", "channelId", "createdTime", "commentsSummary"],
        },
    );

    const [postItem, {comments, otherReferencedComments}, commentChangesResult] =
        await runAllPromises([
            postItemPromise,
            getPostCommentsFromStartAssumingAuthorizedPost(context, {
                postId,
                getSpaceId: () => postItemPromise.then(({spaceId}) => spaceId),
                limit: newCommentLimit,
                afterCommentIndex: clientCommentCount - 1,
                beforeCommentIndex: null,
                // Use a strong read consistency when backfilling. This guarantees the caller
                // will observe all realtime events before this function call. Realtime events
                // that happen during the function call may be missed. You should be subscribed
                // to new realtime events before starting to backfill.
                consistency: "Strong",
            }),
            postItemPromise.then(postItem =>
                queryPostCommentChangeLogAssumingAuthorizedPost(context, {
                    postItem,
                    lastCommentChangeTime: clientLastCommentChangeTime,
                    // Use a strong read consistency when backfilling. This guarantees the caller
                    // will observe all realtime events before this function call. Realtime events
                    // that happen during the function call may be missed. You should be subscribed
                    // to new realtime events before starting to backfill.
                    consistency: "Strong",
                }),
            ),
            postItemPromise.then(({channelId}) => authorizeChannelAccess(context, channelId)),
        ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    const lastCommentChangeTime =
        commentChangesResult.type === "Available" && commentChangesResult.changes.length > 0
            ? getMessageChangeTime(
                  commentChangesResult.changes[commentChangesResult.changes.length - 1]!,
              )
            : null;

    return {
        commentCount: Math.max(
            reduceIterable(
                postItem.commentsSummary.commentCountByAuthorId.values(),
                (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                0,
            ),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        lastCommentChangeTime:
            lastCommentChangeTime &&
            // Make sure `lastCommentChangeTime` is consistent with
            // `commentChangesResult` in case of eventual consistency race conditions.
            (!postItem.commentsSummary.lastChangeTime ||
                lastCommentChangeTime > postItem.commentsSummary.lastChangeTime)
                ? lastCommentChangeTime
                : postItem.commentsSummary.lastChangeTime,
        newComments: comments,
        newOtherReferencedComments: otherReferencedComments,
        commentChangesResult,
    };
}

async function queryPostCommentChangeLogAssumingAuthorizedPost(
    context: ServerActionContext,
    {
        postItem,
        lastCommentChangeTime,
        consistency = "Eventual",
    }: {
        postItem: Pick<
            PostAttributesItem,
            "postId" | "spaceId" | "createdTime" | "commentsSummary"
        >;
        lastCommentChangeTime: Date | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<PostCommentChangesResult> {
    // No changes occurred during the backfill period, there is nothing we need
    // to query.
    if (postItem.commentsSummary.lastChangeTime?.getTime() === lastCommentChangeTime?.getTime())
        return {type: "Available", changes: []};

    const lastCommentChangeExpirationTime = getMessageChangeLogExpirationTimeFromChangeTime(
        lastCommentChangeTime ?? postItem.createdTime,
    );

    // If our last change item has expired then other relevant changelog entries
    // may have also expired. The client will need to fully reset its state since
    // we don't have the data necessary to backfill.
    if (
        isDatePossiblyLessThanWithUncertaintyWindow(
            lastCommentChangeExpirationTime,
            // Use `Date.now()` so tests can mock the `Date.now()` function.
            new Date(Date.now()),
        )
    ) {
        return {type: "Unavailable"};
    }

    const changes = await parallelMapAsyncIterableToArray(
        ForumTable.query(context, {
            partitionKey: {
                partitionType: "Post",
                postId: postItem.postId,
            },
            startSortKey: {
                sortRangeType: "CommentChangeLog",
                changeTime: new Date((lastCommentChangeTime ?? postItem.createdTime).getTime() + 1),
            },
            endSortKey: {
                sortRangeType: "CommentChangeLog",
                changeTime: DynamoKeyAttributeSchema.date.maxValue,
            },
            limit: "All",
            consistency,
        }),
        async (item): Promise<MessageChange> => {
            switch (item.change.type) {
                case "UpdateContent": {
                    return {
                        type: "UpdateContent",
                        index: item.commentIndex,
                        content: {
                            doc: item.change.content,

                            // Don't propagate `consistency` when loading content references. We
                            // accept references can have eventual consistency.
                            references: await getContentReferencesForNode(
                                context,
                                postItem.spaceId,
                                item.change.content,
                            ),
                        },
                        contentUpdatedTime: item.changeTime,
                    };
                }
                case "Delete": {
                    return {
                        type: "Delete",
                        index: item.commentIndex,
                        deletedTime: item.changeTime,
                    };
                }
                default:
                    throw exhaustive(item.change);
            }
        },
    );

    return {type: "Available", changes};
}
