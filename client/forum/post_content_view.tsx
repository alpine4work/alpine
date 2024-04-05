import {
    CaretRight,
    CaretUp,
    ChatCircle,
    DotsThreeVertical,
    IconContext,
    Smiley,
} from "phosphor-react";
import {CSSProperties, useContext, useEffect, useMemo, useState} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {ContentView} from "~/client/content/content_view.js";
import {messageInputPaddingY} from "~/client/content/messaging/message_input_base.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useShowToast} from "~/client/design/toast.js";
import {
    PostContentViewHeader,
    postContentViewHeaderHeight,
} from "~/client/forum/post_content_view_header.js";
import {PostCommentsState} from "~/client/forum/post_list.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
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
import {
    PostCommentModel,
    PostModel,
    maxPostPreviewCommentAuthorCount,
} from "~/shared/forum/post_model.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {getPostCommentAuthors} from "~/shared/rpc/forum_rpc_definitions.js";
import {contentSchemaStyles, fontSizes, forumStyles, sprinkles} from "~/shared/styles/styles.js";

const postContentViewFooterHeight = "10";
const postContentViewFooterButtonHeight = "7";

const postContentViewOuterMarginY = "7";
export const postContentViewInnerMarginY = "4";

export const postContentViewMinHeight = addRemLengths(
    spacing[postContentViewOuterMarginY],
    spacing[postContentViewHeaderHeight],
    spacing[postContentViewInnerMarginY],
    contentSchemaStyles.paragraphLineHeight,
    spacing[postContentViewInnerMarginY],
    spacing[postContentViewFooterHeight],
);

const fontSize75LineHeightRem = parseRemLengthNumber(fontSizes["75"].lineHeight);
const postContentViewFooterHeightRem = parseRemLengthNumber(spacing[postContentViewFooterHeight]);
const postContentViewOuterMarginYRem = parseRemLengthNumber(spacing[postContentViewOuterMarginY]);

// Visually, we want `postContentViewOuterMarginY` of space from the bottom of
// the button text. So adjust our outer padding bottom to exclude footer
// height we already have.
const postContentViewOuterMarginBottomRem =
    postContentViewOuterMarginYRem - (postContentViewFooterHeightRem - fontSize75LineHeightRem) / 2;

const postContentViewOuterMarginBottom = `${postContentViewOuterMarginBottomRem}rem`;

export function PostContentView({
    post,
    postComments,
    postCommentsState,
    paddingX,
    shouldShowChannel,
    onEditPost,
    onTogglePostComments,
    onLoadInitialPostComments,
}: {
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
    postCommentsState: PostCommentsState;
    paddingX: Spacing;
    shouldShowChannel: boolean;
    onEditPost: () => void;
    onTogglePostComments: () => void;
    onLoadInitialPostComments: () => Promise<void>;
}) {
    const isMobile = useIsMobile();
    const {currentAccount} = useSpaceContext();

    return (
        <Box
            position="relative"
            paddingTop={postContentViewOuterMarginY}
            style={{
                minHeight: postContentViewMinHeight,
                paddingBottom: postContentViewOuterMarginBottom,
            }}
        >
            <Box position="relative" paddingX={paddingX}>
                <PostContentViewHeader post={post} shouldShowChannel={shouldShowChannel} />
            </Box>
            <Box position="absolute" top={paddingX} right={paddingX}>
                <MenuButton
                    actions={[
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
                        ...(currentAccount.id === post.author.id
                            ? [
                                  {
                                      label: "Edit",
                                      onPress: onEditPost,
                                  },
                              ]
                            : []),
                    ]}
                >
                    <IconButton
                        size={isMobile ? "base" : "md"}
                        description="More"
                        withoutTooltip={true}
                    >
                        <DotsThreeVertical />
                    </IconButton>
                </MenuButton>
            </Box>
            <ContentView
                content={post.content}
                className={sprinkles({
                    paddingX: assertSpacing(`${parseInt(paddingX, 10) - 2}`),
                    paddingY: postContentViewInnerMarginY,
                })}
                contentUpdatedTime={post.contentUpdatedTime}
            />
            <PostContentViewFooter
                post={post}
                postComments={postComments}
                postCommentsState={postCommentsState}
                paddingX={paddingX}
                onTogglePostComments={onTogglePostComments}
                onLoadInitialPostComments={onLoadInitialPostComments}
            />
            {postCommentsState !== "Closed" && (
                <Box
                    position="absolute"
                    zIndex="30" // Render on top of comment input.
                    left="0"
                    right="0"
                    bottom="-1"
                    paddingX={paddingX}
                >
                    <div className={forumStyles.dashedBorderClassName} />
                </Box>
            )}
        </Box>
    );
}

function PostContentViewFooter({
    post,
    postComments,
    postCommentsState,
    paddingX,
    onTogglePostComments,
    onLoadInitialPostComments,
}: {
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
    postCommentsState: PostCommentsState;
    paddingX: Spacing;
    onTogglePostComments: () => void;
    onLoadInitialPostComments: () => Promise<void>;
}) {
    const showToast = useShowToast();

    return (
        <Box
            data-testid={`PostContentViewFooter:${post.id}`}
            paddingX={paddingX}
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
                            <Box position="relative" width="4" height="4">
                                <ChatCircle size={spacing["4"]} />
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
                    icon={<Smiley size={spacing["4"]} />}
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
