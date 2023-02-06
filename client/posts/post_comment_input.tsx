import {FocusEvent, Ref, useState} from "react";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {Box} from "~/client/design/box";
import {useShowToast} from "~/client/design/toast";
import {PostRealtimeActions, usePostRealtime} from "~/client/posts/use_post_realtime";
import {useSpaceContext} from "~/client/spaces/space_context";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {emptyMessageContent} from "~/shared/content/message_content_schema";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {PostModel} from "~/shared/models/post_model";
import {sprinkles} from "~/shared/styles/styles";

export function PostCommentInput({
    post,
    actionsRef,
    onFocus,
    onBlur,
}: {
    post: PostModel;
    actionsRef: Ref<PostRealtimeActions>;
    onFocus?: (event: FocusEvent<HTMLDivElement>) => void;
    onBlur?: (event: FocusEvent<HTMLDivElement>) => void;
}) {
    const showToast = useShowToast();
    const {currentAccount} = useSpaceContext();
    const [state, setState] = useState(ContentEditorState.create(emptyMessageContent));
    const [isSaving, setIsSaving] = useState(false);

    // We connect to realtime in our `<PostCommentInput>` component. When comments
    // are open this component is always rendered and we only want to connect to
    // realtime when comments are open so works out.
    const {actions} = usePostRealtime({
        postId: post.id,
        actionsRef,
    });

    return (
        <Box flexGrow="1" overflowX="hidden" display="flex">
            <AccountAvatar account={currentAccount} size="7" />
            <Box
                flexGrow="1"
                overflowX="hidden"
                marginLeft="2"
                backgroundColor="grey-bubble"
                borderRadius="xl"
            >
                <Box maxHeight="96" overflowX="hidden" overflowY="scroll">
                    <ContentEditor
                        state={state}
                        onChange={state => {
                            if (isSaving) return;
                            setState(state);
                        }}
                        onNavigate={useNavigate()}
                        aria-label="Comment"
                        placeholder="Write a comment…"
                        className={sprinkles({
                            paddingX: "0.5",
                            paddingY: "1.5",
                        })}
                        onEnter={() => {
                            if (isContentEmpty(state.getContent())) return;

                            runPromiseWithoutAwaiting(async () => {
                                setIsSaving(true);
                                try {
                                    await actions.createPostComment({
                                        parentCommentIndex: null,
                                        content: state.getContent(),
                                    });
                                    setState(ContentEditorState.create(emptyMessageContent));
                                } catch (error) {
                                    showToast({
                                        type: "Error",
                                        title: "Couldn’t create comment",
                                        error,
                                    });
                                }
                                setIsSaving(false);
                            });
                        }}
                        onFocus={onFocus}
                        onBlur={onBlur}
                    />
                </Box>
            </Box>
        </Box>
    );
}
