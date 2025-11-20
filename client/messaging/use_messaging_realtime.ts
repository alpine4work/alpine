import {Memo, useEffect, useRef} from "react";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useErrorState} from "~/client/helpers/use_error_state.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {
    BackfillMessagesProcedureOutput,
    MessagingRealtimeEvent,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

/**
 * Sets up a realtime connection for the provided post. Making sure comments
 * are kept up-to-date in realtime.
 */
export function useMessagingRealtime<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
    BackfillMessagesExtra = null,
>({
    isConnected,
    messages,
    onUpdateMessages: onUpdateMessagesFromProps,
    backfillMessages,
    subscribeToEvents,
    subscribeToPongs,
}: {
    isConnected: boolean;
    messages: MessageList<Message>;
    onUpdateMessages: (
        update: (messages: MessageList<Message>) => MessageList<Message>,
        extra: BackfillMessagesExtra | null,
    ) => void;
    backfillMessages: Memo<
        (input: {
            checkpoint: ServerSynchronizationCheckpoint;
            clientMessageCount: number;
            newMessageLimit: number;
        }) => Promise<BackfillMessagesProcedureOutput<Message> & {extra?: BackfillMessagesExtra}>
    >;
    subscribeToEvents: Memo<
        (subscriber: (event: MessagingRealtimeEvent<Message>) => void) => () => void
    >;
    subscribeToPongs: Memo<(subscriber: (message: WebSocketPongMessage) => void) => () => void>;
}) {
    const setErrorState = useErrorState();

    const onUpdateMessages = useEvent(onUpdateMessagesFromProps);

    const handleEvent = useEvent((event: MessagingRealtimeEvent<Message>) => {
        switch (event.type) {
            case "NewMessage": {
                onUpdateMessages(messages => {
                    if (!messages.isCheckpointInitialized()) return messages;

                    messages = messages.setMessage(event.message);

                    if (event.updateOtherTypingState) {
                        messages = messages.updateTypingState(
                            event.updateOtherTypingState.connectionId,
                            event.updateOtherTypingState.typingState,
                        );
                    }

                    return messages;
                }, null);
                break;
            }
            case "UpdateMessage": {
                onUpdateMessages(messages => {
                    if (!messages.isCheckpointInitialized()) return messages;

                    return messages.setMessage(event.message);
                }, null);
                break;
            }
            case "UpdateOtherTypingState": {
                onUpdateMessages(
                    messages => messages.updateTypingState(event.connectionId, event.typingState),
                    null,
                );
                break;
            }
            case "PutMessageStreamPart": {
                onUpdateMessages(messages => messages.putMessageStreamPart(event), null);
                break;
            }
            case "CompleteMessageStream": {
                onUpdateMessages(messages => messages.completeMessageStream(event), null);
                break;
            }
            case "PingMessageStream": {
                onUpdateMessages(messages => messages.pingMessageStream(event), null);
                break;
            }
            default:
                throw exhaustive(event);
        }
    });

    // Subscribe to realtime events that may change what's in message list.
    useEffect(() => {
        return subscribeToEvents(handleEvent);
    }, [handleEvent, subscribeToEvents]);

    // Whenever we get a pong from the WebSocket, update our checkpoint so we know
    // data is up-to-date as of this new time.
    useEffect(() => {
        return subscribeToPongs(({checkpoint}) => {
            if (messages.isCheckpointInitialized()) {
                messages.setMutableCheckpoint(checkpoint);
            } else {
                onUpdateMessages(
                    messages => messages.initializeCheckpointIfNeeded(checkpoint),
                    null,
                );
            }
        });
    }, [messages, onUpdateMessages, subscribeToPongs]);

    // Whenever we connect, we need to backfill changes from when we initially read
    // inbox entries until now. That way if any realtime events happened during
    // that time we can incorporate them into our state instead of completely
    // missing them.
    const wasConnectedRef = useRef(false);
    useEffect(() => {
        if (!messages.isCheckpointInitialized()) return;

        if (!isConnected) {
            wasConnectedRef.current = false;
            return;
        }

        if (wasConnectedRef.current) return;
        wasConnectedRef.current = true;

        backfillMessages({
            checkpoint: messages.getMutableCheckpoint(),
            clientMessageCount: messages.getMessageCountExcludingOptimisticMessages(),
            newMessageLimit: getInitialLoadMessageCount(getClientInfo()),
        }).then(
            output => {
                switch (output.messageUpdatesResult.type) {
                    case "Available": {
                        const {messageUpdatesResult} = output;

                        onUpdateMessages(messages => {
                            const newMessages = messages.backfillMessages({
                                messageCount: output.messageCount,
                                newMessages: output.newMessages,
                                newOtherReferencedMessages: output.newOtherReferencedMessages,
                                updatedMessages: messageUpdatesResult.messages,
                                typingStateByConnectionId: output.typingStateByConnectionId,
                            });

                            newMessages.setMutableCheckpoint(messageUpdatesResult.checkpoint);

                            return newMessages;
                        }, output.extra ?? null);
                        break;
                    }

                    // If message changes are unavailable then fully reset the message list since
                    // we don't know if any loaded comments are correct. `<MessagingView>` should
                    // then be able to see we have rendered unloaded messages and kick off a new
                    // network request.
                    case "Unavailable": {
                        onUpdateMessages(() => {
                            return MessageList.new({
                                checkpoint: messages.getMutableCheckpoint(),
                                messageCount: output.messageCount,
                                typingStateByConnectionId: output.typingStateByConnectionId,
                            });
                        }, output.extra ?? null);
                        break;
                    }
                    default:
                        throw exhaustive(output.messageUpdatesResult);
                }
            },
            error => setErrorState(error),
        );
    }, [backfillMessages, isConnected, messages, onUpdateMessages, setErrorState]);
}
