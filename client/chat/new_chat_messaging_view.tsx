/* eslint-disable @typescript-eslint/no-misused-promises */

import {useCallback, useRef} from "react";
import {chatMessagingHeader} from "~/client/chat/chat_view.js";
import {useWebSocket} from "~/client/cloudflare/use_web_socket.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {MessagingView} from "~/client/messaging/messaging_view.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {InternalError} from "~/shared/error/error.js";
import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
} from "~/shared/rpc/chat_rpc_definitions.js";

export function NewChatMessagingView({
    selectedChat,
}: {
    selectedChat: {
        chat: ChatModel;
        initialMessages: ReadonlyArray<ChatMessageModel>;
        initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    } | null;
}) {
    const context = useAppContext();

    const {isConnected, procedures, subscribeToEvents} = useWebSocket(
        ChatRealtimeProtocol,
        selectedChat ? `/api/durable-objects/chat/${selectedChat.chat.id}` : null,
    );

    // This ref is used to preserve the message input state across React key
    // changes. `<MessageInput>` will write state changes to the ref and initialize
    // its state from the ref on remount.
    const inputRestoreStateRef = useRef(null);

    return (
        <MessagingView
            key={selectedChat?.chat.id ?? "unknown"}
            initialScrollOffset="bottom"
            initialMessagesResult={
                selectedChat
                    ? {
                          messageCount: selectedChat.chat.messageCount,
                          messages: selectedChat.initialMessages,
                          otherReferencedMessages: selectedChat.initialOtherReferencedMessages,
                          lastMessageChangeTime: selectedChat.chat.lastMessageChangeTime,
                      }
                    : {
                          messageCount: 0,
                          messages: [],
                          otherReferencedMessages: [],
                          lastMessageChangeTime: null,
                      }
            }
            header={chatMessagingHeader}
            randomSeedForShimmer={selectedChat?.chat.id ?? "unknown"}
            isMessageCreationDisabled={!selectedChat}
            getMessagesFromStart={useEvent(input => {
                if (!selectedChat) {
                    throw new InternalError("Can not load messages when we don't know the chat");
                }
                return getChatMessagesFromStart(context, {...input, chatId: selectedChat.chat.id});
            })}
            getMessagesFromEnd={useEvent(input => {
                if (!selectedChat) {
                    throw new InternalError("Can not load messages when we don't know the chat");
                }
                return getChatMessagesFromEnd(context, {...input, chatId: selectedChat.chat.id});
            })}
            backfillMessages={procedures.backfillMessages}
            createMessage={procedures.createMessage}
            updateMessageContent={procedures.updateMessageContent}
            deleteMessage={procedures.deleteMessage}
            startTypingInMessageInput={useCallback(
                async input => {
                    // May be called when we don't have a selected chat.
                    if (!selectedChat) return {};

                    return procedures.startTypingInMessageInput(input);
                },
                [procedures, selectedChat],
            )}
            stopTypingInMessageInput={useCallback(
                async input => {
                    // May be called when we don't have a selected chat.
                    if (!selectedChat) return {};

                    return procedures.stopTypingInMessageInput(input);
                },
                [procedures, selectedChat],
            )}
            isConnected={isConnected}
            subscribeToEvents={subscribeToEvents}
            getMessageUrl={useCallback(
                messageIndex => {
                    // This should never throw through (mostly) coincidence. The only messages you
                    // should see when we don't know the chat are optimistic messages. You can not
                    // copy the link of an optimistic message because we don't know the index. We
                    // get the index when we connect to realtime when we discover the chat ID.
                    // Therefore to have a message index we need a chat.
                    if (!selectedChat) {
                        throw new InternalError(
                            "Should not be able to copy link of chat message when we don't know the chat",
                        );
                    }
                    return new URL(
                        `/s/${selectedChat.chat.spaceId}/chat/${selectedChat.chat.id}?message=${messageIndex}`,
                        window.location.href,
                    );
                },
                [selectedChat],
            )}
            inputRestoreStateRef={inputRestoreStateRef}
        />
    );
}
