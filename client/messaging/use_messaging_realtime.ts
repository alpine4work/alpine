import {Memo, useEffect, useRef, useState} from "react";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {MessageList} from "~/client/messaging/message_list";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {
    BackfillMessagesProcedure,
    BackfillMessagesProcedureOutput,
    MessagingRealtimeEvent,
} from "~/shared/messaging/messaging_realtime_protocol";
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
    isConnected,
    backfillMessages,
    subscribeToEvents,
}: {
    messages: MessageList<Message>;
    onUpdateMessages: (
        update: (postComments: MessageList<Message>) => MessageList<Message>,
    ) => void;
    isConnected: boolean;
    backfillMessages: Memo<BackfillMessagesProcedure<Message>>;
    subscribeToEvents: Memo<
        (subscriber: (event: MessagingRealtimeEvent<Message>) => void) => () => void
    >;
}) {
    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    if (errorState.hasError) throw errorState.error;

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
                });
                break;
            }
            case "ChangeMessage": {
                // Ignore until the backfill has finished
                if (!hasBackfillFinishedRef.current) break;

                onUpdateMessages(messages => messages.changeLoadedMessage(event.change));
                break;
            }
            case "UpdateOtherTypingState": {
                // Ignore until the backfill has finished
                if (!hasBackfillFinishedRef.current) break;

                onUpdateMessages(messages =>
                    messages.updateTypingState(event.connectionId, event.typingState),
                );
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
    const handleBackfillResponse = useEvent((output: BackfillMessagesProcedureOutput<Message>) => {
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
        });
    });

    // Whenever we connect to the WebSocket, request a message backfill. If the
    // visits another browser tab this will disconnect the WebSocket then when the
    // user returns to this browser tab we will send another backfill.
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
            newMessageLimit: getInitialLoadMessageCount(getClientInfoWithoutListening()),
        }).then(
            output => {
                if (backfillPromiseRef.current !== backfillPromise) return;
                handleBackfillResponse(output);
            },
            error => {
                if (backfillPromiseRef.current !== backfillPromise) return;
                setErrorState({hasError: true, error});
            },
        );

        backfillPromiseRef.current = backfillPromise;
    }, [backfillMessages, handleBackfillResponse, isConnected]);
}
