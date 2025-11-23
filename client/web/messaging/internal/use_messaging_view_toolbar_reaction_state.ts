import {Memo, useMemo} from "react";
import {MessageList} from "~/client/web/messaging/message_list.js";
import {MessagingViewPointerToolbarState} from "~/client/web/messaging/messaging_view_pointer_toolbar.js";
import {findMessageReactionPosIfPossible} from "~/shared/messaging/compute_set_message_reaction.js";
import {MessageModel, fromMessagePayloadModel} from "~/shared/messaging/message_model.js";
import {ReactionSet, emptyReactionSet} from "~/shared/reactions/reaction_set.js";

export type MessagingViewToolbarReactionState<RoomKey extends string> = {
    readonly roomKey: RoomKey;
    readonly messageIndex: number;
    readonly pos: number;
    readonly contentVersion: number;
    readonly reactions: ReactionSet;
};

export function useMessagingViewToolbarReactionState<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    state,
    getMessagesByRoomKey,
}: {
    state: MessagingViewPointerToolbarState<RoomKey> | null;
    getMessagesByRoomKey: Memo<(roomKey: string) => MessageList<Message> | null>;
}): MessagingViewToolbarReactionState<RoomKey> | null {
    return useMemo(() => {
        if (state?.parent.type !== "MessagesRange") return null;

        const messages = getMessagesByRoomKey(state.roomKey);
        if (!messages) return null;

        const message = messages.getLoadedMessageIfExists(state.parent.endIndex);
        if (!message) return null;

        const result = findMessageReactionPosIfPossible({
            message: {
                payload: fromMessagePayloadModel(message.payload),
                stream: message.stream,
            },
            contentVersion: state.parent.endContentVersion,
            pos: state.parent.endPos,
        });
        if (!result.ok) return null;

        const {payload, pos} = result.value;

        return {
            roomKey: state.roomKey,
            messageIndex: state.parent.endIndex,
            contentVersion: payload.contentUpdate?.mappings.length ?? 0,
            pos,
            reactions: payload.reactionsByPos.get(pos) ?? emptyReactionSet,
        };
    }, [getMessagesByRoomKey, state]);
}
