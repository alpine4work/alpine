/* eslint-disable @typescript-eslint/no-misused-promises */

import {useCallback, useEffect, useMemo, useState} from "react";
import {ChatAccountPicker} from "~/client/chat/chat_account_picker";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {AppContextProvider, useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {MessagingView, getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useLazyLoadLoadRpc} from "~/client/rpc/use_lazy_load_rpc";
import {useSpaceContext} from "~/client/spaces/space_context";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view";
import {
    ChatRealtimeMessageFromClientSchema,
    ChatRealtimeMessageFromServer,
    ChatRealtimeMessageFromServerSchema,
} from "~/shared/chat/chat_realtime_schema";
import {spacing} from "~/shared/design/spacing";
import {InternalError, UnimplementedError} from "~/shared/error/error";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {cast} from "~/shared/helpers/control/cast";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit";
import {AccountId} from "~/shared/id/types/id_types";
import {MessagingRealtimeMessageFromServer} from "~/shared/messaging/messaging_realtime_schema";
import {AccountModel} from "~/shared/models/account_model";
import {ChatMessageModel, ChatModel} from "~/shared/models/chat_model";
import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    getRecommendedChats,
    sendChatMessageToAccounts,
} from "~/shared/rpc/chat_rpc_definitions";

export function ChatView() {
    const clientInfo = useClientInfo();
    const {space, currentAccount} = useSpaceContext();
    const [selectedAccounts, setSelectedAccounts] = useState<ReadonlyArray<AccountModel>>([]);

    // Canonicalize our selected accounts by:
    //
    // - Removing current account ID (current account is always included)
    // - Sorting account IDs
    // - Removing duplicate account IDs
    const otherAccountIds = useMemo(() => {
        const otherAccountIds = new Set(
            filterMapIterable(selectedAccounts, account =>
                account.id !== currentAccount.id ? account.id : null,
            ),
        );
        return Array.from(otherAccountIds).sort();
    }, [currentAccount.id, selectedAccounts]);

    // It's important that we check `selectedAccounts` is empty and not
    // `otherAccountIds`. If the user selects their own account then
    // `otherAccountIds` will be empty but we do want to load the user's chat
    // with themselves.
    const hasSelectedAccounts = selectedAccounts.length !== 0;

    const {output: recommendedChatsOutput} = useLazyLoadLoadRpc(
        getRecommendedChats,
        hasSelectedAccounts
            ? {
                  spaceId: space.id,
                  otherAccountIds,
                  exactMatchInitialMessagesLimit: getInitialLoadMessageCount(clientInfo),
              }
            : null,
        {keepPreviousData: true},
    );

    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <Box flexShrink="0" borderBottom="grey-10">
                <ChatAccountPicker
                    selectedAccounts={selectedAccounts}
                    setSelectedAccounts={setSelectedAccounts}
                />
            </Box>
            <ChatMessagingView
                hasSelectedAccounts={hasSelectedAccounts && !!recommendedChatsOutput}
                // We use the `otherAccountIds` from our output since the output might be stale
                // while we're fetching new recommended chats. We want all props passed to this
                // function to be consistent.
                otherAccountIds={recommendedChatsOutput?.input.otherAccountIds ?? emptyArray}
                exactMatch={recommendedChatsOutput?.exactMatch ?? null}
            />
        </Box>
    );
}

function ChatMessagingView({
    hasSelectedAccounts,
    otherAccountIds,
    exactMatch,
}: {
    hasSelectedAccounts: boolean;
    otherAccountIds: ReadonlyArray<AccountId>;
    exactMatch: {
        chat: ChatModel;
        initialMessages: ReadonlyArray<ChatMessageModel>;
        initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    } | null;
}) {
    const {space, currentAccount} = useSpaceContext();

    // The messaging header is empty space. It fills up the view height so your
    // first messages are pushed to the bottom of the screen. In the future we
    // should do something interesting with this empty space.
    const messagingHeader = useMemo((): DistributiveOmit<VirtualizedScrollViewItem, "key"> => {
        // When our view is full of messages this will be the top margin of the view.
        const height = spacing["3"];

        return {
            minHeight: height,
            withManualLayout: true,
            render: ({
                ref,
                shouldRenderWithRelativePositioning,
                offset,
                height: actualHeight,
                viewHeight,
                originalContentHeight,
            }) => (
                <div
                    ref={ref}
                    style={{
                        ...(shouldRenderWithRelativePositioning
                            ? {position: "relative", height}
                            : {
                                  position: "absolute",
                                  top: offset,
                                  left: 0,
                                  right: 0,
                                  height: `max(${height}, ${
                                      viewHeight - (originalContentHeight - actualHeight)
                                  }px)`,
                              }),
                    }}
                />
            ),
        };
    }, []);

    const chatKey = useMemo(
        () => [currentAccount.id, ...otherAccountIds].sort().join("-"),
        [currentAccount.id, otherAccountIds],
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
                header={messagingHeader}
                randomSeedForShimmer={chatKey}
                isMessageCreationDisabled={!hasSelectedAccounts}
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
                                otherAccountIds,
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
                    [chat, chatKey, context, otherAccountIds, sendRealtimeMessage, space.id],
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
                getCopyLinkUrl={useCallback(() => {
                    throw new UnimplementedError("TODO");
                }, [])}
            />
        </AppContextProvider>
    );
}
