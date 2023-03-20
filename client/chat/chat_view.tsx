import {Memo, useCallback, useEffect, useRef} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {PrettyConjunctionList} from "~/client/design/pretty_conjunction_list";
import {messageViewMarginY} from "~/client/messaging/message_view";
import {MessagingView, MessagingViewRef} from "~/client/messaging/messaging_view";
import {useSpaceContext} from "~/client/spaces/space_context";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view";
import {
    ChatRealtimeMessageFromClientSchema,
    ChatRealtimeMessageFromServer,
    ChatRealtimeMessageFromServerSchema,
} from "~/shared/chat/chat_realtime_schema";
import {spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {cast} from "~/shared/helpers/control/cast";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit";
import {MessagingRealtimeMessageFromServer} from "~/shared/messaging/messaging_realtime_schema";
import {ChatMessageModel, ChatModel} from "~/shared/models/chat_model";
import {getChatMessagesFromEnd, getChatMessagesFromStart} from "~/shared/rpc/chat_rpc_definitions";
import {sprinkles} from "~/shared/styles/styles";

export function ChatView({
    chat,
    initialMessages,
    initialOtherReferencedMessages,
    initialScrollToMessageIndex,
}: {
    chat: ChatModel;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    initialScrollToMessageIndex: number | null;
}) {
    const {currentAccount} = useSpaceContext();
    assert(chat.accounts.length > 0);
    const otherChatAccounts = chat.accounts.filter(account => account.id !== currentAccount.id);

    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <Box
                flexShrink="0"
                borderBottom="grey-10"
                height="12"
                display="flex"
                alignItems="center"
                paddingX="5"
                gap="2"
            >
                <Box paddingX="0.5">
                    <AccountAvatarPile
                        size="6"
                        previewAccounts={otherChatAccounts.slice(0, 4)}
                        accountCount={otherChatAccounts.length}
                        getAllAccounts={() => otherChatAccounts}
                    />
                </Box>
                <h1
                    className={sprinkles({
                        fontStyle: "truncate-semi-bold",
                        fontSize: "200",
                    })}
                >
                    <PrettyConjunctionList
                        list={otherChatAccounts.map(account => (
                            <AccountShortName key={account.id} account={account} />
                        ))}
                    />
                </h1>
            </Box>
            <ChatMessagingView
                chat={chat}
                initialMessages={initialMessages}
                initialOtherReferencedMessages={initialOtherReferencedMessages}
                initialScrollToMessageIndex={initialScrollToMessageIndex}
            />
        </Box>
    );
}

/**
 * The messaging header is empty space. It fills up the view height so your
 * first messages are pushed to the bottom of the screen. In the future we
 * should do something interesting with this empty space.
 */
export const chatMessagingHeader = ((): DistributiveOmit<VirtualizedScrollViewItem, "key"> => {
    // When our view is full of messages this will be the top margin of the view.
    const height = spacing[messageViewMarginY];

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
                    // NOTE(calebmer): On initial render we don't know the view height so this
                    // header won't push other messages down. So you end up with a flash when
                    // server-rendering a chat with few messages where messages jump down. A flash
                    // we choose to accept since correct implementations are annoying.
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
})() as Memo<DistributiveOmit<VirtualizedScrollViewItem, "key">>;

function ChatMessagingView({
    chat,
    initialMessages,
    initialOtherReferencedMessages,
    initialScrollToMessageIndex,
}: {
    chat: ChatModel;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    initialScrollToMessageIndex: number | null;
}) {
    const context = useAppContext();
    const messagingRef = useRef<MessagingViewRef>(null);

    const {
        isConnected: isRealtimeConnected,
        sendMessage: sendRealtimeMessage,
        subscribeToMessages: subscribeToRealtimeMessages,
    } = useWebSocket(
        ChatRealtimeMessageFromClientSchema,
        ChatRealtimeMessageFromServerSchema,
        chat ? `/durable-objects/chat/${chat.id}` : null,
    );

    const hasInitializedRef = useRef(false);

    // TODO(calebmer): Support server-side rendering for immediately jumping to a
    // comment in the middle of a post. This will make transitions seamless when
    // you click on a link to a comment.
    useEffect(() => {
        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;

        const messaging = assertExists(messagingRef.current);

        if (initialScrollToMessageIndex !== null)
            messaging.jumpToMessageIndex(initialScrollToMessageIndex);
    }, [initialScrollToMessageIndex]);

    return (
        <MessagingView
            ref={messagingRef}
            initialScrollOffset="bottom"
            initialMessagesResult={{
                messageCount: chat.messageCount,
                messages: initialMessages,
                otherReferencedMessages: initialOtherReferencedMessages,
                lastMessageChangeTime: chat.lastMessageChangeTime,
            }}
            header={chatMessagingHeader}
            randomSeedForShimmer={chat.id}
            getMessagesFromStart={useCallback(
                input => getChatMessagesFromStart(context, {...input, chatId: chat.id}),
                [chat.id, context],
            )}
            getMessagesFromEnd={useCallback(
                input => getChatMessagesFromEnd(context, {...input, chatId: chat.id}),
                [chat.id, context],
            )}
            isRealtimeConnected={isRealtimeConnected}
            sendRealtimeMessage={useCallback(
                message => sendRealtimeMessage({type: "ChatMessages", message}),
                [sendRealtimeMessage],
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
                messageIndex =>
                    new URL(
                        `/s/${chat.spaceId}/chat/${chat.id}?message=${messageIndex}`,
                        window.location.href,
                    ),
                [chat.id, chat.spaceId],
            )}
        />
    );
}
