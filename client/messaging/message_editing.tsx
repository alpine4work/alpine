import {Memo, MutableRefObject, ReactNode, useEffect, useMemo, useReducer} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {trimContentEnd} from "~/client/content/trim_content_end.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useReporter} from "~/client/design/reporter.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {MessageDeleteConfirmationDialog} from "~/client/messaging/internal/message_delete_confirmation_dialog.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayloadModel} from "~/shared/messaging/message_model.js";

export type MessageEditingState<RoomKey extends string> =
    | {
          readonly isEditing: false;
      }
    | ({
          readonly isEditing: true;
          readonly messageRoomKey: RoomKey;
          readonly messageIndex: number;
          readonly contentEditorState: ContentEditorState<MessageContentWithReferences>;
          readonly initialContent: MessageContent;
          readonly confirmationDialog: "Save" | "Delete" | null;
          readonly returnFocusAfterEditing: (() => void) | null;
      } & (
          | {
                readonly isSaving: false;
            }
          | {
                readonly isSaving: true;
                readonly isAwaitingSaveRef: MutableRefObject<boolean>;
                readonly savePromiseResolver: PromiseResolver<void> | null;
            }
      ));

export type MessageEditingAction<RoomKey extends string> =
    | {
          readonly type: "StartEditing";
          readonly messageRoomKey: RoomKey;
          readonly messageIndex: number;
          readonly messagePayload: MessageContentPayloadModel;
          readonly isMobile: boolean;
          readonly returnFocusAfterEditing: (() => void) | null;
      }
    | {
          readonly type: "ContentEditorStateChange";
          readonly contentEditorState: ContentEditorState<MessageContentWithReferences>;
      }
    | {
          readonly type: "CancelEditing";
      }
    | {
          readonly type: "MaybeCancelEditing";
      }
    | {
          readonly type: "CloseConfirmingDialog";
          readonly confirmationDialog: "Save" | "Delete";
      }
    | {
          readonly type: "SaveEditedContent";
          readonly savePromiseResolver?: PromiseResolver<void>;
      }
    | {
          readonly type: "FinishedSavingContent";
          readonly shouldCancelEditing: boolean;
      };

function reduce<RoomKey extends string>(
    state: MessageEditingState<RoomKey>,
    action: MessageEditingAction<RoomKey>,
): MessageEditingState<RoomKey> {
    switch (action.type) {
        case "StartEditing": {
            return {
                isEditing: true,
                messageRoomKey: action.messageRoomKey,
                messageIndex: action.messageIndex,
                contentEditorState: ContentEditorState.create(action.messagePayload.content, {
                    // The user is much more likely to need to edit from the end of the message than
                    // the start. But on mobile, if the message is long, editing should start at the
                    // start of the message so the cursor is visible.
                    selectionAt: action.isMobile ? "start" : "end",
                }),
                initialContent: action.messagePayload.content.doc,
                returnFocusAfterEditing: action.returnFocusAfterEditing,
                isSaving: false,
                confirmationDialog: null,
            };
        }
        case "ContentEditorStateChange": {
            if (!state.isEditing || state.isSaving) return state;

            return {
                ...state,
                contentEditorState: action.contentEditorState,
            };
        }
        case "CancelEditing": {
            return {
                isEditing: false,
            };
        }
        case "MaybeCancelEditing": {
            if (!state.isEditing || state.isSaving || state.confirmationDialog !== null)
                return state;

            if (state.contentEditorState.getDoc() === state.initialContent) {
                return {
                    isEditing: false,
                };
            } else {
                return {
                    ...state,
                    confirmationDialog: "Save",
                };
            }
        }
        case "CloseConfirmingDialog": {
            if (
                !state.isEditing ||
                state.isSaving ||
                state.confirmationDialog !== action.confirmationDialog
            ) {
                return state;
            }
            return {...state, confirmationDialog: null};
        }
        case "SaveEditedContent": {
            if (!state.isEditing || state.isSaving) return state;

            if (isContentEmpty(state.contentEditorState.getDoc())) {
                return {
                    ...state,
                    confirmationDialog: "Delete",
                };
            } else {
                return {
                    ...state,
                    isSaving: true,
                    isAwaitingSaveRef: {current: false},
                    savePromiseResolver: action.savePromiseResolver ?? null,
                };
            }
        }
        case "FinishedSavingContent": {
            if (!state.isEditing || !state.isSaving) return state;

            if (action.shouldCancelEditing) {
                return {
                    isEditing: false,
                };
            } else {
                return {
                    ...omitObject(state, ["isAwaitingSaveRef", "savePromiseResolver"]),
                    isSaving: false,
                };
            }
        }
        default:
            throw exhaustive(action);
    }
}

export type MessageEditing<RoomKey extends string> = {
    readonly state: MessageEditingState<RoomKey>;
    readonly dispatch: Memo<(action: MessageEditingAction<RoomKey>) => void>;
};

/**
 * Use state for managing message editing. Message editing state is hoisted to
 * the message virtualized list level because:
 *
 * - We only want to allow editing one message at a time.
 * - We don't want to lose editing state if the message is unmounted by the
 *   virtualized list.
 *
 * This message editing code was forked into `usePostEditing()`. If you make a
 * change here, you might want to make a change there as well.
 */
export function useMessageEditing<RoomKey extends string>({
    messageNoun,
    onUpdateMessageContent: _onUpdateMessageContent,
    onDeleteMessage,
}: {
    messageNoun: string;
    onUpdateMessageContent: (options: {
        roomKey: RoomKey;
        messageIndex: number;
        content: MessageContent;
    }) => Promise<void>;
    onDeleteMessage: (options: {roomKey: RoomKey; messageIndex: number}) => Promise<void>;
}): {
    messageEditing: MessageEditing<RoomKey>;
    modals: ReactNode;
} {
    const reporter = useReporter();

    const [state, dispatch] = useReducer<
        (
            state: MessageEditingState<RoomKey>,
            action: MessageEditingAction<RoomKey>,
        ) => MessageEditingState<RoomKey>
    >(reduce, {isEditing: false});

    const onUpdateMessageContent = useEvent(_onUpdateMessageContent);

    useEffect(() => {
        if (!state.isEditing || !state.isSaving) return;

        if (state.isAwaitingSaveRef.current) return;
        state.isAwaitingSaveRef.current = true;

        onUpdateMessageContent({
            roomKey: state.messageRoomKey,
            messageIndex: state.messageIndex,
            content: trimContentEnd(state.contentEditorState.getDoc()),
        }).then(
            () => {
                state.savePromiseResolver?.resolve();

                dispatch({type: "FinishedSavingContent", shouldCancelEditing: true});
            },
            error => {
                // Expect the promise resolver to handle the error.
                if (state.savePromiseResolver) {
                    state.savePromiseResolver.reject(error);
                } else {
                    reporter.displayError(`Couldn’t update ${messageNoun}`, error);
                }

                dispatch({type: "FinishedSavingContent", shouldCancelEditing: false});
            },
        );
    }, [messageNoun, onUpdateMessageContent, reporter, state]);

    return {
        messageEditing: useMemo(
            () => ({
                state,
                dispatch: dispatch as Memo<(action: MessageEditingAction<RoomKey>) => void>,
            }),
            [state],
        ),
        modals: (
            <>
                {state.isEditing && state.confirmationDialog === "Save" && (
                    <ModalDialog
                        title={`Save ${messageNoun}`}
                        description={`Would you like to save the changes you made to this ${messageNoun}?`}
                        onClose={() => {
                            dispatch({
                                type: "CloseConfirmingDialog",
                                confirmationDialog: "Save",
                            });
                        }}
                        primaryButtonLabel="Save"
                        primaryButtonPressErrorTitle={`Couldn’t save ${messageNoun}`}
                        onPrimaryButtonPress={() => {
                            const savePromiseResolver = createPromiseResolver();

                            dispatch({type: "SaveEditedContent", savePromiseResolver});

                            return savePromiseResolver.promise;
                        }}
                        cancelButtonLabel="Discard changes"
                        onCancelButtonPress={() => {
                            dispatch({type: "CancelEditing"});
                        }}
                    />
                )}
                {state.isEditing && state.confirmationDialog === "Delete" && (
                    <MessageDeleteConfirmationDialog
                        messageNoun={messageNoun}
                        onClose={() => {
                            dispatch({
                                type: "CloseConfirmingDialog",
                                confirmationDialog: "Delete",
                            });
                        }}
                        onDeleteMessage={async () => {
                            await onDeleteMessage({
                                roomKey: state.messageRoomKey,
                                messageIndex: state.messageIndex,
                            });
                        }}
                    />
                )}
            </>
        ),
    };
}
