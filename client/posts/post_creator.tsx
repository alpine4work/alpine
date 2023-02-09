import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {useSpaceContext} from "~/client/spaces/space_context";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {emptyPostContent} from "~/shared/content/post_content_schema";
import {parseRemLengthNumber} from "~/shared/design/spacing";
import {ChannelId} from "~/shared/id/types/id_types";
import {createPost} from "~/shared/rpc/posts_rpc_definitions";
import {fontSizes, sprinkles} from "~/shared/styles/styles";

export function PostCreator({channelId}: {channelId: ChannelId}) {
    const navigate = useNavigate();
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();

    const [state, setState] = useState(() => ContentEditorState.create(emptyPostContent));

    return (
        <>
            <Box paddingTop="5" paddingX="5" display="flex" alignItems="center">
                <AccountAvatar account={currentAccount} size="8" />
                <Box flexGrow="1" paddingLeft="3" paddingRight="4" overflow="hidden">
                    <Box fontSize="100" fontStyle="truncate-semi-bold">
                        {currentAccount.name}
                    </Box>
                    <Box fontSize="75" fontStyle="truncate" color="grey-50">
                        New post
                    </Box>
                </Box>
            </Box>
            <ContentEditor
                aria-label="New post content"
                state={state}
                onChange={setState}
                onNavigate={useNavigate()}
                placeholder="Share your ideas…"
                className={sprinkles({paddingX: "3", paddingY: "5"})}
            />
            <Box
                marginX="5"
                borderTop="grey-5"
                height="12"
                display="flex"
                justifyContent="flex-end"
                alignItems="center"
            >
                <Button
                    variant="accent"
                    isDisabled={isContentEmpty(state.getContent())}
                    pressErrorTitle="Couldn’t create post"
                    onPress={async () => {
                        const {post} = await createPost(context, {
                            channelId,
                            content: state.getContent(),
                        });

                        navigate(`/s/${post.spaceId}/posts/${post.id}`);
                    }}
                >
                    Post
                </Button>
            </Box>
        </>
    );
}
