import {Ref, useState} from "react";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {ContentEditor} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {Box} from "~/client/design/box";
import {useShowToast} from "~/client/design/toast";
import {PostRealtimeActions, usePostRealtime} from "~/client/forum/use_post_realtime";
import {MessageList} from "~/client/messaging/message_list";
import {useSpaceContext} from "~/client/spaces/space_context";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {emptyMessageContent} from "~/shared/content/message_content_schema";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {generateId} from "~/shared/id/id";
import {OptimisticMessageInterface} from "~/shared/models/message_interface";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {sprinkles} from "~/shared/styles/styles";

export function PostCommentInput({
    post,
    actionsRef,
    postComments,
    onUpdatePostComments,
}: {
    post: PostModel;
    actionsRef: Ref<PostRealtimeActions>;
    postComments: MessageList<PostCommentModel>;
    onUpdatePostComments: (
        update: (postComments: MessageList<PostCommentModel>) => MessageList<PostCommentModel>,
    ) => void;
}) {
    const showToast = useShowToast();
    const {currentAccount} = useSpaceContext();
    const [state, setState] = useState(ContentEditorState.create(emptyMessageContent));

    // We connect to realtime in our `<PostCommentInput>` component. When comments
    // are open this component is always rendered and we only want to connect to
    // realtime when comments are open so works out.
    const {actions} = usePostRealtime({
        postId: post.id,
        actionsRef,
        postComments,
        onUpdatePostComments,
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
                        onChange={setState}
                        onNavigate={useNavigate()}
                        aria-label="Comment"
                        placeholder="Write a comment…"
                        className={sprinkles({
                            paddingX: "0.5",
                            paddingY: "1.5",
                        })}
                        onEnter={() => {
                            const content = state.getContent();
                            if (isContentEmpty(content)) return;

                            const optimisticComment: OptimisticMessageInterface = {
                                isOptimistic: true,
                                optimisticId: generateId(),
                                optimisticRequestErrorState: {hasError: false},
                                author: currentAccount,
                                createdTime: new Date(),
                                payload: {
                                    type: "Content",
                                    parentMessageIndex: null,
                                    content,
                                    contentUpdatedTime: null,
                                },
                                getRoomKey: () => post.id,
                            };

                            onUpdatePostComments(postComments =>
                                postComments.addOptimisticMessage(optimisticComment),
                            );

                            setState(ContentEditorState.create(emptyMessageContent));

                            const createPostComment = () => {
                                runPromiseWithoutAwaiting(async () => {
                                    try {
                                        await actions.createPostComment({
                                            parentCommentIndex: null,
                                            content,
                                        });
                                    } catch (error) {
                                        showToast({
                                            type: "Error",
                                            title: "Couldn’t create comment",
                                            error,
                                        });

                                        onUpdatePostComments(postComments =>
                                            postComments.updateOptimisticMessage(
                                                optimisticComment.optimisticId,
                                                optimisticMessage => ({
                                                    ...optimisticMessage,
                                                    optimisticRequestErrorState: {
                                                        hasError: true,
                                                        retry: () => {
                                                            // Clear the error when we are retrying then call this
                                                            // function again.
                                                            onUpdatePostComments(postComments =>
                                                                postComments.updateOptimisticMessage(
                                                                    optimisticComment.optimisticId,
                                                                    optimisticMessage => ({
                                                                        ...optimisticMessage,
                                                                        optimisticRequestErrorState:
                                                                            {
                                                                                hasError: false,
                                                                            },
                                                                    }),
                                                                ),
                                                            );

                                                            createPostComment();
                                                        },
                                                    },
                                                }),
                                            ),
                                        );
                                    }
                                });
                            };

                            createPostComment();
                        }}
                    />
                </Box>
            </Box>
        </Box>
    );
}
