import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {ContentView} from "~/client/content/content_view";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {emptyPostContent} from "~/shared/content/post_content_schema";
import {ChannelId} from "~/shared/id/types/id_types";
import {createPost} from "~/shared/rpc/posts_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

export function PostCreator({channelId}: {channelId: ChannelId}) {
    const navigate = useNavigate();
    const context = useAppContext();

    const [containerRef, containerSize] = useResizeObserver();
    const [inlineButtonRef, inlineButtonSize] = useResizeObserver();
    const [phantomContentRef, phantomContentSize] = useResizeObserver();
    const [state, setState] = useState(() => ContentEditorState.create(emptyPostContent));

    const content = state.getContent();
    const isContentSingleParagraph =
        content.childCount === 1 && content.child(0).type.name === "paragraph";

    const isPostButtonInline =
        isContentSingleParagraph &&
        (containerSize === null ||
            inlineButtonSize === null ||
            phantomContentSize === null ||
            phantomContentSize.width < containerSize.width - inlineButtonSize.width);

    const postButton = (
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
    );

    return (
        <>
            <Box
                ref={containerRef}
                position="relative"
                display="flex"
                alignItems="center"
                overflowX="hidden"
            >
                <ContentEditor
                    aria-label="New post content"
                    state={state}
                    onChange={state => {
                        // Run with immediate priority so `isPostButtonInline` is updated in the
                        // same paint.
                        runWithImmediatePriority(() => {
                            setState(state);
                        });
                    }}
                    onNavigate={navigate}
                    placeholder="Share your ideas…"
                    containerClassName={sprinkles({flexGrow: "1", overflowX: "hidden"})}
                    className={sprinkles({paddingX: "3", paddingY: "4"})}
                />
                {isContentSingleParagraph && (
                    <Box
                        ref={phantomContentRef}
                        position="absolute"
                        top="0"
                        left="0"
                        maxWidth="full"
                        overflowX="hidden"
                        display="inline-block"
                        aria-hidden="true"
                        style={{opacity: 0, pointerEvents: "none"}}
                    >
                        <ContentView
                            content={content}
                            onNavigate={navigate}
                            className={sprinkles({paddingX: "3", paddingY: "4"})}
                        />
                    </Box>
                )}
                {isPostButtonInline && (
                    <Box ref={inlineButtonRef} flexShrink="0" paddingX="3">
                        {postButton}
                    </Box>
                )}
            </Box>
            {!isPostButtonInline && (
                <Box
                    marginX="5"
                    borderTop="grey-5"
                    height="12"
                    display="flex"
                    justifyContent="flex-end"
                    alignItems="center"
                >
                    {postButton}
                </Box>
            )}
        </>
    );
}
