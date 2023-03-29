import {useEffect, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {Modal} from "~/client/design/modal";
import {ModalDialog} from "~/client/design/modal_dialog";
import {useShowToast} from "~/client/design/toast";
import {PostContentViewHeader} from "~/client/forum/post_content_view_header";
import {postViewMaxWidth} from "~/client/forum/post_list_view";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {PostContentWithReferences, PostModel} from "~/shared/models/post_model";
import {updatePostContent} from "~/shared/rpc/forum_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

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

    return (
        <>
            <Modal
                title="Edit post"
                disableCloseAnimation={hasContentChanged}
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
                footer={
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
                }
            >
                <Box paddingTop="5" paddingX="5">
                    <PostContentViewHeader post={post} />
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
                            hasContentChanged: hasContentChanged || transaction.docChanged,
                        }));
                    }}
                    onModEnter={event => {
                        event.preventDefault();

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
