import {Modality} from "@react-aria/interactions";
import {
    Memo,
    ReactElement,
    Ref,
    RefAttributes,
    RefObject,
    forwardRef,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {useFileRegistry} from "~/client/web/content/file_registry_context.js";
import {MessageInputFile} from "~/client/web/content/messaging/add_message_input_files.js";
import {getMessageInputFileIds} from "~/client/web/content/messaging/get_message_input_file_ids.js";
import {
    MessageContentPayloadParentWithMessages,
    MessageInputBase,
    MessageInputRef,
} from "~/client/web/content/messaging/message_input_base.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {isElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {applyServerMessageDraftToInputState} from "~/client/web/messaging/apply_server_message_draft_to_input_state.js";
import {createInitialMessageInputState} from "~/client/web/messaging/create_initial_message_input_state.js";
import {hasMessageInputContent} from "~/client/web/messaging/has_message_input_content.js";
import {MessageDeleteConfirmationDialog} from "~/client/web/messaging/internal/message_delete_confirmation_dialog.js";
import {MessageEditing} from "~/client/web/messaging/message_editing.js";
import {MessageInputDraftSyncState} from "~/client/web/messaging/message_input_draft_sync_state.js";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {resolveInitialMessageInputState} from "~/client/web/messaging/resolve_initial_message_input_state.js";
import {JumpToMessageRangeOptions} from "~/client/web/messaging/use_jump_to_message_range.js";
import {JumpToPostRangeOptions} from "~/client/web/messaging/use_jump_to_post_range.js";
import {useMessageInputDraft} from "~/client/web/messaging/use_message_input_draft.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/content/message_content_schema.js";
import {trimContentWithReferencesEnd} from "~/shared/content/trim_content.js";
import {DocumentCommentThreadModel} from "~/shared/documents/document_model.js";
import {InternalError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {FileModel} from "~/shared/files/file_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {Id, generateId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";
import {MessageDraft, MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";
import {MessageDraftSurface} from "~/shared/messaging/message_draft_surface.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {
    attachFileAsUploader,
    attachFileFromAttachment,
} from "~/shared/rpc/files_rpc_definitions.js";

const defaultDraftContentWriteDebounceMs = 1000;

export type MessageInputProps<RoomKey extends string, Message extends MessageModel<RoomKey>> = {
    messageNoun?: string;
    messageStartOfSentenceNoun?: string;
    placeholder?: string;
    isNotBottomBar?: boolean;
    alwaysRegisterBottomBarFrame?: boolean;
    messages: MessageList<Message>;
    isMessageCreationDisabled?: boolean;
    onUpdateMessages: (update: (messages: MessageList<Message>) => MessageList<Message>) => void;
    createMessage: (input: {
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
    }) => Promise<void>;
    fileAttachmentTarget: Memo<FileAttachmentTarget> | null;
    ensureFileAttachmentTarget?: () => Promise<FileAttachmentTarget>;
    withAttachFileBeforeCreateMessage?: boolean;
    messageEditing: MessageEditing<RoomKey>;
    postRoom?: PostModel;
    documentCommentThreadRoom?: DocumentCommentThreadModel;
    parent: MessageContentPayloadParent | null;
    messageDraft?: MessageDraft | MessageDraftWithFiles;
    messageDraftSurface?: MessageDraftSurface;
    onMessageDraftChange?: (draft: MessageDraft) => void;
    onParentClear: () => void;
    onParentChange?: (parent: MessageContentPayloadParent | null) => void;
    onJumpToMessageRange: (options: JumpToMessageRangeOptions<RoomKey>) => void;
    onJumpToPostRange?: (options: JumpToPostRangeOptions) => void;
    onDeleteMessage: (messageIndex: number) => Promise<void>;
    onShowTypingIndicator: () => void;
    onHideTypingIndicator: () => void;
    "data-testid"?: string;
    restoreStateRef?: RefObject<MessageInputRestoreState | null>;

    /**
     * Flush any pending draft write when the input unmounts. Defaults to `false` when
     * using `restoreStateRef` since local input state will be restored on remount.
     */
    shouldFlushDraftOnUnmount?: boolean;
    withMobileMaxHeight?: boolean;
    onFocus?: () => void;
    onBlur?: () => void;
    onBeforeFocusFromReplyOrEditingChange?: () => {preventDefault: boolean} | void;

    /**
     * How long to wait after the last edit before writing the message draft's content
     * to the server. Edits made within this window are coalesced into a single write.
     * The pending write is also flushed on unmount according to
     * `shouldFlushDraftOnUnmount` and when the page is hidden. Defaults to one second.
     */
    draftContentWriteDebounceMs?: number;
};

/**
 * Message input state stashed in a ref by the owner of a `<MessageInput>` so the
 * input can be restored without a flash when it remounts (for example, when a
 * post's comments are collapsed and expanded again).
 */
export type MessageInputRestoreState = {
    state: ContentEditorState<MessageContentWithReferences>;
    files: ReadonlyArray<MessageInputFile>;
    isFocused: boolean;
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
        alwaysRegisterBottomBarFrame = false,
        messages,
        isMessageCreationDisabled,
        onUpdateMessages,
        createMessage,
        fileAttachmentTarget,
        ensureFileAttachmentTarget,
        withAttachFileBeforeCreateMessage,
        messageEditing,
        postRoom,
        documentCommentThreadRoom,
        parent: parentWithoutMessages,
        messageDraft,
        messageDraftSurface,
        onMessageDraftChange,
        onParentClear,
        onParentChange,
        onJumpToMessageRange,
        onJumpToPostRange,
        onDeleteMessage,
        onShowTypingIndicator,
        onHideTypingIndicator,
        "data-testid": dataTestId,
        restoreStateRef,
        shouldFlushDraftOnUnmount,
        withMobileMaxHeight,
        onFocus,
        onBlur,
        onBeforeFocusFromReplyOrEditingChange,
        draftContentWriteDebounceMs = defaultDraftContentWriteDebounceMs,
    }: MessageInputProps<RoomKey, Message>,
    externalRef: Ref<MessageInputRef>,
) {
    const context = useAppContext();
    const platform = usePlatform();
    const reporter = useReporter();
    const {space, currentAccount} = useSpaceContext();
    const inboxPeekContext = useInboxContext();
    const fileRegistry = useFileRegistry();

    const inputRef = useRef<MessageInputRef>(null);

    // If we're on a mobile device then message editing will happen inside this message
    // input component instead of inline within `<MessageView>`.
    const messageEditingForThisInput =
        platform === "mobile" && messageEditing.state.isEditing
            ? (messageEditing as MessageEditing<RoomKey> & {state: {isEditing: true}})
            : null;

    const parent: MessageContentPayloadParentWithMessages<RoomKey, Message> | null = useMemo(() => {
        if (!parentWithoutMessages) return null;

        switch (parentWithoutMessages.type) {
            case "Message": {
                const message = messages.getLoadedMessageIfExists(parentWithoutMessages.index);
                if (!message) return null;
                return {type: "Message", message};
            }
            case "MessagesRange": {
                const parentMessages: Array<Message> = [];

                for (
                    let index = parentWithoutMessages.startIndex;
                    index <= parentWithoutMessages.endIndex;
                    index++
                ) {
                    const message = messages.getLoadedMessageIfExists(index);
                    if (!message) return null;
                    parentMessages.push(message);
                }

                return {
                    ...parentWithoutMessages,
                    messages: assertNonEmptyReadonlyArray(parentMessages),
                };
            }
            case "PostRange": {
                if (!postRoom) {
                    throw new InternalError("Post range parent may only be used in a post room");
                }

                return {
                    ...parentWithoutMessages,
                    post: postRoom,
                };
            }
            default:
                throw exhaustive(parentWithoutMessages);
        }
    }, [messages, parentWithoutMessages, postRoom]);

    const [
        {key: inputKey, state: inputState, files: inputFiles, draftSyncState},
        actuallySetInputState,
    ] = useState<{
        key: Id;
        state: ContentEditorState<MessageContentWithReferences>;
        files: ReadonlyArray<MessageInputFile>;
        draftSyncState: MessageInputDraftSyncState | null;
    }>(() => {
        const initialState = resolveInitialMessageInputState({
            spaceId: space.id,
            draft: messageDraft,
            restoreStateRef,
        });

        return {
            key: generateId(),
            state: initialState.state,
            files: initialState.files,
            draftSyncState: initialState.draftSyncState,
        };
    });

    const inputFileIds = useMemo(() => getMessageInputFileIds(inputFiles), [inputFiles]);

    const hasLocalDraftContent = hasMessageInputContent({
        contentDoc: inputState.getDoc(),
        parent: parentWithoutMessages,
        fileIds: inputFileIds,
    });

    const {resolvedServerDraft, clearDraft} = useMessageInputDraft({
        draftSurface: messageDraftSurface,
        serverDraft: messageDraft,
        inputState,
        parent: parentWithoutMessages,
        fileIds: inputFileIds,
        draftSyncState,
        hasLocalDraftContent,
        isDisabled: messageEditingForThisInput !== null,
        shouldFlushOnUnmount: shouldFlushDraftOnUnmount ?? !restoreStateRef,
        draftContentWriteDebounceMs,
        onDraftChange: onMessageDraftChange,
    });

    const lastAppliedServerDraftRef = useRef<MessageDraftWithFiles | null>(
        resolvedServerDraft ?? null,
    );
    const messageDraftWithSyncedParentRef = useRef<MessageDraft | MessageDraftWithFiles | null>(
        null,
    );

    // Restores a server draft's reply target into parent-owned state. Drafts persist
    // `parent`, but the "Replying to…" UI is driven by the `parent` prop from
    // `<PostListView>` or `<MessagingView>`. Sync before paint so the reply banner
    // appears with the restored draft instead of after a flash.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!messageDraft?.parent) return;
        if (messageEditingForThisInput) return;
        if (parentWithoutMessages) return;
        if (messageDraftWithSyncedParentRef.current === messageDraft) return;

        messageDraftWithSyncedParentRef.current = messageDraft;
        onParentChange?.(messageDraft.parent);
    }, [messageDraft, messageEditingForThisInput, onParentChange, parentWithoutMessages]);

    // Applies a server draft to the input once file hydration completes. Uses a layout
    // effect so restored draft content/files paint before the browser draws.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!resolvedServerDraft || messageEditingForThisInput) return;
        if (lastAppliedServerDraftRef.current === resolvedServerDraft) return;

        // Ensure we don't apply a stale server draft that was restored from a previous
        // mount.
        const restoredState = restoreStateRef?.current;
        if (
            restoredState &&
            !hasMessageInputContent({
                contentDoc: restoredState.state.getDoc(),
                parent: parentWithoutMessages,
                fileIds: getMessageInputFileIds(restoredState.files),
            }) &&
            hasMessageInputContent({
                contentDoc: resolvedServerDraft.content.doc,
                parent: resolvedServerDraft.parent,
                fileIds: resolvedServerDraft.fileIds,
            })
        ) {
            lastAppliedServerDraftRef.current = resolvedServerDraft;
            return;
        }

        // Don't resurrect a draft the user cleared while its files were still hydrating.
        // The draft's content was applied at mount (recorded in `lastDraftSent`); if the
        // input is now empty, the user cleared it, so keep it empty instead of re-applying
        // the late-hydrated draft.
        const lastSyncedDraft = draftSyncState?.lastDraftSent;
        if (
            !hasLocalDraftContent &&
            lastSyncedDraft &&
            hasMessageInputContent({
                contentDoc: lastSyncedDraft.state.getDoc(),
                parent: lastSyncedDraft.parent,
                fileIds: lastSyncedDraft.fileIds,
            })
        ) {
            lastAppliedServerDraftRef.current = resolvedServerDraft;
            return;
        }

        const result = applyServerMessageDraftToInputState({
            serverDraft: resolvedServerDraft,
            spaceId: space.id,
            currentState: inputState,
            currentParent: parentWithoutMessages,
            currentFileIds: inputFileIds,
        });

        switch (result.type) {
            case "LocalWins":
                actuallySetInputState(oldState => {
                    if (
                        oldState.draftSyncState?.lastDraftSent ===
                            result.draftSyncState.lastDraftSent &&
                        oldState.draftSyncState?.hasRemoteDraftContent ===
                            result.draftSyncState.hasRemoteDraftContent
                    ) {
                        return oldState;
                    }

                    return {
                        ...oldState,
                        draftSyncState: result.draftSyncState,
                    };
                });
                break;
            case "ApplyFiles":
                actuallySetInputState(oldState => ({
                    ...oldState,
                    files: result.files,
                    draftSyncState: result.draftSyncState,
                }));
                break;
            case "Apply":
                actuallySetInputState(oldState => ({
                    ...oldState,
                    state: result.state,
                    files: result.files,
                    draftSyncState: result.draftSyncState,
                }));

                if (result.parentToApply) onParentChange?.(result.parentToApply);
                break;
            default:
                throw exhaustive(result);
        }

        lastAppliedServerDraftRef.current = resolvedServerDraft;
    }, [
        draftSyncState,
        hasLocalDraftContent,
        inputFileIds,
        inputState,
        messageEditingForThisInput,
        onParentChange,
        parentWithoutMessages,
        resolvedServerDraft,
        restoreStateRef,
        space.id,
    ]);

    const setInputState = useCallback(
        (newInputState: ContentEditorState<MessageContentWithReferences>) => {
            actuallySetInputState(oldState => ({
                key: oldState.key,
                state: newInputState,
                files: oldState.files,
                draftSyncState: oldState.draftSyncState,
            }));
        },
        [],
    );

    const resetInputState = useCallback(() => {
        actuallySetInputState({
            key: generateId(),
            state: createInitialMessageInputState({spaceId: space.id}),
            files: emptyArray,
            draftSyncState: null,
        });
    }, [space.id]);

    const addInputFile = useCallback((file: MessageInputFile) => {
        actuallySetInputState(oldState => ({
            key: oldState.key,
            state: oldState.state,
            files: [...oldState.files, file],
            draftSyncState: oldState.draftSyncState,
        }));
    }, []);

    const removeInputFile = useCallback((fileKey: Id) => {
        actuallySetInputState(oldState => ({
            key: oldState.key,
            state: oldState.state,
            files: oldState.files.filter(file => file.key !== fileKey),
            draftSyncState: oldState.draftSyncState,
        }));
    }, []);

    const restoreStateInputStateRef = useRef(inputState);
    restoreStateInputStateRef.current = inputState;
    const restoreStateInputFilesRef = useRef(inputFiles);
    restoreStateInputFilesRef.current = inputFiles;

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!restoreStateRef) return;

        // eslint-disable-next-line react-compiler/react-compiler
        restoreStateRef.current = {
            state: restoreStateInputStateRef.current,
            files: restoreStateInputFilesRef.current,
            isFocused: inputRef.current?.isFocused() ?? false,
        };

        return () => {
            restoreStateRef.current = {
                state: restoreStateInputStateRef.current,
                files: restoreStateInputFilesRef.current,
                isFocused: false,
            };
        };
    }, [inputFiles, inputState, restoreStateRef]);

    // If we're editing a message then clear any new message text so when we finish
    // editing the input is empty. Also clear reply state but we need to do that in an
    // effect since the state isn't local.
    if (messageEditingForThisInput && !isContentEmpty(inputState.getDoc())) {
        resetInputState();
    }
    useEffect(() => {
        if (messageEditingForThisInput && parent) {
            onParentClear();
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
            createdTimeZone: getClientInfo().timeZone,
            payload: {
                type: "Content",
                parent: parent ? parentWithoutMessages : null,
                content: inputContent,
                contentUpdate: null,
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
                reactionsByPos: emptyMap,
                filesReactions: emptyReactionSet,
            },
            stream: null,
        };

        // If the input was focused then after we reset our input state, we want to focus
        // the re-rendered input.
        const wasInputFocused = assertExists(inputRef.current).isFocused();

        // Make sure these updates happen in one React render. These external callbacks
        // might themselves update a store (`useSyncExternalStore()`) or call
        // `flushSync()`.
        flushSync(() => {
            onUpdateMessages(messages => messages.addOptimisticMessage(optimisticMessage));
            resetInputState();
            onParentClear();
        });

        if (wasInputFocused) assertExists(inputRef.current).focus();

        const tryCreatingMessage = () => {
            runPromiseWithoutAwaiting(async () => {
                try {
                    const promise = (async () => {
                        const ensuredFileAttachmentTarget = await ensureFileAttachmentTarget?.();

                        const actualFileAttachmentTarget =
                            fileAttachmentTarget ?? ensuredFileAttachmentTarget;

                        // If there are any files that haven't been attached yet, attach them now.
                        if (actualFileAttachmentTarget) {
                            await runAllPromises(
                                inputFiles.map(async inputFile => {
                                    if (inputFile.type !== "File") return;
                                    if (!inputFile.shouldAttachBeforeCreate) return;

                                    if (inputFile.attachmentTarget === "Uploader") {
                                        await attachFileAsUploader(context, {
                                            fileId: inputFile.file.id,
                                            target: actualFileAttachmentTarget,
                                        });
                                    } else if (
                                        !isDeepEqual(
                                            actualFileAttachmentTarget,
                                            inputFile.attachmentTarget,
                                        )
                                    ) {
                                        await attachFileFromAttachment(context, {
                                            fileId: inputFile.file.id,
                                            fromTarget: inputFile.attachmentTarget,
                                            toTarget: actualFileAttachmentTarget,
                                        });
                                    }
                                }),
                            );
                        }

                        // TODO(calebmer, #unsaved-changes-confirmation): User should not be able to close
                        // the page if we haven't finished sending their message. It will look ok on their
                        // machine but might not be on the server.
                        await createMessage({
                            parent: parent ? parentWithoutMessages : null,
                            content: inputContent.doc,
                            fileIds: inputFileIds,
                        });

                        clearDraft();
                    })();

                    // Sending a message dismisses post comment entries and chat entries.
                    // Optimistically archive these entries so we don't need to wait for realtime. The
                    // latency of which may be long since notification events are processed by a queue.
                    inboxPeekContext?.onCreateMessageOptimistically(
                        promise,
                        postRoom
                            ? {type: "Post", postId: postRoom.id}
                            : documentCommentThreadRoom
                              ? {
                                    type: "DocumentCommentThread",
                                    commentThreadId: documentCommentThreadRoom.id,
                                }
                              : undefined,
                    );

                    await promise;

                    // We wait to receive the new message over realtime to confirm the optimistic
                    // message. We do this so that messages are delivered to the user in order instead
                    // of confirming a message and discovering some unloaded messages.
                } catch (error) {
                    reporter.displayError(`Couldn\u2019t create ${messageNoun}`, error);

                    onUpdateMessages(messages =>
                        messages.updateOptimisticMessage(
                            optimisticMessage.optimisticId,
                            optimisticMessage => ({
                                ...optimisticMessage,
                                optimisticRequestErrorState: {
                                    hasError: true,
                                    retry: () => {
                                        // Clear the error when we are retrying then call this function again.
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
                    // editing mode. This should reset iOS auto complete. Otherwise the last message's
                    // auto complete will still be suggested.
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
                        : (state, transaction) => {
                              messageEditingForThisInput.dispatch({
                                  type: "ContentEditorStateChange",
                                  state,
                                  transaction,
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
                // Always treat `fileAttachmentTarget` as null if we want to attach files before
                // creating the message instead of when they're dropped on the message input.
                fileAttachmentTarget={
                    withAttachFileBeforeCreateMessage ? null : fileAttachmentTarget
                }
                messageEditingForThisInput={messageEditingForThisInput}
                parent={parent}
                onParentClear={onParentClear}
                onJumpToMessageRange={onJumpToMessageRange}
                onJumpToPostRange={onJumpToPostRange}
                onShowTypingIndicator={onShowTypingIndicator}
                onHideTypingIndicator={onHideTypingIndicator}
                isBottomBar={!isNotBottomBar}
                alwaysRegisterBottomBarFrame={alwaysRegisterBottomBarFrame}
                data-testid={dataTestId}
                withMobileMaxHeight={withMobileMaxHeight}
                // Hide the top border if there are no messages. (For example, when we're replying
                // to a post.) Then the message input top border conflicts with the
                // `<PostContentView>` bottom border.
                withoutParentBorderTop={messages.getMessageCountIncludingOptimisticMessages() === 0}
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

                        // Look at the last 10 messages. Start editing state for the last one our account
                        // authored.
                        for (const message of sliceIterable(
                            messages.iterateLoadedMessagesFromEnd(),
                            0,
                            10,
                        )) {
                            if (
                                message.author.id === currentAccount?.id &&
                                message.payload.type === "Content" &&
                                // Don't start editing a message that just has files. Normally we don't allow empty
                                // message content but we do allow empty message content if the message has files.
                                !isContentEmpty(message.payload.content.doc)
                            ) {
                                messageEditing.dispatch({
                                    type: "StartEditing",
                                    spaceId: space.id,
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
