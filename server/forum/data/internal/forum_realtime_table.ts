import {Mapping} from "prosemirror-transform";
import {intoAccessPolicyModel} from "~/server/access/into_access_policy_model.js";
import {getContentReferencesAssumingViewAccessWithOptionalSpaceAccess} from "~/server/content/get_content_references_assuming_view_access_with_optional_space_access.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {getFileFromAttachment} from "~/server/files/data/files_actions.js";
import {authorizePostAccessIfPossible} from "~/server/forum/data/authorize_post_access.js";
import {authorizePostDraftAccessIfPossible} from "~/server/forum/data/authorize_post_draft_access.js";
import {getChannelPreview} from "~/server/forum/data/get_channel_preview.js";
import {maxChannelContributionCount} from "~/server/forum/data/max_channel_contribution_count.js";
import {
    RynamoTableItemType,
    RynamoTableSchema,
    RynamoTableSchemaGetTypes,
} from "~/server/rynamo/rynamo_table_schema.js";
import {getAccountOrDangerouslyGetStubWithoutAuthorization} from "~/server/spaces/get_account_or_dangerously_get_stub_without_authoriztion.js";
import {AccessPolicy, AccessPolicySchema} from "~/shared/access/access_policy.js";
import {
    MessageContent,
    MessageContentSchema,
    emptyMessageContent,
} from "~/shared/content/message_content_schema.js";
import {RynamoEventStub} from "~/shared/dynamo/rynamo_types.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    ChannelContributorsModel,
    ChannelModel,
    ChannelPostFilesModel,
    ChannelPreviewModel,
    maxChannelTopContributorCount,
} from "~/shared/forum/channel_model.js";
import {ChannelBroadcastRealtimeEventsSchema} from "~/shared/forum/channel_realtime_protocol.js";
import {PostContent, PostContentSchema} from "~/shared/forum/post_content_schema.js";
import {PostModel, maxPostPreviewCommentAuthorCount} from "~/shared/forum/post_model.js";
import {PostBroadcastRealtimeEventsSchema} from "~/shared/forum/post_realtime_protocol.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {sumIterable} from "~/shared/helpers/iterable/sum_iterable.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId, ChannelId, FileId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {ProsemirrorMappingSchema} from "~/shared/prosemirror/prosemirror_mapping_schema.js";
import {ReactionSet, emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export const ForumRealtimeTable = RynamoTableSchema.new({
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
                            // NOTE(calebmer, 2025-04-21): Before today channels don't have an `accessPolicy`
                            // and we assume all channels are public within the space. So if we find a channel
                            // with no `accessPolicy` then default to a public access policy.
                            .default({
                                type: "Local",
                                accountGrantById: emptyMap,
                                defaultGrant: {level: "Manage", generation: 0},
                                urlGrant: null,
                            }),

                        /**
                         * Have we added a feed candidate entry for the channel? We add an entry when the
                         * channel is shared with some `defaultGrant`. But if you revoke the `defaultGrant`
                         * then add it again we don't want to add another feed candidate entry.
                         */
                        hasAddedFeedCandidateEntry: Schema.boolean.default(false),
                    }),
                },

                /**
                 * All the accounts who have contributed to this channel. Contributions include
                 * creating the channel, creating a post in the channel, or sending a post comment
                 * for a post in the channel. Each contribution increments the account's
                 * contribution count by 1. If the user deletes their post or moves their post to a
                 * different channel then their contribution count will decrease. Deleting a
                 * comment does not currently decrease the account's contribution count (similar to
                 * how deleting a comment does not decrease `postItem.commentCountByAuthorId`.)
                 * Once the contribution count has reached its max value (currently 10) it will not
                 * increase any further and will never decrease. The account is permanently
                 * considered a contributor after the max contribution count.
                 *
                 * The contributors map may be updated asynchronously after the contribution has
                 * occurred. There's also no guarantee a contribution will be recorded (e.g. if
                 * `AppService` crashes after creating a new post but before updating this map, for
                 * instance).
                 *
                 * The order of accounts in `contributionCountByAccountId` does matter. The order
                 * of accounts is based on first contribution time. Accounts with an earlier first
                 * contribution time are earlier in the map.
                 *
                 * We stop increasing contribution counts at a maximum value as a way to reduce
                 * write cost against the database. Maybe the write cost savings are pointless and
                 * we shouldn't have a contribution count max. Also, we should really consider
                 * adding some exponential decay for the accounts in this list. So if an account
                 * hasn't contributed in a long time they'll fall out of the top contributors.
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
                         * The same as `channelItem.accessPolicy.accountGrant.keys()`. We copy the property
                         * here so we can include shared accounts in the contributor list even before
                         * they've created their first post.
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
                 * For each post with files we create a `PostFiles` item. These items are keyed by
                 * `postCreatedTime` so they're sorted by created date. We use this to show all
                 * files added to a channel.
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
                // NOTE(calebmer, 2024-04-16): My current thoughts on deleting posts. Deleting a
                // post shouldn't delete the post's comments since folks may be having a valuable
                // conversation in the comments. I like the idea that deleting a post:
                //
                // - Sets `channelId` to null
                // - Replaces content with a "this post was deleted message"
                //
                // Setting `channelId` to null would remove the post in realtime from the channel
                // the user is looking at. We should also have notification processing cleanup
                // inbox entries that say the post is a part of a given channel.
                //
                // These mechanisms would also be very useful for a "move post between channels"
                // feature which I think we'll want for channel user's with the "maintain" access
                // level. So I think we should build delete post alongside the ability to move
                // posts between channels.
                //
                // Either of these operations should probably be reflected in a "log" entry in the
                // comments feed. For instance "Caleb deleted the post" or "Caleb moved the post
                // from the Engineering Q&A channel to the Design Q&A channel".
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        createdTime: Schema.date,
                        createdTimeZone: TimeZoneSchema.default(defaultTimeZone),

                        /** What channel was this post created in? */
                        channelId: Schema.id<ChannelId>(),

                        /** Which account created this post? */
                        authorId: Schema.id<AccountId>(),

                        /** The contents of this post. */
                        content: PostContentSchema,

                        /**
                         * The last time at which the post's content was updated. Also contains `mappings`
                         * to help move positions referencing content in the post from an old version of
                         * the post to a new version of the post.
                         */
                        contentUpdate: Schema.object({
                            time: Schema.date,
                            mappings: Schema.array(ProsemirrorMappingSchema).default(emptyArray),
                        })
                            .wrapOriginalPropertyInObject("time", {mappings: []})
                            .originalPropertyKey("contentUpdatedTime")
                            .nullable()
                            .default(null),

                        /**
                         * Information regarding the post's comments. Nested in an object so we can update
                         * it at once.
                         *
                         * We don't send general realtime update events when `commentsSummary` changes.
                         * This is taken care of by
                         * `transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent()`. We do this to
                         * save a bunch of WCUs. Recording an event containing the full post content for
                         * every new comment would be wildly inefficient.
                         */
                        commentsSummary: Schema.object({
                            /**
                             * The index of the next comment.
                             */
                            nextCommentIndex: Schema.integer.min(0),

                            /**
                             * All the accounts which have commented on the post and the number of comments
                             * they have made. The map is ordered by when the account first commented on the
                             * post.
                             *
                             * This map can grow unbounded. When a user deletes a comment it leaves a
                             * gravestone so comment counts should never be decremented.
                             */
                            commentCountByAuthorId: Schema.map(
                                Schema.id<AccountId>(),
                                Schema.integer.min(1),
                            ),

                            /**
                             * All the accounts which have been mentioned at some point in the post's comments
                             * or post's content and how many times the account was mentioned.
                             *
                             * Accounts that exist in the map with a mention count of zero have a special
                             * meaning:
                             *
                             * - If an account exists in the map they were mentioned at some point
                             * - If an account exists in the map with a mention count of zero then they were
                             *   mentioned at some point but all mentions have been removed by updates
                             * - If an account does not exist in the map they were never mentioned in the post
                             *
                             * While this is in `commentsSummary` it also includes mentions from the post
                             * content. We put it in `commentsSummary` so we can update it atomically as a
                             * single attribute with other comment information.
                             */
                            mentionCountByAccountId: Schema.map(
                                Schema.id<AccountId>(),
                                Schema.integer.min(0),
                            ).default(new Map()),
                        }),

                        /**
                         * All reactions on the post.
                         */
                        reactions: ReactionSet.schema.default(emptyReactionSet),
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
                    // Top contributor accounts are sorted by:
                    //
                    // 1. Who has the highest contribution count up to `maxChannelTopContributorCount`
                    // 2. Earliest contribution time
                    function* iterateTopContributorAccountIds() {
                        const accountIdsByContributionCount = new DefaultMap<
                            number,
                            Array<AccountId>
                        >(() => []);

                        for (const [
                            accountId,
                            contributionCount,
                        ] of item.contributionCountByAccountId) {
                            accountIdsByContributionCount
                                .getOrSetDefault(contributionCount)
                                .push(accountId);
                        }

                        for (
                            let contributionCount = maxChannelContributionCount;
                            contributionCount >= 1;
                            contributionCount--
                        ) {
                            const accountIds = accountIdsByContributionCount.get(contributionCount);
                            if (accountIds !== undefined) yield* accountIds;
                        }

                        // Fill the top contributors array with accounts that have been explicitly granted
                        // access even if those accounts haven't posted in the channel yet. This is
                        // especially useful for private channels. Since you can see who's been added to
                        // the private channel.
                        for (const accountId of item.accountIdsWithGrant) {
                            if (item.contributionCountByAccountId.has(accountId)) continue;
                            yield accountId;
                        }
                    }

                    function* iterateBatchedTopContributorAccountIds() {
                        let nextBatch: Array<AccountId> = [];

                        for (const accountId of iterateTopContributorAccountIds()) {
                            nextBatch.push(accountId);

                            // If our max is 8, and we find 7 active, we ask for 2 more to give us some wiggle
                            // room in case some of them are inactive, and we don't need to do as many rounds
                            // of searching. This will also help if two in the first 10 are inactive, we can
                            // still find the 8 we need.
                            if (nextBatch.length >= maxChannelTopContributorCount + 2) {
                                yield nextBatch;
                                nextBatch = [];
                            }
                        }

                        if (nextBatch.length > 0) {
                            yield nextBatch;
                        }
                    }

                    const topContributors: Array<AccountModel> = [];

                    // Will load accounts in batches. If we have enough accounts to fill
                    // `topContributors`, great! Otherwise we'll load another batch. Batches sizes are
                    // `maxChannelTopContributorCount + 2` in case we have any removed accounts.
                    outer: for (const batchedAccountIds of iterateBatchedTopContributorAccountIds()) {
                        const newTopContributors = await runAllPromises(
                            mapIterable(batchedAccountIds, accountId =>
                                getAccountOrDangerouslyGetStubWithoutAuthorization(
                                    context,
                                    item.spaceId,
                                    accountId,
                                ),
                            ),
                        );

                        for (const topContributor of newTopContributors) {
                            // Ignore accounts removed from the space.
                            if (topContributor.initialData.space.state.type !== "Active") continue;

                            topContributors.push(topContributor);

                            if (topContributors.length >= maxChannelTopContributorCount) {
                                break outer;
                            }
                        }
                    }

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
    broadcastEvents: async (context, events) => {
        // Split up event transactions so we send everything in a `ChannelId` to that
        // channel and nothing else. We have to split for security: if two channels are
        // updated in the same transaction, a user connected to channel 1 shouldn't get
        // realtime events for channel 2 which they don't have access to.
        //
        // This means clients may see a glitch where an atomic update across two channels
        // is applied separately. This is fine as in practice we don't have any
        // cross-channel updates it's critical for users to see atomically.
        const eventsByChannelId = new Map<ChannelId, Array<RynamoEventStub>>();

        // We also send post updates to the corresponding post durable object. That way
        // single post views that have a WebSocket connection to `PostRealtimeService` will
        // see content updates in realtime without needing to make an additional connection
        // to `ChannelRealtimeService`.
        //
        // This has some tradeoffs. It's certainly more efficient for clients to only
        // subscribe to `PostRealtimeService` and avoid receiving updates from
        // `ChannelRealtimeService` they don't care about. However, this comes at the cost
        // of an extra Durable Object request which [Cloudflare charges for][1]. However,
        // by the client only subscribing to `PostRealtimeService` (and not
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
        const eventsByPostId = new Map<PostId, Array<RynamoEventStub>>();

        await runAllPromises(
            mapIterable(
                events,
                async ({
                    itemKey,
                    eventStub,
                    oldPartitionKeyByIndexName,
                    newPartitionKeyByIndexName,
                }) => {
                    if (itemKey.partitionType === "Channel") {
                        const isChannelCreationEvent =
                            itemKey.sortRangeType === "Attributes" && eventStub.item.version === 0;

                        // Optimization: Don't broadcast channel creation events to channel durable
                        // objects. No one will be subscribed to the channel durable object before the
                        // channel is created.
                        if (!isChannelCreationEvent) {
                            getOrSetDefaultMapValue(
                                eventsByChannelId,
                                itemKey.channelId,
                                () => [],
                            ).push(eventStub);
                        }
                    } else {
                        const isPostCreationEvent =
                            itemKey.partitionType === "Post" &&
                            itemKey.sortRangeType === "Attributes" &&
                            eventStub.item.version === 0;

                        // Optimization: Don't broadcast post creation events to post durable objects. No
                        // one will be subscribed to the post durable object before the post is created.
                        if (!isPostCreationEvent) {
                            getOrSetDefaultMapValue(eventsByPostId, itemKey.postId, () => []).push(
                                eventStub,
                            );
                        }

                        const {oldValue: oldChannelId, newValue: newChannelId} =
                            ChannelPostsIndex.getPartitionKeyAttributeFromEvent("channelId", {
                                oldPartitionKeyByIndexName,
                                newPartitionKeyByIndexName,
                            });

                        // Send post realtime updates to the channel realtime stream the post is a part of.
                        if (newChannelId !== undefined) {
                            getOrSetDefaultMapValue(eventsByChannelId, newChannelId, () => []).push(
                                eventStub,
                            );
                        }

                        if (oldChannelId !== undefined && oldChannelId !== newChannelId) {
                            // TODO(calebmer, 2025-07-23): If a post moves from one channel to another we'll
                            // need to send an event to the old channel. What do we send? A delete item event?
                            // The item technically still exists the client just doesn't have access anymore.
                            //
                            // Maybe a put item event is fine if the post's contents don't change at the same
                            // time as it moves channels (the client already had access to the post's old
                            // contents). Make that decision when we implement channel moving.
                        }
                    }
                },
            ),
        );

        await runAllPromises(
            concatIterables(
                mapIterable(eventsByChannelId, async ([channelId, events]) => {
                    await context.edge.broadcastToDurableObject(
                        `/api/durable-objects/channels/${channelId}/broadcast-realtime-event-transaction`,
                        {
                            serviceName: "ChannelRealtimeService",
                            route: "/api/durable-objects/channels/:channelId/broadcast-realtime-event-transaction",
                            body: ChannelBroadcastRealtimeEventsSchema.serialize({
                                events,
                            }),
                        },
                    );
                }),
                mapIterable(eventsByPostId, async ([postId, events]) => {
                    await context.edge.broadcastToDurableObject(
                        `/api/durable-objects/posts/${postId}/broadcast-realtime-event-transaction`,
                        {
                            serviceName: "PostRealtimeService",
                            route: "/api/durable-objects/posts/:postId/broadcast-realtime-event-transaction",
                            body: PostBroadcastRealtimeEventsSchema.serialize({
                                events,
                            }),
                        },
                    );
                }),
            ),
        );
    },
});

// Authorizers must be declared next to their respective Tables
const FilePostAuthorizer = FileAuthorizer.new(
    ForumRealtimeTable,
    "Post",
    async (context, target, expectedAccessLevel, options) => {
        switch (target.type) {
            case "Post":
                return mapResult(
                    await authorizePostAccessIfPossible(
                        context,
                        target.postId,
                        expectedAccessLevel,
                        options,
                    ),
                    () => {},
                );
            case "PostDraft":
                return await authorizePostDraftAccessIfPossible(
                    context,
                    target.spaceId,
                    target.accountId,
                    target.draftId,
                );
            case "PostComments":
                return mapResult(
                    await authorizePostAccessIfPossible(context, target.postId, "View", options),
                    () => {},
                );
            default:
                throw exhaustive(target);
        }
    },
);

export {FilePostAuthorizer as InternalFilePostAuthorizer};

// We use an index with join queries since it reduces write/storage costs (compared
// to `addExpensiveFullEventualConsistencyIndex()`) and the read performance
// sacrifice isn't that bad since most of the time posts will be viewed through
// home feed or inbox anyway (vs querying a channel).
export const ChannelPostsIndex = ForumRealtimeTable.addEventualConsistencyIndexWithQueryJoin({
    name: "ChannelPosts",
    itemTypes: [{partitionType: "Post", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
    },
    sortKeyAttributes: {
        createdTime: DynamoKeyAttributeSchema.date,
    },
});

async function createChannelModelFromItem(
    context: ServerActionContext,
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
    const [references, accessPolicy] = await runAllPromises([
        getContentReferencesAssumingViewAccessWithOptionalSpaceAccess(
            context,
            item.spaceId,
            "AssertHasNoFiles",
            item.description,
        ),
        intoAccessPolicyModel(context, item.accessPolicy),
    ]);
    return new ChannelModel({
        id: item.channelId,
        spaceId: item.spaceId,
        createdTime: item.createdTime,
        version: item.updateLockVersion ?? 0,
        name: item.name,
        description: {
            doc: item.description,
            references,
        },
        accessPolicy,
    });
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
        readonly contentUpdate: {
            readonly time: Date;
            readonly mappings: ReadonlyArray<Mapping>;
        } | null;
        readonly commentsSummary: {
            readonly commentCountByAuthorId: ReadonlyMap<AccountId, number>;
        };
        readonly reactions: ReactionSet;
        readonly updateLockVersion?: number;
    },
): Promise<PostModel> {
    const [channel, author, previewCommentAuthors, contentReferences] = await runAllPromises([
        channelPromise,
        getAccountOrDangerouslyGetStubWithoutAuthorization(context, item.spaceId, item.authorId),
        runAllPromises(
            Array.from(
                sliceIterable(
                    item.commentsSummary.commentCountByAuthorId.keys(),
                    0,
                    maxPostPreviewCommentAuthorCount,
                ),
                accountId =>
                    getAccountOrDangerouslyGetStubWithoutAuthorization(
                        context,
                        item.spaceId,
                        accountId,
                    ),
            ),
        ),
        getContentReferencesAssumingViewAccessWithOptionalSpaceAccess(
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
        contentUpdate: item.contentUpdate,
        commentCount: sumIterable(item.commentsSummary.commentCountByAuthorId.values()),
        commentAuthorCount: item.commentsSummary.commentCountByAuthorId.size,
        previewCommentAuthors,
        reactions: item.reactions,
    });
}

export type ChannelAttributesItem = RynamoTableItemType<
    typeof ForumRealtimeTable,
    "Channel",
    "Attributes"
>;

export type ChannelContributorsItem = RynamoTableItemType<
    typeof ForumRealtimeTable,
    "Channel",
    "Contributors"
>;

export type PostAttributesItem = RynamoTableItemType<
    typeof ForumRealtimeTable,
    "Post",
    "Attributes"
>;

export type ChannelPostFilesItem = RynamoTableItemType<
    typeof ForumRealtimeTable,
    "Channel",
    "PostFiles"
>;

// Uses TypeScript to make sure if a new channel sort range is added we consider
// whether `getChannelRealtimeEvent()` is allowed to return it or not.
export const allowedChannelSortRangeTypesForGetChannelRealtimeEvent: Record<
    (RynamoTableSchemaGetTypes<typeof ForumRealtimeTable>["ItemKey"] & {
        readonly partitionType: "Channel";
    })["sortRangeType"],
    boolean
> = {
    Attributes: true,
    Contributors: true,
    PostFiles: true,
};

// Uses TypeScript to make sure if a new post sort range is added we consider
// whether `getPostRealtimeEvent()` is allowed to return it or not.
export const allowedPostSortRangeTypesForGetPostRealtimeEvent: Record<
    (RynamoTableSchemaGetTypes<typeof ForumRealtimeTable>["ItemKey"] & {
        readonly partitionType: "Post";
    })["sortRangeType"],
    boolean
> = {
    Attributes: true,
};

export function serializeForumRealtimeTableOpaqueItemKeyForTest(
    itemKey: RynamoTableSchemaGetTypes<typeof ForumRealtimeTable>["ItemKey"],
) {
    assert(import.meta.jest);
    return ForumRealtimeTable.serializeOpaqueItemKey(itemKey);
}
