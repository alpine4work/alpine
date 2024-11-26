import {ArrowLeft} from "phosphor-react";
import {useCallback, useEffect, useRef} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {chatMessagingViewHeaderItem} from "~/client/chat/internal/chat_messaging_view_header_item.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {PrettyConjunctionList} from "~/client/design/pretty_conjunction_list.js";
import {safeAreaOnlyScrollbarInsetTop} from "~/client/design/scrollbar.js";
import {Spacer} from "~/client/design/spacer.js";
import {MessagingView, MessagingViewRef} from "~/client/messaging/messaging_view.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {chatViewTopBarWithInboxBannerAdjustmentY} from "~/client/styles/chat_shared_styles.js";
import {inboxBannerHeight} from "~/client/styles/inbox_shared_styles.js";
import {messageViewMaxWidth} from "~/client/styles/messaging_shared_styles.js";
import {sprinkles} from "~/client/styles/styles.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {addRemLengths, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
} from "~/shared/rpc/chat_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ChatView({
    withInboxBanner,
    chat,
    initialMessages,
    initialOtherReferencedMessages,
    initialScrollToMessageIndex,
}: {
    withInboxBanner: boolean;
    chat: ChatModel;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    initialScrollToMessageIndex: number | null;
}) {
    return (
        <Box
            position="relative"
            width="full"
            height="full"
            style={{
                // @ts-expect-error: This sets the CSS variable but TypeScript doesn't
                // like it.
                "--safe-area-inset-top": `calc(var(--safe-area-inset-top-base, 0px) + ${addRemLengths(
                    withInboxBanner ? inboxBannerHeight : "0",
                    navigationBarHeight,
                )})`,
            }}
        >
            <ChatViewTopBar withInboxBanner={withInboxBanner} chat={chat} />
            <ChatMessagingView
                chat={chat}
                initialMessages={initialMessages}
                initialOtherReferencedMessages={initialOtherReferencedMessages}
                initialScrollToMessageIndex={initialScrollToMessageIndex}
            />
        </Box>
    );
}

// NOCOMMIT: Don't update to "You sent a message"
function ChatViewTopBar({withInboxBanner, chat}: {withInboxBanner: boolean; chat: ChatModel}) {
    assert(chat.accounts.length > 0);

    const platform = usePlatform();
    const {currentAccount} = useSpaceContext();
    const navigate = useNavigate();

    // Exclude the current user from the list of accounts we display on top of the
    // chat unless this is a one-person chat with only the current user.
    const otherChatAccounts =
        chat.accounts.length === 1 && chat.accounts[0]!.id === currentAccount.id
            ? [currentAccount]
            : chat.accounts.filter(account => account.id !== currentAccount.id);

    return (
        <Box
            data-testid="ChatViewTopBar"
            zIndex="10"
            position="absolute"
            width="full"
            display="flex"
            justifyContent="center"
            alignItems="center"
            backgroundColor="grey-0-opacity-95"
            style={{
                paddingTop: `calc(var(--safe-area-inset-top-base, 0px) + ${
                    spacing[withInboxBanner ? inboxBannerHeight : "0"]
                })`,
                backdropFilter: `saturate(200%) blur(${spacing["1"]})`,
                WebkitBackdropFilter: `saturate(200%) blur(${spacing["1"]})`,
            }}
        >
            <Box
                position="relative"
                height={navigationBarHeight}
                width="full"
                maxWidth={messageViewMaxWidth}
                display="flex"
                justifyContent="center"
                alignItems="center"
                // If this route has an inbox banner then optically center our navigation bar
                // content so there's not a bunch of dead space.
                paddingBottom={
                    withInboxBanner ? chatViewTopBarWithInboxBannerAdjustmentY[platform] : undefined
                }
            >
                {platform === "mobile" && (
                    <Box flexShrink="0" paddingLeft="3">
                        <IconButton
                            size="base"
                            description="Go back"
                            withoutTooltip={true}
                            pressErrorTitle="Couldn’t go back"
                            onPress={() => navigate(-1)}
                        >
                            <ArrowLeft />
                        </IconButton>
                    </Box>
                )}
                <Box
                    width="full"
                    paddingX={screenPaddingX}
                    display="flex"
                    flexDirection={platform !== "mobile" ? "row" : "column"}
                    alignItems="center"
                    gap={platform !== "mobile" ? "2" : "1"}
                >
                    <AccountAvatarPile
                        size="7"
                        previewAccounts={otherChatAccounts.slice(0, 4)}
                        accountCount={otherChatAccounts.length}
                        getAllAccounts={() => otherChatAccounts}
                    />
                    <h1
                        className={sprinkles({
                            fontStyle: platform !== "mobile" ? "truncate-semi-bold" : "truncate",
                            fontSize: platform !== "mobile" ? "200" : "50",
                            userSelect: platform !== "mobile" ? "text" : undefined,
                        })}
                    >
                        {otherChatAccounts.length === 1 ? (
                            platform !== "mobile" ? (
                                <AccountFullName account={otherChatAccounts[0]!} />
                            ) : (
                                <AccountShortName account={otherChatAccounts[0]!} />
                            )
                        ) : (
                            <PrettyConjunctionList
                                list={otherChatAccounts.map(account => (
                                    <AccountShortName key={account.id} account={account} />
                                ))}
                            />
                        )}
                    </h1>
                </Box>
                {platform === "mobile" && <Spacer space="10" />}
            </Box>
        </Box>
    );
}

function AccountFullName({account}: {account: AccountModel}) {
    return <>{useAccountModel(account).name}</>;
}

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
        "ChannelRealtimeService",
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
            header={chatMessagingViewHeaderItem}
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
            scrollbarInsetTop={safeAreaOnlyScrollbarInsetTop}
        />
    );
}
