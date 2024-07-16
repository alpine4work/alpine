import {setInteractionModality} from "@react-aria/interactions";
import {
    Memo,
    MutableRefObject,
    ReactElement,
    Ref,
    RefAttributes,
    forwardRef,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {MessageInputBase, MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {trimContentWithReferencesEnd} from "~/client/content/trim_content_end.js";
import {useReporter} from "~/client/design/reporter.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useInboxContext} from "~/client/inbox/inbox_context.js";
import {MessageDeleteConfirmationDialog} from "~/client/messaging/internal/message_delete_confirmation_dialog.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {Spacing, screenPaddingX} from "~/shared/design/spacing.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {
    MessageContent,
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";

export type MessageInputProps<RoomKey extends string, Message extends MessageModel<RoomKey>> = {
    withMobileLayout: boolean;
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    placeholder?: string;
    isNotBottomBar?: boolean;
    messages: MessageList<Message>;
    isMessageCreationDisabled?: boolean;
    onUpdateMessages: (update: (messages: MessageList<Message>) => MessageList<Message>) => void;
    createMessage: (input: {
        parentMessageIndex: number | null;
        content: MessageContent;
    }) => Promise<void>;
    messageEditing: MessageEditing<RoomKey>;
    replyingToMessage: Message | null;
    onClearReplyingToMessage: () => void;
    onJumpToMessage: (message: Message) => void;
    onDeleteMessage: (messageIndex: number) => Promise<void>;
    onShowTypingIndicator: () => void;
    onHideTypingIndicator: () => void;
    "data-testid"?: string;
    restoreStateRef?: MutableRefObject<{
        state: ContentEditorState<MessageContentWithReferences>;
        isFocused: boolean;
    } | null>;
    paddingX?: Spacing | Memo<{mobile: Spacing; desktop: Spacing}>;
    withMobileMaxHeight?: boolean;
    onFocus?: () => void;
    onBlur?: () => void;
    onBeforeFocusFromReplyOrEditingChange?: () => {preventDefault: boolean} | void;
};

const MessageInputForwardRef = forwardRef(MessageInput) as <
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>(
    props: MessageInputProps<RoomKey, Message> & RefAttributes<MessageInputRef>,
) => ReactElement;
export {MessageInputForwardRef as MessageInput};

function MessageInput<RoomKey extends string, Message extends MessageModel<RoomKey>>(
    {
        withMobileLayout,
        messageNoun = "message",
        messageStartOfSentenceNoun,
        placeholder,
        isNotBottomBar = false,
        messages,
        isMessageCreationDisabled,
        onUpdateMessages,
        createMessage,
        messageEditing,
        replyingToMessage,
        onClearReplyingToMessage,
        onJumpToMessage,
        onDeleteMessage,
        onShowTypingIndicator,
        onHideTypingIndicator,
        "data-testid": dataTestId,
        restoreStateRef,
        paddingX = screenPaddingX,
        withMobileMaxHeight,
        onFocus,
        onBlur,
        onBeforeFocusFromReplyOrEditingChange,
    }: MessageInputProps<RoomKey, Message>,
    externalRef: Ref<MessageInputRef>,
) {
    const isMobile = useIsMobile();
    const reporter = useReporter();
    const {currentAccount} = useSpaceContext();
    const inboxPeekContext = useInboxContext();

    const inputRef = useRef<MessageInputRef>(null);

    // If we're on a mobile device then message editing will happen inside this
    // message input component instead of inline within `<MessageView>`.
    const messageEditingForThisInput =
        isMobile && messageEditing.state.isEditing
            ? (messageEditing as MessageEditing<RoomKey> & {state: {isEditing: true}})
            : null;

    const [newMessageState, _setNewMessageState] = useState(
        () =>
            restoreStateRef?.current?.state ??
            ContentEditorState.create(emptyMessageContentWithReferences),
    );
    const setNewMessageState = useCallback(
        (newMessageState: ContentEditorState<MessageContentWithReferences>) => {
            if (restoreStateRef) {
                restoreStateRef.current = {
                    state: newMessageState,
                    isFocused: inputRef.current?.isFocused() ?? false,
                };
            }

            _setNewMessageState(newMessageState);
        },
        [restoreStateRef],
    );

    // If we're editing a message then clear any new message text so when we finish
    // editing the input is empty. Also clear reply state but we need to do that in
    // an effect since the state isn't local.
    if (messageEditingForThisInput && !isContentEmpty(newMessageState.getDoc())) {
        setNewMessageState(ContentEditorState.create(emptyMessageContentWithReferences));
    }
    useEffect(() => {
        if (messageEditingForThisInput && replyingToMessage) {
            onClearReplyingToMessage();
        }
    });

    const hasInitiallyMountedNewMessageRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        // If we're editing a message then don't mess with state restoration ref.
        if (messageEditingForThisInput) return;

        const isInitialMount = !hasInitiallyMountedNewMessageRef.current;
        hasInitiallyMountedNewMessageRef.current = true;

        if (!restoreStateRef) return;

        const input = assertExists(inputRef.current);

        // If we are restoring a message input that was focused then refocus it.
        if (isInitialMount && restoreStateRef.current?.isFocused) {
            input.focus({preventScroll: true});
        }
    }, [messageEditingForThisInput, restoreStateRef]);

    const sendNewMessage = () => {
        if (isMessageCreationDisabled) return;
        if (messageEditingForThisInput) return;

        const content = trimContentWithReferencesEnd(newMessageState.getContent());
        if (isContentEmpty(content.doc)) return;

        const optimisticMessage: OptimisticMessageModel = {
            isOptimistic: true,
            optimisticId: generateId(),
            optimisticRequestErrorState: {hasError: false},
            author: currentAccount,
            createdTime: new Date(),
            payload: {
                type: "Content",
                parentMessageIndex: replyingToMessage?.index ?? null,
                content,
                contentUpdatedTime: null,
            },
        };

        onUpdateMessages(messages => messages.addOptimisticMessage(optimisticMessage));

        setNewMessageState(ContentEditorState.create(emptyMessageContentWithReferences));
        onClearReplyingToMessage();

        const tryCreatingMessage = () => {
            runPromiseWithoutAwaiting(async () => {
                try {
                    // TODO(calebmer, #unsaved-changes-confirmation): User should not be able to
                    // close the page if we haven't finished sending their message. It will
                    // look ok on their machine but might not be on the server.
                    const promise = createMessage({
                        parentMessageIndex: replyingToMessage?.index ?? null,
                        content: content.doc,
                    });

                    // Sending a message dismisses post comment entries and chat entries.
                    // Optimistically archive these entries so we don't need to wait for
                    // realtime. The latency of which may be long since notification events are
                    // processed by a queue.
                    inboxPeekContext?.onCreateMessageOptimistically(promise);

                    await promise;

                    // We wait to receive the new message over realtime to confirm the optimistic
                    // message. We do this so that messages are delivered to the user in order
                    // instead of confirming a message and discovering some unloaded messages.
                } catch (error) {
                    reporter.displayError(`Couldn’t create ${messageNoun}`, error);

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

    return (
        <>
            <MessageInputBase
                ref={useMergedRefs(inputRef, externalRef)}
                withMobileLayout={withMobileLayout}
                messageNoun={messageNoun}
                messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                placeholder={placeholder}
                state={
                    !messageEditingForThisInput
                        ? newMessageState
                        : messageEditingForThisInput.state.contentEditorState
                }
                onChange={
                    !messageEditingForThisInput
                        ? setNewMessageState
                        : state => {
                              messageEditingForThisInput.dispatch({
                                  type: "ContentEditorStateChange",
                                  contentEditorState: state,
                              });
                          }
                }
                onSend={
                    !messageEditingForThisInput
                        ? sendNewMessage
                        : () => {
                              messageEditing.dispatch({type: "SaveEditedContent"});
                          }
                }
                isSendButtonDisabled={
                    isMessageCreationDisabled ||
                    (!!messageEditingForThisInput &&
                        messageEditingForThisInput.state.contentEditorState.getDoc() ===
                            messageEditingForThisInput.state.initialContent)
                }
                isSendButtonPending={messageEditingForThisInput?.state.isSaving}
                messageEditingForThisInput={messageEditingForThisInput}
                replyingToMessage={replyingToMessage}
                onClearReplyingToMessage={onClearReplyingToMessage}
                onJumpToMessage={onJumpToMessage}
                onShowTypingIndicator={onShowTypingIndicator}
                onHideTypingIndicator={onHideTypingIndicator}
                isBottomBar={!isNotBottomBar}
                data-testid={dataTestId}
                paddingX={paddingX}
                withMobileMaxHeight={withMobileMaxHeight}
                onFocus={() => {
                    if (restoreStateRef?.current) restoreStateRef.current.isFocused = true;
                    onFocus?.();
                }}
                onBlur={() => {
                    if (restoreStateRef?.current) restoreStateRef.current.isFocused = false;
                    onBlur?.();
                }}
                onBeforeFocusFromReplyOrEditingChange={onBeforeFocusFromReplyOrEditingChange}
                onArrowUp={event => {
                    if (messageEditingForThisInput) return;

                    if (isContentEmpty(newMessageState.getDoc())) {
                        event.preventDefault();
                        event.stopPropagation();

                        // Look at the last 10 messages. Start editing state for the last one our
                        // account authored.
                        for (const message of sliceIterable(
                            messages.iterateLoadedMessagesFromEnd(),
                            0,
                            10,
                        )) {
                            if (
                                message.author.id === currentAccount.id &&
                                message.payload.type === "Content"
                            ) {
                                const maintainedInteractionModality = assertExists(
                                    inputRef.current,
                                ).getMaintainedInteractionModality();

                                messageEditing.dispatch({
                                    type: "StartEditing",
                                    messageRoomKey: message.getRoomKey(),
                                    messageIndex: message.index,
                                    messagePayload: message.payload,
                                    isMobile,
                                    returnFocusAfterEditing: () => {
                                        // Reset the interaction modality when returning focus to our editor. So if the
                                        // user pressed enter to save that doesn't give us a keyboard modality if the
                                        // user wasn't using keyboard navigation before.
                                        if (maintainedInteractionModality !== null) {
                                            setInteractionModality(maintainedInteractionModality);
                                        }

                                        inputRef.current?.focus();
                                    },
                                });
                                break;
                            }
                        }
                    }
                }}
            />
            {messageEditingForThisInput?.state.isEditing &&
                messageEditingForThisInput.state.confirmationDialog === "Delete" && (
                    <MessageDeleteConfirmationDialog
                        messageNoun={messageNoun}
                        onClose={() =>
                            messageEditingForThisInput.dispatch({
                                type: "CloseConfirmingDialog",
                                confirmationDialog: "Delete",
                            })
                        }
                        onDeleteMessage={async () => {
                            await onDeleteMessage(messageEditingForThisInput.state.messageIndex);

                            messageEditingForThisInput.dispatch({
                                type: "CancelEditing",
                            });
                        }}
                    />
                )}
        </>
    );
}
