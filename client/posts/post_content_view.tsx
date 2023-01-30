import {CaretDown, CaretRight} from "phosphor-react";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile";
import {ContentView} from "~/client/content/content_view";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date";
import {PrettyNumber} from "~/client/design/pretty_number";
import {spacing} from "~/shared/design/spacing";
import {PostModel} from "~/shared/models/post_model";
import {getPostCommentAuthors} from "~/shared/rpc/posts_rpc_definitions";
import {truncateClassName} from "~/shared/styles/styles";

export const postContentViewMinHeight = "7.75rem";

export function PostContentView({
    post,
    arePostCommentsOpen,
    onTogglePostComments,
}: {
    post: PostModel;
    arePostCommentsOpen: boolean;
    onTogglePostComments: () => void;
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
                borderBottom={arePostCommentsOpen ? "grey-5" : "transparent"}
                height="12"
                display="flex"
                alignItems="center"
            >
                <Box flexGrow="1" />
                <PostCommentsToggleButton
                    post={post}
                    arePostCommentsOpen={arePostCommentsOpen}
                    onTogglePostComments={onTogglePostComments}
                />
            </Box>
        </Box>
    );
}

function PostCommentsToggleButton({
    post,
    arePostCommentsOpen,
    onTogglePostComments,
}: {
    post: PostModel;
    arePostCommentsOpen: boolean;
    onTogglePostComments: () => void;
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
                    arePostCommentsOpen ? (
                        <CaretDown size={spacing["3"]} />
                    ) : (
                        <CaretRight size={spacing["3"]} />
                    )
                }
                iconPlacement="end"
                onPress={onTogglePostComments}
            >
                <PrettyNumber number={post.commentCount} label="comment" />
            </Button>
        </Box>
    );
}
