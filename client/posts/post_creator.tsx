import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {emptyPostContent} from "~/shared/content/post_content_schema";
import {parseRemLengthNumber} from "~/shared/design/spacing";
import {ChannelId} from "~/shared/id/types/id_types";
import {createPost} from "~/shared/rpc/posts_rpc_definitions";
import {fontSizes, sprinkles} from "~/shared/styles/styles";

export function PostCreator({channelId}: {channelId: ChannelId}) {
    const context = useAppContext();
    const navigate = useNavigate();

    const [state, setState] = useState(() => ContentEditorState.create(emptyPostContent));

    return (
        <Box>
            <Box
                backgroundColor={{light: "grey-0", dark: "grey-5"}}
                borderRadius="md"
                boxShadow="elevation-5"
            >
                <Box paddingTop="6" paddingX="6" display="flex">
                    <Box
                        flexShrink="0"
                        backgroundColor="grey-30-const"
                        borderRadius="full"
                        style={{
                            width: `${parseRemLengthNumber(fontSizes["100"].lineHeight) * 2}rem`,
                            height: `${parseRemLengthNumber(fontSizes["100"].lineHeight) * 2}rem`,
                        }}
                    />
                    <Box flexGrow="1" paddingLeft="3" paddingRight="4" overflow="hidden">
                        <Box fontSize="100" fontStyle="truncate-semi-bold">
                            Caleb Meredith
                        </Box>
                        <Box fontSize="100" fontStyle="truncate" color="grey-50">
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
                    className={sprinkles({paddingX: "2", paddingY: "6"})}
                />
                <Box paddingX="6" paddingBottom="4">
                    <Box borderTop={{light: "grey-5", dark: "grey-10"}} />
                    <Box paddingTop="4" display="flex" justifyContent="flex-end">
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
                            Create
                        </Button>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
