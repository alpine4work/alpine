import {ChatCircle, ChatCircleDots, Check, DotsThree, Smiley, X} from "phosphor-react";
import {useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentView} from "~/client/content/content_view.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {useReporter} from "~/client/design/reporter.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {PostContentViewHeader} from "~/client/forum/internal/post_content_view_header.js";
import {PostEditing} from "~/client/forum/internal/post_editing.js";
import {PostCommentsState} from "~/client/forum/post_list.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {CaretUpWithCustomizableStrokeWidthIcon} from "~/client/icons/caret_up_with_customizable_stroke_width_icon.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {getClientInfoWithoutListening, useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {screenPaddingX, spacing} from "~/shared/design/spacing.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {PostContentWithReferences} from "~/shared/forum/post_content_schema.js";
import {
    PostCommentModel,
    PostModel,
    maxPostPreviewCommentAuthorCount,
} from "~/shared/forum/post_model.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {getPostCommentAuthors} from "~/shared/rpc/forum_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    desktopPostContentViewMinHeightWithNavigationBarAndSingleLayoutPinnedCommentInput,
    desktopPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput,
    mobileLayoutPostContentViewMinHeightWithNavigationBarAndSingleLayoutPinnedCommentInput,
    mobileLayoutPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput,
    mobilePlatformPostContentViewMinHeightWithNavigationBarAndSingleLayoutPinnedCommentInput,
    mobilePlatformPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput,
    postCommentSectionGuidelineOffset,
    postCommentSectionGuidelineStartHeight,
    postContentEditorPaddingY,
    postContentViewFooterButtonHeight,
    postContentViewFooterButtonIconSize,
    postContentViewFooterHeight,
    postContentViewInnerMarginYWithoutContentEditorPaddingY,
    postContentViewMinHeightWithClosedCommentSection,
    postContentViewMinHeightWithOpenCommentSection,
    postContentViewOuterMarginBottom,
    postContentViewOuterMarginY,
    postContentViewOuterOpenCommentSectionMarginBottom,
} from "~/shared/styles/forum_shared_styles.js";
import {colorSchemeVars, contentSchemaStyles, sprinkles} from "~/shared/styles/styles.js";

export function PostContentView({
    withMobileLayout,
    post,
    postComments,
    postCommentsState,
    shouldShowChannel,
    postEditing,
    hasNavigationBar,
    isSingleLayoutWithPinnedCommentInput,
    idBase,
    onTogglePostComments,
    onLoadInitialPostComments,
}: {
    withMobileLayout: boolean;
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
    postCommentsState: PostCommentsState;
    postEditing: PostEditing;
    shouldShowChannel: boolean;
    hasNavigationBar: boolean;
    isSingleLayoutWithPinnedCommentInput: boolean;
    idBase: string;
    onTogglePostComments: () => void;
    onLoadInitialPostComments: () => Promise<void>;
}) {
    const isMobile = useIsMobile();
    const {currentAccount} = useSpaceContext();

    const postEditingForThisPost =
        // On mobile we use a modal for the editing UI instead of inline editing.
        !isMobile && postEditing.state.isEditing && postEditing.state.postId === post.id
            ? (postEditing as PostEditing & {state: {isEditing: true}})
            : null;

    const isEditingPost = !!postEditingForThisPost;

    const postSnippet = useMemo(() => {
        if (isSingleLayoutWithPinnedCommentInput) {
            return null;
        } else {
            return {
                doc: getContentSnippet(
                    post.content.doc.resolve(0),
                    {linesAbove: 0, linesBelow: withMobileLayout ? 5 : 16},
                    {
                        // 1.125x the number of "x"s we can fit in a single line in a peek (64). We
                        // want to be slightly more aggressive than the default grapheme count (which
                        // counts the "l" character which is narrower) since we render the entire
                        // snippet.
                        maxLineGraphemeCount: isMobile ? 42 : 72,
                    },
                ),
                references: post.content.references,
            };
        }
    }, [
        isMobile,
        isSingleLayoutWithPinnedCommentInput,
        post.content.doc,
        post.content.references,
        withMobileLayout,
    ]);

    const isPostSnippetTruncated = post.content.doc.nodeSize !== postSnippet?.doc.nodeSize;

    const [isShowingAllContent, setIsShowingAllContent] = useState(!isPostSnippetTruncated);
    if (!isShowingAllContent && !isPostSnippetTruncated) setIsShowingAllContent(true);

    return (
        <Box
            data-testid={
                process.env.NODE_ENV !== "production" ? `PostContentView:${post.id}` : undefined
            }
            position="relative"
            paddingTop={
                !hasNavigationBar || !isSingleLayoutWithPinnedCommentInput
                    ? postContentViewOuterMarginY
                    : undefined
            }
            style={{
                minHeight:
                    hasNavigationBar && isSingleLayoutWithPinnedCommentInput
                        ? withMobileLayout
                            ? isMobile
                                ? mobilePlatformPostContentViewMinHeightWithNavigationBarAndSingleLayoutPinnedCommentInput
                                : mobileLayoutPostContentViewMinHeightWithNavigationBarAndSingleLayoutPinnedCommentInput
                            : desktopPostContentViewMinHeightWithNavigationBarAndSingleLayoutPinnedCommentInput
                        : postCommentsState !== "Closed" && !isSingleLayoutWithPinnedCommentInput
                        ? postContentViewMinHeightWithOpenCommentSection
                        : postContentViewMinHeightWithClosedCommentSection,
                paddingBottom:
                    postCommentsState !== "Closed" && !isSingleLayoutWithPinnedCommentInput
                        ? postContentViewOuterOpenCommentSectionMarginBottom
                        : postContentViewOuterMarginBottom,
            }}
        >
            {!hasNavigationBar || !isSingleLayoutWithPinnedCommentInput ? (
                <>
                    <Box position="relative" paddingX={screenPaddingX}>
                        <PostContentViewHeader post={post} shouldShowChannel={shouldShowChannel} />
                    </Box>
                    <Box position="absolute" top={screenPaddingX} right={screenPaddingX}>
                        {!isEditingPost ? (
                            <MenuButton
                                actions={getPostMoreActions({
                                    currentAccount,
                                    post,
                                    onStartEditingPost: () => {
                                        postEditing.dispatch({
                                            type: "StartEditing",
                                            postId: post.id,
                                            currentContent: post.content,
                                            isMobile,
                                        });
                                    },
                                })}
                            >
                                <IconButton
                                    size={isMobile ? "base" : "md"}
                                    description="More"
                                    withoutTooltip={true}
                                >
                                    <DotsThree />
                                </IconButton>
                            </MenuButton>
                        ) : (
                            <PostContentViewEditingActions
                                idBase={idBase}
                                postEditing={postEditingForThisPost}
                            />
                        )}
                    </Box>
                </>
            ) : (
                <Box paddingTop="safe-area-inset">
                    <Box
                        style={{
                            height: withMobileLayout
                                ? isMobile
                                    ? `${mobilePlatformPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput}rem`
                                    : `${mobileLayoutPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput}rem`
                                : `${desktopPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput}rem`,
                        }}
                    />
                </Box>
            )}
            <Box
                paddingX={contentSchemaStyles.screenPaddingXWithoutBlockPaddingX}
                style={{
                    paddingTop: postContentViewInnerMarginYWithoutContentEditorPaddingY,
                    paddingBottom: postContentViewInnerMarginYWithoutContentEditorPaddingY,
                }}
            >
                {!isEditingPost ? (
                    isSingleLayoutWithPinnedCommentInput ? (
                        <ContentView
                            withMobileLayout={withMobileLayout}
                            content={post.content}
                            contentUpdatedTime={post.contentUpdatedTime}
                            className={sprinkles({paddingY: postContentEditorPaddingY})}
                        />
                    ) : (
                        <ContentView
                            withMobileLayout={withMobileLayout}
                            contentUpdatedTime={post.contentUpdatedTime}
                            className={sprinkles({paddingY: postContentEditorPaddingY})}
                            content={
                                isPostSnippetTruncated && !isShowingAllContent && postSnippet
                                    ? postSnippet
                                    : post.content
                            }
                            onSeeMoreContent={
                                isPostSnippetTruncated && !isShowingAllContent
                                    ? () => setIsShowingAllContent(true)
                                    : undefined
                            }
                            onSeeLessContent={
                                isPostSnippetTruncated && isShowingAllContent
                                    ? () => setIsShowingAllContent(false)
                                    : undefined
                            }
                        />
                    )
                ) : (
                    <PostContentViewEditor
                        withMobileLayout={withMobileLayout}
                        idBase={idBase}
                        postEditingForThisPost={postEditingForThisPost}
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
            {postCommentsState !== "Closed" && !isSingleLayoutWithPinnedCommentInput && (
                <div
                    className={sprinkles({
                        position: "absolute",
                        bottom: "0",
                        borderLeft: "grey-5",
                        borderLeftWidth: "thick",
                    })}
                    style={{
                        height: postCommentSectionGuidelineStartHeight,
                        left: `calc(${
                            postCommentSectionGuidelineOffset[isMobile ? "mobile" : "desktop"]
                        } - 1px)`,
                    }}
                />
            )}
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
    const isMobile = useIsMobile();
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
                            isMobile ? (
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
                            if (isMobile) {
                                await navigate(`/s/${post.spaceId}/posts/${post.id}`);
                                return;
                            }

                            if (postCommentsState !== "Closed") {
                                onTogglePostComments();
                                return;
                            }

                            const initialLoadMessageCount = getInitialLoadMessageCount(
                                getClientInfoWithoutListening(),
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
                            new UnimplementedError("Liking posts hasn't been implemented yet", {
                                displayMessage: errorDisplayMessage`Liking posts hasn't been implemented yet.`,
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
    withMobileLayout,
    idBase,
    postEditingForThisPost,
}: {
    withMobileLayout: boolean;
    idBase: string;
    postEditingForThisPost: PostEditing & {state: {isEditing: true}};
}) {
    const editorRef = useRef<ContentEditorRef<PostContentWithReferences>>(null);

    const hasInitiallyMountedRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const editor = assertExists(editorRef.current);
        editor.focus();
    }, []);

    return (
        <FocusRing offset="border" isVisibleWhenFocusWithin={true} isVisibleFromAnyFocus={true}>
            <Box
                id={`${idBase}-editor-${postEditingForThisPost.state.postId}`}
                borderRadius="md"
                style={{
                    // Use box shadow to draw the border so it doesn't add 1px to layout like
                    // `border` CSS would.
                    boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                }}
                ref={useConfirmSaveAfterLosingFocus({
                    shouldConfirmSave:
                        postEditingForThisPost.state.contentEditorState.getDoc() !==
                        postEditingForThisPost.state.initialContent,
                    isConfirmingSave:
                        postEditingForThisPost.state.isEditing &&
                        postEditingForThisPost.state.confirmationDialog === "Save",
                    onCancelSave: () => postEditingForThisPost.dispatch({type: "CancelEditing"}),
                    onConfirmSave: () =>
                        postEditingForThisPost.dispatch({type: "MaybeCancelEditing"}),
                })}
            >
                <ContentEditor
                    ref={editorRef}
                    aria-label="Post"
                    withMobileLayout={withMobileLayout}
                    state={postEditingForThisPost.state.contentEditorState}
                    onChange={(contentEditorState, transaction) => {
                        if (postEditingForThisPost.state.isSaving && transaction.docChanged) return;

                        postEditingForThisPost.dispatch({
                            type: "ContentEditorStateChange",
                            contentEditorState,
                        });
                    }}
                    // On mobile, don't allow interactions when unfocused. We're already in an
                    // editing modality.
                    withoutMobileDualModality={true}
                    placeholder="Share your ideas…"
                    className={sprinkles({paddingY: postContentEditorPaddingY})}
                    onModEnter={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (postEditingForThisPost.state.isSaving) return;
                        postEditingForThisPost.dispatch({type: "SaveEditedContent"});
                    }}
                    onEscape={event => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (postEditingForThisPost.state.isSaving) return;
                        postEditingForThisPost.dispatch({type: "CancelEditing"});
                    }}
                />
            </Box>
        </FocusRing>
    );
}

export function PostContentViewEditingActions({
    idBase,
    postEditing,
}: {
    idBase: string;
    postEditing: PostEditing & {state: {isEditing: true}};
}) {
    const isMobile = useIsMobile();
    const {isAppleDevice} = useClientInfo();

    return (
        <Box
            // Mark our buttons as being owned by the editor (according to
            // `isElementOwnedBy()`) so `useConfirmSaveAfterLosingFocus()` allows us to
            // press on these buttons without asking the user to confirm the save.
            data-ownedby={`${idBase}-editor-${postEditing.state.postId}`}
            display="flex"
        >
            <IconButton
                description="Save"
                tooltipPlacement="bottom-end"
                keyboardShortcutHint={`${isAppleDevice ? "⌘" : "Ctrl"}+Enter`}
                size={isMobile ? "base" : "md"}
                onPress={() => {
                    postEditing.dispatch({
                        type: "SaveEditedContent",
                    });
                }}
                isDisabled={postEditing.state.isSaving}
                isPending={postEditing.state.isSaving}
            >
                <Check />
            </IconButton>
            <IconButton
                description="Cancel"
                tooltipPlacement="bottom-end"
                keyboardShortcutHint="Esc"
                size={isMobile ? "base" : "md"}
                onPress={() => postEditing.dispatch({type: "CancelEditing"})}
                isDisabled={postEditing.state.isSaving}
            >
                <X />
            </IconButton>
        </Box>
    );
}

export function getPostMoreActions({
    currentAccount,
    post,
    onStartEditingPost,
}: {
    currentAccount: AccountModel;
    post: PostModel;
    onStartEditingPost: () => void;
}) {
    return [
        [
            {
                label: "Copy link",
                pressErrorTitle: "Couldn’t copy post link",
                onPress: async () => {
                    const url = new URL(
                        `/s/${post.spaceId}/posts/${post.id}`,
                        window.location.href,
                    );
                    await writeTextToClipboard(url.toString());
                },
            },
        ],
        ...(currentAccount.id === post.author.id
            ? [
                  [
                      {
                          label: "Edit",
                          onPress: onStartEditingPost,
                      },
                  ],
              ]
            : []),
    ];
}
