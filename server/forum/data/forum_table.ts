import {authorizeInternalAccess} from "~/server/accounts/accounts_table.js";
import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionCountByAccountIdInContent,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {FilesContextModuleBase} from "~/server/context/files_context_module.js";
import {
    ServerActionContext,
    ServerActionContextModules,
    ServerSessionActionContext,
    ServerSessionActionContextModules,
    ServerSystemActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerContentActionContext} from "~/server/context/server_content_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {
    DynamoGeneralRealtimeTableItemType,
    DynamoGeneralRealtimeTableSchema,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {
    FileAuthorizer,
    attachFileFromAttachment,
    detachFile,
    getFileFromAttachment,
    getPostDraftFileAttachments,
} from "~/server/files/data/files_table.js";
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
    internalCreateAlphaSpaceAsAdmin,
    isAccountMemberOfSpace,
} from "~/server/spaces/spaces_table.js";
import {EdgeServiceContextModuleBase} from "~/server/tokens/edge_service_context_module.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {
    DynamoGeneralRealtimeBackfillResult,
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
    DynamoGeneralRealtimePutItemEvent,
    DynamoGeneralRealtimeQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    DataLossError,
    DeadlineExceededError,
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    ChannelModel,
    ChannelPostFilesModel,
    ChannelPreviewModel,
} from "~/shared/forum/channel_model.js";
import {ChannelBroadcastRealtimeEventTransactionSchema} from "~/shared/forum/channel_realtime_protocol.js";
import {
    PostContent,
    PostContentSchema,
    PostContentWithReferences,
} from "~/shared/forum/post_content_schema.js";
import {
    PostCommentModel,
    PostModel,
    maxPostPreviewCommentAuthorCount,
} from "~/shared/forum/post_model.js";
import {PostBroadcastRealtimeEventTransactionSchema} from "~/shared/forum/post_realtime_protocol.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Result} from "~/shared/helpers/control/result.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
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
    FileId,
    PostDraftId,
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
import {visitProsemirrorNode} from "~/shared/prosemirror/prosemirror_visitor.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

type ForumActionExtraBroadcastContextModules = {
    edge: EdgeServiceContextModuleBase;
    files: FilesContextModuleBase;
};

export type ForumActionContextModulesWithBroadcast = ServerActionContextModules &
    ForumActionExtraBroadcastContextModules;

export type ForumActionContextWithBroadcast = Context<ForumActionContextModulesWithBroadcast>;

export type ForumSessionActionContextModulesWithBroadcast = ServerSessionActionContextModules &
    ForumActionExtraBroadcastContextModules;

export type ForumSessionActionContextWithBroadcast =
    Context<ForumSessionActionContextModulesWithBroadcast>;

export type ForumSystemActionContextModulesWithBroadcast = ServerSystemActionContextModules &
    ForumActionExtraBroadcastContextModules;

export type ForumSystemActionContextWithBroadcast =
    Context<ForumSystemActionContextModulesWithBroadcast>;

const ForumRealtimeTable = DynamoGeneralRealtimeTableSchema.new({
    // Enable optional features we use that may incur extra costs.
    features: {
        realtimeQuery: {Channel: true},
        deleteItem: {Channel: {PostFiles: true}},
    },
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

                /**
                 * For each post with files we create a `PostFiles` item. These items are keyed
                 * by `postCreatedTime` so they're sorted by created date. We use this to show
                 * all files added to a channel.
                 */
                {
                    name: "PostFiles",
                    sortKeyAttributes: {
                        postCreatedTime: DynamoKeyAttributeSchema.date.reverse(),
                        postId: DynamoKeyAttributeSchema.id<PostId>(),
                    },
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        fileIds: Schema.set(Schema.id<FileId>()).minSize(1),
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
                // NOTE(calebmer, 2024-04-16): My current thoughts on deleting posts. Deleting
                // a post shouldn't delete the post's comments since folks may be having a
                // valuable conversation in the comments. I like the idea that deleting a post:
                //
                // - Sets `channelId` to null
                // - Replaces content with a "this post was deleted message"
                //
                // Setting `channelId` to null would remove the post in realtime from the
                // channel the user is looking at. We should also have notification processing
                // cleanup inbox entries that say the post is a part of a given channel.
                //
                // These mechanisms would also be very useful for a "move post between
                // channels" feature which I think we'll want for channel user's with the
                // "maintain" access level. So I think we should build delete post alongside
                // the ability to move posts between channels.
                //
                // Either of these operations should probably be reflected in a "log" entry in
                // the comments feed. For instance "Caleb deleted the post" or "Caleb moved the
                // post from the Engineering Q&A channel to the Design Q&A channel".
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
        ChannelPostFiles: ChannelPostFilesModel,
        Post: PostModel,
    }),
    models: {
        Channel: {
            Attributes: {
                build: (context, item) => createChannelModelFromItem(context, item),
            },
            PostFiles: {
                build: async (context, item) => {
                    const files: Array<FileModel> = await runAllPromises(
                        mapIterable(item.fileIds, fileId =>
                            getFileFromAttachment(
                                context,
                                item.spaceId,
                                fileId,
                                FilePostAuthorizer.bind({type: "Post", postId: item.postId}),
                            ),
                        ),
                    );

                    return new ChannelPostFilesModel({
                        channelId: item.channelId,
                        postId: item.postId,
                        files,
                    });
                },
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
    broadcastEventTransaction: async (context, readTime, eventTransaction) => {
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
            Array<DynamoGeneralRealtimeEvent<ChannelModel | PostModel | ChannelPostFilesModel>>
        >();

        // We also send post updates to the corresponding post durable object. That way
        // single post views that have a WebSocket connection to `PostRealtimeService`
        // will see content updates in realtime without needing to make an additional
        // connection to `ChannelRealtimeService`.
        //
        // This has some tradeoffs. It's certainly more efficient for clients to only
        // subscribe to `PostRealtimeService` and avoid receiving updates from
        // `ChannelRealtimeService` they don't care about. However, this comes at the
        // cost of an extra Durable Object request which [Cloudflare charges for][1].
        // However, by the client only subscribing to `PostRealtimeService` (and not
        // `ChannelRealtimeService`) we can avoid duration costs for both
        // `PostRealtimeService` and `ChannelRealtimeService`.
        //
        // If the client is in a channel and has a post's comments open (so is also
        // connected to both the channel durable object and post durable object) then
        // they'll receive a post content update twice. The client is smart enough to
        // dedupe these updates.
        //
        // Anyway, this should only kick in when updating a post's content. Updating a
        // post's content should be relatively rare so the extra costs aren't that
        // meaningful.
        //
        // [1]: https://developers.cloudflare.com/workers/platform/pricing/#durable-objects
        const eventTransactionByPostId = new Map<
            PostId,
            Array<DynamoGeneralRealtimeEvent<PostModel>>
        >();

        for (const eventEntry of eventTransaction) {
            if (eventEntry.itemKey.partitionType === "Channel") {
                const isChannelCreationEvent =
                    eventEntry.itemKey.sortRangeType === "Attributes" &&
                    eventEntry.event.item.version === 0;

                // Optimization: Don't broadcast channel creation events to channel durable
                // objects. No one will be subscribed to the channel durable object before the
                // channel is created.
                if (!isChannelCreationEvent) {
                    getOrSetDefaultMapValue(
                        eventTransactionByChannelId,
                        eventEntry.itemKey.channelId,
                        () => [],
                    ).push(eventEntry.event);
                }
            } else {
                const isPostCreationEvent =
                    eventEntry.itemKey.partitionType === "Post" &&
                    eventEntry.itemKey.sortRangeType === "Attributes" &&
                    eventEntry.event.item.version === 0;

                // Optimization: Don't broadcast post creation events to post durable
                // objects. No one will be subscribed to the post durable object before the
                // post is created.
                if (!isPostCreationEvent) {
                    getOrSetDefaultMapValue(
                        eventTransactionByPostId,
                        eventEntry.itemKey.postId,
                        () => [],
                    ).push(eventEntry.event as DynamoGeneralRealtimeEvent<PostModel>);
                }

                const {oldValue: oldChannelId, newValue: newChannelId} =
                    ChannelPostsIndex.getPartitionKeyAttributeFromEvent("channelId", eventEntry);

                // Send post realtime updates to the channel realtime stream the post is a
                // part of.
                if (newChannelId !== undefined) {
                    getOrSetDefaultMapValue(
                        eventTransactionByChannelId,
                        newChannelId,
                        () => [],
                    ).push(eventEntry.event);
                }

                // If the channel changed then we should send a delete event to the old channel
                // so the post doesn't stick around. We send a delete event because it would be
                // a permission violation to show send the client full item data it doesn't
                // have access to.
                //
                // TODO(calebmer, 2024-11-01): We haven't implemented moving posts between
                // channels. Once that's implemented it would be good to write a test that
                // makes sure the post is removed in realtime from its old channel.
                if (oldChannelId !== undefined && oldChannelId !== newChannelId) {
                    getOrSetDefaultMapValue(
                        eventTransactionByChannelId,
                        oldChannelId,
                        () => [],
                    ).push(
                        eventEntry.event.type !== "DeleteItem"
                            ? {
                                  type: "DeleteItem",
                                  item: {
                                      key: eventEntry.event.item.key,
                                      version: eventEntry.event.item.version,
                                  },
                                  indexes: new Set(eventEntry.event.indexes.keys()),
                              }
                            : eventEntry.event,
                    );
                }
            }
        }

        await runAllPromises(
            concatIterables(
                mapIterable(eventTransactionByChannelId, async ([channelId, eventTransaction]) => {
                    await context.edge.broadcastToDurableObject(
                        `/api/durable-objects/channels/${channelId}/broadcast-realtime-event-transaction`,
                        {
                            serviceName: "ChannelRealtimeService",
                            route: "/api/durable-objects/channels/:channelId/broadcast-realtime-event-transaction",
                            body: ChannelBroadcastRealtimeEventTransactionSchema.serialize({
                                readTime,
                                eventTransaction,
                            }),
                        },
                    );
                }),
                mapIterable(eventTransactionByPostId, async ([postId, eventTransaction]) => {
                    await context.edge.broadcastToDurableObject(
                        `/api/durable-objects/posts/${postId}/broadcast-realtime-event-transaction`,
                        {
                            serviceName: "PostRealtimeService",
                            route: "/api/durable-objects/posts/:postId/broadcast-realtime-event-transaction",
                            body: PostBroadcastRealtimeEventTransactionSchema.serialize({
                                readTime,
                                eventTransaction,
                            }),
                        },
                    );
                }),
            ),
        );
    },
});

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
        {
            name: "Account",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                /**
                 * When the user creates a post we create a `PostDraft` item for them on the
                 * backend. That way the content in their post is saved across reloads and
                 * across devices. We also can attach files to post drafts.
                 *
                 * As of 2024-10-30 we're introducing `PostDraft`s only to have a backend
                 * entity to attach files to. In the future we should show drafts in the UI and
                 * let the user resume writing a post from a draft.
                 */
                {
                    name: "PostDraft",
                    sortKeyAttributes: {
                        draftId: DynamoKeyAttributeSchema.id<PostDraftId>(),
                    },
                    attributes: Schema.object({
                        channelId: Schema.id<ChannelId>().nullable(),
                        content: PostContentSchema,
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

type ChannelPostFilesItem = DynamoGeneralRealtimeTableItemType<
    typeof ForumRealtimeTable,
    "Channel",
    "PostFiles"
>;

type PostCommentItem = DynamoTableItemType<typeof ForumTable, "Post", "Comments">;

type PostDraftItem = DynamoTableItemType<typeof ForumTable, "Account", "PostDraft">;

export const FileChannelAuthorizer = FileAuthorizer.new(
    ForumRealtimeTable,
    "Channel",
    // TODO(calebmer): Once documents get a read-only permission level we should
    // update `authorizeChannelAccess()` to support `expectedAccessLevel`.
    (context, target) => authorizeChannelAccess(context, target.channelId),
);

export const FilePostAuthorizer = FileAuthorizer.new(
    ForumRealtimeTable,
    "Post",
    async (context, target, spaceId, expectedAccessLevel) => {
        switch (target.type) {
            case "Post":
                await authorizePostAccess(context, target.postId, expectedAccessLevel);
                break;
            case "PostDraft":
                await authorizePostDraftAccess(context, spaceId, target.accountId, target.draftId);
                break;
            case "PostComment":
                await authorizePostAccess(context, target.postId, "View");
                break;
            default:
                throw exhaustive(target);
        }
    },
);

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
    context: ServerProcessContext,
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
 * Create an alpha space owned by the provided `ownerAccountId`. Only
 * administrators may call this function. We don't yet have self-serve space
 * creation.
 */
export async function createAlphaSpaceAsAdmin(
    context: ServerActionContext,
    {name, ownerAccountId}: {name: string; ownerAccountId: AccountId},
): Promise<{
    spaceId: SpaceId;
    welcomeChannelId: ChannelId;
    createdTime: Date;
}> {
    await authorizeInternalAccess(context);

    const spaceId = generateId<SpaceId>();
    const welcomeChannelId = generateId<ChannelId>();
    const createdTime = new Date();

    await internalCreateAlphaSpaceAsAdmin(context, {
        name,
        spaceId,
        createdTime,
        ownerAccountId,
        welcomeChannelId,
        createWelcomeChannelTransactionEntries: [
            // We use this when creating an alpha space. So it's ok that we don't send a
            // realtime event since there'll be no one around to subscribe to the event.
            ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheckAndWithoutEvent(
                {
                    partitionType: "Channel",
                    sortRangeType: "Attributes",
                    channelId: welcomeChannelId,
                    spaceId,
                    createdTime,
                    creatorId: ownerAccountId,
                    name: "Welcome",
                    description: emptyMessageContent,
                },
                {
                    onAfterTransactionExecutedSuccessfully: () => {
                        context.jobs.send({
                            type: "IndexSearchEntity",
                            spaceId,
                            update: {
                                type: "Channel",
                                channelId: welcomeChannelId,
                                // Nothing depends on this entity when it's created. Don't bother trying to
                                // reindex dependencies.
                                updatedTraits: {type: "None"},
                            },
                        });
                    },
                },
            ),
        ],
    });

    return {
        spaceId,
        welcomeChannelId,
        createdTime,
    };
}

/**
 * Create a new channel.
 */
export async function createChannel(
    context: ForumSessionActionContextWithBroadcast,
    {
        spaceId,
        channelId = generateId<ChannelId>(),
        name,
        description = emptyMessageContent,
    }: {
        spaceId: SpaceId;
        channelId?: ChannelId;
        name: string;
        description?: MessageContent;
    },
): Promise<{
    id: ChannelId;
    createdTime: Date;
    getDynamoGeneralRealtimeItem: (
        context: ServerContentActionContext,
    ) => Promise<DynamoGeneralRealtimeItem<ChannelModel>>;
}> {
    await authorizeSpaceAccess(context, spaceId);

    const channelItem: ChannelAttributesItem = {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId,
        spaceId,
        createdTime: new Date(),
        creatorId: context.actor.getAccountId(),
        name,
        description,
    };

    const {getEvent} = await ForumRealtimeTable.createItem(context, channelItem);

    // Future `authorizeChannelAccess()` calls in the request should not need to
    // load the channel. This optimization kicks in for the create channel Remix
    // route.
    ChannelPreviewCache.set(
        context,
        channelId,
        new ChannelPreviewModel({
            id: channelItem.channelId,
            spaceId: channelItem.spaceId,
            createdTime: channelItem.createdTime,
            name: channelItem.name,
        }),
    );

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
        getDynamoGeneralRealtimeItem: async context => {
            const {item} = await getEvent(context);
            return item;
        },
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
    context: ServerContentActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<Result<DynamoGeneralRealtimeItem<ChannelModel>, PermissionDeniedError> | null> {
    const getPromise = (async () => {
        const channel = await ForumRealtimeTable.getRealtimeItemIfExists(
            context,
            {
                partitionType: "Channel",
                sortRangeType: "Attributes",
                channelId,
            },
            {consistency: options?.consistency},
        );
        if (!channel) return null;

        await authorizeSpaceAccess(context, channel.model.spaceId);

        return channel;
    })();

    const cachedGetPromise = getPromise.then(channel => channel?.model.asPreview() ?? null);

    // Make sure errors thrown by this promise aren't treated as uncaught
    // exceptions. We catch them below when we await `getPromise`.
    cachedGetPromise.catch(() => {});

    // If we're loading the channel, we can use the channel item in our
    // `ChannelPreviewModel` cache to avoid extra fetches.
    ChannelPreviewCache.set(context, channelId, cachedGetPromise);

    try {
        const channel = await getPromise;
        if (!channel) return null;
        return {ok: true, value: channel};
    } catch (error) {
        if (error instanceof PermissionDeniedError) {
            return {ok: false, error};
        } else {
            throw error;
        }
    }
}

async function createChannelModelFromItem(
    context: ServerContentActionContext,
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
            references: await getContentReferencesForNode(
                context,
                item.spaceId,
                FileChannelAuthorizer.bind({type: "ChannelDescription", channelId: item.channelId}),
                item.description,
            ),
        },
    });
}

/**
 * Gets the channel object with the provided ID. Returns null if the channel
 * doesn't exist or throws if you don't have access to the channel.
 */
export async function getChannelIfExists(
    context: ServerContentActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<DynamoGeneralRealtimeItem<ChannelModel> | null> {
    const channel = await getChannelIfPossible(context, channelId, options);
    if (!channel) return null;
    return unwrapResult(channel);
}

/**
 * Gets the channel object with the provided ID. Throws if the channel doesn't
 * exist or you don't have access to the channel.
 */
export async function getChannel(
    context: ServerContentActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<DynamoGeneralRealtimeItem<ChannelModel>> {
    const channel = await getChannelIfExists(context, channelId, options);
    if (!channel) throw new NotFoundError("Channel not found");
    return channel;
}

/**
 * Get a `ChannelModel` and post files in the channel all at once. Executes a
 * realtime query so the data can be kept up-to-date in realtime.
 */
export function getChannelAndPostFiles(
    context: ServerContentActionContext,
    channelId: ChannelId,
    {
        postFilesLimit,
        consistency = "Eventual",
    }: {
        postFilesLimit: number;
        consistency?: DynamoReadConsistency;
    },
): Promise<DynamoGeneralRealtimeQueryResult<ChannelModel | ChannelPostFilesModel>> {
    const channelPromiseResolver = createPromiseResolver<ChannelPreviewModel | null>();

    const promise = (async () => {
        const result = await ForumRealtimeTable.realtimeQuery(context, {
            consistency,
            partitionKey: {partitionType: "Channel", channelId},
            limit: postFilesLimit + 1,
            onItem: item => {
                if (item.model instanceof ChannelModel) {
                    channelPromiseResolver.resolve(item.model.asPreview());
                }
            },
        });
        if (result.items.length === 0) return null;

        const channel = result.items[0]!;

        if (!(channel.model instanceof ChannelModel)) {
            throw new DataLossError("Expected the first query item to be the channel model");
        }

        await authorizeSpaceAccess(context, channel.model.spaceId);

        return result;
    })().then(
        result => {
            // All of these promise resolvers MUST have either been resolved or rejected by
            // the end of this promise. So any promise resolvers that haven't been settled
            // yet reject with an error as a safety mechanism.
            if (!channelPromiseResolver.isSettled()) {
                channelPromiseResolver.reject(
                    new InternalError("Promise resolver wasn't resolved"),
                );
            }

            return result;
        },
        error => {
            channelPromiseResolver.reject(error);
            throw error;
        },
    );

    // Protect against deadlocks where `ForumRealtimeTable.realtimeQuery()` is
    // waiting for this channel preview promise before it can return. But the
    // channel preview promise is waiting on `ForumRealtimeTable.realtimeQuery()`
    // to finish.
    const timeout = createTimeout(() => {
        channelPromiseResolver.reject(
            new DeadlineExceededError("Timed out waiting for channel item, possibly deadlocked?"),
        );
    }, 3000);

    channelPromiseResolver.promise.then(
        () => timeout.clear(),
        () => timeout.clear(),
    );

    // If we're loading the channel, we can use the channel item in our
    // `ChannelPreviewModel` cache to avoid extra fetches.
    ChannelPreviewCache.set(context, channelId, channelPromiseResolver.promise);

    return promise.then(result => {
        if (!result) {
            throw new NotFoundError("Channel not found");
        }

        return result;
    });
}

const ChannelPreviewCache = new ContextCache<ChannelId, ChannelPreviewModel | null>();

/**
 * Gets a preview channel object with the provided ID. Returns null if the
 * channel doesn't exist and throws an error if the channel exists but you
 * don't have access to the channel.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export function getChannelPreviewIfExists(
    context: ServerActionContext,
    id: ChannelId,
    {
        consistency = "Eventual",
        allowsEventualReadConsistency = false,
    }: {
        consistency?: DynamoReadConsistency;
        allowsEventualReadConsistency?: boolean;
    } = {},
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
                allowsEventualReadConsistency,
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
 * Gets a preview channel object with the provided ID. Throws an error if the
 * channel doesn't exist.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getChannelPreview(
    context: ServerActionContext,
    id: ChannelId,
    options?: {consistency?: DynamoReadConsistency; allowsEventualReadConsistency?: boolean},
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
    let channel = await getChannelPreview(
        context,
        id,
        // It's ok to call this function when expecting strong read consistency.
        // Authorization is mostly strongly consistent since we retry with strong
        // consistency if our eventually consistent read fails.
        {allowsEventualReadConsistency: true},
    );

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
    context: ForumActionContextWithBroadcast,
    {
        channelId,
        name,
    }: {
        channelId: ChannelId;
        name: string;
    },
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (context: ServerContentActionContext) => Promise<{
        readTime: Date;
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<ChannelModel>>;
    }>;
}> {
    // Give the user a nice error message if there was an error validating the new
    // channel name.
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    let spaceId: SpaceId | null = null;

    const readTime = new Date();

    const result = await ForumRealtimeTable.updateItem(
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

    return {
        getDynamoGeneralRealtimeEventTransaction: async context => ({
            readTime,
            eventTransaction: [await result.getEvent(context)],
        }),
    };
}

/**
 * Updates the description of the channel.
 */
export async function updateChannelDescription(
    context: ForumActionContextWithBroadcast,
    {
        channelId,
        description,
    }: {
        channelId: ChannelId;
        description: MessageContent;
    },
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (context: ServerContentActionContext) => Promise<{
        readTime: Date;
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<ChannelModel>>;
    }>;
}> {
    let spaceId: SpaceId | null = null;

    const readTime = new Date();

    const result = await ForumRealtimeTable.updateItem(
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

    return {
        getDynamoGeneralRealtimeEventTransaction: async context => ({
            readTime,
            eventTransaction: [await result.getEvent(context)],
        }),
    };
}

/**
 * Updates the name and description of the channel.
 */
export async function updateChannelNameAndDescription(
    context: ForumActionContextWithBroadcast,
    {
        channelId,
        name,
        description,
    }: {
        channelId: ChannelId;
        name: string;
        description: MessageContent;
    },
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (context: ServerContentActionContext) => Promise<{
        readTime: Date;
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<ChannelModel>>;
    }>;
}> {
    // Give the user a nice error message if there was an error validating the new
    // channel name.
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    let spaceId: SpaceId | null = null;

    const readTime = new Date();

    const result = await ForumRealtimeTable.updateItem(
        context,
        {partitionType: "Channel", sortRangeType: "Attributes", channelId},
        async channelItem => {
            if (!channelItem) throw new NotFoundError("Channel not found");
            spaceId = channelItem.spaceId;
            await authorizeSpaceAccess(context, spaceId);

            return {
                ...channelItem,
                name,
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
            updatedTraits: {type: "Some", traits: ["Preview"]},
        },
    });

    return {
        getDynamoGeneralRealtimeEventTransaction: async context => ({
            readTime,
            eventTransaction: [await result.getEvent(context)],
        }),
    };
}

/**
 * Get the latest posts in a channel in reverse chronological order. The newest
 * post will be the first in the array.
 */
export async function getChannelPosts(
    context: ServerContentActionContext,
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
    context: ServerContentActionContext,
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

function getPostContentFileIds(content: PostContent): Set<FileId> {
    const fileIds = new Set<FileId>();

    visitProsemirrorNode(content, {
        visitAttr: (attr, value) => {
            if (attr === "fileId") {
                const fileId: FileId | null = value;
                if (fileId !== null) {
                    fileIds.add(fileId);
                }
            }
        },
    });

    return fileIds;
}

/**
 * Create a new post by the current account in the provided channel.
 *
 * If we're creating a post from a draft then a `draftId` parameter should be
 * provided so we can delete the draft.
 */
export async function createPost(
    context: ForumSessionActionContextWithBroadcast,
    {
        channelId,
        draftId = null,
        content,
    }: {
        channelId: ChannelId;
        draftId?: PostDraftId | null;
        content: PostContent;
    },
): Promise<{
    id: PostId;
    spaceId: SpaceId;
    createdTime: Date;
    getDynamoGeneralRealtimeEventTransaction: (context: ServerContentActionContext) => Promise<{
        readTime: Date;
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>;
    }>;
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

    // Add our new post to the authorization cache BEFORE we create the post. That
    // way when we attach files with `attachFileFromAttachment()` they'll read the
    // post from this cache and won't throw a not found error.
    PostItemAuthorizationCache.set(context, postItem.postId, postItem);

    const fileIds = getPostContentFileIds(postItem.content);

    // Make sure to attach all files to the post. So when someone else sees the
    // post they can load the files.
    await runAllPromises(
        mapIterable(fileIds, async fileId => {
            if (draftId === null) {
                throw new FailedPreconditionError("Must create post from draft to attach files");
            }

            await attachFileFromAttachment(context, postItem.spaceId, fileId, {
                from: FilePostAuthorizer.bind({
                    type: "PostDraft",
                    accountId: postItem.authorId,
                    draftId,
                }),
                to: FilePostAuthorizer.bind({
                    type: "Post",
                    postId: postItem.postId,
                }),
            });
        }),
    );

    const readTime = new Date();

    let result: {
        getEvent: (
            context: ServerContentActionContext,
        ) => Promise<DynamoGeneralRealtimePutItemEvent<PostModel>>;
    };

    if (fileIds.size === 0) {
        result = await ForumRealtimeTable.createItem(context, postItem);
    } else {
        const {transactionEntry, getEvent} =
            ForumRealtimeTable.transactionCreateItemWithEvent(postItem);

        result = {getEvent};

        await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
            transactionEntry,
            ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheck({
                partitionType: "Channel",
                sortRangeType: "PostFiles",
                channelId,
                postCreatedTime: postItem.createdTime,
                postId: postItem.postId,
                spaceId: postItem.spaceId,
                fileIds,
            }),
        ]);
    }

    // We don't delete our post draft in a transaction with post creation.
    // It's ok if we don't successfully delete the draft. It'll stay in the user's
    // draft list which is a glitch but it's fine if the glitch happens every 1 in
    // 1 million times a post is created.
    //
    // We also make a best effort to detach files. There may be race conditions
    // which prevent us from detaching all files. For example,
    // `getPostDraftFileAttachments()` is run with eventual consistency so may not
    // return a file attached a second ago. When we implement our file garbage
    // collector it'll be able to fully cleanup files from deleted drafts. (As of
    // 2024-10-30 we haven't implemented the file garbage collector. When we add a
    // file garbage collector, actually maybe it doesn't make sense to call
    // `detachFile()` here. The garbage collector will collect anyway.)
    if (draftId !== null) {
        context.process.waitUntil(async () => {
            const [, fileIds] = await runAllPromises([
                ForumTable.deleteItemWithKeyIfExists(context, {
                    partitionType: "Account",
                    sortRangeType: "PostDraft",
                    spaceId: postItem.spaceId,
                    accountId: postItem.authorId,
                    draftId,
                }),
                getPostDraftFileAttachments(
                    context,
                    postItem.spaceId,
                    postItem.authorId,
                    draftId,
                    FilePostAuthorizer,
                ),
            ]);

            // Must run after the post draft has been successfully deleted. We don't want
            // to delete attachments until after we know for certain the post draft has
            // been deleted.
            await runAllPromises(
                fileIds.map(fileId =>
                    detachFile(
                        context,
                        postItem.spaceId,
                        fileId,
                        FilePostAuthorizer.bind({
                            type: "PostDraft",
                            accountId: postItem.authorId,
                            draftId,
                        }),
                    ),
                ),
            );
        });
    }

    const mentionedAccountIds = getMentionedAccountIdsInContent(content);
    const contentSnippet = getNotificationPostContentSnippet(content);

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
            isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
            contentSnippet,
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
        getDynamoGeneralRealtimeEventTransaction: async context => ({
            readTime,
            eventTransaction: [await result.getEvent(context)],
        }),
    };
}

/**
 * Gets the post with the provided `PostId`.
 */
export async function getPost(
    context: ServerContentActionContext,
    id: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<DynamoGeneralRealtimeItem<PostModel>> {
    const postItemPromise = ForumRealtimeTable.getItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId: id,
        },
        {consistency},
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, id, postItemPromise);

    const postItem = await postItemPromise;

    const post = await ForumRealtimeTable.buildRealtimeItem(context, postItem);

    await authorizeChannelAccess(context, post.model.channel.id);

    return post;
}

export async function getPostContentAndChannelPreview(
    context: ServerActionContext,
    id: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<{
    createdTime: Date;
    authorId: AccountId;
    content: PostContent;
    channel: ChannelPreviewModel;
}> {
    const postItemPromise = ForumRealtimeTable.getItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId: id,
        },
        {consistency},
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, id, postItemPromise);

    const postItem = await postItemPromise;

    const channel = await getChannelPreview(context, postItem.channelId, {consistency});

    return {
        createdTime: postItem.createdTime,
        authorId: postItem.authorId,
        content: postItem.content,
        channel,
    };
}

async function createPostModelFromItem(
    context: ServerContentActionContext,
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
        getContentReferencesForNode(
            context,
            item.spaceId,
            FilePostAuthorizer.bind({type: "Post", postId: item.postId}),
            item.content,
        ),
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
 *
 * The result is cached. If you call this for the same `PostId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getPostAuthorAndChannelPreview(
    context: ServerActionContext,
    postId: PostId,
): Promise<{author: AccountModel; channel: ChannelPreviewModel}> {
    const postItem = await getPostItemForAuthorization(context, postId);

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
    const postItemPromise = ForumRealtimeTable.getPartialItem(
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

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, id, postItemPromise);

    const postItem = await postItemPromise;

    await authorizeChannelAccess(context, postItem.channelId);

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
export function updatePostContent(
    context: ForumSessionActionContextWithBroadcast,
    {postId, content}: {postId: PostId; content: PostContent},
): Promise<{
    contentUpdatedTime: Date;
    getDynamoGeneralRealtimeEventTransaction: (context: ServerContentActionContext) => Promise<{
        readTime: Date;
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>;
    }>;
}> {
    return context.dynamo.retryTransaction(async context => {
        const readTime = new Date();

        const oldPostItem = await ForumRealtimeTable.getItem(context, {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        });

        await authorizeChannelAccess(context, oldPostItem.channelId);

        if (oldPostItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only update post comments you authored");

        const contentUpdatedTime = new Date(
            oldPostItem.contentUpdatedTime
                ? Math.max(oldPostItem.contentUpdatedTime.getTime() + 1, Date.now())
                : Date.now(),
        );

        const newPostItem: PostAttributesItem = {
            ...oldPostItem,
            content,
            contentUpdatedTime,
            commentsSummary: {
                ...oldPostItem.commentsSummary,
                mentionCountByAccountId: applyMentionCountByAccountIdDifferenceFromContentUpdate(
                    oldPostItem.commentsSummary.mentionCountByAccountId,
                    oldPostItem.content,
                    content,
                ),
            },
        };

        const oldFileIds = getPostContentFileIds(oldPostItem.content);
        const newFileIds = getPostContentFileIds(newPostItem.content);

        let result: {
            getEvent: (
                context: ServerContentActionContext,
            ) => Promise<DynamoGeneralRealtimePutItemEvent<PostModel>>;
        };

        if (isDeepEqual(oldFileIds, newFileIds)) {
            result = await ForumRealtimeTable.directlyUpdateItem(context, newPostItem);
        } else if (oldFileIds.size === 0) {
            const channelPostFilesDeletedItem = await ForumRealtimeTable.getDeletedItemIfExists(
                context,
                {
                    partitionType: "Channel",
                    sortRangeType: "PostFiles",
                    channelId: newPostItem.channelId,
                    postCreatedTime: newPostItem.createdTime,
                    postId,
                },
            );

            const {transactionEntry, getEvent} =
                ForumRealtimeTable.transactionDirectlyUpdateItemWithEvent(newPostItem);

            result = {getEvent};

            const channelPostFilesItem: ChannelPostFilesItem = {
                partitionType: "Channel",
                sortRangeType: "PostFiles",
                channelId: newPostItem.channelId,
                postCreatedTime: newPostItem.createdTime,
                postId: newPostItem.postId,
                spaceId: newPostItem.spaceId,
                fileIds: newFileIds,
            };

            await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
                transactionEntry,
                channelPostFilesDeletedItem
                    ? ForumRealtimeTable.transactionUndeleteItem(
                          channelPostFilesDeletedItem,
                          channelPostFilesItem,
                      )
                    : ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheck(
                          channelPostFilesItem,
                      ),
            ]);
        } else {
            const channelPostFilesItem = await ForumRealtimeTable.getItem(context, {
                partitionType: "Channel",
                sortRangeType: "PostFiles",
                channelId: newPostItem.channelId,
                postCreatedTime: newPostItem.createdTime,
                postId,
            });

            const {transactionEntry, getEvent} =
                ForumRealtimeTable.transactionDirectlyUpdateItemWithEvent(newPostItem);

            result = {getEvent};

            await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
                transactionEntry,
                newFileIds.size === 0
                    ? ForumRealtimeTable.transactionDeleteItem(channelPostFilesItem)
                    : ForumRealtimeTable.transactionDirectlyUpdateItem({
                          ...channelPostFilesItem,
                          fileIds: newFileIds,
                      }),
            ]);
        }

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: newPostItem.spaceId,
            update: {
                type: "Post",
                postId,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {
            contentUpdatedTime,
            getDynamoGeneralRealtimeEventTransaction: async context => ({
                readTime,
                eventTransaction: [await result.getEvent(context)],
            }),
        };
    });
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

const PostItemAuthorizationCache = new ContextCache<
    PostId,
    Pick<
        PostAttributesItem,
        "partitionType" | "sortRangeType" | "postId" | "spaceId" | "channelId" | "authorId"
    >
>();

async function getPostItemForAuthorization(
    context: ServerActionContext,
    postId: PostId,
): Promise<
    Pick<
        PostAttributesItem,
        "partitionType" | "sortRangeType" | "postId" | "spaceId" | "channelId" | "authorId"
    >
> {
    return PostItemAuthorizationCache.get(context, postId, async () => {
        const postItem = await ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                attributes: ["spaceId", "channelId", "authorId"],
                // It's ok to call this function when expecting strong read consistency.
                // Authorization is mostly strongly consistent since we retry with strong
                // consistency if our eventually consistent read fails.
                allowsEventualReadConsistency: true,
            },
        );
        if (postItem) return postItem;

        return ForumRealtimeTable.getPartialItem(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                attributes: ["spaceId", "channelId", "authorId"],
                consistency: "Strong",
            },
        );
    });
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
    expectedAccessLevel: "View" | "Edit",
): Promise<{spaceId: SpaceId}> {
    const postItem = await getPostItemForAuthorization(context, id);

    await authorizeChannelAccess(context, postItem.channelId);

    switch (expectedAccessLevel) {
        case "View": {
            // If you can view the channel, you can view the post.
            break;
        }
        case "Edit": {
            switch (context.actor.type) {
                case "System": {
                    // System actor can edit any post.
                    break;
                }
                case "Session": {
                    if (postItem.authorId !== context.actor.getAccountId()) {
                        throw new PermissionDeniedError("Account doesn't have edit access to post");
                    }
                    break;
                }
                default:
                    throw exhaustive(context.actor);
            }
            break;
        }
        default:
            throw exhaustive(expectedAccessLevel);
    }

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
    spaceId: SpaceId;
    index: number;
    createdTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const postItemPromise = (async () => {
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
                        "authorId",
                        "commentsSummary",
                        "updateLockVersion",
                    ],
                },
            );
            if (!postItem) throw new NotFoundError("Post not found");
            await authorizeChannelAccess(context, postItem.channelId);

            return postItem;
        })();

        // After we've loaded a post, save it to the authorization cache so if we need
        // to authorize later in the action it's available.
        PostItemAuthorizationCache.set(context, postId, postItemPromise);

        const [postItem] = await runAllPromises([
            postItemPromise,
            (async () => {
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
            })(),
        ]);

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
        const contentSnippet = getNotificationMessageContentSnippet(content);

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
                isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                contentSnippet,
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
            spaceId: postItem.spaceId,
            index: commentIndex,
            createdTime,
        };
    });
}

/**
 * Get a single post comment.
 */
export async function getPostComment(
    context: ServerContentActionContext,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<PostCommentModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizePostAccess(context, postId, "View"),
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
        authorizePostAccess(context, postId, "View"),
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
    context: ServerContentActionContext,
    spaceId: SpaceId,
    item: PostCommentItem,
): Promise<PostCommentModel> {
    const [author, payload] = await runAllPromises([
        getAccount(context, spaceId, item.authorId),
        createMessagePayloadModel(
            context,
            spaceId,
            FilePostAuthorizer.bind({
                type: "PostComment",
                postId: item.postId,
                commentIndex: item.commentIndex,
            }),
            item.payload,
        ),
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
    spaceId: SpaceId;
    contentUpdatedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const postItemPromise = ForumRealtimeTable.getPartialItem(
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
                    "authorId",
                    "createdTime",
                    "commentsSummary",
                    "updateLockVersion",
                ],
            },
        );

        // After we've loaded a post, save it to the authorization cache so if we need
        // to authorize later in the action it's available.
        PostItemAuthorizationCache.set(context, postId, postItemPromise);

        const [postItem, commentItem] = await runAllPromises([
            postItemPromise,
            ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

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

        return {
            spaceId,
            contentUpdatedTime,
        };
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
        const postItemPromise = ForumRealtimeTable.getPartialItem(
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
                    "authorId",
                    "createdTime",
                    "commentsSummary",
                    "updateLockVersion",
                ],
            },
        );

        // After we've loaded a post, save it to the authorization cache so if we need
        // to authorize later in the action it's available.
        PostItemAuthorizationCache.set(context, postId, postItemPromise);

        const [postItem, commentItem] = await runAllPromises([
            postItemPromise,
            ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

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
    context: ServerContentActionContext,
    {
        postId,
        commentLimit,
    }: {
        postId: PostId;
        commentLimit: number;
    },
): Promise<{
    post: DynamoGeneralRealtimeItem<PostModel>;
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

    const postItemPromise = ForumRealtimeTable.getItem(context, {
        partitionType: "Post",
        sortRangeType: "Attributes",
        postId,
    });

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postId, postItemPromise);

    // Important that this comes after the query call since we want to load the
    // query and post item in parallel.
    const postItem = await postItemPromise;

    const commentPromises: Array<Promise<PostCommentModel>> = [];

    const commentIndexes = new Set<number>();
    const parentCommentIndexes = new Set<number>();

    for await (const item of queryIterable) {
        commentIndexes.add(item.commentIndex);

        if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null)
            parentCommentIndexes.add(item.payload.parentMessageIndex);

        commentPromises.push(createPostCommentModelFromItem(context, postItem.spaceId, item));
    }

    const [, post, comments, otherReferencedComments] = await runAllPromises([
        authorizeChannelAccess(context, postItem.channelId),
        ForumRealtimeTable.buildRealtimeItem(context, postItem),
        runAllPromises(commentPromises),
        runAllPromises(
            filterMapIterable(parentCommentIndexes, parentCommentIndex => {
                if (commentIndexes.has(parentCommentIndex)) return;

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
            post.model.commentCount < lastCommentIndex + 1
                ? {...post, model: post.model.clone({commentCount: lastCommentIndex + 1})}
                : post,
        initialComments: comments,
        initialOtherReferencedComments: otherReferencedComments,
    };
}

/**
 * Paginate through post comments from start to finish.
 */
export async function getPostCommentsFromStart(
    context: ServerContentActionContext,
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
            attributes: ["spaceId", "channelId", "authorId", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postId, postItemPromise);

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
    context: ServerContentActionContext,
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
    context: ServerContentActionContext,
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
            attributes: ["spaceId", "channelId", "authorId", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postId, postItemPromise);

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
    context: ServerContentActionContext,
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
    context: ServerContentActionContext,
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
            attributes: ["spaceId", "channelId", "authorId", "createdTime", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postId, postItemPromise);

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
    context: ServerContentActionContext,
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
                                FilePostAuthorizer.bind({
                                    type: "PostComment",
                                    postId: item.postId,
                                    commentIndex: item.commentIndex,
                                }),
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

async function authorizePostDraftAccessEvenIfNotExists(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId);

    switch (context.actor.type) {
        case "System": {
            // We don't have a use case for system actions looking at drafts right now. So
            // block it.
            throw new PermissionDeniedError("System actors can't access post drafts");
        }
        case "Session": {
            if (accountId !== context.actor.getAccountId()) {
                throw new PermissionDeniedError("Can't access drafts from other accounts");
            }
            break;
        }
        default:
            throw exhaustive(context.actor);
    }
}

/**
 * Authorizes whether our session has access to the provided post draft.
 */
export async function authorizePostDraftAccess(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    draftId: PostDraftId,
): Promise<void> {
    await authorizePostDraftAccessEvenIfNotExists(context, spaceId, accountId);

    // Throws an error if the draft item doesn't exist. That's all we need to
    // check. Whether the draft exists or not.
    const draftItem = await getPostDraftItemForAuthorization(context, spaceId, accountId, draftId);
    if (!draftItem) throw new NotFoundError("Post draft not found");

    // Note that we don't authorize whether you have access to
    // `draftItem.channelId`. The draft author may have had access to the provided
    // channel when they created the draft then subsequently lost access to the
    // channel. If the user has lost access to the channel then we should consider
    // `channelId` to be null.
}

const PostDraftItemAuthorizationCache = new ContextCache<
    `${SpaceId}:${AccountId}:${PostDraftId}`,
    PostDraftItem | null
>();

async function getPostDraftItemForAuthorization(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    draftId: PostDraftId,
): Promise<PostDraftItem | null> {
    return PostDraftItemAuthorizationCache.get(
        context,
        `${spaceId}:${accountId}:${draftId}`,
        async () => {
            const draftItem = await ForumTable.getItemIfExists(
                context,
                {
                    partitionType: "Account",
                    sortRangeType: "PostDraft",
                    spaceId,
                    accountId,
                    draftId,
                },
                {
                    // It's ok to call this function when expecting strong read consistency.
                    // Authorization is mostly strongly consistent since we retry with strong
                    // consistency if our eventually consistent read fails.
                    allowsEventualReadConsistency: true,
                },
            );
            if (draftItem) return draftItem;

            return ForumTable.getItemIfExists(
                context,
                {
                    partitionType: "Account",
                    sortRangeType: "PostDraft",
                    spaceId,
                    accountId,
                    draftId,
                },
                {
                    consistency: "Strong",
                },
            );
        },
    );
}

/**
 * Create or replace the contents of a post draft.
 */
export async function createOrReplacePostDraft(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    draftId: PostDraftId,
    {channelId, content}: {channelId: ChannelId | null; content: PostContent},
): Promise<void> {
    await authorizePostDraftAccessEvenIfNotExists(context, spaceId, accountId);

    await ForumTable.createOrReplaceItem(context, {
        partitionType: "Account",
        sortRangeType: "PostDraft",
        spaceId,
        accountId,
        draftId,
        channelId,
        content,
    });
}

/**
 * Get the post draft with the provided `PostDraftId` if it exists.
 */
export async function getPostDraftIfExists(
    context: ServerContentActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    draftId: PostDraftId,
): Promise<{
    channel: ChannelPreviewModel | null;
    content: PostContentWithReferences;
} | null> {
    await authorizePostDraftAccessEvenIfNotExists(context, spaceId, accountId);

    const draftItem = await ForumTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "PostDraft",
        spaceId,
        accountId,
        draftId,
    });

    if (!draftItem) return null;

    PostDraftItemAuthorizationCache.set(context, `${spaceId}:${accountId}:${draftId}`, draftItem);

    const [channel, contentReferences] = await runAllPromises([
        draftItem.channelId
            ? await getChannelPreviewIfExists(context, draftItem.channelId).catch(error => {
                  // Ignore permission denied errors. If the user lost access to the channel then treat the
                  // channel as null.
                  if (error instanceof PermissionDeniedError) return null;

                  throw error;
              })
            : null,
        getContentReferencesForNode(
            context,
            spaceId,
            FilePostAuthorizer.bind({type: "PostDraft", accountId, draftId}),
            draftItem.content,
        ),
    ]);

    return {
        channel,
        content: {doc: draftItem.content, references: contentReferences},
    };
}
