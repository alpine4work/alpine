import classNames from "classnames";
import {SpinnerGap} from "phosphor-react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {InputWithAutoGrowingWidth} from "~/client/design/input_with_auto_growing_width.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {NavigationBarRef, useNavigationBar} from "~/client/design/navigation_bar.js";
import {useShowToast} from "~/client/design/toast.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {useDynamoGeneralRealtimeIndexQueryBase} from "~/client/dynamo/use_dynamo_general_realtime_index_query.js";
import {useDynamoGeneralRealtimeItem} from "~/client/dynamo/use_dynamo_general_realtime_item.js";
import {ChannelViewAside} from "~/client/forum/channel_view_aside.js";
import {createPostEventEmitter} from "~/client/forum/new_post_view.js";
import {postContentViewMinHeight} from "~/client/forum/post_content_view.js";
import {
    PostQueryList,
    PostQueryListDynamoGeneralRealtimeIndexQuery,
} from "~/client/forum/post_list.js";
import {
    PostListView,
    postListViewAsideMaxWidth,
    postViewMaxWidth,
} from "~/client/forum/post_list_view.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {getInitialVirtualizedScrollViewRenderedItemCount} from "~/client/virtualized/virtualized_scroll_view.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {ChannelRealtimeProtocol} from "~/shared/forum/channel_realtime_protocol.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    backfillChannelPosts,
    getChannelPosts,
    getChannelWithStrongReadConsistency,
    updateChannelDescription,
    updateChannelName,
} from "~/shared/rpc/forum_rpc_definitions.js";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/shared/styles/styles.js";

export function ChannelView({
    withMobileLayout,
    initialChannel,
    initialPostsResult,
}: {
    withMobileLayout: boolean;
    initialChannel: DynamoGeneralRealtimeItem<ChannelModel>;
    initialPostsResult: DynamoGeneralRealtimeIndexQueryResult<PostModel>;
}) {
    const context = useAppContext();
    const isMobile = useIsMobile();

    const channelId = initialChannel.model.id;

    const {isConnected, subscribeToEvents, toggleShouldConnect} = useWebSocket(
        ChannelRealtimeProtocol,
        `/api/durable-objects/channels/${channelId}`,
    );

    const {
        item: {model: channel},
        handleEventTransaction: handleEventTransactionForChannel,
    } = useDynamoGeneralRealtimeItem(initialChannel, {
        isConnected,
        subscribeToEvents: useCallback(
            subscriber => subscribeToEvents(event => subscriber(event.eventTransaction)),
            [subscribeToEvents],
        ),
        reloadItemWithStrongReadConsistency: useCallback(async () => {
            const {channel} = await getChannelWithStrongReadConsistency(context, {channelId});
            return channel;
        }, [channelId, context]),
    });

    const [posts, setPosts] = useState(() => PostQueryList.new(initialPostsResult));

    useDevConsoleTool("channel", () => ({
        posts,
        toggleShouldConnect,
    }));

    useDynamoGeneralRealtimeIndexQueryBase(
        {
            query: posts.query,
            onUpdateQuery: useCallback(
                (
                    update: (
                        query: PostQueryListDynamoGeneralRealtimeIndexQuery,
                    ) => PostQueryListDynamoGeneralRealtimeIndexQuery,
                ) => setPosts(posts => posts.updateQuery(update(posts.query))),
                [],
            ),
        },
        {
            isConnected,
            subscribeToEvents,
            backfillQuery: useCallback(
                async ({readTime}) => {
                    const {backfillPostsResult} = await backfillChannelPosts(context, {
                        channelId,
                        readTime,
                    });
                    return backfillPostsResult;
                },
                [channelId, context],
            ),
            reloadQuery: useCallback(async () => {
                const {postsResult} = await getChannelPosts(context, {
                    channelId,
                    limit: getInitialVirtualizedScrollViewRenderedItemCount(
                        getClientInfoWithoutListening(),
                        postContentViewMinHeight,
                    ),
                    beforeCursor: null,
                });
                return postsResult;
            }, [channelId, context]),
        },
    );

    // When a post is created, we should get it from our channel WebSocket
    // connection. But in case our WebSocket connection is slow, `<NewPostView>`
    // emits an event after a post has been successfully created and we handle
    // that event here.
    useEffect(() => {
        return createPostEventEmitter.subscribe(event =>
            setPosts(posts =>
                posts.updateQuery(
                    posts.query.handleEventTransaction(event.readTime, event.eventTransaction),
                ),
            ),
        );
    }, []);

    const [isEditingName, setIsEditingName] = useState(false);
    if (isEditingName && isMobile) setIsEditingName(false);

    const [isEditingDescription, setIsEditingDescription] = useState(false);
    if (isEditingDescription && isMobile) setIsEditingDescription(false);

    const hasAside = !isContentEmpty(channel.description.doc) || isEditingDescription;

    const navigationBarRef = useRef<NavigationBarRef>(null);

    const navigationBar = useNavigationBar({
        ref: navigationBarRef,
        withMobileLayout,
        withoutDisappearingTitle: true,
        title: isEditingName ? (
            <ChannelViewNameEditor
                initialName={channel.name}
                onCancel={() => setIsEditingName(false)}
                onSave={async name => {
                    const event = await updateChannelName(context, {
                        channelId,
                        name,
                    });

                    setIsEditingName(false);

                    // Immediately apply a realtime event transaction to update our channel in case
                    // our realtime WebSocket connection is slow.
                    handleEventTransactionForChannel(event.eventTransaction);
                }}
            />
        ) : (
            <Box
                display="inline"
                onDoubleClick={event => {
                    // Disable selection from double click.
                    event.preventDefault();

                    setIsEditingName(true);
                }}
            >
                {channel.name}
            </Box>
        ),
        // Create a bit of space to the left so we don't cut off the channel name
        // editor border.
        desktopTitleLeftSlop: "1",
        desktopTitleMaxWidth: hasAside
            ? addRemLengths(spacing[postViewMaxWidth], spacing[postListViewAsideMaxWidth])
            : postViewMaxWidth,
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
        menuActions: [
            [
                {
                    label: "Copy link",
                    pressErrorTitle: "Couldn’t copy channel link",
                    onPress: async () => {
                        const url = new URL(
                            `/s/${channel.spaceId}/channels/${channel.id}`,
                            window.location.href,
                        );
                        await writeTextToClipboard(url.toString());
                    },
                },
            ],
            [
                {
                    label: "Edit name",
                    onPress: () => setIsEditingName(true),
                },
                {
                    label: "Edit description",
                    onPress: () => setIsEditingDescription(true),
                },
            ],
        ],
    });

    return (
        <PostListView
            withMobileLayout={withMobileLayout}
            channelHeader={useMemo(() => ({channel}), [channel])}
            posts={posts}
            onTogglePostComments={useCallback(
                postId => setPosts(posts => posts.togglePostComments(postId)),
                [],
            )}
            onUpdatePostComments={useCallback(
                (postId, update) => setPosts(posts => posts.updatePostComments(postId, update)),
                [],
            )}
            onLoadMorePosts={async ({limit}) => {
                const {postsResult} = await getChannelPosts(context, {
                    channelId: channel.id,
                    limit,
                    beforeCursor: posts.query.getPreviousPageCursorIfExists(),
                });

                setPosts(posts => posts.updateQuery(posts.query.loadMore(postsResult)));
            }}
            onPostRealtimeEventTransaction={event => {
                setPosts(posts =>
                    posts.updateQuery(
                        posts.query.handleEventTransaction(event.readTime, event.eventTransaction),
                    ),
                );
            }}
            aside={
                hasAside && (
                    <ChannelViewAside
                        channel={channel}
                        isEditingDescription={isEditingDescription}
                        onCancelEditingDescription={() => setIsEditingDescription(false)}
                        onSaveDescription={async description => {
                            const event = await updateChannelDescription(context, {
                                channelId,
                                description,
                            });

                            setIsEditingDescription(false);

                            // Immediately apply a realtime event transaction to update our channel in case
                            // our realtime WebSocket connection is slow.
                            handleEventTransactionForChannel(event.eventTransaction);
                        }}
                    />
                )
            }
            navigationBar={{...navigationBar, navigationBarRef}}
        />
    );
}

function ChannelViewNameEditor({
    initialName,
    onCancel,
    onSave,
}: {
    initialName: string;
    onCancel: () => void;
    onSave: (name: string) => Promise<void>;
}) {
    const showToast = useShowToast();

    const inputRef = useRef<HTMLInputElement>(null);
    const [name, setName] = useState(initialName);
    const [isSaving, setIsSaving] = useState(false);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const shouldShowSavingIndicator = useDelayLoadingIndicator(isSaving);

    const shouldFocusNextRenderRef = useRef(true);

    useLayoutEffectWithoutServerSideWarning(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmSaveDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        const inputElement = assertExists(inputRef.current);
        inputElement.select();
        inputElement.focus({preventScroll: true});
    }, [shouldShowConfirmSaveDialog]);

    return (
        <>
            <Box marginLeft="-1">
                <Box display="flex" alignItems="center" gap="2" maxWidth="full" height="9">
                    <FocusRing offset="border" isVisibleFromAnyFocus={true}>
                        <InputWithAutoGrowingWidth
                            ref={useMergedRefs(
                                inputRef,
                                useConfirmSaveAfterLosingFocus({
                                    shouldConfirmSave:
                                        // If the initial name is empty, we are creating an optimistic collection and
                                        // you must provide a name.
                                        initialName.length === 0 ||
                                        // Otherwise if you delete all of the collection name it will revert back to
                                        // the initial name.
                                        (name.length > 0 && name !== initialName),
                                    isConfirmingSave: shouldShowConfirmSaveDialog,
                                    onCancelSave: () => void onCancel(),
                                    onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                                }),
                            )}
                            placeholder={initialName.length > 0 ? initialName : "Channel"}
                            autoComplete="false"
                            value={name}
                            onChange={event => {
                                if (isSaving) return;
                                setName(event.currentTarget.value);
                            }}
                            className={sprinkles({
                                paddingY: "1",
                                borderRadius: "base",
                            })}
                            style={{
                                boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                            }}
                            textClassName={sprinkles({
                                fontSize: "400",
                                fontStyle: "bold",
                                paddingX: "1",
                            })}
                            onKeyDown={event => {
                                switch (event.key) {
                                    case "Enter": {
                                        event.preventDefault();
                                        event.stopPropagation();

                                        if (isSaving) break;

                                        runPromiseWithoutAwaiting(async () => {
                                            setIsSaving(true);
                                            try {
                                                // TODO(calebmer, #global-loading-indicator): Show a saving indicator until
                                                // save has finished.
                                                await onSave(name);
                                            } catch (error) {
                                                showToast({
                                                    type: "Error",
                                                    title: "Couldn’t save name",
                                                    error,
                                                });
                                            } finally {
                                                setIsSaving(false);
                                            }
                                        });
                                        break;
                                    }
                                    case "Escape": {
                                        event.preventDefault();
                                        event.stopPropagation();

                                        if (isSaving) break;

                                        onCancel();
                                        break;
                                    }
                                }
                            }}
                        />
                    </FocusRing>
                    {shouldShowSavingIndicator && (
                        <SpinnerGap
                            className={classNames(
                                spinAnimationClassName,
                                sprinkles({flexShrink: "0"}),
                            )}
                            color={colorSchemeVars["grey-70"]}
                            size={spacing["4"]}
                        />
                    )}
                </Box>
            </Box>
            {shouldShowConfirmSaveDialog && (
                <ModalDialog
                    title="Save channel name"
                    description="Would you like to save your new channel name?"
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                        // and lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmSaveDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle="Couldn’t save name"
                    onPrimaryButtonPress={() => onSave(name)}
                    cancelButtonLabel="Discard name"
                    cancelButtonPressErrorTitle="Couldn’t discard name"
                    onCancelButtonPress={onCancel}
                />
            )}
        </>
    );
}
