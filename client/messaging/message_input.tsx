import {ArrowArcLeft, ArrowUp, X} from "phosphor-react";
import {useEffect, useMemo, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {ContentView} from "~/client/content/content_view";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {IconButton} from "~/client/design/icon_button";
import {useShowToast} from "~/client/design/toast";
import {MessageList} from "~/client/messaging/message_list";
import {
    getTruncatedMessageContentForReplyPreview,
    messageBubbleMarginLeft,
    messageViewActionsWidth,
    messageViewBubbleBorderRadius,
    messageViewBubblePaddingX,
    messageViewBubblePaddingY,
    messageViewPreviewScale,
    messageViewReplyPreviewBubbleOpacity,
    messageViewReplyPreviewOpacity,
} from "~/client/messaging/message_view";
import {useSpaceContext} from "~/client/spaces/space_context";
import {isContentEmpty} from "~/shared/content/is_content_empty";
import {MessageContent} from "~/shared/content/message_content_schema";
import {RemLength, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {generateId} from "~/shared/id/id";
import {
    MessageModel,
    OptimisticMessageModel,
    emptyMessageContentWithReferences,
} from "~/shared/models/message_model";
import {contentViewStyles, sprinkles} from "~/shared/styles/styles";

export const messageInputMinHeight: RemLength = "3.5rem";

export function MessageInput<RoomKey extends string, Message extends MessageModel<RoomKey>>({
    messageNoun = "message",
    messageStartOfSentenceNoun = messageNoun.slice(0, 1).toUpperCase() + messageNoun.slice(1),
    messages,
    isMessageCreationDisabled,
    onUpdateMessages,
    createMessage,
    replyingToMessage: _replyingToMessage,
    onClearReplyingToMessage,
    onJumpToMessage,
    withoutBorderTop = false,
    "data-testid": dataTestId,
}: {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    messages: MessageList<Message>;
    isMessageCreationDisabled?: boolean;
    onUpdateMessages: (update: (messages: MessageList<Message>) => MessageList<Message>) => void;
    createMessage: (input: {
        parentMessageIndex: number | null;
        content: MessageContent;
    }) => Promise<void>;
    replyingToMessage: Message | null;
    onClearReplyingToMessage: () => void;
    onJumpToMessage: (message: Message) => void;
    withoutBorderTop?: boolean;
    "data-testid"?: string;
}) {
    const showToast = useShowToast();
    const {currentAccount} = useSpaceContext();
    const editorRef = useRef<ContentEditorRef>(null);
    const [state, setState] = useState(() =>
        ContentEditorState.create<MessageContent>(emptyMessageContentWithReferences),
    );

    const replyingToMessage = useMemo(() => {
        if (!_replyingToMessage) return null;

        return {
            message: _replyingToMessage,
            truncatedContent: getTruncatedMessageContentForReplyPreview({
                message: _replyingToMessage,
                messageStartOfSentenceNoun,
            }),
        };
    }, [_replyingToMessage, messageStartOfSentenceNoun]);

    // Focus the message input whenever the message we're replying to changes.
    const replyingToMessageIndex = replyingToMessage?.message.index ?? null;
    useEffect(() => {
        if (replyingToMessageIndex === null) return;
        const editor = assertExists(editorRef.current);
        editor.focus();
    }, [replyingToMessageIndex]);

    const submitMessage = () => {
        if (isMessageCreationDisabled) return;

        const content = state.getContent();
        if (isContentEmpty(content.doc)) return;

        const optimisticMessage: OptimisticMessageModel = {
            isOptimistic: true,
            optimisticId: generateId(),
            optimisticRequestErrorState: {hasError: false},
            author: currentAccount,
            createdTime: new Date(),
            payload: {
                type: "Content",
                parentMessageIndex: replyingToMessage?.message.index ?? null,
                content,
                contentUpdatedTime: null,
            },
        };

        onUpdateMessages(messages => messages.addOptimisticMessage(optimisticMessage));

        setState(ContentEditorState.create(emptyMessageContentWithReferences));
        onClearReplyingToMessage();

        const tryCreatingMessage = () => {
            runPromiseWithoutAwaiting(async () => {
                try {
                    await createMessage({
                        parentMessageIndex: replyingToMessage?.message.index ?? null,
                        content: content.doc,
                    });

                    // We wait to receive the new message over realtime to confirm the optimistic
                    // message. We do this so that messages are delivered to the user in order
                    // instead of confirming a message and discovering some unloaded messages.
                } catch (error) {
                    // TODO(calebmer): In the context of a channel, if you scroll away from the post
                    // which renders this input and `usePostRealtime()` unmounts this will error
                    // even if the comment is successfully created in the background. Maybe we
                    // should keep our WebSocket alive while there are unacknowledged messages for
                    // some timeout?
                    showToast({
                        type: "Error",
                        title: `Couldn’t create ${messageNoun}`,
                        error,
                    });

                    onUpdateMessages(messages =>
                        messages.updateOptimisticMessage(
                            optimisticMessage.optimisticId,
                            optimisticMessage => ({
                                ...optimisticMessage,
                                optimisticRequestErrorState: {
                                    hasError: true,
                                    retry: () => {
                                        // Clear the error when we are retrying then call this
                                        // function again.
                                        onUpdateMessages(messages =>
                                            messages.updateOptimisticMessage(
                                                optimisticMessage.optimisticId,
                                                optimisticMessage => ({
                                                    ...optimisticMessage,
                                                    optimisticRequestErrorState: {
                                                        hasError: false,
                                                    },
                                                }),
                                            ),
                                        );

                                        tryCreatingMessage();
                                    },
                                },
                            }),
                        ),
                    );
                }
            });
        };

        tryCreatingMessage();
    };

    const isSendButtonDisabled = isMessageCreationDisabled || isContentEmpty(state.getDoc());

    return (
        <Box
            data-testid={dataTestId}
            flexShrink="0"
            borderTop={!withoutBorderTop ? "grey-10" : undefined}
            style={{
                minHeight: messageInputMinHeight,
                // Remove one pixel from top to make space for a border.
                paddingTop: `calc(${spacing["3"]} - 1px)`,
                paddingBottom: spacing["3"],
            }}
        >
            {replyingToMessage &&
                (() => {
                    const height = addRemLengths(
                        spacing["1.5"],
                        contentViewStyles.truncatedHeight,
                        spacing["1.5"],
                    );

                    const scaledHeight = `${
                        Math.round(parseRemLengthNumber(height) * messageViewPreviewScale * 16) / 16
                    }rem`;

                    return (
                        <Box
                            position="relative"
                            paddingBottom="3"
                            style={{
                                paddingLeft: addRemLengths(messageBubbleMarginLeft, spacing["2"]),
                                paddingRight: addRemLengths(
                                    spacing["2"],
                                    spacing["3"],
                                    spacing[messageViewActionsWidth],
                                    spacing["3"],
                                ),
                            }}
                        >
                            <Box
                                paddingLeft="1.5"
                                paddingBottom="1"
                                display="flex"
                                alignItems="center"
                                gap="0.5"
                                fontSize="50"
                                fontStyle="truncate"
                            >
                                <ArrowArcLeft size={spacing["3"]} />
                                <span>
                                    Replying to{" "}
                                    <span className={sprinkles({fontStyle: "bold"})}>
                                        <AccountShortName
                                            account={replyingToMessage.message.author}
                                        />
                                    </span>
                                </span>
                            </Box>
                            <Box style={{height: scaledHeight}}>
                                <FocusRing>
                                    <Box
                                        // This is a simulated link. When the user clicks on it our code navigates us
                                        // to the right message instead of relying on browser URL navigation.
                                        //
                                        // See: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/link_role
                                        role="link"
                                        tabIndex={0}
                                        // We don't use a pointer cursor for buttons in our product because buttons
                                        // they clearly appear clickable. We call this a strong affordance. A reply
                                        // preview is clickable and gives some affordance (different color) but it's a
                                        // weak affordance. So we use a pointer to make this element unambiguously
                                        // clickable.
                                        //
                                        // Also, this element is semantically a link which the pointer cursor was
                                        // originally designed for.
                                        //
                                        // See: https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                                        cursor="pointer"
                                        position="relative"
                                        zIndex="0"
                                        display="inline-block"
                                        maxWidth="full"
                                        paddingX={messageViewBubblePaddingX}
                                        paddingY={messageViewBubblePaddingY}
                                        borderRadius={messageViewBubbleBorderRadius}
                                        style={{
                                            opacity: messageViewReplyPreviewOpacity,
                                            transform: `scale(${messageViewPreviewScale})`,
                                            transformOrigin: "0% 0% 0",
                                        }}
                                        onClick={() => onJumpToMessage(replyingToMessage.message)}
                                        onKeyDown={event => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                onJumpToMessage(replyingToMessage.message);
                                                return;
                                            }
                                        }}
                                    >
                                        <Box
                                            position="absolute"
                                            inset="0"
                                            zIndex="-10"
                                            borderRadius={messageViewBubbleBorderRadius}
                                            backgroundColor="grey-5"
                                            style={{opacity: messageViewReplyPreviewBubbleOpacity}}
                                        />
                                        <Box overflow="hidden" pointerEvents="none">
                                            <ContentView
                                                isInert={true}
                                                isTruncated={true}
                                                content={replyingToMessage.truncatedContent}
                                            />
                                        </Box>
                                    </Box>
                                </FocusRing>
                            </Box>
                            <Box position="absolute" top="0" right="5">
                                <IconButton
                                    size="xs"
                                    description="Cancel reply"
                                    withoutTooltip={true}
                                    onPress={onClearReplyingToMessage}
                                >
                                    <X />
                                </IconButton>
                            </Box>
                        </Box>
                    );
                })()}
            <Box overflowX="hidden" display="flex" paddingX="5">
                <Box display="flex" alignItems="flex-end">
                    <Box paddingY="0.5">
                        <AccountAvatar account={currentAccount} size="7" />
                    </Box>
                </Box>
                <FocusRing isVisibleWhenFocusWithin={true}>
                    <Box
                        flexGrow="1"
                        overflowX="hidden"
                        marginX="2"
                        backgroundColor="grey-5"
                        borderRadius={messageViewBubbleBorderRadius}
                    >
                        <Box maxHeight="96" overflowX="hidden" overflowY="scroll">
                            <ContentEditor
                                ref={editorRef}
                                state={state}
                                onChange={setState}
                                aria-label={`New ${messageNoun}`}
                                placeholder={`Write a ${messageNoun}`}
                                className={sprinkles({
                                    paddingX: messageViewBubblePaddingX,
                                    paddingY: messageViewBubblePaddingY,
                                })}
                                onEnterFromPhysicalKeyboard={submitMessage}
                            />
                        </Box>
                    </Box>
                </FocusRing>
                <Box display="flex" alignItems="flex-end">
                    <Box paddingY="0.5">
                        <IconButton
                            variant="accent"
                            description={`Send ${messageNoun}`}
                            isDisabled={isSendButtonDisabled}
                            onPress={submitMessage}
                        >
                            <ArrowUp
                                size={spacing["4"]}
                                weight={!isSendButtonDisabled ? "bold" : undefined}
                            />
                        </IconButton>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
