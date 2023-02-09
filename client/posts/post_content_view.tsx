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
import {MessageList} from "~/client/messaging/message_list";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context";
import {wait} from "~/shared/helpers/async/wait";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {getPostCommentAuthors} from "~/shared/rpc/posts_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

export const postContentViewMinHeight = "10.125rem";

export function PostContentView({
    post,
    postComments,
    arePostCommentsOpen,
    onTogglePostComments,
    onLoadInitialPostComments,
}: {
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
    arePostCommentsOpen: boolean;
    onTogglePostComments: () => void;
    onLoadInitialPostComments: () => Promise<void>;
}) {
    return (
        <Box style={{minHeight: postContentViewMinHeight}}>
            <Box paddingTop="5" paddingX="5" display="flex" alignItems="center">
                <AccountAvatar account={post.author} size="8" />
                <Box flexGrow="1" paddingLeft="3" paddingRight="4" overflow="hidden">
                    <Box fontSize="100" fontStyle="truncate-semi-bold">
                        {post.author.name}
                    </Box>
                    <Box fontSize="75" fontStyle="truncate" color="grey-50">
                        <PrettyAbsoluteDate date={post.createdTime} />
                    </Box>
                </Box>
            </Box>
            <ContentView
                content={post.content}
                onNavigate={useNavigate()}
                className={sprinkles({paddingX: "3", paddingY: "5"})}
            />
            <Box
                marginX="5"
                borderTop="grey-5"
                borderBottom={
                    arePostCommentsOpen && postComments.getMessageCount() > 0
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
                    onLoadInitialPostComments={onLoadInitialPostComments}
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
    onLoadInitialPostComments,
}: {
    post: PostModel;
    postComments: MessageList<PostCommentModel>;
    arePostCommentsOpen: boolean;
    onTogglePostComments: () => void;
    onLoadInitialPostComments: () => Promise<void>;
}) {
    const context = useAppContext();

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
                pressErrorTitle="Couldn’t open comments"
                onPress={async () => {
                    if (arePostCommentsOpen) {
                        onTogglePostComments();
                        return;
                    }

                    const initialLoadMessageCount = getInitialLoadMessageCount(
                        getClientInfoWithoutListening(),
                    );

                    let areAllInitialMessagesLoaded = true;
                    for (
                        let index = 0;
                        index < Math.min(postComments.getMessageCount(), initialLoadMessageCount);
                        index++
                    ) {
                        if (!postComments.getMessage(index).isLoaded) {
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
                        postComments.getMessageCount() >= initialLoadMessageCount &&
                        areAllInitialMessagesLoaded
                    ) {
                        onTogglePostComments();
                        return;
                    }

                    const postCommentsPromise = onLoadInitialPostComments();

                    // Open post comments once we get our data back. But if the data is taking a
                    // long time to load, open post comments after 1000ms.
                    await Promise.race([postCommentsPromise, wait(uninterruptedThoughtLimitMs)]);
                    onTogglePostComments();

                    await postCommentsPromise;
                }}
            >
                <PrettyNumber number={postComments.getMessageCount()} label="comment" />
            </Button>
        </Box>
    );
}
