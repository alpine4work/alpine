import {ArrowArcRight, Copy, Link as LinkIcon} from "phosphor-react";
import {Memo} from "react";
import {writeContentToClipboard} from "~/client/web/content/write_content_to_clipboard.js";
import {useOutsideInteraction} from "~/client/web/design/helpers/use_outside_interaction.js";
import {Menu, MenuAction} from "~/client/web/design/menu.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {InboxContext} from "~/client/web/inbox/inbox_context_types.js";
import {MessageViewMenuStateUpdatedTime} from "~/client/web/messaging/internal/message_view_menu_state_updated_time.js";
import {messageViewReactionContextMenuAction} from "~/client/web/messaging/internal/message_view_reaction_context_menu_action.js";
import {MessageEditing} from "~/client/web/messaging/message_editing.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    OnUpdateMessagesOptimisticallyFunction,
} from "~/client/web/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cutMessageContentPayloadWithReferences} from "~/shared/messaging/cut_message_content_payload.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";

export function MessageViewTouchMenu<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    messageNoun,
    message,
    isReadOnly,
    top,
    left,
    messageEditing,
    getMessageUrl,
    onReplyToMessage,
    inboxContext,
    onSetMessageReaction,
    onDeleteMessageReaction,
    onUpdateMessagesOptimistically,
    onShowDeleteConfirmationDialog,
    isAnimatingOut,
    onCloseWithoutAnimation,
    onCloseWithAnimation,
}: {
    messageNoun: string;
    message: Message | OptimisticMessageModel;
    isReadOnly: boolean;
    top: number;
    left: number;
    messageEditing: MessageEditing<RoomKey>;
    getMessageUrl: (messageIndex: number) => URL;
    onReplyToMessage: () => void;
    inboxContext: InboxContext | null;
    onSetMessageReaction: Memo<OnSetMessageReactionFunction<RoomKey>>;
    onDeleteMessageReaction: Memo<OnDeleteMessageReactionFunction<RoomKey>>;
    onUpdateMessagesOptimistically: Memo<OnUpdateMessagesOptimisticallyFunction<RoomKey, Message>>;
    onShowDeleteConfirmationDialog: () => void;
    isAnimatingOut: boolean;
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
}) {
    const platform = usePlatform();
    const {currentAccount, space} = useSpaceContext();

    const menuActions: Array<MenuAction> = [];
    const contextMenuActions: Array<ReadonlyArray<MenuAction>> = [];

    // Don't allow replying if the message payload is empty. The UI shouldn't normally
    // allow saving an empty message payload. We allow empty message payloads for
    // messages that have attached files, however. In this special case we don't want
    // to allow the user to reply since the reply message will include no text.
    if (
        !isReadOnly &&
        !message.isOptimistic &&
        message.payload.type === "Content" &&
        (!isContentEmpty(message.payload.content.doc) ||
            (message.stream !== null &&
                message.stream.parts.some(
                    part =>
                        part.payload.type === "Content" && !isContentEmpty(part.payload.content),
                )))
    ) {
        contextMenuActions.push([
            {
                label: "Reply",
                icon: <ArrowArcRight />,
                iconPlacement: "end",
                onPress: onReplyToMessage,
            },
        ]);
        menuActions.push(
            messageViewReactionContextMenuAction({
                message,
                messageNoun,
                onSetMessageReaction,
                onDeleteMessageReaction,
                onUpdateMessagesOptimistically,
                inboxContext,
            }),
        );

        contextMenuActions.push(menuActions);
    }

    const copyMenuActions: Array<MenuAction> = [];
    contextMenuActions.push(copyMenuActions);

    if (message.payload.type === "Content") {
        copyMenuActions.push({
            label: "Copy text",
            icon: <Copy />,
            iconPlacement: "end",
            pressErrorTitle: `Couldn\u2019t copy ${messageNoun} text`,
            onPress: async () => {
                assert(message.payload.type === "Content");
                await writeContentToClipboard(
                    space.id,
                    cutMessageContentPayloadWithReferences({
                        payload: message.payload,
                        stream: message.stream,
                    }),
                    null,
                );
            },
        });
    }

    copyMenuActions.push({
        label: "Copy link",
        icon: <LinkIcon />,
        iconPlacement: "end",
        isDisabled: message.isOptimistic,
        pressErrorTitle: `Couldn\u2019t copy ${messageNoun} link`,
        onPress: async () => {
            if (message.isOptimistic) return;
            await writeTextToClipboard(getMessageUrl(message.index).toString());
        },
    });

    if (
        !isReadOnly &&
        currentAccount?.id === message.author.id &&
        message.payload.type === "Content" &&
        // Can't update or delete clerical messages.
        !message.payload.clerical
    ) {
        const messagePayload = message.payload;

        const editContextMenuActions: Array<MenuAction> = [];
        contextMenuActions.push(editContextMenuActions);

        // Don't allow editing if the message payload is empty. The UI shouldn't normally
        // allow saving an empty message payload. We allow empty message payloads for
        // messages that have attached files, however. In this special case we don't want
        // to allow the user to add text alongside the files.
        if (!isContentEmpty(messagePayload.content.doc)) {
            editContextMenuActions.push({
                label: "Edit",
                isDisabled: message.isOptimistic,
                onPress: () => {
                    if (message.isOptimistic) return;

                    messageEditing.dispatch({
                        type: "StartEditing",
                        messageIndex: message.index,
                        messageRoomKey: message.getRoomKey(),
                        messagePayload,
                        platform,
                        returnFocusAfterEditing: null,
                    });
                },
            });
        }

        editContextMenuActions.push({
            label: "Delete",
            onPress: onShowDeleteConfirmationDialog,
        });
    }

    return (
        <OverlayAnimated
            placement="bottom"
            offset="4"
            isVisible={!isAnimatingOut}
            disableAnimationIn={true}
            onActuallyVisibleChange={isActuallyVisible => {
                if (!isActuallyVisible) onCloseWithoutAnimation();
            }}
            isBlocking={true}
            overlay={
                <div ref={useOutsideInteraction(onCloseWithAnimation)}>
                    <Menu
                        actions={contextMenuActions}
                        extraBottom={
                            <MessageViewMenuStateUpdatedTime
                                createdTime={message.createdTime}
                                contentUpdatedTime={
                                    message.payload.type === "Content"
                                        ? (message.payload.contentUpdate?.time ?? null)
                                        : null
                                }
                                deletedTime={
                                    message.payload.type === "Deleted"
                                        ? message.payload.deletedTime
                                        : null
                                }
                            />
                        }
                        onCloseWithAnimation={onCloseWithAnimation}
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                    />
                </div>
            }
        >
            <div
                className={sprinkles({
                    position: "absolute",
                    pointerEvents: "none",
                    width: "0",
                    height: "0",
                })}
                style={{top, left}}
            ></div>
        </OverlayAnimated>
    );
}
