import {Memo, useEffect, useMemo, useRef, useState} from "react";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageList} from "~/client/messaging/message_list";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context";
import {MessageContent} from "~/shared/content/message_content_schema";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {
    MessagingRealtimeMessageFromClient,
    MessagingRealtimeMessageFromServer,
} from "~/shared/messaging/messaging_realtime_schema";
import {MessageModel} from "~/shared/models/message_model";

export type MessagingRealtimeActions = {
    createMessage(input: {
        parentMessageIndex: number | null;
        content: MessageContent;
    }): Promise<void>;
    updateMessageContent(input: {messageIndex: number; content: MessageContent}): Promise<void>;
    deleteMessage(input: {messageIndex: number}): Promise<void>;
};

/**
 * Sets up a realtime connection for the provided post. Making sure comments
 * are kept up-to-date in realtime.
 */
export function useMessagingRealtime<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    messages,
    onUpdateMessages,
    isRealtimeConnected,
    sendRealtimeMessage,
    subscribeToRealtimeMessages,
}: {
    messages: MessageList<Message>;
    onUpdateMessages: (
        update: (postComments: MessageList<Message>) => MessageList<Message>,
    ) => void;
    isRealtimeConnected: boolean;
    sendRealtimeMessage: Memo<(message: MessagingRealtimeMessageFromClient) => Promise<void>>;
    subscribeToRealtimeMessages: Memo<
        (subscriber: (message: MessagingRealtimeMessageFromServer<Message>) => void) => () => void
    >;
}) {
    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    if (errorState.hasError) throw errorState.error;

    const handleRealtimeMessage = useEvent(
        (realtimeMessage: MessagingRealtimeMessageFromServer<Message>) => {
            switch (realtimeMessage.type) {
                case "BackfillMessagesResponse": {
                    onUpdateMessages(messages => {
                        switch (realtimeMessage.messageChangesResult.type) {
                            case "Available": {
                                messages = messages.loadMessages({
                                    messageCount: realtimeMessage.messageCount,
                                    messages: realtimeMessage.newMessages,
                                    otherReferencedMessages:
                                        realtimeMessage.newOtherReferencedMessages,
                                });

                                messages = messages.setLastMessageChangeTime(
                                    realtimeMessage.lastMessageChangeTime,
                                );

                                messages = realtimeMessage.messageChangesResult.changes.reduce(
                                    (messages, change) => messages.changeLoadedMessage(change),
                                    messages,
                                );

                                return messages;
                            }

                            // If message changes are unavailable then fully reset the message list since
                            // we don't know if any loaded comments are correct. `<MessagingView>` should
                            // then be able to see we have rendered unloaded messages and kick off a new
                            // network request.
                            case "Unavailable": {
                                return MessageList.new({
                                    messageCount: realtimeMessage.messageCount,
                                    lastMessageChangeTime: realtimeMessage.lastMessageChangeTime,
                                });
                            }
                            default:
                                throw exhaustive(realtimeMessage.messageChangesResult);
                        }
                    });
                    break;
                }
                case "NewMessage": {
                    onUpdateMessages(messages => messages.addMessage(realtimeMessage.message));
                    break;
                }
                case "ChangeMessage": {
                    onUpdateMessages(messages =>
                        messages.changeLoadedMessage(realtimeMessage.change),
                    );
                    break;
                }
                default:
                    throw exhaustive(realtimeMessage);
            }
        },
    );

    useEffect(() => {
        if (!isRealtimeConnected) return;
        return subscribeToRealtimeMessages(handleRealtimeMessage);
    }, [handleRealtimeMessage, isRealtimeConnected, subscribeToRealtimeMessages]);

    const messagesRef = useRef(messages);
    useLayoutEffectWithoutServerSideWarning(() => {
        messagesRef.current = messages;
    });

    // Whenever we connect to the WebSocket, request a message backfill. If the
    // visits another browser tab this will disconnect the WebSocket then when the
    // user returns to this browser tab we will send another backfill.
    const wasRealtimeConnectedRef = useRef(false);
    useEffect(() => {
        if (!isRealtimeConnected) {
            wasRealtimeConnectedRef.current = false;
            return;
        }

        if (wasRealtimeConnectedRef.current) return;
        wasRealtimeConnectedRef.current = true;

        sendRealtimeMessage({
            type: "BackfillMessagesRequest",
            clientMessageCount: messagesRef.current.getMessageCountExcludingOptimisticMessages(),
            clientLastMessageChangeTime: messagesRef.current.getLastMessageChangeTime(),
            newMessageLimit: getInitialLoadMessageCount(getClientInfoWithoutListening()),
        }).catch(error => setErrorState({hasError: true, error}));
    }, [isRealtimeConnected, sendRealtimeMessage]);

    const actions = useMemo((): MessagingRealtimeActions => {
        return {
            createMessage: input =>
                sendRealtimeMessage({
                    type: "CreateMessage",
                    ...input,
                }),
            updateMessageContent: input =>
                sendRealtimeMessage({
                    type: "UpdateMessageContent",
                    ...input,
                }),
            deleteMessage: input =>
                sendRealtimeMessage({
                    type: "DeleteMessage",
                    ...input,
                }),
        };
    }, [sendRealtimeMessage]);

    return {
        actions,
    };
}
