import {CaretRight} from "phosphor-react";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile";
import {ContentView} from "~/client/content/content_view";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date";
import {PrettyNumber} from "~/client/design/pretty_number";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing_constants";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {PaginatedMessageList} from "~/client/messaging/paginated_message_list";
import {useClientInfo} from "~/client/remix/client_info_context";
import {wait} from "~/shared/helpers/async/wait";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {getPostCommentAuthors, getPostCommentsFromStart} from "~/shared/rpc/posts_rpc_definitions";
import {truncateClassName} from "~/shared/styles/styles";

export const postContentViewMinHeight = "7.75rem";

export function PostContentView({
    post,
    postComments,
    arePostCommentsOpen,
    onTogglePostComments,
    onLoadPostCommentsFromStart,
}: {
    post: PostModel;
    postComments: PaginatedMessageList<PostCommentModel>;
    arePostCommentsOpen: boolean;
    onTogglePostComments: () => void;
    onLoadPostCommentsFromStart: (options: {
        afterCommentId: number | null;
        beforeCommentId: number | null;
        limit: number;
        hasMoreCommentsAfter: boolean;
        comments: ReadonlyArray<PostCommentModel>;
    }) => void;
}) {
    return (
        <Box style={{minHeight: postContentViewMinHeight}}>
            <Box paddingTop="5" paddingX="5" display="flex" alignItems="center">
                <AccountAvatar account={post.author} size="10" />
                <Box flexGrow="1" paddingLeft="3" paddingRight="4" overflow="hidden">
                    <Box fontSize="sm" fontStyle="semi-bold" className={truncateClassName}>
                        {post.author.name}
                    </Box>
                    <Box fontSize="xs" color="grey-50" className={truncateClassName}>
                        <PrettyAbsoluteDate date={post.createdTime} />
                    </Box>
                </Box>
            </Box>
            <Box paddingX="3" paddingY="5">
                <ContentView content={post.content} onNavigate={useNavigate()} />
            </Box>
            <Box
                marginX="5"
                borderTop="grey-5"
                borderBottom={
                    arePostCommentsOpen && postComments.getEstimatedMessageCount() > 0
                        ? "grey-5"
                        : "transparent"
                }
                height="12"
                display="flex"
                alignItems="center"
            >
                <Box flexGrow="1" />
                <PostCommentsToggleButton
                    post={post}
                    postComments={postComments}
                    arePostCommentsOpen={arePostCommentsOpen}
                    onTogglePostComments={onTogglePostComments}
                    onLoadPostCommentsFromStart={onLoadPostCommentsFromStart}
                />
            </Box>
        </Box>
    );
}

function PostCommentsToggleButton({
    post,
    postComments,
    arePostCommentsOpen,
    onTogglePostComments,
    onLoadPostCommentsFromStart,
}: {
    post: PostModel;
    postComments: PaginatedMessageList<PostCommentModel>;
    arePostCommentsOpen: boolean;
    onTogglePostComments: () => void;
    onLoadPostCommentsFromStart: (options: {
        afterCommentId: number | null;
        beforeCommentId: number | null;
        limit: number;
        hasMoreCommentsAfter: boolean;
        comments: ReadonlyArray<PostCommentModel>;
    }) => void;
}) {
    const context = useAppContext();
    const clientInfo = useClientInfo();

    return (
        <Box display="flex" alignItems="center" gap="1.5">
            <AccountAvatarPile
                previewAccounts={post.previewCommentAuthors}
                accountCount={post.commentAuthorCount}
                getAllAccounts={async limit => {
                    const {authors} = await getPostCommentAuthors(context, {
                        postId: post.id,
                        limit,
                    });
                    return authors;
                }}
            />
            <Button
                paddingX="2"
                icon={
                    <CaretRight
                        style={{
                            transform: arePostCommentsOpen ? "rotate(90deg)" : "rotate(0deg)",
                            transition: "transform 100ms ease",
                        }}
                    />
                }
                iconPlacement="end"
                onPress={async () => {
                    if (arePostCommentsOpen) {
                        onTogglePostComments();
                        return;
                    }

                    // Open comments immediately if:
                    //
                    // 1. There are no comments. There may be an async race condition where a
                    //    comment was added after the server gave us an estimated message count so
                    //    we'll still need to backfill comments.
                    // 2. Comments are already loaded. We only check that the first comment is
                    //    loaded. If other comments onscreen are unloaded then we fallback to
                    //    shimmers kicking off data loading.
                    if (
                        postComments.getEstimatedMessageCount() === 0 ||
                        postComments.getMessage(0).isLoaded
                    ) {
                        onTogglePostComments();
                        return;
                    }

                    const limit = getInitialLoadMessageCount(clientInfo);

                    const postCommentsPromise = getPostCommentsFromStart(context, {
                        postId: post.id,
                        limit,
                        afterCommentId: null,
                        beforeCommentId: null,
                    });

                    // Open post comments once we get our data back. But if the data is taking a
                    // long time to load, open post comments after 1000ms.
                    const postCommentsResult = await Promise.race([
                        postCommentsPromise,
                        wait(uninterruptedThoughtLimitMs),
                    ]);
                    onTogglePostComments();

                    // Finish waiting for post comments in case the `wait()` won the race.
                    const {hasMoreCommentsAfter, comments} =
                        postCommentsResult ?? (await postCommentsPromise);

                    onLoadPostCommentsFromStart({
                        afterCommentId: null,
                        beforeCommentId: null,
                        limit,
                        hasMoreCommentsAfter,
                        comments,
                    });
                }}
            >
                <PrettyNumber number={post.commentCount} label="comment" />
            </Button>
        </Box>
    );
}
