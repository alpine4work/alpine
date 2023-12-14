import {CaretRight, DotsThree} from "phosphor-react";
import {useEffect, useMemo, useState} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {ContentView} from "~/client/content/content_view.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {
    PostContentViewHeader,
    postContentViewHeaderHeight,
} from "~/client/forum/post_content_view_header.js";
import {PostCommentsState} from "~/client/forum/post_list.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    assertSpacing,
    spacing,
} from "~/shared/design/spacing.js";
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
import {contentSchemaStyles, sprinkles} from "~/shared/styles/styles.js";

const postContentViewFooterHeight: Spacing = "12";

export const postContentViewPaddingY: Spacing = "5";

export const postContentViewMinHeight: RemLength = addRemLengths(
    spacing[postContentViewPaddingY],
    spacing[postContentViewHeaderHeight],
    spacing[postContentViewPaddingY],
    contentSchemaStyles.paragraphLineHeight,
    spacing[postContentViewPaddingY],
    spacing[postContentViewFooterHeight],
);

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
    const {currentAccount} = useSpaceContext();

    return (
        <Box style={{minHeight: postContentViewMinHeight}}>
            <Box position="relative" paddingTop={postContentViewPaddingY} paddingX={paddingX}>
                <PostContentViewHeader post={post} shouldShowChannel={shouldShowChannel} />
                <Box
                    position="absolute"
                    top={assertSpacing(`${parseInt(postContentViewPaddingY, 10) - 2}`)}
                    right={assertSpacing(`${parseInt(paddingX, 10) - 2}`)}
                >
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
                        <IconButton size="md" description="More" withoutTooltip={true}>
                            <DotsThree />
                        </IconButton>
                    </MenuButton>
                </Box>
            </Box>
            <ContentView
                content={post.content}
                className={sprinkles({
                    paddingX: assertSpacing(`${parseInt(paddingX, 10) - 2}`),
                    paddingY: postContentViewPaddingY,
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
    return (
        <Box
            data-testid={`PostContentViewFooter:${post.id}`}
            marginX={paddingX}
            borderTop="grey-5"
            borderBottom={
                postCommentsState !== "Closed" && postComments.getItemCount() > 0
                    ? "grey-5"
                    : "transparent"
            }
            height={postContentViewFooterHeight}
            display="flex"
            alignItems="center"
        >
            <Box flexGrow="1" />
            <Box display="flex" alignItems="center" gap="1.5">
                <PostCommentsAccountAvatarPile post={post} postComments={postComments} />
                {postCommentsState === "AlwaysOpen" ? (
                    <Box paddingX="2">
                        <PrettyNumber
                            number={postComments.getMessageCountIncludingOptimisticMessages()}
                            label="comment"
                        />
                    </Box>
                ) : (
                    <Button
                        paddingX="2"
                        icon={
                            <CaretRight
                                style={{
                                    transform:
                                        postCommentsState !== "Closed"
                                            ? "rotate(90deg)"
                                            : "rotate(0deg)",
                                    transition: "transform 100ms ease",
                                }}
                            />
                        }
                        iconPlacement="end"
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
