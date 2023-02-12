import {MutableRefObject, useEffect, useMemo, useReducer} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useShowToast} from "~/client/design/toast";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {MessageContent} from "~/shared/content/message_content_schema";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {omitObject} from "~/shared/helpers/object/omit_object";
import {MessageContentPayload} from "~/shared/models/message_interface";

export type MessageEditingState<RoomKey extends string> =
    | {
          readonly isEditing: false;
      }
    | ({
          readonly isEditing: true;
          readonly messageRoomKey: RoomKey;
          readonly messageIndex: number;
          readonly contentEditorState: ContentEditorState<MessageContent>;
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
          readonly messagePayload: MessageContentPayload;
      }
    | {
          readonly type: "ContentEditorStateChange";
          readonly contentEditorState: ContentEditorState<MessageContent>;
      }
    | {
          readonly type: "CancelEditing";
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
                isSaving: false,
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
        case "SaveEditedContent": {
            if (!state.isEditing || state.isSaving) return state;

            return {
                ...state,
                isSaving: true,
                isAwaitingSaveRef: {current: false},
                messageNoun: action.messageNoun,
            };
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
    readonly dispatch: (action: MessageEditingAction<RoomKey>) => void;
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
            content: state.contentEditorState.getContent(),
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

    return useMemo(() => ({state, dispatch}), [state]);
}
