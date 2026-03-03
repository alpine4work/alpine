import classNames from "classnames";
import {ChatCircleDots, Check, DotsThree} from "phosphor-react";
import {NodeSelection} from "prosemirror-state";
import {Memo, useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatarPile} from "~/client/web/accounts/account_avatar_pile.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {ContentView} from "~/client/web/content/content_view.js";
import {ContentViewWithSeeMoreToggleBase} from "~/client/web/content/content_view_with_see_more_toggle.js";
import {useFileRegistry} from "~/client/web/content/file_registry_context.js";
import {getContentReferencesForClientPrintSingleLineTextSnippet} from "~/client/web/content/print_content_single_line_text_snippet_for_client.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {PrettyNumber} from "~/client/web/design/pretty_number.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {getPostMoreActions} from "~/client/web/forum/get_post_more_actions.js";
import {PostContentViewHeader} from "~/client/web/forum/internal/post_content_view_header.js";
import {PostEditing} from "~/client/web/forum/internal/post_editing.js";
import {PostCommentsState} from "~/client/web/forum/post_list.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {ChatCircleWithCaretUpIcon} from "~/client/web/icons/chat_circle_with_caret_up_icon.js";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {InlineEditorToolbar} from "~/client/web/messaging/inline_editor_toolbar.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {JumpToPostRangeState} from "~/client/web/messaging/use_jump_to_post_range.js";
import {ReactionButton} from "~/client/web/reactions/reaction_button.js";
import {ReactionParty} from "~/client/web/reactions/reaction_party.js";
import {getClientInfo, useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    postContentViewFooterButtonHeight,
    postContentViewFooterButtonIconSize,
    postContentViewFooterHeight,
    postContentViewFooterReactionButtonAreaWidth,
    postContentViewInnerMarginY,
    postContentViewMinHeightPx,
    postContentViewOuterMarginBottom,
    postContentViewOuterMarginY,
    postViewContentPaddingTop,
    postViewMinHeightPx,
    screenPaddingXWithoutPostContentViewInnerMarginY,
} from "~/client/web/styles/forum_shared_styles.js";
import {
    colorSchemeVars,
    contentStyles,
    messagingStyles,
    navigationBarStyles,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {
    addRemLengths,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {createPostSearchEntityTitle} from "~/shared/forum/create_post_search_entity_title.js";
import {PostContentWithReferences, assertPostContent} from "~/shared/forum/post_content_schema.js";
import {
    PostCommentModel,
    PostModel,
    maxPostPreviewCommentAuthorCount,
} from "~/shared/forum/post_model.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId, FileId, PostId} from "~/shared/id/types/id_types.js";
import {mapMessagePosFromContentVersion} from "~/shared/messaging/map_message_pos_from_content_version.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";
import {
    deletePostReaction,
    getPostCommentAuthors,
    setPostReaction,
} from "~/shared/rpc/forum_rpc_definitions.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";

export type PostContentViewInitialScroll = {
    readonly type: "File";
    readonly fileId: FileId;
};

export function PostContentView({
    post,
    postComments,
    postCommentsState,
    postEditing,
    shouldShowChannel,
    isPostView,
    isReadOnly,
    initialScroll,
    jumpState,
    idBase,
    onTogglePostComments,
    onLoadInitialPostComments,
    onScrollToIfNotVisible,
    isShowingAllContent,
    onIsShowingAllContentChange,
    onOptimisticPostRealtimeEventTransaction,
    isPostArchived,
    onArchivePost,
    onUnarchivePost,
}: {
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
    postCommentsState: PostCommentsState;
    postEditing: PostEditing;
    shouldShowChannel: boolean;
    isPostView: boolean;
    isReadOnly: boolean;
    initialScroll: PostContentViewInitialScroll | null;
    jumpState: JumpToPostRangeState | null;
    idBase: string;
    onTogglePostComments: () => void;
    onLoadInitialPostComments: () => Promise<void>;
    onScrollToIfNotVisible: () => void;
    isShowingAllContent: boolean;
    onIsShowingAllContentChange: (isShowingAllContent: boolean) => void;
    onOptimisticPostRealtimeEventTransaction: (
        promise: Promise<ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>>,
        postId: PostId,
        update: (post: PostModel) => PostModel,
    ) => void;
    isPostArchived?: Memo<(postId: PostId) => boolean>;
    onArchivePost?: Memo<(postId: PostId) => MaybePromise<void>>;
    onUnarchivePost?: Memo<(postId: PostId) => MaybePromise<void>>;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const {currentAccount} = useSpaceContext();
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();

    // Update `SearchEntityRegistry` with the post content. Now as the post content
    // changes in realtime, any `SearchEntityModel`s rendered elsewhere in the product
    // will also update.
    {
        const searchEntity = useStore(
            useMemo(() => {
                return computeStore(get => {
                    return new SearchEntityModel({
                        id: `Post:${post.id}`,
                        title: createPostSearchEntityTitle(
                            post.channel.name,
                            post.content.doc,
                            getContentReferencesForClientPrintSingleLineTextSnippet(
                                get,
                                post.content.references,
                                {accountRegistry, searchEntityRegistry, fileRegistry},
                            ),
                        ),
                        titleVersion: {
                            type: "Integers",
                            versions: [post.version, post.channel.version],
                        },
                        media: {type: "Account", account: post.author},
                    });
                });
            }, [
                accountRegistry,
                fileRegistry,
                post.author,
                post.channel.name,
                post.channel.version,
                post.content.doc,
                post.content.references,
                post.id,
                post.version,
                searchEntityRegistry,
            ]),
        );

        useMemo(
            () => searchEntityRegistry.getEntityStore(searchEntity),
            [searchEntity, searchEntityRegistry],
        );
    }

    const contentContainerRef = useRef<HTMLDivElement>(null);

    const postEditingForThisPost =
        // On mobile we use a modal for the editing UI instead of inline editing.
        platform !== "mobile" && postEditing.state.isEditing && postEditing.state.postId === post.id
            ? (postEditing as PostEditing & {state: {isEditing: true}})
            : null;

    const isEditingPost = !!postEditingForThisPost;

    const postSnippet = useMemo(() => {
        if (isPostView) {
            return null;
        } else {
            return {
                doc: assertPostContent(
                    getContentSnippet(
                        post.content.doc.resolve(0),
                        {linesAbove: 0, linesBelow: routeLayout === "narrow" ? 5 : 16},
                        {
                            // 1.125x the number of "x"s we can fit in a single line in a peek (64). We want to
                            // be slightly more aggressive than the default grapheme count (which counts the
                            // "l" character which is narrower) since we render the entire snippet.
                            maxLineGraphemeCount: platform === "mobile" ? 42 : 72,
                        },
                    ),
                ),
                references: post.content.references,
            };
        }
    }, [isPostView, platform, post.content.doc, post.content.references, routeLayout]);

    const fileAttachmentTarget = useMemo(
        (): FileAttachmentTarget => ({type: "Post", postId: post.id}),
        [post.id],
    );

    const hasInitializedRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;

        const contentContainerElement = assertExists(contentContainerRef.current);

        if (!initialScroll) return;

        let fileNodePos: number | null = null;

        post.content.doc.descendants((node, pos) => {
            if (fileNodePos !== null) return false;
            if (node.type.name !== "file") return;
            if (node.attrs.fileId !== initialScroll.fileId) return;

            fileNodePos = pos;
        });

        // We need to run after a microtask since our `<VirtualizedScrollView>` parent will
        // set scroll top to its initial value (0) in a `useLayoutEffect()`. So we need to
        // apply our scroll after that.
        scheduleMicrotask(() => {
            const fileElement = contentContainerElement.querySelector(
                // eslint-disable-next-line cyberworlds/string-quotes
                `[data-pos="${fileNodePos}"]`,
            );
            if (!fileElement) return;

            let scrollElement = contentContainerElement.parentElement;
            while (scrollElement) {
                const {overflowY} = getComputedStyle(scrollElement);

                const isScrollable = overflowY === "scroll" || overflowY === "auto";
                if (isScrollable) break;

                scrollElement = scrollElement.parentElement;
            }

            if (!scrollElement) return;

            const scrollRect = scrollElement.getBoundingClientRect();
            const fileRect = fileElement.getBoundingClientRect();

            // Scroll the top of the file 20% from the top of the scroll element.
            scrollElement.scrollTop =
                fileRect.top - (scrollRect.top - scrollElement.scrollTop) - scrollRect.height / 5;
        });
    }, [initialScroll, post.content.doc]);

    // Schedule the jump animation to run once `<MessageView>` mounts.
    useEffect(() => {
        if (!jumpState) return;
        jumpState.scheduleAnimation();
    }, [jumpState]);

    // If we're highlighting this message then get the correct `from` and `to`
    // positions based on the versioning information we have for the highlight.
    const jumpAnimation = useMemo(() => {
        if (!jumpState?.animation) return null;

        const from = mapMessagePosFromContentVersion(
            post,
            jumpState.options.contentVersion,
            jumpState.options.startPos,
            1,
        );
        const to = mapMessagePosFromContentVersion(
            post,
            jumpState.options.contentVersion,
            jumpState.options.endPos,
            -1,
        );

        return {from, to, startTime: jumpState.animation.startTime};
    }, [jumpState, post]);

    const editorHeightSpacerRef = useRef<HTMLDivElement>(null);

    // When we switch from not editing to editing, measure the current height of the
    // content container element. This runs before React makes any changes to the DOM.
    // So we'll get the content container height before it switches to the editor
    // component.
    //
    // I feel ok reading mutable state in a `useState()` initializer function (vs
    // `useMemo()` or directly in the React render function).
    const oldContentContainerHeightForEditorHeightDifference =
        useStateWithDependenciesWithoutDispatch(
            ([withHeight]) =>
                withHeight ? (contentContainerRef.current?.offsetHeight ?? 0) : null,
            [isEditingPost],
        );

    // When we switch from not editing to editing, after the editor has rendered
    // measure the new height and take the difference of the height pre-editor render
    // and post-editor render. We'll render the difference in some empty space below
    // the post so layout doesn't shift.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (oldContentContainerHeightForEditorHeightDifference === null) return;

        const contentContainerElement = assertExists(contentContainerRef.current);
        const editorHeightSpacerElement = assertExists(editorHeightSpacerRef.current);

        // Don't change the spacer height once it's been set the first time.
        if (editorHeightSpacerElement.hasAttribute("style")) return;

        const oldContentContainerHeight = oldContentContainerHeightForEditorHeightDifference;
        const newContentContainerHeight = contentContainerElement.offsetHeight;

        const editorHeightDifference = Math.max(
            0,
            oldContentContainerHeight - newContentContainerHeight,
        );

        // Directly set the `style` attribute in this effect so we don't need a React
        // re-render.
        editorHeightSpacerElement.setAttribute("style", `height: ${editorHeightDifference}px`);
    }, [oldContentContainerHeightForEditorHeightDifference]);

    return (
        <Box
            data-testid={
                process.env.NODE_ENV !== "production" ? `PostContentView:${post.id}` : undefined
            }
            position="relative"
            paddingTop={!isPostView ? postContentViewOuterMarginY : undefined}
            style={{
                minHeight: isPostView
                    ? postViewMinHeightPx[spacingScale]
                    : postContentViewMinHeightPx[spacingScale],
                paddingBottom: postContentViewOuterMarginBottom,
            }}
        >
            {isPostView ? (
                <Box paddingTop="safe-area-inset">
                    <Box height={navigationBarStyles.navigationBarHeight} />
                </Box>
            ) : (
                <>
                    <Box position="relative" paddingX={screenPaddingX}>
                        <PostContentViewHeader
                            post={post}
                            shouldShowChannel={shouldShowChannel}
                            // Don't let the route open in `<PeekStack>` if this is a `<PostView>`.
                            stopNavigateToChannelPropagation={isPostView}
                        />
                    </Box>
                    <Box
                        display="flex"
                        position="absolute"
                        top={screenPaddingX}
                        right={screenPaddingX}
                        gap="2"
                    >
                        <MenuButton
                            placement="bottom-end"
                            actions={getPostMoreActions({
                                currentAccount,
                                post,
                                onStartEditingPost: () => {
                                    postEditing.dispatch({
                                        type: "StartEditing",
                                        postId: post.id,
                                        contentVersion: post.contentUpdate?.mappings.length ?? 0,
                                        content: post.content,
                                        platform,
                                    });
                                },
                            })}
                        >
                            <IconButton
                                size={platform === "mobile" ? "base" : "md"}
                                description="More"
                                withoutTooltip={true}
                            >
                                <DotsThree />
                            </IconButton>
                        </MenuButton>
                        {isPostArchived && (
                            <Button
                                variant={isPostArchived(post.id) ? "neutral-disabled" : "neutral"}
                                height="6"
                                paddingX="2"
                                icon={<Check />}
                                pressErrorTitle="Can&#x2019;t mark as done"
                                onPress={async () => {
                                    if (isPostArchived(post.id)) {
                                        await onUnarchivePost?.(post.id);
                                    } else {
                                        await onArchivePost?.(post.id);
                                    }
                                }}
                            >
                                Done
                            </Button>
                        )}
                    </Box>
                </>
            )}
            <Box
                ref={contentContainerRef}
                style={{
                    // Margin since on mobile these values will be negative.
                    marginLeft: screenPaddingXWithoutPostContentViewInnerMarginY[platform],
                    marginRight: screenPaddingXWithoutPostContentViewInnerMarginY[platform],
                }}
            >
                {!isEditingPost ? (
                    !postSnippet ? (
                        <ContentView
                            content={post.content}
                            contentUpdatedTime={post.contentUpdate?.time ?? null}
                            fileAttachmentTarget={fileAttachmentTarget}
                            className={classNames(
                                messagingStyles.withPointerToolbarClassName,
                                sprinkles({padding: postContentViewInnerMarginY}),
                            )}
                            style={{paddingTop: isPostView ? postViewContentPaddingTop : undefined}}
                            // `data-index` of -1 tells `<MessagingViewPointerToolbar>` that we're referencing
                            // a post and not a post comment.
                            data-room={post.id}
                            data-index={-1}
                            jumpAnimation={jumpAnimation}
                        />
                    ) : (
                        <ContentViewWithSeeMoreToggleBase
                            contentUpdatedTime={post.contentUpdate?.time ?? null}
                            fileAttachmentTarget={fileAttachmentTarget}
                            className={classNames(
                                messagingStyles.withPointerToolbarClassName,
                                sprinkles({padding: postContentViewInnerMarginY}),
                            )}
                            style={{paddingTop: isPostView ? postViewContentPaddingTop : undefined}}
                            content={post.content}
                            contentSnippet={postSnippet}
                            isShowingAllContent={isShowingAllContent}
                            onIsShowingAllContentChange={onIsShowingAllContentChange}
                            // `data-index` of -1 tells `<MessagingViewPointerToolbar>` that we're referencing
                            // a post and not a post comment.
                            data-room={post.id}
                            data-index={-1}
                            jumpAnimation={jumpAnimation}
                        />
                    )
                ) : (
                    <>
                        <PostContentViewEditor
                            idBase={idBase}
                            isPostView={isPostView}
                            postEditingForThisPost={postEditingForThisPost}
                            fileAttachmentTarget={fileAttachmentTarget}
                            onScrollToIfNotVisible={onScrollToIfNotVisible}
                        />
                        <div ref={editorHeightSpacerRef} />
                    </>
                )}
            </Box>
            <PostContentViewFooter
                post={post}
                postComments={postComments}
                postCommentsState={postCommentsState}
                isReadOnly={isReadOnly}
                onTogglePostComments={onTogglePostComments}
                onLoadInitialPostComments={onLoadInitialPostComments}
                onOptimisticPostRealtimeEventTransaction={onOptimisticPostRealtimeEventTransaction}
            />
        </Box>
    );
}

function PostContentViewFooter({
    post,
    postComments,
    postCommentsState,
    isReadOnly,
    onTogglePostComments,
    onLoadInitialPostComments,
    onOptimisticPostRealtimeEventTransaction,
}: {
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
    postCommentsState: PostCommentsState;
    isReadOnly: boolean;
    onTogglePostComments: () => void;
    onLoadInitialPostComments: () => Promise<void>;
    onOptimisticPostRealtimeEventTransaction: (
        promise: Promise<ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>>,
        postId: PostId,
        update: (post: PostModel) => PostModel,
    ) => void;
}) {
    const context = useAppContext();
    const {locale} = useClientInfo();
    const platform = usePlatform();
    const {space, currentAccount} = useSpaceContext();
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const reporter = useReporter();
    const inboxContext = useInboxContext();

    const [isNavigatePending, setIsNavigatePending] = useState(false);

    const commentButtonAndAvatarsAreaWidth = platform !== "mobile" ? "10rem" : "7rem";

    const commentCount = postComments.getMessageCountIncludingOptimisticMessages();

    const commentButtonAriaLabel = useMemo(
        () => printPrettyNumber(locale, commentCount, "comment"),
        [locale, commentCount],
    );

    const hasOnlyGenericLikeReactions = useMemo(() => {
        return iterableEvery(
            post.reactions.get().values() ?? [],
            reaction => reaction === "GenericLike",
        );
    }, [post.reactions]);

    return (
        <Box
            data-testid={
                process.env.NODE_ENV !== "production"
                    ? `PostContentViewFooter:${post.id}`
                    : undefined
            }
            paddingX={screenPaddingX}
            marginLeft={hasOnlyGenericLikeReactions ? "-1.5" : "-1"}
            height={postContentViewFooterHeight}
            display="flex"
            alignItems="center"
        >
            <ContentBlockWidthContextProvider
                maxWidth={contentStyles.contentMaxWidth}
                paddingRight={useMemo(
                    () =>
                        addRemLengths(
                            screenPaddingX[platform],
                            "-1.5",
                            commentButtonAndAvatarsAreaWidth,
                            postContentViewFooterReactionButtonAreaWidth,
                        ),
                    [commentButtonAndAvatarsAreaWidth, platform],
                )}
            >
                <ReactionParty
                    reactions={post.reactions}
                    randomSeed={post.id}
                    onPress={() => {
                        if (isNavigatePending) return;

                        setIsNavigatePending(true);
                        navigate(`/s/${space.id}/posts/${post.id}/reactions`).finally(() => {
                            setIsNavigatePending(false);
                        });
                    }}
                />
            </ContentBlockWidthContextProvider>
            <Box
                flexShrink="0"
                display="flex"
                justifyContent="flex-start"
                alignItems="center"
                style={{width: postContentViewFooterReactionButtonAreaWidth}}
            >
                <ReactionButton
                    isReadOnly={isReadOnly}
                    reactions={post.reactions}
                    onSetReaction={reaction => {
                        if (!currentAccount) return;

                        const promise = setPostReaction(context, {postId: post.id, reaction}).then(
                            ({eventTransaction}) => eventTransaction,
                        );

                        promise.catch(error => {
                            reporter.displayError("Couldn\u2019t add reaction to post", error);
                        });

                        // On the server, `setPostReaction()` uses the same logic as
                        // `setPostCommentReaction()` for archiving a post in response to a reaction. So
                        // use the same logic on the client as well.
                        inboxContext?.onSetMessageReactionOptimistically(promise, post.id);

                        onOptimisticPostRealtimeEventTransaction(promise, post.id, post => {
                            const newReactions = new Map(post.reactions.get());
                            newReactions.set(currentAccount.id, reaction);
                            return post.clone({reactions: new ReactionSet(newReactions)});
                        });
                    }}
                    onDeleteReaction={() => {
                        if (!currentAccount) return;

                        const promise = deletePostReaction(context, {postId: post.id}).then(
                            ({eventTransaction}) => eventTransaction,
                        );

                        promise.catch(error => {
                            reporter.displayError("Couldn\u2019t remove reaction from post", error);
                        });

                        onOptimisticPostRealtimeEventTransaction(promise, post.id, post => {
                            const newReactions = new Map(post.reactions.get());
                            newReactions.delete(currentAccount.id);
                            return post.clone({reactions: new ReactionSet(newReactions)});
                        });
                    }}
                    onPressSeeReactions={async () => {
                        await navigate(`/s/${space.id}/posts/${post.id}/reactions`);
                    }}
                />
            </Box>
            <Box flexGrow="1" />
            <Box
                flexShrink="0"
                marginRight="-1.5"
                display="flex"
                justifyContent="flex-end"
                alignItems="center"
                gap="1.5"
                style={{width: commentButtonAndAvatarsAreaWidth}}
            >
                <PostCommentsAccountAvatarPile post={post} postComments={postComments} />
                {postCommentsState === "AlwaysOpen" ? (
                    <Box
                        aria-label={commentButtonAriaLabel}
                        paddingX="1.5"
                        color="grey-50"
                        display="flex"
                        alignItems="center"
                        gap="1"
                    >
                        <ChatCircleDots size={spacing[postContentViewFooterButtonIconSize]} />
                        <span style={{lineHeight: 1}}>
                            <PrettyNumber number={commentCount} />
                        </span>
                    </Box>
                ) : (
                    <Button
                        aria-label={commentButtonAriaLabel}
                        variant="quietest"
                        height={postContentViewFooterButtonHeight}
                        paddingX="1.5"
                        icon={
                            routeLayout === "narrow" ? (
                                <ChatCircleDots
                                    size={spacing[postContentViewFooterButtonIconSize]}
                                />
                            ) : (
                                <ChatCircleWithCaretUpIcon
                                    size={spacing[postContentViewFooterButtonIconSize]}
                                    caretStyle={{
                                        transformOrigin: "center",
                                        transform:
                                            postCommentsState !== "Closed"
                                                ? "rotate(180deg)"
                                                : "rotate(0deg)",
                                        transition: "transform 250ms ease",
                                    }}
                                />
                            )
                        }
                        iconPlacement="start"
                        pressErrorTitle="Couldn&#x2019;t open comments"
                        onPress={async () => {
                            if (routeLayout === "narrow") {
                                await navigate(`/s/${post.spaceId}/posts/${post.id}`);
                                return;
                            }

                            if (postCommentsState !== "Closed") {
                                onTogglePostComments();
                                return;
                            }

                            const initialLoadMessageCount =
                                getInitialLoadMessageCount(getClientInfo());

                            let areAllInitialMessagesLoaded = true;
                            for (
                                let index = 0;
                                index <
                                Math.min(
                                    postComments.getMessageCountExcludingOptimisticMessages(),
                                    initialLoadMessageCount,
                                );
                                index++
                            ) {
                                if (postComments.getItem(index).type !== "Loaded") {
                                    areAllInitialMessagesLoaded = false;
                                    break;
                                }
                            }

                            // Open comments immediately if:
                            //
                            // 1. There are more comments then our initial load request would fetch; AND
                            // 2. All of those comments are loaded.
                            //
                            // We want to load comments again when we have less than the initial load count
                            // because maybe some users added comments while the comment section was closed?
                            if (
                                postComments.getMessageCountExcludingOptimisticMessages() >=
                                    initialLoadMessageCount &&
                                areAllInitialMessagesLoaded
                            ) {
                                onTogglePostComments();
                                return;
                            }

                            const postCommentsPromise = onLoadInitialPostComments();

                            // Open post comments once we get our data back. But if the data is taking a long
                            // time to load, open post comments after a delay.
                            await Promise.race([
                                postCommentsPromise,
                                wait(delayLoadingIndicatorLimitMs),
                            ]);
                            onTogglePostComments();

                            await postCommentsPromise;
                        }}
                    >
                        <PrettyNumber number={commentCount} />
                    </Button>
                )}
            </Box>
        </Box>
    );
}

function PostCommentsAccountAvatarPile({
    post,
    postComments,
}: {
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
}) {
    const context = useAppContext();
    const platform = usePlatform();

    const additionalCommentAuthors = useStateWithDependenciesWithoutDispatch<
        {
            readonly endIndex: number;
            readonly accountById: ReadonlyMap<AccountId, AccountModel>;
        },
        [MessageList<PostCommentModel>]
    >(
        ([postComments], previousState) => {
            previousState ??= {
                endIndex: post.commentCount,
                accountById: new Map(),
            };

            if (
                previousState.endIndex >= postComments.getMessageCountIncludingOptimisticMessages()
            ) {
                return previousState;
            }

            return {
                endIndex: postComments.getMessageCountIncludingOptimisticMessages(),
                accountById: new Map(
                    concatIterables(
                        previousState.accountById,
                        mapIterable(
                            postComments.iterateMessages(previousState.endIndex),
                            comment => [comment.message.author.id, comment.message.author],
                        ),
                    ),
                ),
            };
        },
        [postComments],
    );

    const previewCommentAuthors = useMemo(
        () =>
            platform !== "mobile"
                ? post.previewCommentAuthors.slice(0, maxPostPreviewCommentAuthorCount)
                : post.previewCommentAuthors.slice(0, 3),
        [platform, post.previewCommentAuthors],
    );

    const {previewAccounts, accountCount} = useMemo(() => {
        // If there are unloaded comment authors then don't touch our author state. Since
        // we don't know whether an additional comment author has already been counted in
        // `commentAuthorCount`.
        if (previewCommentAuthors.length < post.commentAuthorCount) {
            return {
                previewAccounts: previewCommentAuthors,
                accountCount: post.commentAuthorCount,
            };
        }

        const previewCommentAuthorIds = new Set<AccountId>();
        const commentAuthors = [];

        for (const account of previewCommentAuthors) {
            previewCommentAuthorIds.add(account.id);
            commentAuthors.push(account);
        }

        for (const account of additionalCommentAuthors.accountById.values()) {
            if (!previewCommentAuthorIds.has(account.id)) {
                commentAuthors.push(account);
            }
        }

        return {
            previewAccounts: commentAuthors.slice(0, maxPostPreviewCommentAuthorCount),
            accountCount: commentAuthors.length,
        };
    }, [additionalCommentAuthors.accountById, post.commentAuthorCount, previewCommentAuthors]);

    return (
        <AccountAvatarPile
            size="5"
            previewAccounts={previewAccounts}
            accountCount={accountCount}
            getAllAccounts={async limit => {
                const {authors} = await getPostCommentAuthors(context, {
                    postId: post.id,
                    limit,
                });
                return authors;
            }}
        />
    );
}

function PostContentViewEditor({
    idBase,
    isPostView,
    postEditingForThisPost,
    fileAttachmentTarget,
    onScrollToIfNotVisible,
}: {
    idBase: string;
    isPostView: boolean;
    postEditingForThisPost: PostEditing & {state: {isEditing: true}};
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    onScrollToIfNotVisible: () => void;
}) {
    const editorRef = useRef<ContentEditorRef<PostContentWithReferences>>(null);

    const hasInitiallyMountedRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const editor = assertExists(editorRef.current);

        // If the user is in the middle of a post and they hit "edit" we don't want to
        // scroll the post. However, if the user is reading comments then they hit "edit"
        // on the post then we do want to scroll.
        //
        // By default, Chrome's scroll on focus will always scroll to the top of the editor
        // even if the editor is already visible. However, the `onScrollToIfNotVisible()`
        // function won't scroll if the editor is already visible.
        editor.focus({preventScroll: true});
        if (isPostView) onScrollToIfNotVisible();
    }, [isPostView, onScrollToIfNotVisible]);

    const hasContentChanged =
        postEditingForThisPost.state.contentEditorState.getDoc() !==
        postEditingForThisPost.state.initialContent;

    return (
        <Box
            style={{
                padding: subtractRemLengths(postContentViewInnerMarginY, "2"),
                paddingTop: isPostView
                    ? 0
                    : // Don't subtract `2` for padding top. Fixes:
                      // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/0cjng1831gafxd0qzz5bqnt39r
                      postContentViewInnerMarginY,
                // `postViewContentPaddingTop` minus `2` is negative which is why we use
                // `marginTop`.
                marginTop: isPostView
                    ? subtractRemLengths(postViewContentPaddingTop, "2")
                    : undefined,
            }}
        >
            <FocusRing
                // Don't render a focus ring around the post if a node is selected since the node
                // will have a blue focus ring. We don't want both focus rings to clash.
                isDisabled={
                    postEditingForThisPost.state.contentEditorState.getSelection() instanceof
                    NodeSelection
                }
                // This has an `inset` offset to avoid conflicting with the post navigation bar
                // when `isPostView` is true.
                offset="inset"
                isVisibleWhenFocusWithin={true}
                isVisibleFromAnyFocus={true}
            >
                <Box
                    id={`${idBase}-editor-${postEditingForThisPost.state.postId}`}
                    position="relative"
                    zIndex="40"
                    // We picked this border radius because it looks good with a selected file's
                    // `<FocusRing>` when they line up in the bottom corners.
                    borderRadius="2.5"
                    style={{
                        // Use box shadow to draw the border so it doesn't add 1px to layout like `border`
                        // CSS would.
                        boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                    }}
                    ref={useConfirmSaveAfterLosingFocus({
                        shouldConfirmSave: hasContentChanged,
                        isConfirmingSave:
                            postEditingForThisPost.state.isEditing &&
                            postEditingForThisPost.state.confirmationDialog === "Save",
                        onCancelSave: () =>
                            postEditingForThisPost.dispatch({type: "CancelEditing"}),
                        onConfirmSave: () =>
                            postEditingForThisPost.dispatch({type: "MaybeCancelEditing"}),
                    })}
                >
                    <ContentEditor
                        ref={editorRef}
                        aria-label="Post"
                        state={postEditingForThisPost.state.contentEditorState}
                        onChange={(contentEditorState, transaction) => {
                            if (postEditingForThisPost.state.isSaving && transaction.docChanged)
                                return;

                            postEditingForThisPost.dispatch({
                                type: "ContentEditorStateChange",
                                contentEditorState,
                                transaction,
                            });
                        }}
                        // On mobile, don't allow interactions when unfocused. We're already in an editing
                        // modality.
                        withoutMobileDualModality={true}
                        placeholder="Share your ideas, press @ to insert…"
                        fileAttachmentTarget={fileAttachmentTarget}
                        className={sprinkles({padding: "2"})}
                        onModEnterKeyDown={event => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (postEditingForThisPost.state.isSaving) return;
                            postEditingForThisPost.dispatch({type: "SaveEditedContent"});
                        }}
                        onEscapeKeyDown={event => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (postEditingForThisPost.state.isSaving) return;
                            postEditingForThisPost.dispatch({type: "CancelEditing"});
                        }}
                    />
                    <InlineEditorToolbar
                        isSaving={postEditingForThisPost.state.isSaving}
                        withModEnterSaveKeyboardShortcut={true}
                        onSave={() => postEditingForThisPost.dispatch({type: "SaveEditedContent"})}
                        onCancel={() => postEditingForThisPost.dispatch({type: "CancelEditing"})}
                    />
                </Box>
            </FocusRing>
        </Box>
    );
}
