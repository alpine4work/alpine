/* eslint-disable @typescript-eslint/no-misused-promises */

import {useCallback, useEffect, useMemo, useState} from "react";
import {ChatAccountPicker} from "~/client/chat/chat_account_picker";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {MessagingView, getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useLazyLoadLoadRpc} from "~/client/rpc/use_lazy_load_rpc";
import {useSpaceContext} from "~/client/spaces/space_context";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view";
import {spacing} from "~/shared/design/spacing";
import {InternalError, UnimplementedError} from "~/shared/error/error";
import {emptyArray} from "~/shared/helpers/array/empty_array";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit";
import {AccountId, ChatId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {ChatMessageModel, ChatModel} from "~/shared/models/chat_model";
import {
    deleteChatMessage,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    getRecommendedChats,
    sendChatMessage,
    sendChatMessageToAccounts,
    updateChatMessageContent,
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
    const context = useAppContext();
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

    const chat = chatForChatKey?.chatKey === chatKey ? chatForChatKey.chat : exactMatch?.chat;

    return (
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
                const chatId: ChatId = (() => {
                    throw new UnimplementedError("TODO");
                })();
                return getChatMessagesFromStart(context, {...input, chatId});
            })}
            getMessagesFromEnd={useEvent(input => {
                const chatId: ChatId = (() => {
                    throw new UnimplementedError("TODO");
                })();
                return getChatMessagesFromEnd(context, {...input, chatId});
            })}
            createMessage={useEvent(async input => {
                if (!hasSelectedAccounts)
                    throw new InternalError("Must select account to send message");

                // When we don't know the `ChatId` we can use our `sendChatMessageToAccounts()`
                // function which will create a new chat for the provided accounts. Or if a
                // chat with the provided accounts already exists it will send to that chat.
                if (chat) {
                    await sendChatMessage(context, {
                        ...input,
                        chatId: chat.id,
                    });
                } else {
                    const {chat} = await sendChatMessageToAccounts(context, {
                        ...input,
                        spaceId: space.id,
                        otherAccountIds,
                    });

                    setChatForChatKey(chatForChatKey => {
                        if (chatForChatKey.chatKey !== chatKey) return chatForChatKey;
                        return {chatKey, chat};
                    });
                }
            })}
            updateMessageContent={useEvent(async input => {
                const chatId: ChatId = (() => {
                    throw new UnimplementedError("TODO");
                })();
                await updateChatMessageContent(context, {...input, chatId});
            })}
            deleteMessage={useEvent(async input => {
                const chatId: ChatId = (() => {
                    throw new UnimplementedError("TODO");
                })();
                await deleteChatMessage(context, {...input, chatId});
            })}
            getCopyLinkUrl={useCallback(() => {
                throw new UnimplementedError("TODO");
            }, [])}
        />
    );
}
