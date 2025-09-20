import {ChatCircle, ChatCircleDots, DotsThree, Smiley} from "phosphor-react";
import {NodeSelection} from "prosemirror-state";
import {Memo, useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {useAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentView} from "~/client/content/content_view.js";
import {ContentViewWithSeeMoreToggleBase} from "~/client/content/content_view_with_see_more_toggle.js";
import {useFileRegistry} from "~/client/content/file_registry_context.js";
import {getContentReferencesForClientPrintSingleLineTextSnippet} from "~/client/content/print_content_single_line_text_snippet_for_client.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {useReporter} from "~/client/design/reporter.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {getPostMoreActions} from "~/client/forum/get_post_more_actions.js";
import {PostContentViewHeader} from "~/client/forum/internal/post_content_view_header.js";
import {PostEditing} from "~/client/forum/internal/post_editing.js";
import {PostCommentsState} from "~/client/forum/post_list.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/helpers/use_store.js";
import {CaretUpWithCustomizableStrokeWidthIcon} from "~/client/icons/caret_up_with_customizable_stroke_width_icon.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {InlineEditorToolbar} from "~/client/messaging/inline_editor_toolbar.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSearchEntityRegistry} from "~/client/search/core/search_entity_registry_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    postContentViewFooterButtonHeight,
    postContentViewFooterButtonIconSize,
    postContentViewFooterHeight,
    postContentViewInnerMarginY,
    postContentViewMinHeightPx,
    postContentViewOuterMarginBottom,
    postContentViewOuterMarginY,
    postViewContentPaddingTop,
    postViewMinHeightPx,
    screenPaddingXWithoutPostContentViewInnerMarginY,
} from "~/client/styles/forum_shared_styles.js";
import {colorSchemeVars, navigationBarStyles, sprinkles} from "~/client/styles/styles.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {screenPaddingX, spacing, subtractRemLengths} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
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
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.js";
import {getPostCommentAuthors} from "~/shared/rpc/forum_rpc_definitions.js";
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
    shouldShowChannel,
    postEditing,
    isPostView,
    initialScroll,
    idBase,
    onTogglePostComments,
    onLoadInitialPostComments,
    onScrollToIfNotVisible,
    isShowingAllContent,
    onIsShowingAllContentChange,
}: {
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
    postCommentsState: PostCommentsState;
    postEditing: PostEditing;
    shouldShowChannel: boolean;
    isPostView: boolean;
    initialScroll: PostContentViewInitialScroll | null;
    idBase: string;
    onTogglePostComments: () => void;
    onLoadInitialPostComments: () => Promise<void>;
    onScrollToIfNotVisible: () => void;
    isShowingAllContent: boolean;
    onIsShowingAllContentChange: (isShowingAllContent: boolean) => void;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const {currentAccount} = useSpaceContext();
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();

    // Update `SearchEntityRegistry` with the post content. Now as the post content
    // changes in realtime, any `SearchEntityModel`s rendered elsewhere in
    // the product will also update.
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
                            // 1.125x the number of "x"s we can fit in a single line in a peek (64). We
                            // want to be slightly more aggressive than the default grapheme count (which
                            // counts the "l" character which is narrower) since we render the entire
                            // snippet.
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

        // We need to run after a microtask since our `<VirtualizedScrollView>` parent
        // will set scroll top to its initial value (0) in a `useLayoutEffect()`. So we
        // need to apply our scroll after that.
        scheduleMicrotask(() => {
            const fileElement = contentContainerElement.querySelector(
                // eslint-disable-next-line string-quotes
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
                    <Box position="absolute" top={screenPaddingX} right={screenPaddingX}>
                        <MenuButton
                            placement="bottom-end"
                            actions={getPostMoreActions({
                                currentAccount,
                                post,
                                onStartEditingPost: () => {
                                    postEditing.dispatch({
                                        type: "StartEditing",
                                        postId: post.id,
                                        currentContent: post.content,
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
                            contentUpdatedTime={post.contentUpdatedTime}
                            fileAttachmentTarget={fileAttachmentTarget}
                            className={sprinkles({padding: postContentViewInnerMarginY})}
                            style={{paddingTop: isPostView ? postViewContentPaddingTop : undefined}}
                        />
                    ) : (
                        <ContentViewWithSeeMoreToggleBase
                            contentUpdatedTime={post.contentUpdatedTime}
                            fileAttachmentTarget={fileAttachmentTarget}
                            className={sprinkles({padding: postContentViewInnerMarginY})}
                            style={{paddingTop: isPostView ? postViewContentPaddingTop : undefined}}
                            content={post.content}
                            contentSnippet={postSnippet}
                            isShowingAllContent={isShowingAllContent}
                            onIsShowingAllContentChange={onIsShowingAllContentChange}
                        />
                    )
                ) : (
                    <PostContentViewEditor
                        idBase={idBase}
                        isPostView={isPostView}
                        postEditingForThisPost={postEditingForThisPost}
                        fileAttachmentTarget={fileAttachmentTarget}
                        lastContentUpdatedTime={post.contentUpdatedTime}
                        onScrollToIfNotVisible={onScrollToIfNotVisible}
                    />
                )}
            </Box>
            <PostContentViewFooter
                post={post}
                postComments={postComments}
                postCommentsState={postCommentsState}
                onTogglePostComments={onTogglePostComments}
                onLoadInitialPostComments={onLoadInitialPostComments}
            />
        </Box>
    );
}

function PostContentViewFooter({
    post,
    postComments,
    postCommentsState,
    onTogglePostComments,
    onLoadInitialPostComments,
}: {
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
    postCommentsState: PostCommentsState;
    onTogglePostComments: () => void;
    onLoadInitialPostComments: () => Promise<void>;
}) {
    const routeLayout = useRouteLayout();
    const navigate = useNavigate();
    const reporter = useReporter();

    return (
        <Box
            data-testid={
                process.env.NODE_ENV !== "production"
                    ? `PostContentViewFooter:${post.id}`
                    : undefined
            }
            paddingX={screenPaddingX}
            height={postContentViewFooterHeight}
            display="flex"
            alignItems="center"
        >
            <Box marginLeft="-1.5" display="flex" alignItems="center" gap="1.5">
                {postCommentsState === "AlwaysOpen" ? (
                    <Box paddingX="1.5" color="grey-50" display="flex" alignItems="center" gap="1">
                        <ChatCircleDots size={spacing[postContentViewFooterButtonIconSize]} />
                        <span style={{lineHeight: 1}}>
                            <PrettyNumber
                                number={postComments.getMessageCountIncludingOptimisticMessages()}
                                label="comment"
                            />
                        </span>
                    </Box>
                ) : (
                    <Button
                        variant="quietest"
                        height={postContentViewFooterButtonHeight}
                        paddingX="1.5"
                        icon={
                            routeLayout === "narrow" ? (
                                <ChatCircleDots
                                    size={spacing[postContentViewFooterButtonIconSize]}
                                />
                            ) : (
                                <Box
                                    position="relative"
                                    width={postContentViewFooterButtonIconSize}
                                    height={postContentViewFooterButtonIconSize}
                                >
                                    <ChatCircle
                                        size={spacing[postContentViewFooterButtonIconSize]}
                                    />
                                    <Box
                                        position="absolute"
                                        inset="0"
                                        display="flex"
                                        justifyContent="center"
                                        alignItems="center"
                                    >
                                        <CaretUpWithCustomizableStrokeWidthIcon
                                            size={spacing["2"]}
                                            strokeWidthScale={4 / 2}
                                            style={{
                                                transform:
                                                    postCommentsState !== "Closed"
                                                        ? "rotate(-180deg)"
                                                        : "rotate(0deg)",
                                                transition: "transform 250ms ease",
                                            }}
                                        />
                                    </Box>
                                </Box>
                            )
                        }
                        iconPlacement="start"
                        pressErrorTitle="Couldn’t open comments"
                        onPress={async () => {
                            if (routeLayout === "narrow") {
                                await navigate(`/s/${post.spaceId}/posts/${post.id}`);
                                return;
                            }

                            if (postCommentsState !== "Closed") {
                                onTogglePostComments();
                                return;
                            }

                            const initialLoadMessageCount = getInitialLoadMessageCount(
                                getClientInfo(),
                            );

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

                            // Open post comments once we get our data back. But if the data is taking a
                            // long time to load, open post comments after a delay.
                            await Promise.race([
                                postCommentsPromise,
                                wait(delayLoadingIndicatorLimitMs),
                            ]);
                            onTogglePostComments();

                            await postCommentsPromise;
                        }}
                    >
                        <PrettyNumber
                            number={postComments.getMessageCountIncludingOptimisticMessages()}
                            label="comment"
                        />
                    </Button>
                )}
                <PostCommentsAccountAvatarPile post={post} postComments={postComments} />
            </Box>
            <Box flexGrow="1" />
            <Box marginRight="-1.5">
                <Button
                    variant="quietest"
                    icon={<Smiley size={spacing[postContentViewFooterButtonIconSize]} />}
                    height={postContentViewFooterButtonHeight}
                    paddingX="1.5"
                    onPress={() => {
                        reporter.displayError(
                            "Can’t like post",
                            new UnimplementedError("Liking posts hasn’t been implemented yet", {
                                displayMessage: errorDisplayMessage`Liking posts hasn’t been implemented yet.`,
                            }),
                        );
                    }}
                >
                    <PrettyNumber number={0} label="like" />
                </Button>
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

    const [_additionalCommentAuthors, setAdditionalCommentAuthors] = useState<{
        endIndex: number;
        accountById: ReadonlyMap<AccountId, AccountModel>;
    }>(() => ({
        // NOTE(calebmer): Intentionally using the `PostModel` comment count instead of
        // `postComments.getMessageCountExcludingOptimisticMessages()` so that we use the
        // comment count that `previewCommentAuthors` was loaded at.
        endIndex: post.commentCount,
        accountById: new Map(),
    }));

    const additionalCommentAuthors = useMemo(
        () =>
            _additionalCommentAuthors.endIndex <
            postComments.getMessageCountIncludingOptimisticMessages()
                ? {
                      endIndex: postComments.getMessageCountIncludingOptimisticMessages(),
                      accountById: new Map(
                          concatIterables(
                              _additionalCommentAuthors.accountById,
                              mapIterable(
                                  postComments.iterateMessages(_additionalCommentAuthors.endIndex),
                                  comment => [comment.message.author.id, comment.message.author],
                              ),
                          ),
                      ),
                  }
                : _additionalCommentAuthors,
        [_additionalCommentAuthors, postComments],
    );

    useEffect(() => {
        setAdditionalCommentAuthors(additionalCommentAuthors);
    }, [additionalCommentAuthors]);

    const {previewAccounts, accountCount} = useMemo(() => {
        // If there are unloaded comment authors then don't touch our author state.
        // Since we don't know whether an additional comment author has already been
        // counted in `commentAuthorCount`.
        if (post.previewCommentAuthors.length < post.commentAuthorCount) {
            return {
                previewAccounts: post.previewCommentAuthors,
                accountCount: post.commentAuthorCount,
            };
        }

        const previewCommentAuthorIds = new Set<AccountId>();
        const commentAuthors = [];

        for (const account of post.previewCommentAuthors) {
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
    }, [additionalCommentAuthors.accountById, post.commentAuthorCount, post.previewCommentAuthors]);

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
    lastContentUpdatedTime,
    onScrollToIfNotVisible,
}: {
    idBase: string;
    isPostView: boolean;
    postEditingForThisPost: PostEditing & {state: {isEditing: true}};
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    lastContentUpdatedTime: Date | null;
    onScrollToIfNotVisible: () => void;
}) {
    const editorRef = useRef<ContentEditorRef<PostContentWithReferences>>(null);

    const hasInitiallyMountedRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const editor = assertExists(editorRef.current);

        // If the user is in the middle of a post and they hit "edit" we don't want to
        // scroll the post. However, if the user is reading comments then they hit
        // "edit" on the post then we do want to scroll.
        //
        // By default, Chrome's scroll on focus will always scroll to the top of the
        // editor even if the editor is already visible. However, the
        // `onScrollToIfNotVisible()` function won't scroll if the editor is already
        // visible.
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
                // Don't render a focus ring around the post if a node is selected since the
                // node will have a blue focus ring. We don't want both focus rings to clash.
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
                        // Use box shadow to draw the border so it doesn't add 1px to layout like
                        // `border` CSS would.
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
                            });
                        }}
                        // On mobile, don't allow interactions when unfocused. We're already in an
                        // editing modality.
                        withoutMobileDualModality={true}
                        // Allocate space for the "(edited)" note so messages don't shift when we
                        // enter/exit edit mode.
                        withContentUpdatedTimePlaceholder={
                            !!lastContentUpdatedTime || hasContentChanged
                        }
                        placeholder="Share your ideas…"
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
