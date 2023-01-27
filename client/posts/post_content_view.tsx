import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile";
import {ContentView} from "~/client/content/content_view";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date";
import {pluralizeEnglish} from "~/shared/helpers/string/pluralize_english";
import {PostModel} from "~/shared/models/post_model";
import {getPostCommentAuthors} from "~/shared/rpc/posts_rpc_definitions";
import {truncateClassName} from "~/shared/styles/styles";

export const postContentViewMinHeight = "7.75rem";

export function PostContentView({post}: {post: PostModel}) {
    const context = useAppContext();

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
            <Box>
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
                {pluralizeEnglish(post.commentCount, "reply", "replies")}
            </Box>
        </Box>
    );
}
