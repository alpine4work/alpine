import {Memo, useEffect, useRef, useState} from "react";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageList} from "~/client/messaging/message_list";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {
    MessagingRealtimeMessageFromClient,
    MessagingRealtimeMessageFromServer,
} from "~/shared/messaging/messaging_realtime_schema";
import {MessageModel} from "~/shared/models/message_model";

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

    const hasBackfillFinishedRef = useRef(false);

    const handleRealtimeMessage = useEvent(
        (realtimeMessage: MessagingRealtimeMessageFromServer<Message>) => {
            switch (realtimeMessage.type) {
                case "BackfillMessagesResponse": {
                    hasBackfillFinishedRef.current = true;

                    onUpdateMessages(messages => {
                        switch (realtimeMessage.messageChangesResult.type) {
                            case "Available": {
                                return messages.backfillMessages({
                                    messageCount: realtimeMessage.messageCount,
                                    lastMessageChangeTime: realtimeMessage.lastMessageChangeTime,
                                    newMessages: realtimeMessage.newMessages,
                                    newOtherReferencedMessages:
                                        realtimeMessage.newOtherReferencedMessages,
                                    messageChanges: realtimeMessage.messageChangesResult.changes,
                                    typingStateByConnectionId:
                                        realtimeMessage.typingStateByConnectionId,
                                });
                            }

                            // If message changes are unavailable then fully reset the message list since
                            // we don't know if any loaded comments are correct. `<MessagingView>` should
                            // then be able to see we have rendered unloaded messages and kick off a new
                            // network request.
                            case "Unavailable": {
                                return MessageList.new({
                                    messageCount: realtimeMessage.messageCount,
                                    lastMessageChangeTime: realtimeMessage.lastMessageChangeTime,
                                    typingStateByConnectionId:
                                        realtimeMessage.typingStateByConnectionId,
                                });
                            }
                            default:
                                throw exhaustive(realtimeMessage.messageChangesResult);
                        }
                    });
                    break;
                }
                case "NewMessage": {
                    // Ignore until the backfill has finished
                    if (!hasBackfillFinishedRef.current) break;

                    onUpdateMessages(messages => {
                        messages = messages.addMessage(realtimeMessage.message);

                        if (realtimeMessage.updateOtherTypingState) {
                            messages = messages.updateTypingState(
                                realtimeMessage.updateOtherTypingState.connectionId,
                                realtimeMessage.updateOtherTypingState.typingState,
                            );
                        }

                        return messages;
                    });
                    break;
                }
                case "ChangeMessage": {
                    // Ignore until the backfill has finished
                    if (!hasBackfillFinishedRef.current) break;

                    onUpdateMessages(messages =>
                        messages.changeLoadedMessage(realtimeMessage.change),
                    );
                    break;
                }
                case "UpdateOtherTypingState": {
                    // Ignore until the backfill has finished
                    if (!hasBackfillFinishedRef.current) break;

                    onUpdateMessages(messages =>
                        messages.updateTypingState(
                            realtimeMessage.connectionId,
                            realtimeMessage.typingState,
                        ),
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
}
