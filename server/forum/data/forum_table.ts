import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {
    getContentReferencesForNode,
    getMessageContentReferencesForNode,
} from "~/server/content/get_content_references.js";
import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionCountByAccountIdInContent,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {ContentContextModuleBase} from "~/server/context/content_context_module_base.js";
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
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {
    DynamoGeneralRealtimeTableItemType,
    DynamoGeneralRealtimeTableSchema,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {
    addFeedAccountCandidateEntry,
    addFeedCandidateEntry,
} from "~/server/feed/data/feed_table.js";
import {
    FileAuthorizer,
    attachFileFromAttachment,
    detachFile,
    getFileFromAttachment,
    getPostDraftFileAttachments,
} from "~/server/files/data/files_table.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {getMessageChangeLogExpirationTimeFromChangeTime} from "~/server/messaging/helpers/get_message_change_log_expiration_time_from_change_time.js";
import {
    getNotificationMessageContentSnippet,
    getNotificationPostContentSnippet,
} from "~/server/notifications/core/get_notification_content_snippet.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_table.js";
import {
    authorizeSpaceAccess,
    createAuthorizeSpaceAccessPermissionDeniedError,
    getAccount,
    isAccountMemberOfSpace,
    isAccountMemberOfSpaceWithoutAuthorization,
} from "~/server/spaces/spaces_table.js";
import {EdgeServiceContextModuleBase} from "~/server/tokens/edge_service_context_module.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicySchema,
    validateAccessPolicyUpdate,
} from "~/shared/access/access_policy.js";
import {reduceAccessPolicy} from "~/shared/access/access_policy_action.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {Context} from "~/shared/context/context.js";
import {
    DynamoGeneralRealtimeBackfillResult,
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
    DynamoGeneralRealtimePutItemEvent,
    DynamoGeneralRealtimeQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    DynamoIndexCursor,
    DynamoIndexPartitionKey,
    DynamoItemKey,
    DynamoItemPartitionKey,
} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    DataLossError,
    DeadlineExceededError,
    ErrorBase,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    ChannelContributorsModel,
    ChannelModel,
    ChannelOrMetadataModel,
    ChannelPostFilesModel,
    ChannelPreviewModel,
    maxChannelTopContributorCount,
} from "~/shared/forum/channel_model.js";
import {ChannelBroadcastRealtimeEventTransactionSchema} from "~/shared/forum/channel_realtime_protocol.js";
import {channelPermissionDeniedErrorDisplayMessageByExpectedAccessLevel} from "~/shared/forum/forum_error_messages.js";
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
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {generateId, isId} from "~/shared/id/id.js";
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
    content: ContentContextModuleBase;
    files: FilesContextModuleBase;
    r2: CloudflareR2ContextModule;
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

/**
 * The max contribution count in the `Contributors` DynamoDB item.
 */
export const maxChannelContributionCount = 8;

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

                        /** Who's allowed to access the channel and the posts inside it? */
                        accessPolicy: AccessPolicySchema
                            // NOTE(calebmer, 2025-04-21): Before today channels don't have an
                            // `accessPolicy` and we assume all channels are public within the space.
                            // So if we find a channel with no `accessPolicy` then default to a public
                            // access policy.
                            .default({
                                accountGrantById: emptyMap,
                                defaultGrant: {level: "Manage", generation: 0},
                                urlGrant: null,
                            }),

                        /**
                         * Have we added a feed candidate entry for the channel? We add an entry when
                         * the channel is shared with some `defaultGrant`. But if you revoke the
                         * `defaultGrant` then add it again we don't want to add another feed
                         * candidate entry.
                         */
                        hasAddedFeedCandidateEntry: Schema.boolean.default(false),
                    }),
                },

                /**
                 * All the accounts who have contributed to this channel. Contributions include
                 * creating the channel, creating a post in the channel, or sending a post
                 * comment for a post in the channel. Each contribution increments the
                 * account's contribution count by 1. If the user deletes their post or moves
                 * their post to a different channel then their contribution count will
                 * decrease. Deleting a comment does not currently decrease the account's
                 * contribution count (similar to how deleting a comment does not decrease
                 * `postItem.commentCountByAuthorId`.) Once the contribution count has reached
                 * its max value (currently 10) it will not increase any further and will never
                 * decrease. The account is permanently considered a contributor after the max
                 * contribution count.
                 *
                 * The contributors map may be updated asynchronously after the contribution
                 * has occurred. There's also no guarantee a contribution will be recorded
                 * (e.g. if `AppService` crashes after creating a new post but before
                 * updating this map, for instance).
                 *
                 * The order of accounts in `contributionCountByAccountId` does matter. The
                 * order of accounts is based on first contribution time. Accounts with an
                 * earlier first contribution time are earlier in the map.
                 *
                 * We stop increasing contribution counts at a maximum value as a way to reduce
                 * write cost against the database. Maybe the write cost savings are pointless
                 * and we shouldn't have a contribution count max. Also, we should really
                 * consider adding some exponential decay for the accounts in this list. So if
                 * an account hasn't contributed in a long time they'll fall out of the top
                 * contributors.
                 */
                {
                    name: "Contributors",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * Contribution count for each `AccountId` in the channel. We stop incrementing
                         * contribution count after `maxChannelContributionCount`.
                         *
                         * Order in this map matters. The map is ordered by first contribution count.
                         */
                        contributionCountByAccountId: Schema.map(
                            Schema.id<AccountId>(),
                            Schema.integer.min(1).max(maxChannelContributionCount),
                        ).minSize(1),

                        /**
                         * The same as `channelItem.accessPolicy.accountGrant.keys()`. We copy the
                         * property here so we can include shared accounts in the contributor list even
                         * before they've created their first post.
                         *
                         * Order in this array is the same as the order in
                         * `channelItem.accessPolicy.accountGrant.keys()`.
                         */
                        accountIdsWithGrant: Schema.array(Schema.id<AccountId>()).default(
                            emptyArray,
                        ),
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
        ChannelContributors: ChannelContributorsModel,
        ChannelPostFiles: ChannelPostFilesModel,
        Post: PostModel,
    }),
    models: {
        Channel: {
            Attributes: {
                build: (context, item) => createChannelModelFromItem(context, item),
            },
            Contributors: {
                build: async (context, item) => {
                    const accountIdsByContributionCount = new DefaultMap<number, Array<AccountId>>(
                        () => [],
                    );

                    for (const [
                        accountId,
                        contributionCount,
                    ] of item.contributionCountByAccountId) {
                        accountIdsByContributionCount
                            .getOrSetDefault(contributionCount)
                            .push(accountId);
                    }

                    // Top contributor accounts are sorted by:
                    //
                    // 1. Who has the highest contribution count up to
                    //    `maxChannelTopContributorCount`
                    // 2. Earliest contribution time
                    const topContributorIds = new Set<AccountId>();

                    outer: for (
                        let contributionCount = maxChannelContributionCount;
                        contributionCount >= 1;
                        contributionCount--
                    ) {
                        const accountIds =
                            accountIdsByContributionCount.get(contributionCount) ?? emptyArray;

                        for (const accountId of accountIds) {
                            topContributorIds.add(accountId);

                            if (topContributorIds.size >= maxChannelTopContributorCount) {
                                break outer;
                            }
                        }
                    }

                    // Fill the top contributors array with accounts that have been explicitly
                    // granted access even if those accounts haven't posted in the channel yet.
                    // This is especially useful for private channels. Since you can see who's been
                    // added to the private channel.
                    for (const accountId of item.accountIdsWithGrant) {
                        if (topContributorIds.size >= maxChannelTopContributorCount) break;
                        topContributorIds.add(accountId);
                    }

                    const topContributors = await runAllPromises(
                        mapIterable(topContributorIds, accountId =>
                            getAccount(context, item.spaceId, accountId),
                        ),
                    );

                    return new ChannelContributorsModel({
                        contributorCount: item.contributionCountByAccountId.size,
                        topContributors,
                    });
                },
            },
            PostFiles: {
                build: async (context, item) => {
                    const files: Array<{signedUrlSearch: string; file: FileModel}> =
                        await runAllPromises(
                            mapIterable(item.fileIds, async fileId => {
                                const [file, signedUrl] = await runAllPromises([
                                    getFileFromAttachment(
                                        context,
                                        item.spaceId,
                                        fileId,
                                        FilePostAuthorizer.bind({
                                            type: "Post",
                                            postId: item.postId,
                                        }),
                                    ),
                                    await context.files.dangerouslySignFileUrlWithoutAuthorization(
                                        item.spaceId,
                                        fileId,
                                    ),
                                ]);

                                return {signedUrlSearch: signedUrl.search, file};
                            }),
                        );

                    return new ChannelPostFilesModel({
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
            Array<DynamoGeneralRealtimeEvent<ChannelOrMetadataModel | PostModel>>
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

                /**
                 * Accounts who are subscribed to get notifications in their inbox whenever a
                 * post is created in this channel.
                 */
                {
                    name: "Subscription",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
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
            case "PostComments":
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
    const promiseWaiter = new PromiseWaiter();
    const mutexes = createArrayWithLength(8, () => new Mutex());

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

            // Make sure we're not overriding an existing `accessPolicy`.
            assert(!("accessPolicy" in item));

            promiseWaiter.waitUntil(
                mutex.withLock(async () => {
                    await DynamoTableSchema.executeTransaction(context, [
                        ForumTable.transactionDeleteItem(item),
                        ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheckAndWithoutEvent(
                            {
                                ...item,
                                // NOTE(calebmer, 2025-04-21): This migration was run before channels had
                                // access policies. And the implicit access policy was public to everyone in
                                // the space.
                                accessPolicy: {
                                    accountGrantById: emptyMap,
                                    defaultGrant: {level: "Manage", generation: 0},
                                    urlGrant: null,
                                },
                                hasAddedFeedCandidateEntry: false,
                            },
                        ),
                    ]);
                }),
            );
        }
    }

    await promiseWaiter.wait();
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
            accessPolicy: {
                accountGrantById: emptyMap,
                defaultGrant: {level: "Manage", generation: 0},
                urlGrant: null,
            },
            // We haven't actually added a feed candidate entry for this channel but we
            // think it'd be weird if you unshared then re-shared this initial channel for
            // the space to get a feed entry.
            hasAddedFeedCandidateEntry: true,
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
 * Should only be called in `createAlphaSpaceAsAdmin()`. Dangerous since we
 * create a channel item for `welcomeChannelId` without checking whether a
 * channel with that `ChannelId` already exists! `createAlphaSpaceAsAdmin()`
 * handles this but otherwise you need to be careful.
 */
export function internalDangerouslyCreateAlphaSpaceWelcomeChannelTransactionEntries(
    context: ServerActionContext,
    {
        ownerAccountId,
        spaceId,
        welcomeChannelId,
        createdTime,
    }: {
        ownerAccountId: AccountId;
        spaceId: SpaceId;
        welcomeChannelId: ChannelId;
        createdTime: Date;
    },
) {
    return [
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
                accessPolicy: {
                    accountGrantById: new Map([[ownerAccountId, {level: "Manage", generation: 0}]]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
                // We haven't actually added a feed candidate entry for this channel but we
                // think it'd be weird if you unshared then re-shared this initial channel for
                // the space to get a feed entry.
                hasAddedFeedCandidateEntry: true,
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
    ];
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
        accessPolicy = {
            accountGrantById: new Map([
                [context.actor.getAccountId(), {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    }: {
        spaceId: SpaceId;
        channelId?: ChannelId;
        name: string;
        description?: MessageContent;
        accessPolicy?: AccessPolicy;
    },
): Promise<{
    id: ChannelId;
    createdTime: Date;
    getDynamoGeneralRealtimeItem: (
        context: ServerContentActionContext,
    ) => Promise<DynamoGeneralRealtimeItem<ChannelModel>>;
}> {
    await authorizeSpaceAccess(context, spaceId);

    if (accessPolicy.urlGrant) {
        throw new InvalidArgumentError("Channels don’t currently support `urlGrant`s");
    }

    if (
        !(await evaluateAccessPolicy(
            context,
            spaceId,
            context.actor.getAccountId(),
            accessPolicy,
            "Manage",
        ))
    ) {
        throw new InvalidArgumentError(
            "Account actor must have `Manage` access level on channels they create",
        );
    }

    const creatorId = context.actor.getAccountId();

    const channelItem: ChannelAttributesItem = {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId,
        spaceId,
        createdTime: new Date(),
        creatorId,
        name,
        description,
        accessPolicy,
        hasAddedFeedCandidateEntry: !!accessPolicy.defaultGrant,
    };

    const {transactionEntry, getEvent} =
        ForumRealtimeTable.transactionCreateItemWithEvent(channelItem);

    await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
        transactionEntry,
        // Make sure the `Contributors` item is created at the same time as our channel
        // item.
        ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheckAndWithoutEvent(
            {
                partitionType: "Channel",
                sortRangeType: "Contributors",
                channelId,
                spaceId,
                contributionCountByAccountId: new Map([[context.actor.getAccountId(), 1]]),
                accountIdsWithGrant: Array.from(channelItem.accessPolicy.accountGrantById.keys()),
            },
        ),
        // Automatically subscribe the channel creator to the channel they've just
        // created.
        ForumTable.transactionCreateOrReplaceItem({
            partitionType: "Channel",
            sortRangeType: "Subscription",
            channelId,
            accountId: context.actor.getAccountId(),
            createdTime: channelItem.createdTime,
        }),
    ]);

    // Future `authorizeChannelAccess()` calls in the request should not need to
    // load the channel. This optimization kicks in for the create channel Remix
    // route.
    ChannelPreviewItemAuthorizationCache.set(context, "Strong", channelId, channelItem);

    context.process.waitUntil(async () => {
        const entry: FeedEntry = {
            type: "Channel",
            channelId,
            sharedTime: channelItem.createdTime,
            sharerId: creatorId,
            creatorId,
            event: "Created",
        };

        // If we created a public channel then we immediately add it to the feed.
        if (channelItem.hasAddedFeedCandidateEntry) {
            await addFeedCandidateEntry(context, channelItem.spaceId, entry);
        }
        // If we're creating a private channel then only add an entry to the
        // creator account's personal feed.
        else {
            await addFeedAccountCandidateEntry(context, channelItem.spaceId, creatorId, entry);
        }
    });

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
        markSearchAffinityEntityInteraction(context, {
            spaceId,
            entityId: `Channel:${channelItem.channelId}`,
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

async function authorizeChannelItemAccess(
    context: ServerActionContext,
    channelItem: {spaceId: SpaceId; accessPolicy: AccessPolicy} & (
        | {id: ChannelId}
        | {channelId: ChannelId}
    ),
    expectedAccessLevel: AccessLevel,
): Promise<void> {
    unwrapResult(
        await authorizeChannelItemAccessIfPossible(context, channelItem, expectedAccessLevel),
    );
}

async function authorizeChannelItemAccessIfPossible(
    context: ServerActionContext,
    channelItem: {spaceId: SpaceId; accessPolicy: AccessPolicy} & (
        | {id: ChannelId}
        | {channelId: ChannelId}
    ),
    expectedAccessLevel: AccessLevel,
): Promise<Result<void, ErrorBase>> {
    switch (context.actor.type) {
        // System actors can read all documents in the space they have access to.
        case "System": {
            if (context.actor.getSpaceId() !== channelItem.spaceId) {
                return {
                    ok: false,
                    error: new PermissionDeniedError(
                        "System actor doesn’t have access to channel’s space",
                    ),
                };
            }

            return okResult;
        }
        case "Session":
        case "ImpersonatedAccount":
        case "Anonymous": {
            if (
                context.actor.type === "ImpersonatedAccount" &&
                context.actor.getSpaceId() !== channelItem.spaceId
            ) {
                return {
                    ok: false,
                    error: new PermissionDeniedError(
                        "Impersonated account actor doesn’t have access to channel’s space",
                    ),
                };
            }

            // Evaluate the document access policy.
            const isAccessAuthorized = await evaluateAccessPolicy(
                context,
                channelItem.spaceId,
                context.actor.type !== "Anonymous" ? context.actor.getAccountId() : null,
                channelItem.accessPolicy,
                expectedAccessLevel,
            );

            if (isAccessAuthorized) return okResult;

            // Throw an unauthenticated error if this is an anonymous user instead of
            // returning false. We want to show the user the unauthenticated error display
            // message when they don't have access.
            if (context.actor.type === "Anonymous") {
                return {ok: false, error: unauthenticatedSessionError()};
            } else if (
                !(await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    channelItem.spaceId,
                    context.actor.getAccountId(),
                ))
            ) {
                return {
                    ok: false,
                    error: createAuthorizeSpaceAccessPermissionDeniedError(
                        channelItem.spaceId,
                        context.actor.getAccountId(),
                    ),
                };
            } else {
                const channelId = "id" in channelItem ? channelItem.id : channelItem.channelId;

                return {
                    ok: false,
                    error: new PermissionDeniedError(
                        quote`Actor doesn’t have ${expectedAccessLevel} access level to channel`,
                        {
                            aggregateDedupeKey: channelId,
                            displayMessage:
                                channelPermissionDeniedErrorDisplayMessageByExpectedAccessLevel[
                                    expectedAccessLevel
                                ],
                        },
                    ),
                };
            }
        }
        default:
            throw exhaustive(context.actor);
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
        readonly accessPolicy: AccessPolicy;
        readonly updateLockVersion?: number;
    },
): Promise<ChannelModel> {
    return new ChannelModel({
        id: item.channelId,
        spaceId: item.spaceId,
        createdTime: item.createdTime,
        version: item.updateLockVersion ?? 0,
        name: item.name,
        description: {
            doc: item.description,
            references: await getMessageContentReferencesForNode(
                context,
                item.spaceId,
                item.description,
            ),
        },
        accessPolicy: item.accessPolicy,
    });
}

/**
 * Gets the channel object with the provided `ChannelId`. Returns null if the
 * channel doesn't exist, returns a `Result` with a `PermissionDeniedError` if
 * access isn't authorized.
 *
 * Sometimes calling code wants to handle these error cases by discarding the
 * channel instead of returning null.
 */
export async function getChannelIfPossible(
    context: ServerContentActionContext,
    channelId: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = emptyObject,
): Promise<Result<DynamoGeneralRealtimeItem<ChannelModel>, ErrorBase> | null> {
    const getPromise = ForumRealtimeTable.getRealtimeItemIfExists(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Attributes",
            channelId,
        },
        {consistency},
    );

    const cachedGetPromise = getPromise.then(channel => (channel ? channel.model : null));

    // Make sure errors thrown by this promise aren't treated as uncaught
    // exceptions. We catch them below when we await `getPromise`.
    cachedGetPromise.catch(() => {});

    // If we're loading the channel, we can use the channel item in our
    // `ChannelPreviewModel` cache to avoid extra fetches.
    ChannelPreviewItemAuthorizationCache.set(context, consistency, channelId, cachedGetPromise);

    const channel = await getPromise;
    if (!channel) return null;

    const result = await authorizeChannelItemAccessIfPossible(context, channel.model, "View");
    if (!result.ok) return result;

    return {ok: true, value: channel};
}

/**
 * Gets the channel object with the provided `ChannelId`. Returns null if the
 * channel doesn't exist or throws if you don't have access to the channel.
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

export function createChannelNotFoundError(channelId: ChannelId) {
    return new NotFoundError("Channel not found", {
        aggregateDedupeKey: channelId,
        displayMessage: errorDisplayMessage`This channel doesn’t exist. Try searching “my channels” to see channels you’ve posted in.`,
    });
}

function createPostNotFoundError(postId: PostId) {
    return new NotFoundError("Post not found", {
        aggregateDedupeKey: postId,
        displayMessage: errorDisplayMessage`This post doesn’t exist. Try searching “my posts” to see posts you’ve created.`,
    });
}

/**
 * Gets the channel object with the provided `ChannelId`. Throws if the channel
 * doesn't exist or you don't have access to the channel.
 */
export async function getChannel(
    context: ServerContentActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<DynamoGeneralRealtimeItem<ChannelModel>> {
    const channel = await getChannelIfExists(context, channelId, options);
    if (!channel) throw createChannelNotFoundError(channelId);
    return channel;
}

/**
 * Get an array of all the accounts which have contributed to this channel. We
 * consider an account a contributor if they've created the channel, posted in
 * the channel, or commented in the channel. The array is sorted with the top
 * contributors first. If multiple accounts have contributed the same amount
 * then we put the account who contributed first, first in the list.
 */
export async function getChannelContributors(
    context: ServerContentActionContext,
    channelId: ChannelId,
    {limit, consistency = "Eventual"}: {limit: number; consistency?: DynamoReadConsistency},
): Promise<Array<AccountModel>> {
    const promise = (async () => {
        const items = await arrayFromAsyncIterable(
            ForumRealtimeTable.query(context, {
                partitionKey: {partitionType: "Channel", channelId},
                endSortKey: {sortRangeType: "Contributors"},
                limit: "All",
                consistency,
            }),
        );
        if (items.length === 0) return null;

        const firstItem = items[0]!;
        const secondItem = items[1];

        if (firstItem.sortRangeType !== "Attributes") {
            throw new DataLossError("Expected the first query item to be the channel item");
        }

        if (secondItem && secondItem.sortRangeType !== "Contributors") {
            throw new DataLossError("Expected the second query item to be the contributors item");
        }

        return {channelItem: firstItem, contributorsItem: secondItem};
    })();

    const cachedPromise = promise.then(async result => (result ? result.channelItem : null));

    // Make sure errors thrown by this promise aren't treated as uncaught
    // exceptions. We catch them below when we await `getPromise`.
    cachedPromise.catch(() => {});

    // If we're loading the channel, we can use the channel item in our
    // `ChannelPreviewModel` cache to avoid extra fetches.
    ChannelPreviewItemAuthorizationCache.set(context, consistency, channelId, cachedPromise);

    return (async () => {
        const result = await promise;
        if (!result) throw createChannelNotFoundError(channelId);

        await authorizeChannelItemAccess(context, result.channelItem, "View");

        const accountIdsByContributionCount = new DefaultMap<number, Array<AccountId>>(() => []);

        for (const [accountId, contributionCount] of result.contributorsItem
            ?.contributionCountByAccountId ?? emptyArray) {
            accountIdsByContributionCount.getOrSetDefault(contributionCount).push(accountId);
        }

        // Top contributor accounts are sorted by:
        //
        // 1. Who has the highest contribution count up to
        //    `maxChannelTopContributorCount`
        // 2. Earliest contribution time
        const contributorPromises: Array<Promise<AccountModel>> = [];

        outer: for (
            let contributionCount = maxChannelContributionCount;
            contributionCount >= 1;
            contributionCount--
        ) {
            const accountIds = accountIdsByContributionCount.get(contributionCount) ?? emptyArray;

            for (const accountId of accountIds) {
                contributorPromises.push(
                    getAccount(context, result.channelItem.spaceId, accountId),
                );

                if (contributorPromises.length >= limit) break outer;
            }
        }

        return runAllPromises(contributorPromises);
    })();
}

export function getChannelContributorsKey(channelId: ChannelId): DynamoItemKey {
    return ForumRealtimeTable.serializeOpaqueItemKey({
        partitionType: "Channel",
        sortRangeType: "Contributors",
        channelId,
    });
}

export function getChannelAndMetadataPartitionKey(channelId: ChannelId): DynamoItemPartitionKey {
    return ForumRealtimeTable.getRealtimeQueryPartitionKey({partitionType: "Channel", channelId});
}

/**
 * Get a `ChannelModel` and post files in the channel all at once. Executes a
 * realtime query so the data can be kept up-to-date in realtime.
 */
export function getChannelAndMetadataIfPossible(
    context: ServerContentActionContext,
    {
        channelId,
        postFilesLimit,
        afterItemKey = null,
        consistency = "Eventual",
    }: {
        channelId: ChannelId;
        postFilesLimit: number;
        afterItemKey?: DynamoItemKey | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<Result<DynamoGeneralRealtimeQueryResult<ChannelOrMetadataModel>, ErrorBase> | null> {
    if (afterItemKey) {
        return (async () => {
            const [channelResult, queryResult] = await runAllPromises([
                // Get the channel preview separately to make sure we're authorized to make
                // this request.
                getChannelPreviewIfPossible(context, channelId, {consistency}),

                ForumRealtimeTable.realtimeQuery(context, {
                    consistency,
                    partitionKey: {partitionType: "Channel", channelId},
                    paginate: {type: "FromStart", afterItemKey},
                    // Plus one for `ChannelModel` and plus one for `ChannelContributorsModel`.
                    limit: postFilesLimit + 2,
                }),
            ]);

            if (channelResult === null) return null;
            if (!channelResult.ok) return channelResult;

            return {ok: true, value: queryResult};
        })();
    } else {
        const channelPromiseResolver = createPromiseResolver<ChannelModel | null>();

        const promise = (async (): Promise<Result<
            DynamoGeneralRealtimeQueryResult<ChannelOrMetadataModel>,
            ErrorBase
        > | null> => {
            const result = await ForumRealtimeTable.realtimeQuery(context, {
                consistency,
                partitionKey: {partitionType: "Channel", channelId},
                paginate: {type: "FromStart", afterItemKey},
                // Plus one for `ChannelModel` and plus one for `ChannelContributorsModel`.
                limit: postFilesLimit + 2,
                onItem: item => {
                    if (item.model instanceof ChannelModel) {
                        channelPromiseResolver.resolve(item.model);
                    }
                },
            });
            if (result.items.length === 0) return null;

            const channel = result.items[0]!;

            if (!(channel.model instanceof ChannelModel)) {
                throw new DataLossError("Expected the first query item to be the channel model");
            }

            // Save the channel item to our authorization cache in case we try to load it
            // again later.
            ChannelPreviewItemAuthorizationCache.set(
                context,
                consistency,
                channelId,
                channel.model,
            );

            const authorizationResult = await authorizeChannelItemAccessIfPossible(
                context,
                channel.model,
                "View",
            );
            if (!authorizationResult.ok) return authorizationResult;

            return {ok: true, value: result};
        })().then(
            result => {
                // All of these promise resolvers MUST have either been resolved or rejected by
                // the end of this promise. So any promise resolvers that haven't been settled
                // yet reject with an error as a safety mechanism.
                if (!channelPromiseResolver.isSettled()) {
                    if (!result) {
                        channelPromiseResolver.resolve(null);
                    } else if (result && !result.ok) {
                        channelPromiseResolver.reject(result.error);
                    } else {
                        channelPromiseResolver.reject(
                            new InternalError("Promise resolver wasn’t resolved"),
                        );
                    }
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
                new DeadlineExceededError(
                    "Timed out waiting for channel item, possibly deadlocked?",
                ),
            );
        }, 3000);

        channelPromiseResolver.promise.then(
            () => timeout.clear(),
            () => timeout.clear(),
        );

        // If we're loading the channel, we can use the channel item in our
        // `ChannelPreviewModel` cache to avoid extra fetches.
        ChannelPreviewItemAuthorizationCache.set(
            context,
            consistency,
            channelId,
            channelPromiseResolver.promise,
        );

        return promise;
    }
}

/**
 * Get a `ChannelModel` and post files in the channel all at once. Executes a
 * realtime query so the data can be kept up-to-date in realtime.
 */
export async function getChannelAndMetadata(
    context: ServerContentActionContext,
    options: {
        channelId: ChannelId;
        postFilesLimit: number;
        afterItemKey?: DynamoItemKey | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<DynamoGeneralRealtimeQueryResult<ChannelOrMetadataModel>> {
    const result = await getChannelAndMetadataIfPossible(context, options);
    if (!result) throw createChannelNotFoundError(options.channelId);
    return unwrapResult(result);
}

/**
 * Backfill any realtime updates to catch up our client after it's been
 * disconnected from realtime.
 */
export async function backfillChannelAndMetadata(
    context: ServerContentActionContext,
    {
        channelId,
        readTime,
    }: {
        channelId: ChannelId;
        readTime: Date;
    },
): Promise<DynamoGeneralRealtimeBackfillResult<ChannelOrMetadataModel>> {
    const [, result] = await runAllPromises([
        authorizeChannelAccess(context, channelId, "View"),

        ForumRealtimeTable.backfillRealtimeQuery(context, {
            partitionKey: {partitionType: "Channel", channelId},
            readTime,
        }),
    ]);

    return result;
}

type ChannelPreviewAttributesItem = {
    readonly spaceId: SpaceId;
    readonly createdTime: Date;
    readonly name: string;
    readonly accessPolicy: AccessPolicy;
} & (
    | {readonly id: ChannelId; readonly version: number}
    | {readonly channelId: ChannelId; readonly updateLockVersion?: number}
);

assertAssignableTypes<ChannelAttributesItem, ChannelPreviewAttributesItem>();
assertAssignableTypes<ChannelModel, ChannelPreviewAttributesItem>();

const ChannelPreviewItemAuthorizationCache = new DynamoContextCache<
    ChannelId,
    ChannelPreviewAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getChannelPreviewItemForAuthorizationIfExists(
    context: ServerActionContext,
    channelId: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<ChannelPreviewAttributesItem | null> {
    return ChannelPreviewItemAuthorizationCache.get(context, consistency, channelId, consistency =>
        ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Channel",
                sortRangeType: "Attributes",
                channelId,
            },
            {
                consistency,
                attributes: ["spaceId", "createdTime", "name", "accessPolicy", "updateLockVersion"],
            },
        ),
    );
}

async function getChannelPreviewItemForAuthorization(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChannelPreviewAttributesItem> {
    const channelItem = await getChannelPreviewItemForAuthorizationIfExists(
        context,
        channelId,
        options,
    );

    if (!channelItem) throw createChannelNotFoundError(channelId);

    return channelItem;
}

/**
 * Gets a preview channel object with the provided `ChannelId`. Returns null if
 * the channel doesn't exist, returns a `Result` with a `PermissionDeniedError`
 * if access isn't authorized.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getChannelPreviewIfPossible(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<ChannelPreviewModel, ErrorBase> | null> {
    const channelItem = await getChannelPreviewItemForAuthorizationIfExists(
        context,
        channelId,
        options,
    );
    if (!channelItem) return null;

    const result = await authorizeChannelItemAccessIfPossible(context, channelItem, "View");
    if (!result.ok) return result;

    return {
        ok: true,
        value: new ChannelPreviewModel({
            id: channelId,
            spaceId: channelItem.spaceId,
            createdTime: channelItem.createdTime,
            version: "id" in channelItem ? channelItem.version : channelItem.updateLockVersion ?? 0,
            name: channelItem.name,
            accessPolicy: channelItem.accessPolicy,
        }),
    };
}

/**
 * Gets a preview channel object with the provided `ChannelId`. Returns null if
 * the channel doesn't exist and throws an error if the channel exists but you
 * don't have access to the channel.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getChannelPreviewIfExists(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChannelPreviewModel | null> {
    const channelResult = await getChannelPreviewIfPossible(context, channelId, options);
    if (!channelResult) return null;
    return unwrapResult(channelResult);
}

/**
 * Gets a preview channel object with the provided `ChannelId`. Throws an error
 * if the channel doesn't exist.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getChannelPreview(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ChannelPreviewModel> {
    const channel = await getChannelPreviewIfExists(context, channelId, options);
    if (!channel) throw createChannelNotFoundError(channelId);
    return channel;
}

/**
 * Gets a preview channel object and its `AccessPolicy` with the provided
 * `ChannelId`. Returns null if the channel doesn't exist, returns a `Result`
 * with a `PermissionDeniedError` if access isn't authorized.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getChannelPreviewAndAccessPolicyIfPossible(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<
    {
        readonly preview: ChannelPreviewModel;
        readonly accessPolicy: AccessPolicy;
    },
    ErrorBase
> | null> {
    const channelItem = await getChannelPreviewItemForAuthorizationIfExists(
        context,
        channelId,
        options,
    );
    if (!channelItem) return null;

    const result = await authorizeChannelItemAccessIfPossible(context, channelItem, "View");
    if (!result.ok) return result;

    return {
        ok: true,
        value: {
            preview: new ChannelPreviewModel({
                id: channelId,
                spaceId: channelItem.spaceId,
                createdTime: channelItem.createdTime,
                version:
                    "id" in channelItem ? channelItem.version : channelItem.updateLockVersion ?? 0,
                name: channelItem.name,
                accessPolicy: channelItem.accessPolicy,
            }),
            accessPolicy: channelItem.accessPolicy,
        },
    };
}

/**
 * Gets a preview channel object and its `AccessPolicy` with the provided
 * `ChannelId`. Returns null if the channel doesn't exist, throws a
 * `PermissionDeniedError` if access isn't authorized.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getChannelPreviewAndAccessPolicyIfExists(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    readonly preview: ChannelPreviewModel;
    readonly accessPolicy: AccessPolicy;
} | null> {
    const channel = await getChannelPreviewAndAccessPolicyIfPossible(context, channelId, options);
    if (!channel) return null;
    return unwrapResult(channel);
}

/**
 * Gets a preview channel object and its `AccessPolicy` with the provided
 * `ChannelId`. Throws if the channel doesn't exist or you don't have access
 * to it.
 *
 * The result is cached. If you call this for the same `ChannelId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getChannelPreviewAndAccessPolicy(
    context: ServerActionContext,
    channelId: ChannelId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    readonly preview: ChannelPreviewModel;
    readonly accessPolicy: AccessPolicy;
}> {
    const channel = await getChannelPreviewAndAccessPolicyIfExists(context, channelId, options);
    if (!channel) throw createChannelNotFoundError(channelId);
    return channel;
}

/**
 * Get the channel name and description content without references. Used for
 * building a search entity which will load content references on its own in a
 * way that tracks dependencies.
 */
export async function getChannelNameAndDescriptionContentAndContributors(
    context: ServerActionContext,
    channelId: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    version: number;
    name: string;
    description: MessageContent;
    createdTime: Date;
    creatorId: AccountId | null;
    accessPolicy: AccessPolicy;
    contributionCountByAccountId: ReadonlyMap<AccountId, number>;
}> {
    const promise = (async () => {
        const items = await arrayFromAsyncIterable(
            ForumRealtimeTable.query(context, {
                partitionKey: {partitionType: "Channel", channelId},
                endSortKey: {sortRangeType: "Contributors"},
                limit: "All",
                consistency,
            }),
        );
        if (items.length === 0) throw createChannelNotFoundError(channelId);

        const firstItem = items[0]!;
        const secondItem = items[1];

        if (firstItem.sortRangeType !== "Attributes") {
            throw new DataLossError("Expected the first query item to be the channel item");
        }

        if (secondItem && secondItem.sortRangeType !== "Contributors") {
            throw new DataLossError("Expected the second query item to be the contributors item");
        }

        return {channelItem: firstItem, contributorsItem: secondItem};
    })();

    // Save the channel to our authorization cache in case we need it later.
    ChannelPreviewItemAuthorizationCache.set(
        context,
        consistency,
        channelId,
        promise.then(({channelItem}) => channelItem),
    );

    const {channelItem, contributorsItem} = await promise;
    await authorizeChannelItemAccess(context, channelItem, "View");

    return {
        version: channelItem.updateLockVersion ?? 0,
        name: channelItem.name,
        description: channelItem.description,
        createdTime: channelItem.createdTime,
        creatorId: channelItem.creatorId,
        accessPolicy: channelItem.accessPolicy,
        contributionCountByAccountId: contributorsItem?.contributionCountByAccountId ?? emptyMap,
    };
}

/**
 * Authorize that the current user has access to a channel. Implicitly also
 * authorizes that the current user has access to the space the channel is in.
 */
export async function authorizeChannelAccess(
    context: ServerActionContext,
    channelId: ChannelId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId; accessPolicy: AccessPolicy}> {
    const channelItem = await getChannelPreviewItemForAuthorization(context, channelId, options);

    await authorizeChannelItemAccess(context, channelItem, expectedAccessLevel);

    return {spaceId: channelItem.spaceId, accessPolicy: channelItem.accessPolicy};
}

/**
 * Authorize that the current user has access to a channel. Implicitly also
 * authorizes that the current user has access to the space the channel is in.
 *
 * Returns a result instead of throwing an error if the user doesn't have
 * access.
 */
export async function authorizeChannelAccessIfPossible(
    context: ServerActionContext,
    channelId: ChannelId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId; accessPolicy: AccessPolicy}, ErrorBase>> {
    const channelItem = await getChannelPreviewItemForAuthorization(context, channelId, options);

    const result = await authorizeChannelItemAccessIfPossible(
        context,
        channelItem,
        expectedAccessLevel,
    );
    if (!result.ok) return result;

    return {
        ok: true,
        value: {spaceId: channelItem.spaceId, accessPolicy: channelItem.accessPolicy},
    };
}

/**
 * Subscribes the session actor to the channel. When new posts are made in the
 * channel they'll go into the session actor's inbox.
 */
export async function subscribeToChannel(
    context: ServerSessionActionContext,
    channelId: ChannelId,
) {
    await authorizeChannelAccess(context, channelId, "View");

    await ForumTable.updateItem(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Subscription",
            channelId,
            accountId: context.actor.getAccountId(),
        },
        item => {
            if (item) return item;

            return {
                partitionType: "Channel",
                sortRangeType: "Subscription",
                channelId,
                accountId: context.actor.getAccountId(),
                createdTime: new Date(),
            };
        },
    );
}

/**
 * Unsubscribes the session actor from the channel. They'll no longer see new
 * posts appear in their inbox.
 */
export async function unsubscribeFromChannel(
    context: ServerSessionActionContext,
    channelId: ChannelId,
) {
    await authorizeChannelAccess(context, channelId, "View");

    await ForumTable.updateItem(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Subscription",
            channelId,
            accountId: context.actor.getAccountId(),
        },
        item => {
            if (!item) return item;

            return null;
        },
    );
}

/**
 * Returns true if the actor is subscribed to the channel.
 */
export async function isSubscribedToChannel(
    context: ServerSessionActionContext,
    channelId: ChannelId,
    {consistency}: {consistency?: DynamoReadConsistency} = emptyObject,
): Promise<boolean> {
    await authorizeChannelAccess(context, channelId, "View");

    const item = await ForumTable.getItemIfExists(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Subscription",
            channelId,
            accountId: context.actor.getAccountId(),
        },
        {consistency},
    );

    return !!item;
}

/**
 * Get all subscribers to the channel.
 *
 * Tries to avoid returning accounts that don't have access to the channel
 * anymore. But it's possible due to race conditions we'll return an account
 * who's lost access to the channel.
 */
export async function getChannelNotificationSubscribers(
    context: ServerSystemActionContext,
    channelId: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
) {
    // Double check that this is a system actor. Currently the list of channel
    // subscribers is private. We don't want there to be social pressure to never
    // unsubscribe from a channel because people can see whether or not you're
    // subscribed (like there is in Slack, leaving a channel shows everyone a
    // "Caleb left the channel" message).
    context.actor.authorizeSystem();

    const channelItem = await getChannelPreviewItemForAuthorization(context, channelId, {
        consistency,
    });

    await authorizeChannelItemAccess(context, channelItem, "View");

    const accountIds = await parallelMapAsyncIterableToArray(
        ForumTable.query(context, {
            consistency,
            limit: "All",
            partitionKey: {partitionType: "Channel", channelId},
            startSortKey: {
                sortRangeType: "Subscription",
                accountId: DynamoKeyAttributeSchema.id.getMinValue<AccountId>(),
            },
            endSortKey: {
                sortRangeType: "Subscription",
                accountId: DynamoKeyAttributeSchema.id.getMaxValue<AccountId>(),
            },
        }),
        async item => {
            const hasAccess = await evaluateAccessPolicy(
                context,
                channelItem.spaceId,
                item.accountId,
                channelItem.accessPolicy,
                "View",
            );

            if (!hasAccess) return null;
            return item.accountId;
        },
    );

    return accountIds.filter(isNonNullable);
}

/**
 * Send a `ShareNotification` for the channel without updating the channel's
 * `AccessPolicy`.
 */
export async function sendChannelShareNotification(
    context: ServerSessionActionContext,
    channelId: ChannelId,
    notification: ShareNotification,
) {
    const {spaceId} = await authorizeChannelAccess(context, channelId, "View");

    await context.jobs.sendImmediately({
        type: "SendShareNotification",
        jobId: generateId(),
        spaceId,
        actorAccountId: context.actor.getAccountId(),
        entityId: `Channel:${channelId}`,
        notification,
    });
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
            if (!channelItem) throw createChannelNotFoundError(channelId);
            spaceId = channelItem.spaceId;

            await authorizeChannelItemAccess(context, channelItem, "Manage");

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
            if (!channelItem) throw createChannelNotFoundError(channelId);
            spaceId = channelItem.spaceId;

            await authorizeChannelItemAccess(context, channelItem, "Manage");

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
            if (!channelItem) throw createChannelNotFoundError(channelId);
            spaceId = channelItem.spaceId;

            await authorizeChannelItemAccess(context, channelItem, "Manage");

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

async function updateChannelAccessPolicyBase(
    context: ForumSessionActionContextWithBroadcast,
    {
        channelId,
        updateAccessPolicy,
        notification,
    }: {
        channelId: ChannelId;
        updateAccessPolicy: (accessPolicy: AccessPolicy) => AccessPolicy;
        notification: ShareNotification | null;
    },
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (context: ServerContentActionContext) => Promise<{
        readTime: Date;
        eventTransaction: ReadonlyArray<
            DynamoGeneralRealtimeEvent<ChannelModel | ChannelContributorsModel>
        >;
    }>;
}> {
    const readTime = new Date();

    const {channelItem, shouldAddFeedCandidateEntry, getDynamoGeneralRealtimeEventTransaction} =
        await context.dynamo.retryTransaction(
            async (
                context,
            ): Promise<{
                channelItem: ChannelAttributesItem;
                shouldAddFeedCandidateEntry: boolean;
                getDynamoGeneralRealtimeEventTransaction: (
                    context: ServerContentActionContext,
                ) => Promise<{
                    readTime: Date;
                    eventTransaction: ReadonlyArray<
                        DynamoGeneralRealtimeEvent<ChannelModel | ChannelContributorsModel>
                    >;
                }>;
            }> => {
                const channelItem = await ForumRealtimeTable.getItemIfExists(context, {
                    partitionType: "Channel",
                    sortRangeType: "Attributes",
                    channelId,
                });
                if (!channelItem) throw createChannelNotFoundError(channelId);

                await authorizeChannelItemAccess(context, channelItem, "Manage");

                const oldAccessPolicy = channelItem.accessPolicy;
                const newAccessPolicy = updateAccessPolicy(oldAccessPolicy);

                if (newAccessPolicy.urlGrant) {
                    throw new InvalidArgumentError("Channels don’t currently support `urlGrant`s");
                }

                const result = validateAccessPolicyUpdate(
                    context.actor.getAccountId(),
                    oldAccessPolicy,
                    newAccessPolicy,
                );
                if (!result.ok) {
                    throw new FailedPreconditionError(result.reason);
                }

                const oldHasAddedFeedCandidateEntry = channelItem.hasAddedFeedCandidateEntry;
                const newHasAddedFeedCandidateEntry =
                    oldHasAddedFeedCandidateEntry || !!newAccessPolicy.defaultGrant;

                const oldAccountIdsWithGrant = Array.from(oldAccessPolicy.accountGrantById.keys());
                const newAccountIdsWithGrant = Array.from(newAccessPolicy.accountGrantById.keys());

                // If we're adding or removing accounts to the `accessPolicy` then we also want
                // to update the `Contributors` item. The `Contributors` item includes the
                // granted `AccountId`s in the contributor list when we're out of accounts that
                // have actually contributed content.
                //
                // We do it in a transaction so that the `eventTransaction` we return to the
                // client includes the updated contributors model. So we can immediately
                // re-render the contributors item with the new data.
                if (isDeepEqual(oldAccountIdsWithGrant, newAccountIdsWithGrant)) {
                    const {getEvent} = await ForumRealtimeTable.directlyUpdateItem(context, {
                        ...channelItem,
                        accessPolicy: newAccessPolicy,
                        hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                    });

                    return {
                        channelItem,
                        shouldAddFeedCandidateEntry:
                            newHasAddedFeedCandidateEntry && !oldHasAddedFeedCandidateEntry,
                        getDynamoGeneralRealtimeEventTransaction: async context => ({
                            readTime,
                            eventTransaction: [await getEvent(context)],
                        }),
                    };
                } else {
                    const contributorsItem = (await ForumRealtimeTable.getItemIfExists(context, {
                        partitionType: "Channel",
                        sortRangeType: "Contributors",
                        channelId,
                    })) ?? {
                        partitionType: "Channel",
                        sortRangeType: "Contributors",
                        channelId,
                        spaceId: channelItem.spaceId,
                        contributionCountByAccountId: new Map(),
                        accountIdsWithGrant: emptyArray,
                    };

                    const {getEventTransaction} =
                        await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
                            ForumRealtimeTable.transactionDirectlyUpdateItem({
                                ...channelItem,
                                accessPolicy: newAccessPolicy,
                                hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                            }),
                            ForumRealtimeTable.transactionDirectlyUpdateItem({
                                ...contributorsItem,
                                accountIdsWithGrant: newAccountIdsWithGrant,
                            }),
                        ]);

                    return {
                        channelItem,
                        shouldAddFeedCandidateEntry:
                            newHasAddedFeedCandidateEntry && !oldHasAddedFeedCandidateEntry,
                        getDynamoGeneralRealtimeEventTransaction: async context => ({
                            readTime,
                            eventTransaction: (await getEventTransaction(
                                context,
                                ForumRealtimeTable,
                            )) as ReadonlyArray<
                                DynamoGeneralRealtimeEvent<ChannelModel | ChannelContributorsModel>
                            >,
                        }),
                    };
                }
            },
        );

    if (shouldAddFeedCandidateEntry) {
        context.process.waitUntil(async () => {
            await addFeedCandidateEntry(context, channelItem.spaceId, {
                type: "Channel",
                channelId,
                sharedTime: readTime,
                sharerId: context.actor.getAccountId(),
                creatorId: channelItem.creatorId,
                event: "SharedWithAccessPolicyDefaultGrant",
            });
        });
    }

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId: channelItem.spaceId,
        update: {
            type: "Channel",
            channelId,
            updatedTraits: {type: "Some", traits: ["Authorization"]},
        },
    });

    if (notification) {
        context.jobs.send({
            type: "SendShareNotification",
            jobId: generateId(),
            spaceId: channelItem.spaceId,
            actorAccountId: context.actor.getAccountId(),
            entityId: `Channel:${channelId}`,
            notification,
        });
    }

    return {getDynamoGeneralRealtimeEventTransaction};
}

/**
 * Updates the channel's `AccessPolicy`. The session actor must be a manager on
 * the channel to update the channel's access policy.
 */
export async function updateChannelAccessPolicy(
    context: ForumSessionActionContextWithBroadcast,
    {
        channelId,
        accessPolicy,
        notification,
    }: {
        channelId: ChannelId;
        accessPolicy: AccessPolicy;
        notification: ShareNotification | null;
    },
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (context: ServerContentActionContext) => Promise<{
        readTime: Date;
        eventTransaction: ReadonlyArray<
            DynamoGeneralRealtimeEvent<ChannelModel | ChannelContributorsModel>
        >;
    }>;
}> {
    return updateChannelAccessPolicyBase(context, {
        channelId,
        updateAccessPolicy: () => accessPolicy,
        notification,
    });
}

/**
 * Updates the channel's `AccessPolicy` by adding account grants. This allows
 * you to avoid conflicting update race conditions since you're not replacing
 * the entire access policy.
 */
export async function addAccountGrantsToChannelAccessPolicy(
    context: ForumSessionActionContextWithBroadcast,
    {
        channelId,
        accountGrantById,
        notification,
    }: {
        channelId: ChannelId;
        accountGrantById: ReadonlyMap<AccountId, {readonly level: AccessLevel}>;
        notification: ShareNotification | null;
    },
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (context: ServerContentActionContext) => Promise<{
        readTime: Date;
        eventTransaction: ReadonlyArray<
            DynamoGeneralRealtimeEvent<ChannelModel | ChannelContributorsModel>
        >;
    }>;
}> {
    return updateChannelAccessPolicyBase(context, {
        channelId,
        updateAccessPolicy: accessPolicy =>
            reduceAccessPolicy(context.actor.getAccountId(), accessPolicy, {
                type: "AddAccountGrants",
                accountGrantById,
            }),
        notification,
    });
}

export function getChannelPostsIndexName(): string {
    return ChannelPostsIndex.name;
}

export function getChannelPostsPartitionKey(channelId: ChannelId): DynamoIndexPartitionKey {
    return ChannelPostsIndex.getRealtimeQueryPartitionKey({channelId});
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
        authorizeChannelAccess(context, channelId, "View"),
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
        authorizeChannelAccess(context, channelId, "View"),
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
                const fileId: FileId | FileEntityId | null = value;
                if (fileId !== null && isId<FileId>(fileId)) {
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
    const {spaceId} = await authorizeChannelAccess(context, channelId, "Edit");

    const mentionCountByAccountId = getMentionCountByAccountIdInContent(content);

    const postItem: PostAttributesItem = {
        partitionType: "Post",
        sortRangeType: "Attributes",
        postId: generateId(),
        spaceId,
        channelId,
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
    PostItemAuthorizationCache.set(context, "Strong", postItem.postId, postItem);

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

            // We create the `PostFiles` item in a transaction instead of asynchronously
            // with `context.process.waitUntil()` because we want the `PostFiles` realtime
            // event to be applied atomically to clients alongside the create post realtime
            // event. Otherwise `context.process.waitUntil()` would be fine. It's not
            // critical to write this item so it's a bit of a bummer we double our DynamoDB
            // WCU cost for posts with files.
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

    // TODO(calebmer): If the Node.js process crashes between the DynamoDB write
    // creating the post and this code, we won't show the newly created post in the
    // home feed! Which is pretty bad.
    //
    // I think we should probably move all this after-write logic to DynamoDB
    // streams for reliability. We should make all this after-write logic
    // idempotent and retry until the DynamoDB stream event is processed. Not just
    // here but in `createPostComment()` and `sendChatMessage()` and
    // `createChannel()`. Really anywhere that schedules some
    // `context.process.waitUntil()` work after a write that we want done reliably.
    context.process.waitUntil(async () => {
        await addFeedCandidateEntry(context, postItem.spaceId, {
            type: "Post",
            postId: postItem.postId,
            channelId: postItem.channelId,
            authorId: postItem.authorId,
            createdTime: postItem.createdTime,
        });
    });

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

    // When a post is created, update the contributors map. It's ok to do this in
    // `context.process.waitUntil()`. It's fine if `AppService` crashes and we
    // don't record the contribution.
    context.process.waitUntil(async () => {
        let oldContributionCount = 0;
        let newContributionCount = 0;

        await ForumRealtimeTable.updateItem(
            context,
            {partitionType: "Channel", sortRangeType: "Contributors", channelId},
            contributorsItem => {
                contributorsItem ??= {
                    partitionType: "Channel",
                    sortRangeType: "Contributors",
                    channelId: postItem.channelId,
                    spaceId: postItem.spaceId,
                    contributionCountByAccountId: new Map(),
                    accountIdsWithGrant: emptyArray,
                };

                oldContributionCount =
                    contributorsItem.contributionCountByAccountId.get(
                        context.actor.getAccountId(),
                    ) ?? 0;

                newContributionCount = Math.min(
                    oldContributionCount + 1,
                    maxChannelContributionCount,
                );

                // Optimization: If this account has already reached the max contribution count
                // then don't increment their contributions anymore.
                if (oldContributionCount === newContributionCount) {
                    return contributorsItem;
                }

                const newContributionCountByAccountId = new Map(
                    contributorsItem.contributionCountByAccountId,
                );

                newContributionCountByAccountId.set(
                    context.actor.getAccountId(),
                    newContributionCount,
                );

                return {
                    ...contributorsItem,
                    contributionCountByAccountId: newContributionCountByAccountId,
                };
            },
        );

        // Reindex the channel whenever someone contributes for the first time
        // (making them a minor contributor) or when someone maxes out their
        // contribution count (making them a major contributor).
        if (
            oldContributionCount !== newContributionCount &&
            (oldContributionCount === 0 || newContributionCount === maxChannelContributionCount)
        ) {
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
    });

    const mentionedAccountIds = getMentionedAccountIdsInContent(content);
    const contentSnippet = getNotificationPostContentSnippet(content);

    context.jobs.send({
        type: "NotificationEvent",
        event: {
            type: "CreatePost",
            id: generateId(),
            spaceId,
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
        spaceId,
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
        markSearchAffinityEntityInteraction(context, {
            spaceId,
            entityId: `Channel:${channelId}`,
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
            if (await isAccountMemberOfSpace(context, spaceId, mentionedAccountId)) {
                await markSearchAffinityEntityInteraction(context, {
                    spaceId,
                    entityId: `Account:${mentionedAccountId as AccountId}`,
                    interaction: {type: "HighIntentUpdate"},
                });
            }
        });
    }

    return {
        id: postItem.postId,
        spaceId,
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
    postId: PostId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<DynamoGeneralRealtimeItem<PostModel>> {
    return unwrapResult(await getPostIfPossible(context, postId, options));
}

/**
 * Gets the post with the provided `PostId`. If you don't have access to the
 * post we return a result with an error instead of throwing. Throws an error
 * if the post doesn't exist in the database.
 */
export async function getPostIfPossible(
    context: ServerContentActionContext,
    postId: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<Result<DynamoGeneralRealtimeItem<PostModel>, ErrorBase>> {
    const postItemPromise = ForumRealtimeTable.getItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {consistency},
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, consistency, postId, postItemPromise);

    const postItem = await postItemPromise;
    if (!postItem) throw createPostNotFoundError(postId);

    const [authorizationResult, postResult] = await runAllPromises([
        authorizeChannelAccessIfPossible(context, postItem.channelId, "View"),
        captureResultPromise(ForumRealtimeTable.buildRealtimeItem(context, postItem)),
    ]);
    if (!authorizationResult.ok) return authorizationResult;

    // Ignore errors from `postResult` if authorization fails (since it's probably
    // the same error). Otherwise, if authorization passed and building the post
    // item failed treat that as an exception.
    const post = unwrapResult(postResult);

    return {ok: true, value: post};
}

export async function getPostContentAndChannelPreview(
    context: ServerActionContext,
    postId: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    version: number;
    createdTime: Date;
    authorId: AccountId;
    content: PostContent;
    channel: ChannelPreviewModel;
}> {
    const postItemPromise = ForumRealtimeTable.getItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {consistency},
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, consistency, postId, postItemPromise);

    const postItem = await postItemPromise;
    if (!postItem) throw createPostNotFoundError(postId);

    const channel = await getChannelPreviewAndAccessPolicy(context, postItem.channelId, {
        consistency,
    });

    return {
        version: postItem.updateLockVersion ?? 0,
        createdTime: postItem.createdTime,
        authorId: postItem.authorId,
        content: postItem.content,
        channel: channel.preview,
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
        readonly updateLockVersion?: number;
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
        version: item.updateLockVersion ?? 0,
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
export async function getPostAuthorAndChannelPreviewIfPossible(
    context: ServerActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{author: AccountModel; channel: ChannelPreviewModel}, ErrorBase> | null> {
    const postItem = await getPostItemForAuthorizationIfExists(context, postId, options);
    if (!postItem) return null;

    const authorPromise = getAccount(context, postItem.spaceId, postItem.authorId, options);
    const channelResultPromise = getChannelPreviewIfPossible(context, postItem.channelId, options);

    const [, channelResult] = await runAllPromises([
        authorPromise.catch(() => {
            // Ignore errors but wait for `authorPromise` to resolve. If
            // `channelResultPromise` returns an `ok: false` result then we're going to
            // ignore any errors from `getAccount()`.
        }),
        channelResultPromise,
    ]);

    // The channel referenced by `postItem` must always exist.
    assert(channelResult);

    if (!channelResult.ok) return channelResult;

    const author = await authorPromise;

    return {ok: true, value: {author, channel: channelResult.value}};
}

/**
 * Get the `ChannelPreviewModel` for a post and the `AccountModel` who authored
 * the post.
 *
 * The result is cached. If you call this for the same `PostId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getPostAuthorAndChannelPreview(context: ServerActionContext, postId: PostId) {
    const result = await getPostAuthorAndChannelPreviewIfPossible(context, postId);
    if (!result) throw createPostNotFoundError(postId);
    return unwrapResult(result);
}

/**
 * Get the `ChannelPreviewModel` for a post.
 *
 * The result is cached. If you call this for the same `PostId` multiple
 * times in the same action you'll get the same result without issuing a
 * network request.
 */
export async function getPostChannelPreviewIfPossible(
    context: ServerActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{authorId: AccountId; channel: ChannelPreviewModel}, ErrorBase> | null> {
    const postItem = await getPostItemForAuthorizationIfExists(context, postId, options);
    if (!postItem) return null;

    const channelResult = await getChannelPreviewIfPossible(context, postItem.channelId, options);

    // The channel referenced by `postItem` must always exist.
    assert(channelResult);

    if (!channelResult.ok) return channelResult;

    return {ok: true, value: {authorId: postItem.authorId, channel: channelResult.value}};
}

/**
 * Get the post's author without authorizing that the actor has access to the
 * post. This is dangerous since it lets you read data you shouldn't be allowed
 * to see! Though you must have access to the space the post is in.
 *
 * It's difficult to abuse this function because you at least need to know a
 * valid `PostId`. Which probably means you have access to the post through
 * some other means. So if you have a `PostId` and space access it probably
 * means you had access to the post at some previous point in time. Given the
 * post author never changes then you're reading data you could previously see
 * which while still technically a violation of our permission policies isn't
 * that bad.
 *
 * Regardless! You should have a very good reason to use this function since it
 * does technically violate our permission policies.
 */
export async function dangerouslyGetPostAuthorWithoutAuthorization(
    context: ServerActionContext,
    postId: PostId,
): Promise<AccountModel> {
    const postItem = await getPostItemForAuthorization(context, postId);
    await authorizeSpaceAccess(context, postItem.spaceId);
    return getAccount(context, postItem.spaceId, postItem.authorId);
}

/**
 * Get accounts subscribed to notifications for the provided `PostId`.
 */
export async function getPostNotificationSubscribers(
    context: ServerSystemActionContext,
    postId: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    accountIds: ReadonlySet<AccountId | ContentMentionAccountId>;
    postCreatedTime: Date;
}> {
    const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId: postId,
        },
        {
            attributes: ["createdTime", "authorId", "spaceId", "channelId", "commentsSummary"],
            consistency,
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, consistency, postId, postItemPromise);

    const postItem = await postItemPromise;
    if (!postItem) throw createPostNotFoundError(postId);

    await authorizeChannelAccess(context, postItem.channelId, "View", {consistency});

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

        await authorizeChannelAccess(context, oldPostItem.channelId, "Edit");

        if (oldPostItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only update posts you authored");

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

    await authorizeChannelAccess(context, postItem.channelId, "View");

    return runAllPromises(
        Array.from(
            sliceIterable(postItem.commentsSummary.commentCountByAuthorId.keys(), 0, limit),
            accountId => getAccount(context, postItem.spaceId, accountId),
        ),
    );
}

const PostItemAuthorizationCache = new DynamoContextCache<
    PostId,
    Pick<
        PostAttributesItem,
        "partitionType" | "sortRangeType" | "postId" | "spaceId" | "channelId" | "authorId"
    > | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getPostItemForAuthorizationIfExists(
    context: ServerActionContext,
    postId: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<Pick<
    PostAttributesItem,
    "partitionType" | "sortRangeType" | "postId" | "spaceId" | "channelId" | "authorId"
> | null> {
    return PostItemAuthorizationCache.get(context, consistency, postId, consistency =>
        ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                consistency,
                attributes: ["spaceId", "channelId", "authorId"],
            },
        ),
    );
}

async function getPostItemForAuthorization(
    context: ServerActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<
    Pick<
        PostAttributesItem,
        "partitionType" | "sortRangeType" | "postId" | "spaceId" | "channelId" | "authorId"
    >
> {
    const item = await getPostItemForAuthorizationIfExists(context, postId, options);
    if (!item) throw createPostNotFoundError(postId);
    return item;
}

/**
 * Authorizes that the session user can access the provided post.
 * Implicitly also authorizes that the session user can access the channel the
 * post is in and the space the channel is in.
 */
export async function authorizePostAccess(
    context: ServerActionContext,
    id: PostId,
    expectedAccessLevel: "View" | "Edit",
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId; channelId: ChannelId; channelAccessPolicy: AccessPolicy}> {
    return unwrapResult(
        await authorizePostAccessIfPossible(context, id, expectedAccessLevel, options),
    );
}

/**
 * Authorizes that the session user can access the provided post.
 * Implicitly also authorizes that the session user can access the channel the
 * post is in and the space the channel is in.
 *
 * Returns a result if there's an authorization failure instead of throwing.
 */
export async function authorizePostAccessIfPossible(
    context: ServerActionContext,
    id: PostId,
    expectedAccessLevel: "View" | "Edit",
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<
    Result<{spaceId: SpaceId; channelId: ChannelId; channelAccessPolicy: AccessPolicy}, ErrorBase>
> {
    const postItem = await getPostItemForAuthorization(context, id, options);

    const result = await authorizeChannelAccessIfPossible(
        context,
        postItem.channelId,
        expectedAccessLevel,
        options,
    );
    if (!result.ok) return result;

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
                case "Session":
                case "ImpersonatedAccount": {
                    if (postItem.authorId !== context.actor.getAccountId()) {
                        return {
                            ok: false,
                            error: new PermissionDeniedError(
                                "Account doesn’t have edit access to post",
                            ),
                        };
                    }
                    break;
                }
                case "Anonymous": {
                    return {ok: false, error: unauthenticatedSessionError()};
                }
                default:
                    throw exhaustive(context.actor);
            }
            break;
        }
        default:
            throw exhaustive(expectedAccessLevel);
    }

    return {
        ok: true,
        value: {
            spaceId: postItem.spaceId,
            channelId: postItem.channelId,
            channelAccessPolicy: result.value.accessPolicy,
        },
    };
}

/**
 * Add a new comment to a post.
 */
export async function createPostComment(
    context: ForumSessionActionContextWithBroadcast,
    {
        postId,
        parentCommentIndex,
        content,
        fileIds,
    }: {
        postId: PostId;
        parentCommentIndex: number | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
    },
): Promise<{
    spaceId: SpaceId;
    index: number;
    createdTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const postItemConsistency: DynamoReadConsistency = "Eventual";

        const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                consistency: postItemConsistency,
                attributes: [
                    "spaceId",
                    "channelId",
                    "authorId",
                    "commentsSummary",
                    "updateLockVersion",
                ],
            },
        );

        // After we've loaded a post, save it to the authorization cache so if we need
        // to authorize later in the action it's available.
        PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

        const [postItem] = await runAllPromises([
            postItemPromise.then(async postItem => {
                if (!postItem) throw createPostNotFoundError(postId);

                await runAllPromises([
                    authorizeChannelAccess(context, postItem.channelId, "Comment"),

                    // Make sure all the provided files exist.
                    runAllPromises(
                        fileIds.map(fileId =>
                            isId<FileId>(fileId)
                                ? getFileFromAttachment(
                                      context,
                                      postItem.spaceId,
                                      fileId,
                                      FilePostAuthorizer.bind({type: "PostComments", postId}),
                                  )
                                : null,
                        ),
                    ),
                ]);

                return postItem;
            }),

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
        const oldCommentCount = postItem.commentsSummary.commentCountByAuthorId.get(authorId) ?? 0;
        newCommentCountByAuthorId.set(authorId, oldCommentCount + 1);

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
                    fileIds,
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

        // When the account comments on a post they didn't author for the first time,
        // update the contributors map. It's ok to do this in
        // `context.process.waitUntil()`. It's fine if `AppService` crashes and we
        // don't record the contribution.
        if (postItem.authorId !== authorId && oldCommentCount === 0) {
            context.process.waitUntil(async () => {
                let oldContributionCount = 0;
                let newContributionCount = 0;

                await ForumRealtimeTable.updateItem(
                    context,
                    {
                        partitionType: "Channel",
                        sortRangeType: "Contributors",
                        channelId: postItem.channelId,
                    },
                    contributorsItem => {
                        contributorsItem ??= {
                            partitionType: "Channel",
                            sortRangeType: "Contributors",
                            channelId: postItem.channelId,
                            spaceId: postItem.spaceId,
                            contributionCountByAccountId: new Map(),
                            accountIdsWithGrant: emptyArray,
                        };

                        oldContributionCount =
                            contributorsItem.contributionCountByAccountId.get(
                                context.actor.getAccountId(),
                            ) ?? 0;

                        newContributionCount = Math.min(
                            oldContributionCount + 1,
                            maxChannelContributionCount,
                        );

                        // If this account has already reached the max contribution count then don't
                        // increment their contributions anymore.
                        if (oldContributionCount === newContributionCount) {
                            return contributorsItem;
                        }

                        const newContributionCountByAccountId = new Map(
                            contributorsItem.contributionCountByAccountId,
                        );

                        newContributionCountByAccountId.set(
                            context.actor.getAccountId(),
                            newContributionCount,
                        );

                        return {
                            ...contributorsItem,
                            contributionCountByAccountId: newContributionCountByAccountId,
                        };
                    },
                );

                // Reindex the channel whenever someone contributes for the first time
                // (making them a minor contributor) or when someone maxes out their
                // contribution count (making them a major contributor).
                if (
                    oldContributionCount !== newContributionCount &&
                    (oldContributionCount === 0 ||
                        newContributionCount === maxChannelContributionCount)
                ) {
                    context.jobs.send({
                        type: "IndexSearchEntity",
                        spaceId: postItem.spaceId,
                        update: {
                            type: "Channel",
                            channelId: postItem.channelId,
                            updatedTraits: {type: "Some", traits: []},
                        },
                    });
                }
            });
        }

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
            markSearchAffinityEntityInteraction(context, {
                spaceId: postItem.spaceId,
                entityId: `Channel:${postItem.channelId}`,
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
                    await markSearchAffinityEntityInteraction(context, {
                        spaceId: postItem.spaceId,
                        entityId: `Account:${mentionedAccountId as AccountId}`,
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
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    createdTime: Date;
    authorId: AccountId;
    payload: MessagePayload;
    channelId: ChannelId;
    channelAccessPolicy: AccessPolicy;
}> {
    const [{channelId, channelAccessPolicy}, item] = await runAllPromises([
        authorizePostAccess(context, postId, "View", {consistency}),
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
        channelId,
        channelAccessPolicy,
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
            FilePostAuthorizer.bind({type: "PostComments", postId: item.postId}),
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
        const postItemConsistency: DynamoReadConsistency = "Eventual";

        const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                consistency: postItemConsistency,
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
        PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

        const [postItem, commentItem] = await runAllPromises([
            postItemPromise,
            ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

        if (!postItem) throw createPostNotFoundError(postId);

        const {spaceId} = await authorizeChannelAccess(context, postItem.channelId, "Comment");

        if (commentItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only update post comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not update comments with a non-content payload");

        if (commentItem.payload.clerical)
            throw new FailedPreconditionError("Can’t update clerical comment content");

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
        const postItemConsistency: DynamoReadConsistency = "Eventual";

        const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                consistency: postItemConsistency,
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
        PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

        const [postItem, commentItem] = await runAllPromises([
            postItemPromise,
            ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

        if (!postItem) throw createPostNotFoundError(postId);

        const {spaceId} = await authorizeChannelAccess(context, postItem.channelId, "Comment");

        if (commentItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only delete post comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can’t delete comments with a non-content payload");

        if (commentItem.payload.clerical)
            throw new FailedPreconditionError("Can’t delete clerical comments");

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

    const postItemConsistency: DynamoReadConsistency = "Eventual";

    const postItemPromise = ForumRealtimeTable.getItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId: postId,
        },
        {consistency: postItemConsistency},
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

    // Important that this comes after the query call since we want to load the
    // query and post item in parallel.
    const postItem = await postItemPromise;
    if (!postItem) throw createPostNotFoundError(postId);

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
        authorizeChannelAccess(context, postItem.channelId, "View"),
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
    const postItemConsistency: DynamoReadConsistency = "Eventual";

    const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            consistency: postItemConsistency,
            attributes: ["spaceId", "channelId", "authorId", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

    const [postItem, {comments, otherReferencedComments}] = await runAllPromises([
        postItemPromise.then(async postItem => {
            if (!postItem) throw createPostNotFoundError(postId);
            await authorizeChannelAccess(context, postItem.channelId, "View");
            return postItem;
        }),
        getPostCommentsFromStartAssumingAuthorizedPost(context, {
            postId,
            getSpaceId: () =>
                postItemPromise.then(postItem => {
                    if (!postItem) throw createPostNotFoundError(postId);
                    return postItem.spaceId;
                }),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
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
        consistency?: DynamoCacheReadConsistency;
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
    const postItemConsistency: DynamoReadConsistency = "Eventual";

    const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            consistency: postItemConsistency,
            attributes: ["spaceId", "channelId", "authorId", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

    const [postItem, {comments, otherReferencedComments}] = await runAllPromises([
        postItemPromise.then(async postItem => {
            if (!postItem) throw createPostNotFoundError(postId);
            await authorizeChannelAccess(context, postItem.channelId, "View");
            return postItem;
        }),
        getPostCommentsFromEndAssumingAuthorizedPost(context, {
            postId,
            getSpaceId: () =>
                postItemPromise.then(postItem => {
                    if (!postItem) throw createPostNotFoundError(postId);
                    return postItem.spaceId;
                }),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
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
    const postItemConsistency: DynamoReadConsistency = "Eventual";

    const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            consistency: postItemConsistency,
            attributes: ["spaceId", "channelId", "authorId", "createdTime", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

    const [[postItem, commentChangesResult], {comments, otherReferencedComments}] =
        await runAllPromises([
            postItemPromise.then(async postItem => {
                if (!postItem) throw createPostNotFoundError(postId);

                const [, commentChangesResult] = await runAllPromises([
                    authorizeChannelAccess(context, postItem.channelId, "View"),
                    queryPostCommentChangeLogAssumingAuthorizedPost(context, {
                        postItem,
                        lastCommentChangeTime: clientLastCommentChangeTime,
                        // Use a strong read consistency when backfilling. This guarantees the caller
                        // will observe all realtime events before this function call. Realtime events
                        // that happen during the function call may be missed. You should be subscribed
                        // to new realtime events before starting to backfill.
                        consistency: "Strong",
                    }),
                ]);

                return [postItem, commentChangesResult] as const;
            }),
            getPostCommentsFromStartAssumingAuthorizedPost(context, {
                postId,
                getSpaceId: () =>
                    postItemPromise.then(postItem => {
                        if (!postItem) throw createPostNotFoundError(postId);
                        return postItem.spaceId;
                    }),
                limit: newCommentLimit,
                afterCommentIndex: clientCommentCount - 1,
                beforeCommentIndex: null,
                // Use a strong read consistency when backfilling. This guarantees the caller
                // will observe all realtime events before this function call. Realtime events
                // that happen during the function call may be missed. You should be subscribed
                // to new realtime events before starting to backfill.
                consistency: "Strong",
            }),
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
        consistency?: DynamoCacheReadConsistency;
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
                            references: await getMessageContentReferencesForNode(
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

export async function authorizePostDraftAccess(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    draftId: PostDraftId,
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId);

    switch (context.actor.type) {
        case "System": {
            // We don't have a use case for system actions looking at drafts right now. So
            // block it.
            throw new PermissionDeniedError("System actors can’t access post drafts");
        }
        case "Session":
        case "ImpersonatedAccount": {
            if (accountId !== context.actor.getAccountId()) {
                throw new PermissionDeniedError("Can’t access drafts from other accounts");
            }
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        default:
            throw exhaustive(context.actor);
    }

    // Note that we don't authorize whether the post draft actually exists or not.
    // The session actor always has access to drafts with their `accountId` in the
    // key and nothing in the draft item can change that. We don't check if the
    // draft exists for performance because it's irrelevant to whether the account
    // has access. Also since there's a race condition when create a post with a
    // `draftId` between `getPostDraftFileAttachments()` (which calls this
    // function) and DynamoDB deleting the draft item.

    // Note that we don't authorize whether you have access to
    // `draftItem.channelId`. The draft author may have had access to the provided
    // channel when they created the draft then subsequently lost access to the
    // channel. If the user has lost access to the channel then we should consider
    // `channelId` to be null.
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
    await authorizePostDraftAccess(context, spaceId, accountId, draftId);

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
    await authorizePostDraftAccess(context, spaceId, accountId, draftId);

    const draftItem = await ForumTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "PostDraft",
        spaceId,
        accountId,
        draftId,
    });

    if (!draftItem) return null;

    const [channel, contentReferences] = await runAllPromises([
        draftItem.channelId
            ? await getChannelPreviewIfPossible(context, draftItem.channelId).then(channelResult =>
                  // Ignore permission denied errors on the channel.
                  channelResult?.ok ? channelResult.value : null,
              )
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
