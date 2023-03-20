/* eslint-disable @typescript-eslint/no-misused-promises */

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {chatMessagingHeader} from "~/client/chat/chat_view";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {AppContextProvider, useAppContext} from "~/client/context/app_context";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {MessagingView} from "~/client/messaging/messaging_view";
import {useSpaceContext} from "~/client/spaces/space_context";
import {
    ChatRealtimeMessageFromClientSchema,
    ChatRealtimeMessageFromServer,
    ChatRealtimeMessageFromServerSchema,
} from "~/shared/chat/chat_realtime_schema";
import {InternalError} from "~/shared/error/error";
import {cast} from "~/shared/helpers/control/cast";
import {MessagingRealtimeMessageFromServer} from "~/shared/messaging/messaging_realtime_schema";
import {AccountModel} from "~/shared/models/account_model";
import {ChatMessageModel, ChatModel} from "~/shared/models/chat_model";
import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    sendChatMessageToAccounts,
} from "~/shared/rpc/chat_rpc_definitions";

export function NewChatMessagingView({
    selectedAccounts,
    exactMatch,
}: {
    selectedAccounts: ReadonlyArray<AccountModel>;
    exactMatch: {
        chat: ChatModel;
        initialMessages: ReadonlyArray<ChatMessageModel>;
        initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    } | null;
}) {
    const {space, currentAccount} = useSpaceContext();

    const chatKey = useMemo(
        () =>
            Array.from(
                new Set([currentAccount.id, ...selectedAccounts.map(account => account.id)].sort()),
            ).join("-"),
        [currentAccount.id, selectedAccounts],
    );

    // We may not know the `ChatId` for this view initially but after sending a
    // message we should discover the `ChatId` and put it in this state.
    const [chatForChatKey, setChatForChatKey] = useState<{chatKey: string; chat: ChatModel | null}>(
        {chatKey, chat: null},
    );

    // Reset the chat when `chatKey` changes.
    useEffect(() => {
        setChatForChatKey(chatForChatKey => {
            if (chatForChatKey.chatKey === chatKey) return chatForChatKey;
            return {chatKey, chat: null};
        });
    }, [chatKey]);

    const chat =
        exactMatch?.chat ?? (chatForChatKey?.chatKey === chatKey ? chatForChatKey.chat : null);

    // Make sure we include the `ChatId` in our context's propagated data. Normally
    // this is set by the route loader but because new chats may not know the
    // `ChatId` in the URL we should set it again here.
    const _context = useAppContext();
    const context = useMemo(() => {
        if (!chat) return _context;
        return _context.tracer.withPropagatedData({context: {chatId: chat.id}});
    }, [_context, chat]);

    const {
        isConnected: isRealtimeConnected,
        sendMessage: sendRealtimeMessage,
        subscribeToMessages: subscribeToRealtimeMessages,
    } = useWebSocket(
        ChatRealtimeMessageFromClientSchema,
        ChatRealtimeMessageFromServerSchema,
        chat ? `/durable-objects/chat/${chat.id}` : null,
    );

    // This ref is used to preserve the message input state across React key
    // changes. `<MessageInput>` will write state changes to the ref and initialize
    // its state from the ref on remount.
    const inputStateRef = useRef(null);

    return (
        <AppContextProvider value={context}>
            <MessagingView
                key={chatKey}
                initialScrollOffset="bottom"
                initialMessagesResult={
                    exactMatch
                        ? {
                              messageCount: exactMatch.chat.messageCount,
                              messages: exactMatch.initialMessages,
                              otherReferencedMessages: exactMatch.initialOtherReferencedMessages,
                              lastMessageChangeTime: exactMatch.chat.lastMessageChangeTime,
                          }
                        : {
                              messageCount: 0,
                              messages: [],
                              otherReferencedMessages: [],
                              lastMessageChangeTime: null,
                          }
                }
                header={chatMessagingHeader}
                randomSeedForShimmer={chat?.id ?? chatKey}
                isMessageCreationDisabled={selectedAccounts.length === 0}
                getMessagesFromStart={useEvent(input => {
                    if (!chat) {
                        throw new InternalError(
                            "Can not load messages when we don't know the chat",
                        );
                    }
                    return getChatMessagesFromStart(context, {...input, chatId: chat.id});
                })}
                getMessagesFromEnd={useEvent(input => {
                    if (!chat) {
                        throw new InternalError(
                            "Can not load messages when we don't know the chat",
                        );
                    }
                    return getChatMessagesFromEnd(context, {...input, chatId: chat.id});
                })}
                isRealtimeConnected={isRealtimeConnected}
                sendRealtimeMessage={useCallback(
                    async message => {
                        // When we don't know the `ChatId` we can use our `sendChatMessageToAccounts()`
                        // function which will create a new chat for the provided accounts. Or if a
                        // chat with the provided accounts already exists it will send to that chat.
                        if (message.type === "CreateMessage" && !chat) {
                            const {chat} = await sendChatMessageToAccounts(context, {
                                spaceId: space.id,
                                otherAccountIds: selectedAccounts.map(account => account.id),
                                parentMessageIndex: message.parentMessageIndex,
                                content: message.content,
                            });

                            setChatForChatKey(chatForChatKey => {
                                if (chatForChatKey.chatKey !== chatKey) return chatForChatKey;
                                return {chatKey, chat};
                            });
                        } else {
                            await sendRealtimeMessage({type: "ChatMessages", message});
                        }
                    },
                    [chat, chatKey, context, selectedAccounts, sendRealtimeMessage, space.id],
                )}
                subscribeToRealtimeMessages={useCallback(
                    (
                        subscriber: (
                            message: MessagingRealtimeMessageFromServer<ChatMessageModel>,
                        ) => void,
                    ) => {
                        const actualSubscriber = (message: ChatRealtimeMessageFromServer) => {
                            // TypeScript will error if we ever add other message types here. At that point
                            // this code should turn into a switch.
                            cast<"ChatMessages">(message.type);
                            subscriber(message.message);
                        };

                        return subscribeToRealtimeMessages(actualSubscriber);
                    },
                    [subscribeToRealtimeMessages],
                )}
                getCopyLinkUrl={useCallback(
                    messageIndex => {
                        // This should never throw through (mostly) coincidence. The only messages you
                        // should see when we don't know the chat are optimistic messages. You can not
                        // copy the link of an optimistic message because we don't know the index. We
                        // get the index when we connect to realtime when we discover the chat ID.
                        // Therefore to have a message index we need a chat.
                        if (!chat) {
                            throw new InternalError(
                                "Should not be able to copy link of chat message when we don't know the chat",
                            );
                        }
                        return new URL(
                            `/s/${chat.spaceId}/chat/${chat.id}?message=${messageIndex}`,
                            window.location.href,
                        );
                    },
                    [chat],
                )}
                inputStateRef={inputStateRef}
            />
        </AppContextProvider>
    );
}
