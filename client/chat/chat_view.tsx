import {Memo, useCallback, useEffect, useRef} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {useWebSocket} from "~/client/cloudflare/use_web_socket.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {PrettyConjunctionList} from "~/client/design/pretty_conjunction_list.js";
import {messageViewMarginY} from "~/client/messaging/message_view.js";
import {MessagingView, MessagingViewRef} from "~/client/messaging/messaging_view.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
} from "~/shared/rpc/chat_rpc_definitions.js";
import {sprinkles} from "~/shared/styles/styles.js";

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
    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <ChatViewTopBar chat={chat} />
            <ChatMessagingView
                chat={chat}
                initialMessages={initialMessages}
                initialOtherReferencedMessages={initialOtherReferencedMessages}
                initialScrollToMessageIndex={initialScrollToMessageIndex}
            />
        </Box>
    );
}

function ChatViewTopBar({chat}: {chat: ChatModel}) {
    const isMobile = useIsMobile();
    const {currentAccount} = useSpaceContext();
    assert(chat.accounts.length > 0);

    // Exclude the current user from the list of accounts we display on top of the
    // chat unless this is a one-person chat with only the current user.
    const otherChatAccounts =
        chat.accounts.length === 1 && chat.accounts[0]!.id === currentAccount.id
            ? [currentAccount]
            : chat.accounts.filter(account => account.id !== currentAccount.id);

    const padding: Spacing = isMobile ? "3" : "5";

    return (
        <Box
            data-testid="ChatViewTopBar"
            flexShrink="0"
            borderBottom="grey-10"
            paddingX={padding}
            paddingY="3"
        >
            <Box height="6" display="flex" alignItems="center" gap="2">
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

    const {isConnected, procedures, subscribeToEvents} = useWebSocket(
        ChatRealtimeProtocol,
        `/api/durable-objects/chat/${chat.id}`,
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
            backfillMessages={procedures.backfillMessages}
            createMessage={procedures.createMessage}
            updateMessageContent={procedures.updateMessageContent}
            deleteMessage={procedures.deleteMessage}
            startTypingInMessageInput={procedures.startTypingInMessageInput}
            stopTypingInMessageInput={procedures.stopTypingInMessageInput}
            isConnected={isConnected}
            subscribeToEvents={subscribeToEvents}
            getMessageUrl={useCallback(
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
