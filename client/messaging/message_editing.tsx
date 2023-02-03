import {useMemo, useReducer} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {MessageContent} from "~/shared/content/message_content_schema";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {MessageInterface} from "~/shared/models/message_interface";

export type MessageEditingState =
    | {
          readonly isEditing: false;
      }
    | {
          readonly isEditing: true;
          readonly messageRoomKey: string;
          readonly messageId: number;
          readonly contentEditorState: ContentEditorState<MessageContent>;
      };

export type MessageEditingAction =
    | {
          readonly type: "StartEditing";
          readonly message: MessageInterface;
      }
    | {
          readonly type: "CancelEditing";
      }
    | {
          readonly type: "ContentEditorStateChange";
          readonly contentEditorState: ContentEditorState<MessageContent>;
      };

function reduce(state: MessageEditingState, action: MessageEditingAction): MessageEditingState {
    switch (action.type) {
        case "StartEditing": {
            return {
                isEditing: true,
                messageRoomKey: action.message.getRoomKey(),
                messageId: action.message.id,
                contentEditorState: ContentEditorState.create(action.message.content),
            };
        }
        case "CancelEditing": {
            return {
                isEditing: false,
            };
        }
        case "ContentEditorStateChange": {
            if (!state.isEditing) return state;

            return {
                ...state,
                contentEditorState: action.contentEditorState,
            };
        }
        default:
            throw exhaustive(action);
    }
}

export type MessageEditing = {
    readonly state: MessageEditingState;
    readonly dispatch: (action: MessageEditingAction) => void;
};

/**
 * Use state for managing message editing. Message editing state is hoisted to
 * the message virtualized list level because:
 *
 * - We only want to allow editing one message at a time.
 * - We don't want to lose editing state if the message is unmounted by the
 *   virtualized list.
 */
export function useMessageEditing(): MessageEditing {
    const [state, dispatch] = useReducer(reduce, {isEditing: false});
    return useMemo(() => ({state, dispatch}), [state]);
}
