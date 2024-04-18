import {ChatCircle, Check, DotsThree, IconContext, Smiley, X} from "phosphor-react";
import {CSSProperties, useContext, useEffect, useId, useMemo, useRef, useState} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentView} from "~/client/content/content_view.js";
import {messageInputPaddingY} from "~/client/content/messaging/message_input_base.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useShowToast} from "~/client/design/toast.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {
    PostContentViewHeader,
    postContentViewHeaderHeight,
} from "~/client/forum/post_content_view_header.js";
import {PostEditing} from "~/client/forum/post_editing.js";
import {PostCommentsState} from "~/client/forum/post_list.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {getClientInfoWithoutListening, useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    assertSpacing,
    parseRemLengthNumber,
    spacing,
    subtractRemLengths,
} from "~/shared/design/spacing.js";
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
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {getPostCommentAuthors} from "~/shared/rpc/forum_rpc_definitions.js";
import {
    colorSchemeVars,
    contentSchemaStyles,
    fontSizes,
    sprinkles,
} from "~/shared/styles/styles.js";

export const postContentViewPaddingX: {mobile: Spacing; desktop: Spacing} = {
    mobile: "3",
    desktop: "5",
};

export const postContentViewFooterHeight = "8";
const postContentViewFooterButtonHeight = "7";

export const postContentViewOuterMarginY = "6";
export const postContentViewInnerMarginY = "4";

const contentEditorPaddingY = "1.5";

const postContentViewInnerMarginYWithoutContentEditorPaddingY = subtractRemLengths(
    spacing[postContentViewInnerMarginY],
    spacing[contentEditorPaddingY],
);

const fontSize75LineHeightRem = parseRemLengthNumber(fontSizes["75"].lineHeight);
const postContentViewFooterHeightRem = parseRemLengthNumber(spacing[postContentViewFooterHeight]);
const postContentViewFooterButtonHeightRem = parseRemLengthNumber(
    spacing[postContentViewFooterButtonHeight],
);
const postContentViewOuterMarginYRem = parseRemLengthNumber(spacing[postContentViewOuterMarginY]);

// Visually, we want `postContentViewOuterMarginY` of space from the bottom of
// the button text. So adjust our outer padding bottom to exclude footer
// height we already have.
const postContentViewOuterMarginBottomRem =
    postContentViewOuterMarginYRem - (postContentViewFooterHeightRem - fontSize75LineHeightRem) / 2;

export const postContentViewOuterMarginBottom: RemLength = `${postContentViewOuterMarginBottomRem}rem`;

export const postContentViewContentPaddingX = mapObjectValues(postContentViewPaddingX, paddingX =>
    assertSpacing(`${parseInt(paddingX, 10) - parseInt(contentSchemaStyles.blockPaddingX, 10)}`),
);

const postContentViewOuterOpenCommentSectionMarginBottomRem =
    postContentViewOuterMarginBottomRem - parseRemLengthNumber(spacing[messageInputPaddingY]);

const postContentViewOuterOpenCommentSectionMarginBottom: RemLength = `${postContentViewOuterOpenCommentSectionMarginBottomRem}rem`;

const postContentViewFooterButtonIconSize = "4";

export const postCommentSectionGuidelineOffset = mapObjectValues(
    postContentViewPaddingX,
    (paddingX): RemLength =>
        `${
            parseRemLengthNumber(spacing[paddingX]) +
            parseRemLengthNumber(spacing[postContentViewFooterButtonIconSize]) / 2
        }rem`,
);

const postCommentSectionGuidelineStartHeightRem =
    postContentViewOuterOpenCommentSectionMarginBottomRem +
    (postContentViewFooterHeightRem - postContentViewFooterButtonHeightRem) / 2;

const postCommentSectionGuidelineStartHeight = `${postCommentSectionGuidelineStartHeightRem}rem`;

const postContentViewMinHeightBase = addRemLengths(
    spacing[postContentViewOuterMarginY],
    spacing[postContentViewHeaderHeight],
    spacing[postContentViewInnerMarginY],
    contentSchemaStyles.paragraphLineHeight,
    spacing[postContentViewInnerMarginY],
    spacing[postContentViewFooterHeight],
);

export const postContentViewMinHeightWithOpenCommentSection = addRemLengths(
    postContentViewMinHeightBase,
    postContentViewOuterOpenCommentSectionMarginBottom,
);

export const postContentViewMinHeightWithClosedCommentSection = addRemLengths(
    postContentViewMinHeightBase,
    postContentViewOuterMarginBottom,
);

export function PostContentView({
    post,
    postComments,
    postCommentsState,
    shouldShowChannel,
    postEditing,
    isSingleLayoutWithPinnedCommentInput,
    onTogglePostComments,
    onLoadInitialPostComments,
}: {
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
    postCommentsState: PostCommentsState;
    postEditing: PostEditing;
    shouldShowChannel: boolean;
    isSingleLayoutWithPinnedCommentInput: boolean;
    onTogglePostComments: () => void;
    onLoadInitialPostComments: () => Promise<void>;
}) {
    const isMobile = useIsMobile();
    const {isAppleDevice} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const postEditingForThisPost =
        postEditing.state.isEditing && postEditing.state.postId === post.id
            ? (postEditing as PostEditing & {state: {isEditing: true}})
            : null;

    const isEditingPost = !!postEditingForThisPost;

    const editorId = useId();

    return (
        <Box
            position="relative"
            paddingTop={postContentViewOuterMarginY}
            style={{
                minHeight:
                    postCommentsState !== "Closed" && !isSingleLayoutWithPinnedCommentInput
                        ? postContentViewMinHeightWithOpenCommentSection
                        : postContentViewMinHeightWithClosedCommentSection,
                paddingBottom:
                    postCommentsState !== "Closed" && !isSingleLayoutWithPinnedCommentInput
                        ? postContentViewOuterOpenCommentSectionMarginBottom
                        : postContentViewOuterMarginBottom,
            }}
        >
            <Box position="relative" paddingX={postContentViewPaddingX}>
                <PostContentViewHeader post={post} shouldShowChannel={shouldShowChannel} />
            </Box>
            <Box position="absolute" top={postContentViewPaddingX} right={postContentViewPaddingX}>
                {!isEditingPost ? (
                    <MenuButton
                        actions={[
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
                                              onPress: () => {
                                                  postEditing.dispatch({
                                                      type: "StartEditing",
                                                      postId: post.id,
                                                      currentContent: post.content,
                                                  });
                                              },
                                          },
                                      ],
                                  ]
                                : []),
                        ]}
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
                    <Box
                        // Mark our buttons as being owned by the editor (according to
                        // `isElementOwnedBy()`) so `useConfirmSaveAfterLosingFocus()` allows us to
                        // press on these buttons without asking the user to confirm the save.
                        data-ownedby={editorId}
                        display="flex"
                    >
                        <IconButton
                            description="Save"
                            tooltipPlacement="bottom-end"
                            keyboardShortcutHint={`${isAppleDevice ? "⌘" : "Ctrl"}+Enter`}
                            size={isMobile ? "base" : "md"}
                            onPress={() => {
                                postEditingForThisPost.dispatch({type: "SaveEditedContent"});
                            }}
                            isDisabled={postEditingForThisPost.state.isSaving}
                            isPending={postEditingForThisPost.state.isSaving}
                        >
                            <Check />
                        </IconButton>
                        <IconButton
                            description="Cancel"
                            tooltipPlacement="bottom-end"
                            keyboardShortcutHint="Esc"
                            size={isMobile ? "base" : "md"}
                            onPress={() => postEditingForThisPost.dispatch({type: "CancelEditing"})}
                            isDisabled={postEditingForThisPost.state.isSaving}
                        >
                            <X />
                        </IconButton>
                    </Box>
                )}
            </Box>
            <Box
                paddingX={postContentViewContentPaddingX}
                style={{
                    paddingTop: postContentViewInnerMarginYWithoutContentEditorPaddingY,
                    paddingBottom: postContentViewInnerMarginYWithoutContentEditorPaddingY,
                }}
            >
                {!isEditingPost ? (
                    <ContentView
                        content={post.content}
                        contentUpdatedTime={post.contentUpdatedTime}
                        className={sprinkles({paddingY: contentEditorPaddingY})}
                    />
                ) : (
                    <PostContentViewEditor
                        editorId={editorId}
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
    const showToast = useShowToast();

    return (
        <Box
            data-testid={`PostContentViewFooter:${post.id}`}
            paddingX={postContentViewPaddingX}
            height={postContentViewFooterHeight}
            display="flex"
            alignItems="center"
        >
            <Box marginLeft="-1.5" display="flex" alignItems="center" gap="1.5">
                {postCommentsState === "AlwaysOpen" ? (
                    <Box paddingX="1.5" color="grey-60">
                        <PrettyNumber
                            number={postComments.getMessageCountIncludingOptimisticMessages()}
                            label="comment"
                        />
                    </Box>
                ) : (
                    <Button
                        variant="quieter2"
                        height={postContentViewFooterButtonHeight}
                        paddingX="1.5"
                        icon={
                            <Box
                                position="relative"
                                width={postContentViewFooterButtonIconSize}
                                height={postContentViewFooterButtonIconSize}
                            >
                                <ChatCircle size={spacing[postContentViewFooterButtonIconSize]} />
                                <Box
                                    position="absolute"
                                    inset="0"
                                    display="flex"
                                    justifyContent="center"
                                    alignItems="center"
                                >
                                    <CaretUpWithCustomizableStrokeWidth
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
                        }
                        iconPlacement="start"
                        pressErrorTitle="Couldn’t open comments"
                        onPress={async () => {
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
                    variant="quieter2"
                    icon={<Smiley size={spacing[postContentViewFooterButtonIconSize]} />}
                    height={postContentViewFooterButtonHeight}
                    paddingX="1.5"
                    onPress={() => {
                        showToast({
                            type: "Error",
                            title: "Can’t like post",
                            error: new UnimplementedError(
                                "Liking posts hasn't been implemented yet",
                                {
                                    displayMessage: errorDisplayMessage`Liking posts hasn't been implemented yet.`,
                                },
                            ),
                        });
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

// The `<CaretUp>` Phosphor icon but allows us to customize the stroke width.
function CaretUpWithCustomizableStrokeWidth({
    color,
    size,
    style,
    strokeWidthScale = 1,
}: {
    color?: string;
    size?: string | number;
    style?: CSSProperties;
    strokeWidthScale?: number;
}) {
    const {
        color: contextColor,
        size: contextSize,
        weight,
        mirrored,
        ...context
    } = useContext(IconContext);

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            fill={color ?? contextColor}
            viewBox="0 0 256 256"
            {...context}
            // NOTE(calebmer): Safari doesn't like `width` and `height` attributes being
            // set to rem units so use `style` instead.
            style={{
                width: size ?? contextSize,
                height: size ?? contextSize,
                ...context.style,
                ...style,
            }}
        >
            <polyline
                points="48 160 128 80 208 160"
                fill="none"
                stroke={color ?? contextColor}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={16 * strokeWidthScale}
            />
        </svg>
    );
}

function PostContentViewEditor({
    editorId,
    postEditingForThisPost,
}: {
    editorId: string;
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
                id={editorId}
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
                    className={sprinkles({paddingY: contentEditorPaddingY})}
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
