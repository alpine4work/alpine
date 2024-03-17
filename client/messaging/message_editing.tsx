import {Memo, MutableRefObject, useEffect, useMemo, useReducer} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {useShowToast} from "~/client/design/toast.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
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
                readonly messageNoun: string;
            }
      ));

export type MessageEditingAction<RoomKey extends string> =
    | {
          readonly type: "StartEditing";
          readonly messageRoomKey: RoomKey;
          readonly messageIndex: number;
          readonly messagePayload: MessageContentPayloadModel;
          readonly messageTop: number;
          readonly shouldMergeWithNextMessage: boolean;
          readonly shouldMergeWithPreviousMessage: boolean;
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
          readonly messageNoun: string;
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
                contentEditorState: ContentEditorState.create(action.messagePayload.content),
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
                    messageNoun: action.messageNoun,
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
                    ...omitObject(state, ["isAwaitingSaveRef", "messageNoun"]),
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
 */
export function useMessageEditing<RoomKey extends string>({
    onUpdateMessageContent: _onUpdateMessageContent,
}: {
    onUpdateMessageContent: (options: {
        roomKey: RoomKey;
        messageIndex: number;
        content: MessageContent;
    }) => Promise<void>;
}): MessageEditing<RoomKey> {
    const showToast = useShowToast();

    const [state, dispatch] = useReducer<
        (
            state: MessageEditingState<RoomKey>,
            action: MessageEditingAction<RoomKey>,
        ) => MessageEditingState<RoomKey>
    >(reduce, {isEditing: false});

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const onUpdateMessageContent = useEvent(_onUpdateMessageContent);

    useEffect(() => {
        if (!state.isEditing || !state.isSaving) return;

        if (state.isAwaitingSaveRef.current) return;
        state.isAwaitingSaveRef.current = true;

        onUpdateMessageContent({
            roomKey: state.messageRoomKey,
            messageIndex: state.messageIndex,
            content: state.contentEditorState.getDoc(),
        }).then(
            () => {
                dispatch({type: "FinishedSavingContent", shouldCancelEditing: true});
            },
            error => {
                showToast({
                    type: "Error",
                    title: `Couldn’t update ${state.messageNoun}`,
                    error,
                });

                dispatch({type: "FinishedSavingContent", shouldCancelEditing: false});
            },
        );
    }, [onUpdateMessageContent, showToast, state]);

    return useMemo(
        () => ({
            state,
            dispatch: dispatch as Memo<(action: MessageEditingAction<RoomKey>) => void>,
        }),
        [state],
    );
}
