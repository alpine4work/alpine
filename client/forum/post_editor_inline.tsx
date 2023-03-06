import {useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {ContentView} from "~/client/content/content_view";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {FocusRing} from "~/client/design/focus_ring";
import {useShowToast} from "~/client/design/toast";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {useResizeObserver} from "~/client/helpers/use_resize_observer";
import {useSpaceContext} from "~/client/spaces/space_context";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {PostContent} from "~/shared/content/post_content_schema";
import {RemLength} from "~/shared/design/spacing";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {ChannelId} from "~/shared/id/types/id_types";
import {PostModel, emptyPostContentWithReferences} from "~/shared/models/post_model";
import {createPost} from "~/shared/rpc/forum_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

export const postEditorInlineMinHeight: RemLength = "3.25rem";

export function PostEditorInline({
    channelId,
    onCreatePost,
    parentHasMargin,
}: {
    channelId: ChannelId;
    onCreatePost: (post: PostModel) => void;
    parentHasMargin: boolean;
}) {
    const showToast = useShowToast();
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();

    const [containerRef, containerSize] = useResizeObserver();
    const [inlineButtonRef, inlineButtonSize] = useResizeObserver();
    const [phantomContentRef, phantomContentSize] = useResizeObserver();
    const editorRef = useRef<ContentEditorRef>(null);
    const [state, setState] = useState(() =>
        ContentEditorState.create<PostContent>(emptyPostContentWithReferences),
    );
    const [isPending, setIsPending] = useState(false);

    const content = state.getContent();
    const isContentSingleParagraph =
        content.doc.childCount === 1 && content.doc.child(0).type.name === "paragraph";

    const isPostButtonInline =
        isContentSingleParagraph &&
        (containerSize === null ||
            inlineButtonSize === null ||
            phantomContentSize === null ||
            phantomContentSize.width < containerSize.width - inlineButtonSize.width);

    const errorTitle = "Couldn’t create post";

    const handleCreatePost = async () => {
        const content = state.getContent();

        // If we are already pending, don't try to submit again...
        if (isPending) return;

        setIsPending(true);
        try {
            const editor = assertExists(editorRef.current);

            const {post} = await createPost(context, {
                channelId,
                content: content.doc,
            });

            setState(ContentEditorState.create(emptyPostContentWithReferences));

            onCreatePost(
                new PostModel({
                    id: post.id,
                    spaceId: post.spaceId,
                    channelId,
                    createdTime: post.createdTime,
                    author: currentAccount,
                    content,
                    contentUpdatedTime: null,
                    commentCount: 0,
                    lastCommentChangeTime: null,
                    commentAuthorCount: 0,
                    previewCommentAuthors: [],
                }),
            );

            editor.blur();
        } finally {
            setIsPending(false);
        }
    };

    const postButton = (
        <Button
            // Use an accent color even when this button is disabled because of no content.
            // We want to draw the user's attention to the post editor to encourage them
            // to post.
            variant="accent-even-when-disabled"
            isDisabled={isContentEmpty(state.getDoc())}
            isPending={isPending}
            pressErrorTitle={errorTitle}
            onPress={handleCreatePost}
        >
            Post
        </Button>
    );

    return (
        <FocusRing isVisibleWhenFocusWithin={true}>
            <Box
                backgroundColor="grey-0"
                borderRadius={parentHasMargin ? "md" : undefined}
                boxShadow="elevation-5"
                style={{minHeight: postEditorInlineMinHeight}}
            >
                <Box
                    ref={containerRef}
                    position="relative"
                    display="flex"
                    alignItems="center"
                    overflowX="hidden"
                >
                    <ContentEditor
                        ref={editorRef}
                        aria-label="New post"
                        state={state}
                        placeholder="Share your ideas…"
                        containerClassName={sprinkles({flexGrow: "1", overflowX: "hidden"})}
                        className={sprinkles({paddingX: "3", paddingY: "4"})}
                        onChange={(state, transaction) => {
                            // Don't change content while we are pending...
                            if (transaction.docChanged && isPending) return;

                            // Run with immediate priority so `isPostButtonInline` is updated in the
                            // same paint.
                            runWithImmediatePriority(() => {
                                setState(state);
                            });
                        }}
                        onModEnter={() => {
                            runPromiseWithoutAwaiting(async () => {
                                try {
                                    await handleCreatePost();
                                } catch (error) {
                                    showToast({
                                        type: "Error",
                                        title: errorTitle,
                                        error,
                                    });
                                }
                            });
                        }}
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
            </Box>
        </FocusRing>
    );
}
