import {ArrowLeft, DotsThreeVertical, Link as LinkIcon} from "phosphor-react";
import {useCallback, useEffect, useMemo, useRef} from "react";
import {AccountAvatarPile} from "~/client/web/accounts/account_avatar_pile.js";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {AccountShortName} from "~/client/web/accounts/account_short_name.js";
import {chatMessagingViewHeaderItem} from "~/client/web/chat/internal/chat_messaging_view_header_item.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuActions} from "~/client/web/design/menu.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/web/design/navigation_bar_helpers.js";
import {PrettyConjunctionList} from "~/client/web/design/pretty_conjunction_list.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {MessagingView, MessagingViewRef} from "~/client/web/messaging/messaging_view.js";
import {useNavigationState} from "~/client/web/navigation/navigation_state_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {chatViewTopBarWithInboxBannerAdjustmentY} from "~/client/web/styles/chat_shared_styles.js";
import {
    messageViewAccountAvatarSize,
    messageViewRailGap,
} from "~/client/web/styles/messaging_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
} from "~/shared/rpc/chat_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export function ChatView({
    withInboxBanner,
    chat,
    initialCheckpoint,
    initialMessages,
    initialOtherReferencedMessages,
    initialScrollToMessageIndex,
    initiallyFocus,
    initialIsFavorite,
}: {
    withInboxBanner: boolean;
    chat: ChatModel;
    initialCheckpoint: ServerSynchronizationCheckpoint;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    initialScrollToMessageIndex: number | null;
    initiallyFocus: boolean;
    initialIsFavorite: boolean;
}) {
    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <ChatViewTopBar
                withInboxBanner={withInboxBanner}
                chat={chat}
                initialIsFavorite={initialIsFavorite}
            />
            <ChatMessagingView
                chat={chat}
                initialCheckpoint={initialCheckpoint}
                initialMessages={initialMessages}
                initialOtherReferencedMessages={initialOtherReferencedMessages}
                initialScrollToMessageIndex={initialScrollToMessageIndex}
                initiallyFocus={initiallyFocus}
            />
        </Box>
    );
}

function ChatViewTopBar({
    withInboxBanner,
    chat,
    initialIsFavorite,
}: {
    withInboxBanner: boolean;
    chat: ChatModel;
    initialIsFavorite: boolean;
}) {
    assert(chat.accounts.length > 0);

    const platform = usePlatform();
    const {space, currentAccount} = useSpaceContext();
    const navigate = useNavigate();
    const inboxContext = useInboxContext();
    const navigationState = useNavigationState();

    // Exclude the current user from the list of accounts we display on top of the
    // chat unless this is a one-person chat with only the current user.
    const otherChatAccounts =
        chat.accounts.length === 1 && chat.accounts[0]!.id === currentAccount?.id
            ? [currentAccount]
            : chat.accounts.filter(account => account.id !== currentAccount?.id);

    const favoriteMenuAction = useSearchFavoriteEntityMenuAction(
        currentAccount && chat.accounts.length === 2
            ? `Account:${chat.accounts.filter(account => account.id !== currentAccount.id)[0]!.id}`
            : `Chat:${chat.id}`,
        initialIsFavorite,
    );

    const handleBackButtonPress = () => {
        if (inboxContext?.entry) {
            navigate(`/s/${inboxContext.entry.model.spaceId}/inbox`);
        } else if (navigationState.hasPreviousLocation) {
            navigate(-1);
        } else {
            navigate(`/s/${space.id}/chat/with/${chat.id}`);
        }
    };

    return (
        <Box
            position="relative"
            zIndex="10"
            data-testid="ChatViewTopBar"
            flexShrink="0"
            width="full"
            paddingTop="safe-area-inset"
            display="flex"
            justifyContent="center"
            alignItems="center"
        >
            <Box
                pointerEvents="none"
                position="absolute"
                height="border"
                // It's subtle, but `grey-5-translucent` ends up looking a lot nicer
                // than if we used `grey-5` directly. This is because the border operates more
                // like a shadow. When rendered over some other content (e.g. an image) the
                // image's colors show through the border but a little darker.
                backgroundColor="grey-5-translucent"
                style={{
                    bottom: -1,
                    left: `max(-${spacing["3"]}, (100% - ${
                        spacing[contentStyles.contentMaxWidth]
                    }) / 2 - ${spacing["3"]})`,
                    right: `max(-${spacing["3"]}, (100% - ${
                        spacing[contentStyles.contentMaxWidth]
                    }) / 2 - ${spacing["3"]})`,
                    maskImage: `linear-gradient(to right, transparent, black ${spacing["3"]} calc(100% - ${spacing["3"]}), transparent)`,
                }}
            />
            <Box
                height={navigationBarHeight}
                width="full"
                maxWidth={contentStyles.contentMaxWidth}
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
                    <Box flexShrink="0" paddingLeft={navigationBarMobileGap}>
                        <IconButton
                            size="base"
                            description="Go back"
                            withoutTooltip={true}
                            pressErrorTitle="Couldn\u2019t go back"
                            onPress={handleBackButtonPress}
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
                    gap={platform !== "mobile" ? messageViewRailGap : "1"}
                >
                    <AccountAvatarPile
                        size={messageViewAccountAvatarSize}
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
                <Box
                    flexShrink="0"
                    paddingRight={platform === "mobile" ? navigationBarMobileGap : "5"}
                >
                    <MenuButton
                        placement="bottom-end"
                        actions={useMemo(
                            (): MenuActions => [
                                {
                                    label: "Copy link",
                                    icon: <LinkIcon />,
                                    iconPlacement: "end",
                                    pressErrorTitle: "Couldn\u2019t copy link",
                                    onPress: async () => {
                                        const url = new URL(
                                            `/s/${space.id}/chat/${chat.id}`,
                                            window.location.href,
                                        );
                                        await writeTextToClipboard(url.toString());
                                    },
                                },
                                ...(favoriteMenuAction ? [favoriteMenuAction] : []),
                            ],
                            [chat.id, favoriteMenuAction, space.id],
                        )}
                    >
                        <IconButton
                            size={platform === "mobile" ? "base" : "md"}
                            description="More"
                            withoutTooltip={true}
                        >
                            <DotsThreeVertical />
                        </IconButton>
                    </MenuButton>
                </Box>
            </Box>
        </Box>
    );
}

function AccountFullName({account}: {account: AccountModel}) {
    return <>{useAccountModel(account).name}</>;
}

function ChatMessagingView({
    chat,
    initialCheckpoint,
    initialMessages,
    initialOtherReferencedMessages,
    initialScrollToMessageIndex,
    initiallyFocus,
}: {
    chat: ChatModel;
    initialCheckpoint: ServerSynchronizationCheckpoint;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    initialScrollToMessageIndex: number | null;
    initiallyFocus?: boolean;
}) {
    const context = useAppContext();
    const messagingRef = useRef<MessagingViewRef<ChatId>>(null);

    const {isConnected, procedures, subscribeToEvents, subscribeToPongs} = useWebSocket(
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

        if (initialScrollToMessageIndex !== null) {
            messaging.jumpToMessageRange({
                roomKey: chat.id,
                startIndex: initialScrollToMessageIndex,
                endIndex: initialScrollToMessageIndex,
                start: null,
                end: null,
            });
        }

        if (initiallyFocus) {
            return scheduleAfterNavigationAnimation(() => {
                messaging.focusInput();
            });
        }
    }, [chat.id, initialScrollToMessageIndex, initiallyFocus]);

    return (
        <MessagingView
            ref={messagingRef}
            initialScrollOffset="bottom"
            initialMessagesResult={{
                checkpoint: initialCheckpoint,
                messageCount: chat.messageCount,
                messages: initialMessages,
                otherReferencedMessages: initialOtherReferencedMessages,
            }}
            header={chatMessagingViewHeaderItem}
            randomSeedForShimmer={chat.id}
            fileAttachmentTarget={useMemo(
                () => ({type: "ChatMessages", chatId: chat.id}),
                [chat.id],
            )}
            getMessagesFromStart={useCallback(
                input => getChatMessagesFromStart(context, {...input, chatId: chat.id}),
                [chat.id, context],
            )}
            getMessagesFromEnd={useCallback(
                input => getChatMessagesFromEnd(context, {...input, chatId: chat.id}),
                [chat.id, context],
            )}
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now. Only errs when Bazel runs TypeScript which is strange.
            // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
            // @ts-ignore
            backfillMessages={procedures.backfillMessages}
            createMessage={procedures.createMessage}
            updateMessageContent={procedures.updateMessageContent}
            deleteMessage={procedures.deleteMessage}
            setMessageReaction={procedures.setMessageReaction}
            deleteMessageReaction={procedures.deleteMessageReaction}
            startTypingInMessageInput={procedures.startTypingInMessageInput}
            stopTypingInMessageInput={procedures.stopTypingInMessageInput}
            isConnected={isConnected}
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now. Only errs when Bazel runs TypeScript which is strange.
            // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
            // @ts-ignore
            subscribeToEvents={subscribeToEvents}
            subscribeToPongs={subscribeToPongs}
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
