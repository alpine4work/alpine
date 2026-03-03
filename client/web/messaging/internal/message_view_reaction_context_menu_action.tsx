import {Memo} from "react";
import {MenuCustomAction} from "~/client/web/design/menu.js";
import {InboxContext} from "~/client/web/inbox/inbox_context_types.js";
import {MessageViewContextMenuReactionButton} from "~/client/web/messaging/internal/message_view_context_menu_reaction_button.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    OnUpdateMessagesOptimisticallyFunction,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
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
}: {
    message: Message;
    messageNoun: string;
    onSetMessageReaction: Memo<OnSetMessageReactionFunction<RoomKey>>;
    onDeleteMessageReaction: Memo<OnDeleteMessageReactionFunction<RoomKey>>;
    onUpdateMessagesOptimistically: Memo<OnUpdateMessagesOptimisticallyFunction<RoomKey, Message>>;
    inboxContext: InboxContext | null;
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
                pos = payload.content.doc.content.size;
            } else {
                pos = 0;

                if (!isContentEmpty(payload.content.doc)) {
                    pos += payload.content.doc.content.size;
                }

                const usableStreamPartCount =
                    message.stream.parts.length -
                    // If the stream is incomplete then we can't react to the last part. Since the last
                    // part may still be receiving updates.
                    (message.stream.completedTime === null ? 1 : 0);

                for (let i = 0; i < usableStreamPartCount; i++) {
                    const part = message.stream.parts[i]!;
                    if (part.payload.type !== "Content") continue;
                    pos += part.payload.content.content.size;
                }
            }

            const reactions =
                pos === "Files"
                    ? payload.filesReactions
                    : (payload.reactionsByPos.get(pos) ?? emptyReactionSet);

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
