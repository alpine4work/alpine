import {ArrowLeft} from "phosphor-react";
import {Memo, Ref, useCallback, useEffect, useRef} from "react";
import {AccountAvatarPile} from "~/client/accounts/account_avatar_pile.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context_provider.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {PrettyConjunctionList} from "~/client/design/pretty_conjunction_list.js";
import {
    getElementSafeAreaInsetBottomPx,
    getElementWindowSafeAreaInsetBottomPx,
} from "~/client/design/safe_area_inset.js";
import {Spacer} from "~/client/design/spacer.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {MessagingView, MessagingViewRef} from "~/client/messaging/messaging_view.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    messageViewMarginY,
    messageViewMaxWidth,
    messageViewTimestampDividerMarginTop,
} from "~/client/styles/messaging_shared_styles.js";
import {sprinkles} from "~/client/styles/styles.js";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {
    addRemLengths,
    parseRemLengthNumber,
    screenPaddingX,
    spacing,
} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
} from "~/shared/rpc/chat_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ChatView({
    withMobileLayout,
    chat,
    initialMessages,
    initialOtherReferencedMessages,
    initialScrollToMessageIndex,
}: {
    withMobileLayout: boolean;
    chat: ChatModel;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    initialScrollToMessageIndex: number | null;
}) {
    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <ChatViewTopBar chat={chat} />
            <ChatMessagingView
                withMobileLayout={withMobileLayout}
                chat={chat}
                initialMessages={initialMessages}
                initialOtherReferencedMessages={initialOtherReferencedMessages}
                initialScrollToMessageIndex={initialScrollToMessageIndex}
            />
        </Box>
    );
}

function ChatViewTopBar({chat}: {chat: ChatModel}) {
    assert(chat.accounts.length > 0);

    const isMobile = useIsMobile();
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
            flexShrink="0"
            width="full"
            paddingTop="safe-area-inset"
            display="flex"
            alignItems="center"
        >
            <Box
                height={navigationBarHeight}
                width="full"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                {isMobile && (
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
                    maxWidth={messageViewMaxWidth}
                    paddingX={screenPaddingX}
                    display="flex"
                    flexDirection={!isMobile ? "row" : "column"}
                    alignItems="center"
                    gap={!isMobile ? "2" : "1"}
                >
                    <AccountAvatarPile
                        size="7"
                        previewAccounts={otherChatAccounts.slice(0, 4)}
                        accountCount={otherChatAccounts.length}
                        getAllAccounts={() => otherChatAccounts}
                    />
                    <h1
                        className={sprinkles({
                            fontStyle: !isMobile ? "truncate-semi-bold" : "truncate",
                            fontSize: !isMobile ? "200" : "50",
                        })}
                    >
                        {otherChatAccounts.length === 1 ? (
                            !isMobile ? (
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
                {isMobile && <Spacer space="10" />}
            </Box>
        </Box>
    );
}

function AccountFullName({account}: {account: AccountModel}) {
    return <>{useAccountModel(account).name}</>;
}

// When our view is full of messages this will be the top margin of the view.
const chatMessagingViewHeaderMinHeight = addRemLengths(
    spacing[messageViewTimestampDividerMarginTop],
    spacing[messageViewMarginY],
);

const chatMessagingViewHeaderMinHeightRem = parseRemLengthNumber(chatMessagingViewHeaderMinHeight);

/**
 * The messaging header is empty space. It fills up the view height so your
 * first messages are pushed to the bottom of the screen. In the future we
 * should do something interesting with this empty space.
 */
export const chatMessagingViewHeader = ((): DistributiveOmit<VirtualizedScrollViewItem, "key"> => {
    return {
        minHeight: chatMessagingViewHeaderMinHeight,
        withManualLayout: true,
        render: ({
            ref,
            shouldRenderWithRelativePositioning,
            offset,
            height: originalHeight,
            viewHeight,
            originalContentHeight,
        }) => (
            <ChatMessagingViewHeader
                itemRef={ref}
                shouldRenderWithRelativePositioning={shouldRenderWithRelativePositioning}
                offset={offset}
                originalHeight={originalHeight}
                viewHeight={viewHeight}
                originalContentHeight={originalContentHeight}
            />
        ),
    };
})() as Memo<DistributiveOmit<VirtualizedScrollViewItem, "key">>;

function ChatMessagingViewHeader({
    itemRef: externalRef,
    shouldRenderWithRelativePositioning,
    offset,
    viewHeight,
    originalContentHeight,
    originalHeight,
}: {
    itemRef: Ref<HTMLDivElement>;
    shouldRenderWithRelativePositioning: boolean;
    offset: number;
    viewHeight: number;
    originalContentHeight: number;
    originalHeight: number;
}) {
    const internalRef = useRef<HTMLDivElement>(null);
    const remPx = useRemPx();

    const minHeight = chatMessagingViewHeaderMinHeightRem * remPx;

    useLayoutEffectWithoutServerSideWarning(() => {
        if (shouldRenderWithRelativePositioning) return;

        const element = assertExists(internalRef.current);

        // Exclude safe area contributed by the keyboard opening/closing from the chat
        // messaging view header height. This makes sure scroll animations from
        // `useScrollToAvoidBottomBarsAndMobileKeyboard()` are nice and smooth.
        //
        // We need to update the header height in a layout effect
        const keyboardSafeAreaBottom =
            getElementSafeAreaInsetBottomPx(element) -
            getElementWindowSafeAreaInsetBottomPx(element) -
            (NativeMobileBridge?.tabBar.height ?? 0);

        const height = Math.max(
            minHeight,
            viewHeight - (originalContentHeight - keyboardSafeAreaBottom - originalHeight),
        );

        // Directly update the height style without scheduling another React render.
        // React should never override this style since from React's perspective the
        // height is always `chatMessagingViewHeaderMinHeight`.
        //
        // It's important we directly update the DOM instead of scheduling another
        // render so that other hooks like `useScrollToNewMessages()` that run in the
        // same render will read the correct height.
        if (height !== element.clientHeight) {
            element.style.height = `${height}px`;
        }
    }, [
        minHeight,
        originalContentHeight,
        originalHeight,
        shouldRenderWithRelativePositioning,
        viewHeight,
    ]);

    return (
        <div
            ref={useMergedRefs(internalRef, externalRef)}
            style={{
                // NOTE(calebmer): On initial render we don't know the view height so this
                // header won't push other messages down. So you end up with a flash when
                // server-rendering a chat with few messages where messages jump down. A flash
                // we choose to accept since correct implementations are annoying.
                ...(shouldRenderWithRelativePositioning
                    ? {position: "relative", height: chatMessagingViewHeaderMinHeight}
                    : {
                          position: "absolute",
                          top: offset,
                          left: 0,
                          right: 0,
                          height: chatMessagingViewHeaderMinHeight,
                      }),
            }}
        />
    );
}

function ChatMessagingView({
    withMobileLayout,
    chat,
    initialMessages,
    initialOtherReferencedMessages,
    initialScrollToMessageIndex,
}: {
    withMobileLayout: boolean;
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
            withMobileLayout={withMobileLayout}
            initialScrollOffset="bottom"
            initialMessagesResult={{
                messageCount: chat.messageCount,
                messages: initialMessages,
                otherReferencedMessages: initialOtherReferencedMessages,
                lastMessageChangeTime: chat.lastMessageChangeTime,
            }}
            header={chatMessagingViewHeader}
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
