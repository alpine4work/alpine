import {Memo} from "react";
import {MenuCustomAction} from "~/client/web/design/menu.js";
import {InboxContext} from "~/client/web/inbox/context/inbox_context_types.js";
import {MessageViewContextMenuReactionButton} from "~/client/web/messaging/internal/message_view_context_menu_reaction_button.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    OnUpdateMessagesOptimisticallyFunction,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {findMessageReactionPosIfPossible} from "~/shared/messaging/compute_set_message_reaction.js";
import {getMessageReactionsByCanonicalPos} from "~/shared/messaging/get_message_reactions_by_canonical_pos.js";
import {MessageModel, fromMessagePayloadModel} from "~/shared/messaging/message_model.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";

export function messageViewReactionContextMenuAction<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    message,
    messageNoun,
    onSetMessageReaction,
    onDeleteMessageReaction,
    onUpdateMessagesOptimistically,
    inboxContext,
    targetPos,
}: {
    message: Message;
    messageNoun: string;
    onSetMessageReaction: Memo<OnSetMessageReactionFunction<RoomKey>>;
    onDeleteMessageReaction: Memo<OnDeleteMessageReactionFunction<RoomKey>>;
    onUpdateMessagesOptimistically: Memo<OnUpdateMessagesOptimisticallyFunction<RoomKey, Message>>;
    inboxContext: InboxContext | null;
    targetPos?: number;
}): MenuCustomAction {
    assert(message.payload.type === "Content");

    const {payload} = message;

    return {
        withCustomLayout: true,
        // Don't close the context menu on press. Instead we want to open the reaction
        // picker.
        onPress: () => ({withoutClose: true}),
        renderWithStructure: ({isPressed, renderStructure, onCloseMenuWithAnimation}) => {
            let pos: number | "Files";

            // The context menu will add a reaction to the end of the message. Find the
            // position at the end of the message.
            if (payload.files.length > 0) {
                pos = "Files";
            } else if (message.stream === null) {
                pos = targetPos ?? payload.content.doc.content.size;
            } else {
                pos = targetPos ?? getMessageStreamContentEndPos(message);
            }

            let reactions;

            if (pos === "Files") {
                reactions = payload.filesReactions;
            } else {
                const messagePayload = fromMessagePayloadModel(message.payload);
                const result = findMessageReactionPosIfPossible({
                    message: {
                        payload: messagePayload,
                        stream: message.stream,
                    },
                    contentVersion: payload.contentUpdate?.mappings.length ?? 0,
                    pos,
                });

                if (result.ok) {
                    pos = result.value.pos;
                }

                reactions =
                    getMessageReactionsByCanonicalPos({
                        message: {
                            payload: messagePayload,
                            stream: message.stream,
                        },
                    }).get(pos) ?? emptyReactionSet;
            }

            return (
                <MessageViewContextMenuReactionButton
                    isPressed={isPressed}
                    renderStructure={renderStructure}
                    messageNoun={messageNoun}
                    roomKey={message.getRoomKey()}
                    messageIndex={message.index}
                    contentVersion={payload.contentUpdate?.mappings.length ?? 0}
                    pos={pos}
                    reactions={reactions}
                    onSetMessageReaction={onSetMessageReaction}
                    onDeleteMessageReaction={onDeleteMessageReaction}
                    onUpdateMessagesOptimistically={onUpdateMessagesOptimistically}
                    inboxContext={inboxContext}
                    onCloseMenuWithAnimation={onCloseMenuWithAnimation}
                />
            );
        },
    };
}

/**
 * Returns the global position immediately after the last stream content block.
 */
function getMessageStreamContentEndPos(message: MessageModel<string>): number {
    assert(message.payload.type === "Content");

    let pos = 0;

    if (!isContentEmpty(message.payload.content.doc)) {
        pos += message.payload.content.doc.content.size;
    }

    for (const part of message.stream?.parts ?? []) {
        if (part.payload.type !== "Content") continue;
        pos += part.payload.content.content.size;
    }

    return pos;
}
