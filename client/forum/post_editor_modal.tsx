import {useEffect, useId, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {Modal} from "~/client/design/modal.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useShowToast} from "~/client/design/toast.js";
import {PostContentViewHeader} from "~/client/forum/post_content_view_header.js";
import {postViewMaxWidth} from "~/client/forum/post_list_view.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {PostContentWithReferences} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {updatePostContent} from "~/shared/rpc/forum_rpc_definitions.js";
import {sprinkles} from "~/shared/styles/styles.js";

export function PostEditorModal({
    post,
    onUpdatePost,
    onClose,
}: {
    post: PostModel;
    onUpdatePost: (update: (post: PostModel) => PostModel) => void;
    onClose: () => void;
}) {
    const context = useAppContext();
    const showToast = useShowToast();
    const editorRef = useRef<ContentEditorRef>(null);
    const [{state, hasContentChanged}, setState] = useState<{
        state: ContentEditorState<PostContentWithReferences>;
        hasContentChanged: boolean;
    }>(() => ({
        state: ContentEditorState.create(post.content, {selectionAt: "end"}),
        hasContentChanged: false,
    }));
    const [isPending, setIsPending] = useState(false);
    const [shouldConfirmClose, setShouldConfirmClose] = useState(false);

    const errorTitle = "Couldn’t save post";

    useEffect(() => {
        const editor = assertExists(editorRef.current);
        editor.focus();
    }, []);

    const handleUpdatePost = async () => {
        // If we are already pending, don't try to submit again...
        if (isPending) return;

        setIsPending(true);
        try {
            const content = state.getContent();

            const {contentUpdatedTime} = await updatePostContent(context, {
                postId: post.id,
                content: content.doc,
            });

            onUpdatePost(post => post.clone({content, contentUpdatedTime}));
            onClose();
        } catch (error) {
            showToast({
                type: "Error",
                title: errorTitle,
                error,
            });
        } finally {
            setIsPending(false);
        }
    };

    const titleId = useId();

    return (
        <>
            <Modal
                aria-labelledby={titleId}
                withoutCloseAnimation={hasContentChanged}
                onClose={() => {
                    if (hasContentChanged) {
                        setShouldConfirmClose(true);
                    } else {
                        onClose();
                    }
                }}
                maxWidth={`${
                    // Make post editor slimmer than a post so if we render it on top of a post it
                    // doesn't line up precisely.
                    parseRemLengthNumber(spacing[postViewMaxWidth]) -
                    parseRemLengthNumber(spacing["3"]) * 2
                }rem`}
            >
                <Box
                    display="flex"
                    flexDirection="column"
                    width="full"
                    maxHeight="full"
                    overflow="hidden"
                >
                    <Box flexShrink="0" paddingX="5" paddingTop="5" borderBottom="grey-5">
                        <h2
                            id={titleId}
                            className={sprinkles({
                                fontStyle: "semi-bold",
                                fontSize: "200",
                                paddingBottom: "2",
                                // Make sure our heading doesn't collide with the close button.
                                paddingRight: "6",
                            })}
                        >
                            Edit post
                        </h2>
                    </Box>
                    <Box ref={useScrollbar()} flexGrow="1" overflowY="auto" position="relative">
                        <Box>
                            <Box paddingTop="5" paddingX="5">
                                <PostContentViewHeader post={post} shouldShowChannel={true} />
                            </Box>
                            <ContentEditor
                                ref={editorRef}
                                aria-label="Post"
                                state={state}
                                placeholder="Share your ideas…"
                                className={sprinkles({paddingX: "3", paddingY: "4"})}
                                onChange={(state, transaction) => {
                                    // Don't change content while we are pending...
                                    if (transaction.docChanged && isPending) return;

                                    setState(({state: oldState, hasContentChanged}) => ({
                                        state,
                                        hasContentChanged:
                                            hasContentChanged || transaction.docChanged,
                                    }));
                                }}
                                onModEnter={event => {
                                    event.preventDefault();
                                    event.stopPropagation();

                                    runPromiseWithoutAwaiting(async () => {
                                        try {
                                            await handleUpdatePost();
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
                        </Box>
                    </Box>
                    <Box flexShrink="0" borderTop="grey-5">
                        <Box
                            marginX="5"
                            height="12"
                            display="flex"
                            justifyContent="flex-end"
                            alignItems="center"
                        >
                            <Button
                                variant="accent"
                                isDisabled={isContentEmpty(state.getDoc())}
                                isPending={isPending}
                                pressErrorTitle={errorTitle}
                                onPress={handleUpdatePost}
                            >
                                Save
                            </Button>
                        </Box>
                    </Box>
                </Box>
            </Modal>
            {shouldConfirmClose && (
                <ModalDialog
                    title="Discard changes?"
                    description="Changes you made to the post will not be saved."
                    onClose={() => setShouldConfirmClose(false)}
                    primaryButtonLabel="Discard"
                    onPrimaryButtonPress={onClose}
                    cancelButtonLabel="Keep editing"
                />
            )}
        </>
    );
}
