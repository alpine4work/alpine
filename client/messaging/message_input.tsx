import {Modality} from "@react-aria/interactions";
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
import {flushSync} from "react-dom";
import {useFileRegistry} from "~/client/content/file_registry_context.js";
import {MessageInputFile} from "~/client/content/messaging/add_message_input_files.js";
import {MessageInputBase, MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useReporter} from "~/client/design/reporter.js";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useInboxContext} from "~/client/inbox/inbox_context.js";
import {MessageDeleteConfirmationDialog} from "~/client/messaging/internal/message_delete_confirmation_dialog.js";
import {MessageEditing} from "~/client/messaging/message_editing.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {trimContentWithReferencesEnd} from "~/shared/content/trim_content.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileModel} from "~/shared/files/file_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {Id, generateId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {
    attachFileAsUploader,
    attachFileFromAttachment,
} from "~/shared/rpc/files_rpc_definitions.js";

export type MessageInputProps<RoomKey extends string, Message extends MessageModel<RoomKey>> = {
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
        fileIds: ReadonlyArray<FileId | FileEntityId>;
    }) => Promise<void>;
    fileAttachmentTarget: Memo<FileAttachmentTarget> | null;
    withAttachFileBeforeCreateMessage?: boolean;
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
        files: ReadonlyArray<MessageInputFile>;
        isFocused: boolean;
    } | null>;
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
        messageNoun = "message",
        messageStartOfSentenceNoun,
        placeholder,
        isNotBottomBar = false,
        messages,
        isMessageCreationDisabled,
        onUpdateMessages,
        createMessage,
        fileAttachmentTarget,
        withAttachFileBeforeCreateMessage = false,
        messageEditing,
        replyingToMessage,
        onClearReplyingToMessage,
        onJumpToMessage,
        onDeleteMessage,
        onShowTypingIndicator,
        onHideTypingIndicator,
        "data-testid": dataTestId,
        restoreStateRef,
        withMobileMaxHeight,
        onFocus,
        onBlur,
        onBeforeFocusFromReplyOrEditingChange,
    }: MessageInputProps<RoomKey, Message>,
    externalRef: Ref<MessageInputRef>,
) {
    const context = useAppContext();
    const platform = usePlatform();
    const reporter = useReporter();
    const {currentAccount, space} = useSpaceContext();
    const inboxPeekContext = useInboxContext();
    const fileRegistry = useFileRegistry();

    const inputRef = useRef<MessageInputRef>(null);

    // If we're on a mobile device then message editing will happen inside this
    // message input component instead of inline within `<MessageView>`.
    const messageEditingForThisInput =
        platform === "mobile" && messageEditing.state.isEditing
            ? (messageEditing as MessageEditing<RoomKey> & {state: {isEditing: true}})
            : null;

    const [{key: inputKey, state: inputState, files: inputFiles}, actuallySetInputState] =
        useState<{
            key: Id;
            state: ContentEditorState<MessageContentWithReferences>;
            files: ReadonlyArray<MessageInputFile>;
        }>(() => ({
            key: generateId(),
            state:
                restoreStateRef?.current?.state ??
                ContentEditorState.create(emptyMessageContentWithReferences),
            files: restoreStateRef?.current?.files ?? emptyArray,
        }));

    const setInputState = useCallback(
        (newInputState: ContentEditorState<MessageContentWithReferences>) => {
            actuallySetInputState(oldState => ({
                key: oldState.key,
                state: newInputState,
                files: oldState.files,
            }));
        },
        [],
    );

    const resetInputState = useCallback(() => {
        actuallySetInputState({
            key: generateId(),
            state: ContentEditorState.create(emptyMessageContentWithReferences),
            files: emptyArray,
        });
    }, []);

    const addInputFile = useCallback((file: MessageInputFile) => {
        actuallySetInputState(oldState => ({
            key: oldState.key,
            state: oldState.state,
            files: [...oldState.files, file],
        }));
    }, []);

    const removeInputFile = useCallback((fileKey: Id) => {
        actuallySetInputState(oldState => ({
            key: oldState.key,
            state: oldState.state,
            files: oldState.files.filter(file => file.key !== fileKey),
        }));
    }, []);

    useEffect(() => {
        if (restoreStateRef) {
            // eslint-disable-next-line react-compiler/react-compiler
            restoreStateRef.current = {
                state: inputState,
                files: inputFiles,
                isFocused: inputRef.current?.isFocused() ?? false,
            };
        }
    }, [inputFiles, inputState, restoreStateRef]);

    // If we're editing a message then clear any new message text so when we finish
    // editing the input is empty. Also clear reply state but we need to do that in
    // an effect since the state isn't local.
    if (messageEditingForThisInput && !isContentEmpty(inputState.getDoc())) {
        resetInputState();
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

    const maintainedInteractionModalityRef = useRef<Modality | null>(null);

    const sendNewMessage = () => {
        if (isMessageCreationDisabled) return;
        if (!currentAccount) return;
        if (messageEditingForThisInput) return;

        const inputContent = trimContentWithReferencesEnd(inputState.getContent());
        if (isContentEmpty(inputContent.doc) && inputFiles.length === 0) return;

        const optimisticMessage: OptimisticMessageModel = {
            isOptimistic: true,
            optimisticId: generateId(),
            optimisticRequestErrorState: {hasError: false},
            author: currentAccount,
            createdTime: new Date(),
            payload: {
                type: "Content",
                parentMessageIndex: replyingToMessage?.index ?? null,
                content: inputContent,
                contentUpdatedTime: null,
                files: inputFiles.map(inputFile => {
                    switch (inputFile.type) {
                        case "File": {
                            const latestFile = fileRegistry.getFileStore(inputFile).getSnapshot();
                            return {
                                type: "File",
                                signedUrlSearch: latestFile.signedUrlSearch,
                                file: new FileModel(latestFile),
                            };
                        }
                        case "FileEntity": {
                            return {
                                type: "FileEntity",
                                fileEntityId: inputFile.fileEntityId,
                                fileEntityResult: inputFile.fileEntityResult,
                            };
                        }
                        default:
                            throw exhaustive(inputFile);
                    }
                }),
            },
            stream: null,
        };

        // If the input was focused then after we reset our input state, we want to
        // focus the re-rendered input.
        const wasInputFocused = assertExists(inputRef.current).isFocused();

        // Make sure these updates happen in one React render. These external callbacks
        // might themselves update a store (`useSyncExternalStore()`) or call
        // `flushSync()`.
        flushSync(() => {
            onUpdateMessages(messages => messages.addOptimisticMessage(optimisticMessage));
            resetInputState();
            onClearReplyingToMessage();
        });

        if (wasInputFocused) assertExists(inputRef.current).focus();

        const tryCreatingMessage = () => {
            runPromiseWithoutAwaiting(async () => {
                try {
                    const promise = (async () => {
                        // If we were configured to attach files right before creating a message
                        // (instead of when the file was added to the message input) then run our
                        // attach calls now.
                        if (withAttachFileBeforeCreateMessage && fileAttachmentTarget !== null) {
                            await runAllPromises(
                                inputFiles.map(async inputFile => {
                                    if (inputFile.type !== "File") return;

                                    if (inputFile.attachmentTarget === "Uploader") {
                                        await attachFileAsUploader(context, {
                                            spaceId: space.id,
                                            fileId: inputFile.file.id,
                                            target: fileAttachmentTarget,
                                        });
                                    } else if (
                                        !isDeepEqual(
                                            fileAttachmentTarget,
                                            inputFile.attachmentTarget,
                                        )
                                    ) {
                                        await attachFileFromAttachment(context, {
                                            spaceId: space.id,
                                            fileId: inputFile.file.id,
                                            fromTarget: inputFile.attachmentTarget,
                                            toTarget: fileAttachmentTarget,
                                        });
                                    }
                                }),
                            );
                        }

                        // TODO(calebmer, #unsaved-changes-confirmation): User should not be able to
                        // close the page if we haven't finished sending their message. It will
                        // look ok on their machine but might not be on the server.
                        await createMessage({
                            parentMessageIndex: replyingToMessage?.index ?? null,
                            content: inputContent.doc,
                            fileIds: inputFiles.map(inputFile =>
                                inputFile.type === "FileEntity"
                                    ? inputFile.fileEntityId
                                    : inputFile.file.id,
                            ),
                        });
                    })();

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
                key={
                    // Fully remount the message input after sending a message or when switching to
                    // editing mode. This should reset iOS auto complete. Otherwise the last
                    // message's auto complete will still be suggested.
                    !messageEditingForThisInput
                        ? inputKey
                        : `MessageEditing:${messageEditingForThisInput.state.messageRoomKey}:${messageEditingForThisInput.state.messageIndex}`
                }
                messageNoun={messageNoun}
                messageStartOfSentenceNoun={messageStartOfSentenceNoun}
                placeholder={placeholder}
                state={
                    !messageEditingForThisInput
                        ? inputState
                        : messageEditingForThisInput.state.contentEditorState
                }
                files={!messageEditingForThisInput ? inputFiles : emptyArray}
                onChange={
                    !messageEditingForThisInput
                        ? setInputState
                        : state => {
                              messageEditingForThisInput.dispatch({
                                  type: "ContentEditorStateChange",
                                  contentEditorState: state,
                              });
                          }
                }
                onAddFile={!messageEditingForThisInput ? addInputFile : null}
                onRemoveFile={!messageEditingForThisInput ? removeInputFile : null}
                onSend={
                    !messageEditingForThisInput
                        ? sendNewMessage
                        : () => {
                              messageEditing.dispatch({type: "SaveEditedContent"});
                          }
                }
                isSendButtonDisabled={
                    isMessageCreationDisabled ||
                    !currentAccount ||
                    (!!messageEditingForThisInput &&
                        messageEditingForThisInput.state.contentEditorState.getDoc() ===
                            messageEditingForThisInput.state.initialContent)
                }
                isSendButtonPending={messageEditingForThisInput?.state.isSaving}
                // Always treat `fileAttachmentTarget` as null if we want to attach files
                // before creating the message instead of when they're dropped on the message
                // input.
                fileAttachmentTarget={
                    withAttachFileBeforeCreateMessage ? null : fileAttachmentTarget
                }
                messageEditingForThisInput={messageEditingForThisInput}
                replyingToMessage={replyingToMessage}
                onClearReplyingToMessage={onClearReplyingToMessage}
                onJumpToMessage={onJumpToMessage}
                onShowTypingIndicator={onShowTypingIndicator}
                onHideTypingIndicator={onHideTypingIndicator}
                isBottomBar={!isNotBottomBar}
                data-testid={dataTestId}
                withMobileMaxHeight={withMobileMaxHeight}
                onFocus={() => {
                    if (restoreStateRef?.current) restoreStateRef.current.isFocused = true;
                    onFocus?.();
                }}
                onBlur={event => {
                    if (restoreStateRef?.current) restoreStateRef.current.isFocused = false;

                    // Don't clear our maintained interaction modality until focus completely leaves
                    // the `<MessageInput>` along with any of its children.
                    if (
                        !(event.relatedTarget instanceof Element) ||
                        !isElementOwnedBy(event.currentTarget, event.relatedTarget)
                    ) {
                        maintainedInteractionModalityRef.current = null;
                    }

                    onBlur?.();
                }}
                onBeforeFocusFromReplyOrEditingChange={onBeforeFocusFromReplyOrEditingChange}
                onArrowUpKeyDown={event => {
                    if (messageEditingForThisInput) return;

                    if (isContentEmpty(inputState.getDoc())) {
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
                                message.author.id === currentAccount?.id &&
                                message.payload.type === "Content" &&
                                // Don't start editing a message that just has files. Normally we don't allow
                                // empty message content but we do allow empty message content if the message
                                // has files.
                                !isContentEmpty(message.payload.content.doc)
                            ) {
                                messageEditing.dispatch({
                                    type: "StartEditing",
                                    messageRoomKey: message.getRoomKey(),
                                    messageIndex: message.index,
                                    messagePayload: message.payload,
                                    platform,
                                    returnFocusAfterEditing: () => {
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
