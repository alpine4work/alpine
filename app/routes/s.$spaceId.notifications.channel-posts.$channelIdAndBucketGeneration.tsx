import {ReactElement, useCallback, useEffect, useMemo} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {PostBasicList} from "~/client/web/forum/post_list.js";
import {PostListView} from "~/client/web/forum/post_list_view.js";
import {PostView} from "~/client/web/forum/post_view.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useWaitForState} from "~/client/web/helpers/use_wait_for_state.js";
import {
    archiveInboxChannelPostsEntryPostOptimistically,
    subscribeToArchiveInboxChannelPostsEntryPostOptimistically,
} from "~/client/web/inbox/archive_inbox_channel_posts_entry_post_optimistically.js";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {InboxContextNavigation} from "~/client/web/inbox/inbox_context_types.js";
import {shouldRenderPostAsArchivedInInboxChannelPostsEntry} from "~/client/web/inbox/should_render_post_as_archived_in_inbox_channel_posts_entry.js";
import {useInboxBannerOutletContainer} from "~/client/web/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {getChannel} from "~/server/forum/data/get_channel.js";
import {getInboxChannelPostsEntryPosts} from "~/server/notifications/data/get_inbox_channel_posts_entry_posts.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {printPrettySmallNumberSummary} from "~/shared/design/print_pretty_small_number_summary.js";
import {
    DynamoGeneralRealtimeItem,
    createDynamoGeneralRealtimeItemSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {isId} from "~/shared/id/id.js";
import {ChannelId, PostId} from "~/shared/id/types/id_types.js";
import {
    InboxChannelPostsEntryModel,
    InboxEntryModelSchema,
    InboxPostCommentsEntryModel,
} from "~/shared/notifications/inbox_model.js";
import {
    archiveInboxChannelPostsEntryPost,
    unarchiveInboxChannelPostsEntryPost,
} from "~/shared/rpc/notifications_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    ServerSynchronizationCheckpointSchema,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const LoaderSchema = Schema.object({
    checkpoint: ServerSynchronizationCheckpointSchema,
    channel: createDynamoGeneralRealtimeItemSchema(ChannelModel.schema()),
    bucketGeneration: Schema.integer,
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema),
    posts: Schema.array(createDynamoGeneralRealtimeItemSchema(PostModel.schema())),
    initialCommentsByPostId: Schema.map(
        Schema.id<PostId>(),
        Schema.object({
            comments: Schema.array(PostCommentModel.schema()),
            otherReferencedComments: Schema.array(PostCommentModel.schema()),
        }),
    ),
});

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? null);
    const channelIdAndBucketGeneration = assertExists(params.channelIdAndBucketGeneration);
    const [channelId, bucketGenerationString, ...otherParts] =
        channelIdAndBucketGeneration.split("-");

    if (otherParts.length !== 0)
        throw new InvalidArgumentError("Only expected two parts in the URL");

    if (!channelId || !isId<ChannelId>(channelId))
        throw new InvalidArgumentError("Expected `ChannelId`");

    const bucketGeneration =
        bucketGenerationString && /^\d+$/.test(bucketGenerationString)
            ? parseInt(bucketGenerationString, 10)
            : null;

    if (bucketGeneration === null || !Number.isInteger(bucketGeneration))
        throw new InvalidArgumentError("Expected bucket generation to be an integer");

    const clientInfo = context.loader.getClientInfo();

    // Generate checkpoint before we start loading data. So when we backfill we include
    // any realtime events that happened while loading data.
    const checkpoint = generateServerSynchronizationCheckpoint();

    const [channel, {inboxEntry, posts, initialCommentsByPostId}] = await runAllPromises([
        getChannel(context, channelId),
        getInboxChannelPostsEntryPosts(context, {
            spaceId,
            channelId,
            bucketGeneration,
            commentLimit: getInitialLoadMessageCount(clientInfo),
        }),
    ]);

    return jsonWithSchema(LoaderSchema, {
        checkpoint,
        channel,
        bucketGeneration,
        inboxEntry,
        posts,
        initialCommentsByPostId,
    });
}

export const meta = createMetaFunction(LoaderSchema, ({data: {channel, posts}}) => [
    {
        title: `${printPrettySmallNumberSummary(posts.length, "new post")} in ${
            channel.model.name
        }`,
    },
]);

export default function ChannelPostsRouteWrapper() {
    const {
        checkpoint: initialCheckpoint,
        channel,
        posts,
        initialCommentsByPostId,
        inboxEntry,
    } = useLoaderDataWithSchema(LoaderSchema);

    // While you're viewing new posts in a channel, this accrues affinity points to the
    // channel. Since you're taking time to pay attention to what's new in a channel.
    useSearchAffinityViewEntityInteraction(`Channel:${channel.model.id}`);

    const inboxContext = useInboxContext();

    let withoutArchiveButton = false;
    let node: ReactElement;

    if (posts.length === 1) {
        const post = posts[0]!;
        const postId = post.model.id;

        node = (
            <PostView
                // Remount when navigating to a different post.
                key={postId}
                initialCheckpoint={initialCheckpoint}
                initialPost={post}
                initialPostComments={initialCommentsByPostId.get(postId)?.comments ?? emptyArray}
                initialOtherReferencedPostComments={
                    initialCommentsByPostId.get(postId)?.otherReferencedComments ?? emptyArray
                }
                initialScroll={null}
            />
        );
    } else {
        const initialIsArchived = inboxEntry.model.isArchived;

        withoutArchiveButton = !initialIsArchived;

        node = (
            <ChannelPostsRoute
                // `useInboxBannerOutletContainer()` changes the inbox context so capture the
                // `navigation` object from our parent component and use that.
                parentNavigation={inboxContext?.navigation ?? null}
                initialIsArchived={initialIsArchived}
            />
        );
    }

    return useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: contentStyles.contentMaxWidth,
            withoutArchiveButton,
        },
        node,
    );
}

function ChannelPostsRoute({
    parentNavigation,
    initialIsArchived,
}: {
    parentNavigation: InboxContextNavigation | null;
    initialIsArchived: boolean;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const {space} = useSpaceContext();
    const reporter = useReporter();

    const inboxContext = assertExists(useInboxContext());
    const originalInboxEntry = assertExists(inboxContext.entry);

    assert(
        originalInboxEntry.model instanceof InboxChannelPostsEntryModel ||
            originalInboxEntry.model instanceof InboxPostCommentsEntryModel,
        "This route should only render an `InboxChannelPostsEntryModel` or `InboxPostCommentsEntryModel`",
    );

    const inboxEntry = originalInboxEntry as DynamoGeneralRealtimeItem<
        InboxChannelPostsEntryModel | InboxPostCommentsEntryModel
    >;

    const {
        channel: initialChannel,
        bucketGeneration,
        posts: initialPosts,
        initialCommentsByPostId,
    } = useLoaderDataWithSchema(LoaderSchema);

    // Shouldn't have loaded initial comments since all the posts should have collapsed
    // comments.
    assert(initialCommentsByPostId.size === 0);

    const channelId = initialChannel.model.id;

    // NOTE(calebmer): Posts aren't updated in realtime until the user opens the
    // comment section for a post. At which point we keep the post up-to-date in
    // realtime. This is the same realtime posture we have for our home feed.
    const [posts, setPosts, setPostsOptimistically] = useStateWithOptimisticUpdates(() =>
        PostBasicList.new({
            type: "Many",
            posts: initialPosts,
            hasMorePosts: false,
        }),
    );

    const [
        archivedPostIds,
        setArchivedPostIds,
        setArchivedPostIdsOptimistically,
        archivedPostIdsWithoutOptimisticUpdates,
    ] = useStateWithOptimisticUpdates<ReadonlySet<PostId>>(() => {
        const archivedPostIds = new Set<PostId>();

        for (const postId of posts.iteratePostIds()) {
            if (shouldRenderPostAsArchivedInInboxChannelPostsEntry(inboxEntry.model, postId)) {
                archivedPostIds.add(postId);
            }
        }

        return archivedPostIds;
    });

    const expectedArchivedPostIds = useMemo<ReadonlySet<PostId>>(() => {
        return new Set(
            filterIterable(posts.iteratePostIds(), postId =>
                shouldRenderPostAsArchivedInInboxChannelPostsEntry(inboxEntry.model, postId),
            ),
        );
    }, [inboxEntry.model, posts]);

    const waitForExpectedArchivedPostIds = useWaitForState(expectedArchivedPostIds);

    // Make sure `archivedPostIdsWithoutOptimisticUpdates` is always equal to
    // `expectedArchivedPostIds`.
    if (!isDeepEqual(expectedArchivedPostIds, archivedPostIdsWithoutOptimisticUpdates)) {
        setArchivedPostIds(() => expectedArchivedPostIds);
    }

    // On mobile, the comment button doesn't expand/collapse. Instead it opens the post
    // in a new route. `<PostListView>` will throw if you pass in `posts` with expanded
    // comments on mobile. So make sure to close them all.
    if (platform === "mobile" && posts.hasOpenPostComments()) {
        setPosts(posts => posts.closeAllPostComments());
    }

    const navigationBar = useNavigationBar({
        isDisabled: platform !== "mobile",
        title: printPrettySmallNumberSummary(posts.getPostCount(), "new post"),
        withoutDisappearingTitle: true,
        defaultPreviousRoute: `/s/${inboxEntry.model.spaceId}/inbox`,
    });

    useEffect(() => {
        return subscribeToArchiveInboxChannelPostsEntryPostOptimistically(event => {
            if (event.entryKey !== inboxEntry.key) return;

            // Wait for our inbox entry to update in realtime. The realtime update event may
            // happen after `promise` resolves.
            const waitPromise = waitForExpectedArchivedPostIds(archivedPostIds =>
                archivedPostIds.has(event.postId),
            );

            // NOTE(calebmer): We don't optimistically update `inboxEntry` itself because if
            // there's a new `latestPost` we don't know the new `contentTextSnippet` on the
            // client.
            setArchivedPostIdsOptimistically(
                event.promise.then(() => waitPromise).then(() => true),
                (archivedPostIds, promiseValue) => {
                    if (promiseValue) return archivedPostIds;
                    const newArchivedPostIds = new Set(archivedPostIds);
                    newArchivedPostIds.add(event.postId);
                    return newArchivedPostIds;
                },
            );
        });
    }, [inboxEntry.key, setArchivedPostIdsOptimistically, waitForExpectedArchivedPostIds]);

    const {handleArchivePost, handleUnarchivePost} = useEvents({
        handleArchivePost: async (postId: PostId) => {
            const promise = archiveInboxChannelPostsEntryPost(context, {
                spaceId: space.id,
                channelId,
                bucketGeneration,
                postId,
            });

            promise.catch(error => {
                reporter.displayError("Couldn\u2019t mark post as done", error);
            });

            archiveInboxChannelPostsEntryPostOptimistically({
                promise,
                entryKey: inboxEntry.key,
                postId,
            });

            // If we're viewing new entries and by archiving this `postId` we've archived all
            // posts in the entry then navigate to the next entry.
            if (
                parentNavigation?.filter === "New" &&
                (inboxEntry.model instanceof InboxPostCommentsEntryModel
                    ? inboxEntry.model.postId === postId
                    : inboxEntry.model.postIds.size === 1 && inboxEntry.model.postIds.has(postId))
            ) {
                if (parentNavigation.nextEntry) {
                    await parentNavigation.selectEntry(parentNavigation.nextEntry);
                } else if (parentNavigation.previousEntry) {
                    await parentNavigation.selectEntry(parentNavigation.previousEntry);
                } else {
                    await parentNavigation.selectEntry(null);
                }
            }
        },
        handleUnarchivePost: async (postId: PostId) => {
            const promise = unarchiveInboxChannelPostsEntryPost(context, {
                spaceId: space.id,
                channelId,
                bucketGeneration,
                postId,
            });

            promise.catch(error => {
                reporter.displayError("Couldn\u2019t move notification to new", error);
            });

            // Wait for our inbox entry to update in realtime. The realtime update event may
            // happen after `promise` resolves.
            const waitPromise = waitForExpectedArchivedPostIds(
                archivedPostIds => !archivedPostIds.has(postId),
            );

            // NOTE(calebmer): We don't optimistically update `inboxEntry` itself because if
            // there's a new `latestPost` we don't know the new `contentTextSnippet` on the
            // client.
            setArchivedPostIdsOptimistically(
                promise.then(() => waitPromise).then(() => true),
                (archivedPostIds, promiseValue) => {
                    if (promiseValue) return archivedPostIds;
                    const newArchivedPostIds = new Set(archivedPostIds);
                    newArchivedPostIds.delete(postId);
                    return newArchivedPostIds;
                },
            );
        },
    });

    return (
        <PostListView
            header={useMemo(
                () => (platform === "mobile" ? {type: "NavigationBar"} : undefined),
                [platform],
            )}
            posts={posts}
            onTogglePostComments={useCallback(
                postId => setPosts(posts => posts.togglePostComments(postId)),
                [setPosts],
            )}
            onUpdatePostComments={useCallback(
                (postId, update) => setPosts(posts => posts.updatePostComments(postId, update)),
                [setPosts],
            )}
            onUpdatePostCommentsOptimistically={useCallback(
                (postId, promise, update) =>
                    setPostsOptimistically(promise, (posts, promiseValue) =>
                        posts.updatePostComments(postId, comments =>
                            update(comments, promiseValue),
                        ),
                    ),
                [setPostsOptimistically],
            )}
            shouldBeConnectedToChannelRealtime={true}
            onPostRealtimeEventTransaction={useCallback(
                eventTransaction => {
                    setPosts(posts => posts.handleEventTransaction(eventTransaction));
                },
                [setPosts],
            )}
            onOptimisticPostRealtimeEventTransaction={useCallback(
                (promise, postId, update) => {
                    setPostsOptimistically(promise, (posts, promiseValue) => {
                        // Once `promise` resolves, use the event transaction from `promise` to update the
                        // posts instead of our optimistic updater.
                        if (promiseValue) {
                            return posts.handleEventTransaction(promiseValue);
                        }

                        const oldPostItem = posts.getPostRealtimeItemIfExists(postId);
                        if (!oldPostItem) return posts;
                        const newPost = update(oldPostItem.model);

                        const newPostItem = {
                            ...oldPostItem,
                            // Always pretend like our optimistic update is one version higher than what's
                            // currently in state. Once `promise` resolves then we'll update the item with the
                            // real version.
                            version: oldPostItem.version + 1,
                            model: newPost,
                        };

                        return posts.handleEventTransaction([
                            {type: "PutItem", item: newPostItem, indexes: new Map()},
                        ]);
                    });
                },
                [setPostsOptimistically],
            )}
            navigationBar={navigationBar}
            // Safe area inset is already accounted for on mobile thanks to the
            // `navigationBar`.
            withSafeAreaInsetTop={platform !== "mobile"}
            isPostArchived={useMemo(() => {
                // If this route was initially archived, we only let you "unarchive" the entry as a
                // whole. You can't unarchive individual posts.
                if (initialIsArchived) return;

                return (postId: PostId) => archivedPostIds.has(postId);
            }, [archivedPostIds, initialIsArchived])}
            onArchivePost={handleArchivePost}
            onUnarchivePost={handleUnarchivePost}
        />
    );
}
