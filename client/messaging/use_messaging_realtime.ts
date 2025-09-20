import {Memo, useEffect, useRef} from "react";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
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

/**
 * Sets up a realtime connection for the provided post. Making sure comments
 * are kept up-to-date in realtime.
 */
export function useMessagingRealtime<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
    BackfillMessagesExtra = null,
>({
    messages,
    onUpdateMessages,
    isConnected,
    backfillMessages,
    subscribeToEvents,
}: {
    messages: MessageList<Message>;
    onUpdateMessages: (
        update: (messages: MessageList<Message>) => MessageList<Message>,
        extra: BackfillMessagesExtra | null,
    ) => void;
    isConnected: boolean;
    backfillMessages: Memo<
        (input: {
            clientMessageCount: number;
            clientLastMessageChangeTime: Date | null;
            newMessageLimit: number;
        }) => Promise<BackfillMessagesProcedureOutput<Message> & {extra?: BackfillMessagesExtra}>
    >;
    subscribeToEvents: Memo<
        (subscriber: (event: MessagingRealtimeEvent<Message>) => void) => () => void
    >;
}) {
    const setErrorState = useErrorState();

    const hasBackfillFinishedRef = useRef(false);

    const handleEvent = useEvent((event: MessagingRealtimeEvent<Message>) => {
        switch (event.type) {
            case "NewMessage": {
                // Ignore until the backfill has finished
                if (!hasBackfillFinishedRef.current) break;

                onUpdateMessages(messages => {
                    messages = messages.addMessage(event.message);

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
            case "ChangeMessage": {
                // Ignore until the backfill has finished
                if (!hasBackfillFinishedRef.current) break;

                onUpdateMessages(messages => messages.changeLoadedMessage(event.change), null);
                break;
            }
            case "UpdateOtherTypingState": {
                // Ignore until the backfill has finished
                if (!hasBackfillFinishedRef.current) break;

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
            default:
                throw exhaustive(event);
        }
    });

    useEffect(() => {
        if (!isConnected) return;
        return subscribeToEvents(handleEvent);
    }, [handleEvent, isConnected, subscribeToEvents]);

    const messagesRef = useRef(messages);
    useLayoutEffectWithoutServerSideWarning(() => {
        messagesRef.current = messages;
    });

    // Important that this is in a `useEvent()` so we have access to the latest
    // `onUpdateMessages()` reference.
    const handleBackfillResponse = useEvent(
        (output: BackfillMessagesProcedureOutput<Message> & {extra?: BackfillMessagesExtra}) => {
            hasBackfillFinishedRef.current = true;

            onUpdateMessages(messages => {
                switch (output.messageChangesResult.type) {
                    case "Available": {
                        return messages.backfillMessages({
                            messageCount: output.messageCount,
                            lastMessageChangeTime: output.lastMessageChangeTime,
                            newMessages: output.newMessages,
                            newOtherReferencedMessages: output.newOtherReferencedMessages,
                            messageChanges: output.messageChangesResult.changes,
                            typingStateByConnectionId: output.typingStateByConnectionId,
                        });
                    }

                    // If message changes are unavailable then fully reset the message list since
                    // we don't know if any loaded comments are correct. `<MessagingView>` should
                    // then be able to see we have rendered unloaded messages and kick off a new
                    // network request.
                    case "Unavailable": {
                        return MessageList.new({
                            messageCount: output.messageCount,
                            lastMessageChangeTime: output.lastMessageChangeTime,
                            typingStateByConnectionId: output.typingStateByConnectionId,
                        });
                    }
                    default:
                        throw exhaustive(output.messageChangesResult);
                }
            }, output.extra ?? null);
        },
    );

    // Whenever we connect to the WebSocket, request a message backfill. If the
    // user visits another browser tab this will disconnect the WebSocket then when
    // the user returns to this browser tab we will send another backfill.
    const backfillPromiseRef = useRef<Promise<void> | null>(null);
    useEffect(() => {
        if (!isConnected) {
            backfillPromiseRef.current = null;
            return;
        }

        if (backfillPromiseRef.current) return;

        const backfillPromise = backfillMessages({
            clientMessageCount: messagesRef.current.getMessageCountExcludingOptimisticMessages(),
            clientLastMessageChangeTime: messagesRef.current.getLastMessageChangeTime(),
            newMessageLimit: getInitialLoadMessageCount(getClientInfo()),
        }).then(
            output => {
                if (backfillPromiseRef.current !== backfillPromise) return;
                handleBackfillResponse(output);
            },
            error => {
                if (backfillPromiseRef.current !== backfillPromise) return;
                setErrorState(error);
            },
        );

        backfillPromiseRef.current = backfillPromise;
    }, [backfillMessages, handleBackfillResponse, isConnected, setErrorState]);
}
