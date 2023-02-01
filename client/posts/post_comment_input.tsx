import {useState} from "react";
import {useNavigate} from "react-router-dom";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {emptyMessageContent} from "~/shared/content/message_content_schema";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {PostModel} from "~/shared/models/post_model";
import {createPostComment} from "~/shared/rpc/posts_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

export function PostCommentInput({post}: {post: PostModel}) {
    const context = useAppContext();
    const [state, setState] = useState(ContentEditorState.create(emptyMessageContent));
    const [isSaving, setIsSaving] = useState(false);

    return (
        <Box flexGrow="1" display="flex">
            <Box marginY="1">
                <Box
                    flexShrink="0"
                    width="8"
                    height="8"
                    backgroundColor="grey-40-const"
                    borderRadius="full"
                />
            </Box>
            <Box flexGrow="1" marginLeft="2" backgroundColor="grey-5" borderRadius="2xl">
                <ContentEditor
                    state={state}
                    onChange={state => {
                        if (!isSaving) {
                            setState(state);
                        }
                    }}
                    onNavigate={useNavigate()}
                    aria-label="Comment"
                    placeholder="Write a comment…"
                    className={sprinkles({paddingY: "2", paddingX: "1.5"})}
                    onEnter={() => {
                        if (isContentEmpty(state.getContent())) return;

                        runPromiseWithoutAwaiting(async () => {
                            setIsSaving(true);
                            try {
                                await createPostComment(context, {
                                    postId: post.id,
                                    parentCommentId: null,
                                    content: state.getContent(),
                                });
                                setState(ContentEditorState.create(emptyMessageContent));
                            } catch (error) {
                                // TODO(calebmer): This shows nothing to the user?
                                context.tracer
                                    .getRoot()
                                    .logUncaughtException("Could not create post comment", error);
                            }
                            setIsSaving(false);
                        });
                    }}
                />
            </Box>
        </Box>
    );
}
