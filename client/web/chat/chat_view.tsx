import {ArrowLeft, ArrowSquareOut, Bell, BellRinging, Link as LinkIcon} from "phosphor-react";
import {Memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {createAccessPolicyStore} from "~/client/web/access/create_access_policy_store.js";
import {AccountAvatarPile} from "~/client/web/accounts/account_avatar_pile.js";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {AccountShortName} from "~/client/web/accounts/account_short_name.js";
import {getSafeCurrentlyViewedEntityIfPossibleForClient} from "~/client/web/bots/get_safe_current_viewed_entity_if_possible_for_client.js";
import {getChatOrAccountSearchAffinityEntityId} from "~/client/web/chat/get_chat_or_account_search_affinity_entity_id.js";
import {ChatDirectOneOnOneInvitePendingOverlayController} from "~/client/web/chat/internal/chat_direct_one_on_one_invite_pending_overlay_controller.js";
import {chatMessagingViewHeaderItem} from "~/client/web/chat/internal/chat_messaging_view_header_item.js";
import {RoomChatMobileEditor} from "~/client/web/chat/internal/room_chat_mobile_editor.js";
import {RoomChatViewNameEditor} from "~/client/web/chat/internal/room_chat_view_name_editor.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {MobileFullScreenModal} from "~/client/web/design/mobile_full_screen_modal.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {
    navigationBarHeight,
    navigationBarHeightWithTitleBreadcrumb,
    navigationBarMobileGap,
} from "~/client/web/design/navigation_bar_helpers.js";
import {PrettyConjunctionList} from "~/client/web/design/pretty_conjunction_list.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {Tooltip, defaultTooltipOffset} from "~/client/web/design/tooltip.js";
import {MemoObject} from "~/client/web/helpers/types/memo_object.js";
import {useStateWithOptimisticUpdates} from "~/client/web/helpers/use_state_with_optimistic_updates.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {LockBoldFillIcon} from "~/client/web/icons/lock_bold_fill_icon.js";
import {useInboxContext} from "~/client/web/inbox/inbox_context.js";
import {MessagingView, MessagingViewRef} from "~/client/web/messaging/messaging_view.js";
import {NavigationBarContentMoreButton} from "~/client/web/navigation/navigation_bar_content.js";
import {useNavigationState} from "~/client/web/navigation/navigation_state_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useCurrentlyViewingSearchEntityId} from "~/client/web/remix/use_currently_viewing_search_entity_id.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useIdlyPreloadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {SiteBreadcrumbChip} from "~/client/web/sites/breadcrumb/site_breadcrumb_chip.js";
import {useSiteContextIfExists} from "~/client/web/sites/context/site_context.js";
import {useSiteRegistry} from "~/client/web/sites/context/site_registry_context.js";
import {applySiteAccessPolicyChange} from "~/client/web/sites/helpers/apply_site_access_policy_change.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {chatViewTopBarWithInboxBannerAdjustmentY} from "~/client/web/styles/chat_shared_styles.js";
import {postFauxInputCreateButtonInnerButtonHeight} from "~/client/web/styles/forum_shared_styles.js";
import {
    messageViewAccountAvatarSize,
    messageViewRailGap,
} from "~/client/web/styles/messaging_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {WebSocketClientProcedures} from "~/client/web/web_socket/web_socket_client.js";
import {
    AccessLevel,
    ResolvedAccessPolicyWithGenerations,
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {chatPermissionDeniedErrorDisplayMessageByAccessLevel} from "~/shared/chat/chat_error_messages.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ChatRealtimeEvent, ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {doubleClickDelayMs} from "~/shared/design/core/timing.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    getChatWithStrongReadConsistency,
    isSubscribedToRoomChat,
    subscribeToRoomChat,
    unsubscribeFromRoomChat,
} from "~/shared/rpc/chat_rpc_definitions.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";
import {WebSocketProtocolProceduresType} from "~/shared/web_socket/web_socket_protocol.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

type ChatRealtimeWebSocketClientProcedures = MemoObject<
    WebSocketClientProcedures<WebSocketProtocolProceduresType<typeof ChatRealtimeProtocol>>
>;

export function ChatView({
    withInboxBanner,
    chat,
    messageDraft,
    onUpdateChat,
    initialIsSubscribed,
    initialCheckpoint,
    initialMessages,
    initialOtherReferencedMessages,
    initialScrollToMessageIndex,
    initiallyFocus,
    initialIsFavorite,
}: {
    withInboxBanner: boolean;
    chat: ChatModel;
    messageDraft: MessageDraftWithFiles;
    onUpdateChat: Memo<(chat: ChatModel) => void>;
    initialIsSubscribed: boolean | null;
    initialCheckpoint: ServerSynchronizationCheckpoint;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    initialScrollToMessageIndex: number | null;
    initiallyFocus: boolean;
    initialIsFavorite: boolean;
}) {
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const searchEntityRegistry = useSearchEntityRegistry();
    const siteRegistry = useSiteRegistry();

    const {isConnected, procedures, subscribeToEvents, subscribeToPongs} = useWebSocket(
        "ChannelRealtimeService",
        ChatRealtimeProtocol,
        currentAccount ? `/api/durable-objects/chat/${chat.id}` : null,
    );

    const lastBackfilledChatIdRef = useRef<ChatId | null>(null);

    useEffect(() => {
        if (!isConnected) {
            // Clear so on reconnection we'll backfill the chat again.
            lastBackfilledChatIdRef.current = null;
            return;
        }

        // Backfill the chat once realtime is connected. When we've connected to realtime
        // we'll get all events from the time `isConnected` is true on but we'll have
        // missed any events from when we weren't connected to the WebSocket.
        if (lastBackfilledChatIdRef.current !== chat.id) {
            lastBackfilledChatIdRef.current = chat.id;

            getChatWithStrongReadConsistency(context, {chatId: chat.id}).then(
                ({chat}) => onUpdateChat(chat),
                error => {
                    context.tracer.getRoot().logException("Failed to backfill chat", error);
                },
            );
        }

        return subscribeToEvents(event => {
            if (event.type === "UpdateChat") {
                onUpdateChat(event.chat);
            }
        });
    }, [chat.id, context, isConnected, onUpdateChat, subscribeToEvents]);

    // Update `SearchEntityRegistry` with the latest chat name. Now as the name changes
    // in realtime, any `SearchEntityModel`s rendered elsewhere in the product will
    // also update.
    useMemo(() => {
        if (chat.definition.type !== "Room") return;

        return searchEntityRegistry.getEntityStore(
            new SearchEntityModel({
                type: "Chat",
                chat: {
                    id: chat.id,
                    version: chat.version,
                    media:
                        chat.definition.previewAccounts.length === 1
                            ? {
                                  type: "Account",
                                  account: chat.definition.previewAccounts[0]!,
                              }
                            : {
                                  type: "AccountPile",
                                  previewAccounts: chat.definition.previewAccounts,
                                  accountCount: null,
                              },
                },
                title: chat.definition.name,
            }),
        );
    }, [chat.definition, chat.id, chat.version, searchEntityRegistry]);

    const chatAccessPolicy = useStore(
        useMemo((): Store<
            {type: "Direct"} | {type: "Room"; accessPolicy: ResolvedAccessPolicyWithGenerations}
        > => {
            switch (chat.definition.type) {
                case "Direct": {
                    return new ConstStore({type: "Direct"});
                }
                case "Room": {
                    return createAccessPolicyStore(chat.definition.accessPolicy, siteRegistry).map(
                        accessPolicy => ({type: "Room", accessPolicy}),
                    );
                }
                default:
                    throw exhaustive(chat.definition);
            }
        }, [chat.definition, siteRegistry]),
    );

    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <ChatViewTopBar
                withInboxBanner={withInboxBanner}
                chat={chat}
                onUpdateChat={onUpdateChat}
                procedures={procedures}
                initialIsSubscribed={initialIsSubscribed}
                initialIsFavorite={initialIsFavorite}
                chatAccessPolicy={chatAccessPolicy}
            />
            <ChatMessagingView
                chat={chat}
                messageDraft={messageDraft}
                chatAccessPolicy={chatAccessPolicy}
                isConnected={isConnected}
                procedures={procedures}
                subscribeToEvents={subscribeToEvents}
                subscribeToPongs={subscribeToPongs}
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
    onUpdateChat,
    procedures,
    initialIsSubscribed,
    initialIsFavorite,
    chatAccessPolicy,
}: {
    withInboxBanner: boolean;
    chat: ChatModel;
    onUpdateChat: Memo<(chat: ChatModel) => void>;
    procedures: ChatRealtimeWebSocketClientProcedures;
    initialIsSubscribed: boolean | null;
    initialIsFavorite: boolean;
    chatAccessPolicy:
        | {type: "Direct"}
        | {type: "Room"; accessPolicy: ResolvedAccessPolicyWithGenerations};
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const {space, currentAccount} = useSpaceContext();
    const hasCurrentAccount = !!currentAccount;
    const navigate = useNavigate();
    const inboxContext = useInboxContext();
    const navigationState = useNavigationState();
    const siteContext = useSiteContextIfExists();
    const routeLayout = useRouteLayout();

    const accessLevel = useMemo((): AccessLevel | null => {
        switch (chatAccessPolicy.type) {
            case "Direct":
                return "Manage";
            case "Room": {
                return getAccountAccessLevelAssumingSpaceAccess(
                    chatAccessPolicy.accessPolicy,
                    currentAccount?.id,
                );
            }
            default:
                throw exhaustive(chatAccessPolicy);
        }
    }, [chatAccessPolicy, currentAccount?.id]);

    if (accessLevel === null) {
        throw new PermissionDeniedError("Current account lost access to chat", {
            displayMessage: chatPermissionDeniedErrorDisplayMessageByAccessLevel.View,
        });
    }

    const [showTurnIntoChatRoomModalDialog, setShowTurnIntoChatRoomModalDialog] = useState(false);

    const canConvertDirectChatToRoomChat =
        chat.definition.type === "Direct" && chat.definition.accounts.length > 2;

    if (showTurnIntoChatRoomModalDialog && !canConvertDirectChatToRoomChat)
        setShowTurnIntoChatRoomModalDialog(false);

    // Exclude the current user from the list of accounts we display on top of the chat
    // unless this is a one-person chat with only the current user.
    const otherChatAccounts =
        chat.definition.type === "Direct"
            ? chat.definition.accounts.length === 1 &&
              chat.definition.accounts[0]!.id === currentAccount?.id
                ? [currentAccount]
                : chat.definition.accounts.filter(account => account.id !== currentAccount?.id)
            : [];

    const favoriteMenuAction = useSearchFavoriteEntityMenuAction(
        getChatOrAccountSearchAffinityEntityId(currentAccount?.id, chat),
        initialIsFavorite,
    );

    const handleBackButtonPress = () => {
        if (navigationState.hasPreviousLocation) {
            navigate(-1);
        } else if (inboxContext?.entry) {
            navigate(`/inbox/${inboxContext.entry.model.spaceId}`);
        } else {
            navigate(`/home/${space.id}`);
        }
    };

    const [isEditingRoomNameInline, setIsEditingRoomNameInline] = useState(false);
    if (isEditingRoomNameInline && (platform === "mobile" || chat.definition.type !== "Room"))
        setIsEditingRoomNameInline(false);

    const [editRoomNameMobileModalState, setEditRoomNameMobileModalState] = useState<{
        readonly initiallyFocus: "Name";
    } | null>(null);
    if (
        editRoomNameMobileModalState &&
        (platform !== "mobile" || chat.definition.type !== "Room")
    ) {
        setEditRoomNameMobileModalState(null);
    }

    const [actuallyIsSubscribed, setIsSubscribed, setIsSubscribedOptimistically] =
        useStateWithOptimisticUpdates(initialIsSubscribed);

    // If we don't know the subscription state we assume `isSubscribed` is true. This
    // will happen if user A is viewing a direct chat with user B and user B turns the
    // direct chat into a room chat. User A's `initialIsSubscribed` value will be null
    // (since we return null for direct chats) and we'll render that null as
    // "subscribed" because in the case where user B turns the direct chat into a room
    // chat we automatically subscribe all previous members of the direct chat.
    const isSubscribed = actuallyIsSubscribed ?? true;

    const hasFetchedIsSubscribed = useRef(false);

    useEffect(() => {
        // Don't fetch subscribed state if this isn't a chat room.
        if (chat.definition.type !== "Room") return;

        // If the actor doesn't have space access they'll never be subscribed, don't try
        // loading subscribed state.
        if (!hasCurrentAccount) return;

        if (actuallyIsSubscribed !== null) {
            hasFetchedIsSubscribed.current = false;
            return;
        }

        if (hasFetchedIsSubscribed.current) return;
        hasFetchedIsSubscribed.current = true;

        isSubscribedToRoomChat(context, {chatId: chat.id})
            .then(({isSubscribed}) => setIsSubscribed(() => isSubscribed))
            .catch(error => {
                context.tracer.logException(
                    "Couldn\u2019t backfill room chat is subscribed state",
                    error,
                );
            });
    }, [
        actuallyIsSubscribed,
        chat.definition.type,
        chat.id,
        context,
        hasCurrentAccount,
        setIsSubscribed,
    ]);

    const lastPointerDownTimeRef = useRef<number | null>(null);

    // Preload accounts so they're available if the user opens the room share dropdown.
    useIdlyPreloadRpc(
        expensivelyGetAllSpaceAccounts,
        chat.definition.type === "Room" && currentAccount ? {spaceId: space.id} : null,
    );

    const shouldRenderSiteBreadcrumb =
        !!siteContext &&
        routeLayout === "narrow" &&
        chatAccessPolicy.type === "Room" &&
        chatAccessPolicy.accessPolicy.type === "Site" &&
        chatAccessPolicy.accessPolicy.siteId === siteContext.tree.site.id;

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
                // It's subtle, but `grey-5-translucent` ends up looking a lot nicer than if we
                // used `grey-5` directly. This is because the border operates more like a shadow.
                // When rendered over some other content (e.g. an image) the image's colors show
                // through the border but a little darker.
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
                style={{
                    height: shouldRenderSiteBreadcrumb
                        ? navigationBarHeightWithTitleBreadcrumb[platform]
                        : spacing[navigationBarHeight],
                }}
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
                            pressErrorTitle="Couldn&#x2019;t go back"
                            onPress={handleBackButtonPress}
                        >
                            <ArrowLeft />
                        </IconButton>
                    </Box>
                )}
                <Box
                    display="flex"
                    flexDirection="column"
                    alignItems={platform === "mobile" ? "center" : undefined}
                    justifyContent="center"
                    width="full"
                    minWidth="0"
                    paddingX={screenPaddingX}
                    // Desktop peek only: chip stacks above the chat name in a column, so bottom-align
                    // this column so the name sits at the visual bottom of the top bar (aligned with
                    // the bottom-aligned subscribe / more menu below).
                    alignSelf={
                        shouldRenderSiteBreadcrumb && platform !== "mobile" ? "flex-end" : undefined
                    }
                    paddingBottom={
                        shouldRenderSiteBreadcrumb && platform !== "mobile" ? "3" : undefined
                    }
                >
                    {shouldRenderSiteBreadcrumb && <SiteBreadcrumbChip />}
                    <Box
                        width="full"
                        minWidth="0"
                        display="flex"
                        flexDirection={
                            chat.definition.type === "Room"
                                ? "row"
                                : platform !== "mobile"
                                  ? "row"
                                  : "column"
                        }
                        // Mobile + site: 2-line iOS layout — center the chat name horizontally under the
                        // supratitle. Desktop + site: left-align so the name reads next to the stacked
                        // chip rather than recentered.
                        justifyContent={
                            shouldRenderSiteBreadcrumb
                                ? platform === "mobile"
                                    ? "center"
                                    : "flex-start"
                                : chat.definition.type === "Room"
                                  ? platform !== "mobile"
                                      ? "flex-start"
                                      : "center"
                                  : "flex-start"
                        }
                        alignItems="center"
                        gap={
                            chat.definition.type === "Room"
                                ? platform === "mobile"
                                    ? "1.5"
                                    : "2"
                                : platform === "mobile"
                                  ? "1"
                                  : messageViewRailGap
                        }
                    >
                        {chat.definition.type === "Direct" && (
                            <AccountAvatarPile
                                size={messageViewAccountAvatarSize}
                                previewAccounts={otherChatAccounts.slice(0, 4)}
                                accountCount={otherChatAccounts.length}
                                getAllAccounts={() => otherChatAccounts}
                            />
                        )}
                        {chatAccessPolicy.type === "Room" &&
                            !chatAccessPolicy.accessPolicy.defaultGrant &&
                            !chatAccessPolicy.accessPolicy.urlGrant && (
                                // We add a lock icon to private chats because unlike other entities we don't show
                                // the share switch in the navigation bar. Since knowing whether a chat is public
                                // or private is important context, we include a lock to make sure you know the
                                // chat is private before posting.
                                <LockBoldFillIcon
                                    className={sprinkles({flexShrink: "0"})}
                                    size={spacing[platform === "mobile" ? "3" : "4"]}
                                />
                            )}
                        {isEditingRoomNameInline && chat.definition.type === "Room" ? (
                            <RoomChatViewNameEditor
                                initialName={chat.definition.name}
                                onCancel={() => setIsEditingRoomNameInline(false)}
                                onSave={async name => {
                                    const {chat} = await procedures.updateRoomChatName({name});
                                    onUpdateChat(chat);
                                    setIsEditingRoomNameInline(false);
                                }}
                            />
                        ) : (
                            <h1
                                className={sprinkles({
                                    fontStyle:
                                        chat.definition.type === "Room"
                                            ? platform !== "mobile"
                                                ? "truncate-bold"
                                                : "truncate-semi-bold"
                                            : platform !== "mobile"
                                              ? "truncate-semi-bold"
                                              : "truncate",
                                    fontSize:
                                        chat.definition.type === "Room"
                                            ? platform !== "mobile"
                                                ? "400"
                                                : "100"
                                            : platform !== "mobile"
                                              ? "200"
                                              : "50",
                                    userSelect: platform !== "mobile" ? "text" : undefined,
                                })}
                            >
                                {(() => {
                                    switch (chat.definition.type) {
                                        case "Direct": {
                                            if (otherChatAccounts.length !== 1) {
                                                return (
                                                    <PrettyConjunctionList
                                                        list={otherChatAccounts.map(account => (
                                                            <AccountShortName
                                                                key={account.id}
                                                                account={account}
                                                            />
                                                        ))}
                                                    />
                                                );
                                            }

                                            return platform !== "mobile" ? (
                                                <AccountFullName account={otherChatAccounts[0]!} />
                                            ) : (
                                                <AccountShortName account={otherChatAccounts[0]!} />
                                            );
                                        }
                                        case "Room": {
                                            return (
                                                <span
                                                    onPointerDown={event => {
                                                        const currentTime = Date.now();
                                                        const lastPointerDownTime =
                                                            lastPointerDownTimeRef.current;
                                                        lastPointerDownTimeRef.current =
                                                            currentTime;

                                                        if (lastPointerDownTime === null) return;

                                                        if (
                                                            currentTime - lastPointerDownTime >
                                                            doubleClickDelayMs
                                                        )
                                                            return;

                                                        if (
                                                            hasAccessLevel(accessLevel, "Manage") &&
                                                            platform !== "mobile"
                                                        ) {
                                                            // Disable selection from double click.
                                                            //
                                                            // We implement double click with `onPointerDown` instead of `onDoubleClick`
                                                            // because `onDoubleClick` fires one pointer up but the browser performs text
                                                            // selection on double click pointer down. So there's a small visual glitch where
                                                            // you can see the browser selection after double click before pointer up when you
                                                            // use `onDoubleClick`,
                                                            event.preventDefault();

                                                            setIsEditingRoomNameInline(true);
                                                        }
                                                    }}
                                                >
                                                    {chat.definition.name}
                                                </span>
                                            );
                                        }
                                        default:
                                            throw exhaustive(chat.definition);
                                    }
                                })()}
                            </h1>
                        )}
                    </Box>
                </Box>
                {chat.definition.type === "Room" &&
                    platform !== "mobile" &&
                    // Don't render the subscribe button if the account doesn't have space access.
                    currentAccount && (
                        <Box
                            flexShrink="0"
                            paddingRight="4"
                            // The subscribe button only renders on desktop (see condition above), so when
                            // there's a site context the chip is stacked above the chat name — bottom-align
                            // this so the subscribe button sits on the same visual row as the name.
                            alignSelf={shouldRenderSiteBreadcrumb ? "flex-end" : undefined}
                            paddingBottom={shouldRenderSiteBreadcrumb ? "3" : undefined}
                        >
                            <Tooltip
                                placement="bottom-end"
                                content="Get notified about new messages"
                            >
                                <Button
                                    variant={isSubscribed ? "neutral-disabled" : "neutral"}
                                    icon={isSubscribed ? <BellRinging /> : <Bell />}
                                    // Consistent height with `<ChannelViewSubscribeButton>`.
                                    height={postFauxInputCreateButtonInnerButtonHeight}
                                    paddingX="2.5"
                                    pressErrorTitle={
                                        !isSubscribed
                                            ? "Couldn\u2019t subscribe to chat"
                                            : "Couldn\u2019t unsubscribe from chat"
                                    }
                                    onPress={async () => {
                                        if (isSubscribed) {
                                            const promise = unsubscribeFromRoomChat(context, {
                                                chatId: chat.id,
                                            });
                                            setIsSubscribedOptimistically(promise, () => false);
                                            await promise;
                                        } else {
                                            const promise = subscribeToRoomChat(context, {
                                                chatId: chat.id,
                                            });
                                            setIsSubscribedOptimistically(promise, () => true);
                                            await promise;
                                        }
                                    }}
                                >
                                    {isSubscribed ? "Subscribed" : "Subscribe"}
                                </Button>
                            </Tooltip>
                        </Box>
                    )}
                <Box
                    flexShrink="0"
                    paddingRight={platform === "mobile" ? navigationBarMobileGap : "5"}
                    // Match the title column's bottom alignment when the chip stacks above the name on
                    // desktop peek so the more menu lines up with the chat name.
                    alignSelf={
                        shouldRenderSiteBreadcrumb && platform !== "mobile" ? "flex-end" : undefined
                    }
                    paddingBottom={
                        shouldRenderSiteBreadcrumb && platform !== "mobile" ? "3" : undefined
                    }
                >
                    <NavigationBarContentMoreButton
                        // Move the menu further away from the subscribe button. It's quite large and the
                        // default offset renders our menu too close to the subscribe button in my design
                        // opinion.
                        menuOffset={
                            chat.definition.type === "Room" && platform !== "mobile"
                                ? "2.5"
                                : defaultTooltipOffset
                        }
                        shareButton={
                            chatAccessPolicy.type === "Room" &&
                            // Don't render the share button if the account doesn't have space access. They
                            // won't be allowed to see the names of accounts in the share dialog.
                            currentAccount
                                ? {
                                      entityNoun: "chat",
                                      entityId: `Chat:${chat.id}`,
                                      accessPolicy: chatAccessPolicy.accessPolicy,
                                      accessLevelText: {
                                          // The text is "can chat" (and not "can message") so that when you press the alt
                                          // key to show "can chat (can't share)" it doesn't grow the dropdown width.
                                          Manage: "can chat",
                                          Edit: "can chat (can\u2019t share)",
                                          Comment: "can chat (can\u2019t share)",
                                          View: "can view",
                                      },
                                      // `Edit` access level and `Comment` access level are the same for chat rooms. Keep
                                      // both hidden by default and reveal them only while holding "alt".
                                      withoutEditAccessLevel: true,
                                      withHiddenCommentAccessLevel: true,
                                      onAccessPolicyChange: async (notification, accessPolicy) => {
                                          if (accessPolicy.type === "Site") {
                                              await applySiteAccessPolicyChange({
                                                  context,
                                                  accessPolicy,
                                                  handleEventForSite:
                                                      assertExists(siteContext).handleEventForSite,
                                              });
                                              return;
                                          }

                                          const {chat} =
                                              await procedures.updateRoomChatAccessPolicy({
                                                  accessPolicy,
                                                  notification,
                                              });

                                          onUpdateChat(chat);
                                      },
                                      onCopyLink: async () => {
                                          const url = new URL(
                                              `/chat/${chat.id}`,
                                              window.location.href,
                                          );
                                          await writeTextToClipboard(url.toString());
                                      },
                                  }
                                : undefined
                        }
                        menuActions={useMemo(
                            (): ReadonlyArray<ReadonlyArray<MenuAction>> => [
                                [
                                    {
                                        label: "Copy link",
                                        icon: <LinkIcon />,
                                        iconPlacement: "end",
                                        pressErrorTitle: "Couldn\u2019t copy link",
                                        onPress: async () => {
                                            const url = new URL(
                                                `/chat/${chat.id}`,
                                                window.location.href,
                                            );
                                            await writeTextToClipboard(url.toString());
                                        },
                                    },
                                    ...(favoriteMenuAction ? [favoriteMenuAction] : []),
                                ],
                                ...(canConvertDirectChatToRoomChat
                                    ? [
                                          [
                                              cast<MenuAction>({
                                                  label: "Turn into chat room",
                                                  icon: <ArrowSquareOut />,
                                                  iconPlacement: "end",
                                                  onPress: () => {
                                                      setShowTurnIntoChatRoomModalDialog(true);
                                                  },
                                              }),
                                          ],
                                      ]
                                    : chat.definition.type === "Room" &&
                                        hasAccessLevel(accessLevel, "Manage")
                                      ? [
                                            [
                                                cast<MenuAction>({
                                                    label: "Edit name",
                                                    onPress: () => {
                                                        if (platform !== "mobile") {
                                                            setIsEditingRoomNameInline(true);
                                                        } else {
                                                            setEditRoomNameMobileModalState({
                                                                initiallyFocus: "Name",
                                                            });
                                                        }
                                                    },
                                                }),
                                            ],
                                        ]
                                      : []),
                                ...(chat.definition.type === "Room" && platform === "mobile"
                                    ? [
                                          [
                                              cast<MenuAction>({
                                                  label: isSubscribed
                                                      ? "Unsubscribe from message notifications"
                                                      : "Subscribe to message notifications",
                                                  pressErrorTitle: !isSubscribed
                                                      ? "Couldn\u2019t subscribe to chat"
                                                      : "Couldn\u2019t unsubscribe from chat",
                                                  onPress: async () => {
                                                      if (isSubscribed) {
                                                          const promise = unsubscribeFromRoomChat(
                                                              context,
                                                              {chatId: chat.id},
                                                          );
                                                          setIsSubscribedOptimistically(
                                                              promise,
                                                              () => false,
                                                          );
                                                          await promise;
                                                      } else {
                                                          const promise = subscribeToRoomChat(
                                                              context,
                                                              {chatId: chat.id},
                                                          );
                                                          setIsSubscribedOptimistically(
                                                              promise,
                                                              () => true,
                                                          );
                                                          await promise;
                                                      }

                                                      // Don't close the menu when subscribing/unsubscribing since there's no feedback
                                                      // other than the menu action label changing when the user subscribes/unsubscribes.
                                                      return {withoutClose: true};
                                                  },
                                              }),
                                          ],
                                      ]
                                    : []),
                            ],
                            [
                                accessLevel,
                                canConvertDirectChatToRoomChat,
                                chat.definition.type,
                                chat.id,
                                context,
                                favoriteMenuAction,
                                isSubscribed,
                                platform,
                                setIsSubscribedOptimistically,
                            ],
                        )}
                        menuExtraBottom={null}
                    />
                </Box>
            </Box>
            {chat.definition.type === "Room" &&
                editRoomNameMobileModalState &&
                (() => {
                    const initialName = chat.definition.name;

                    return (
                        <MobileFullScreenModal
                            onClose={() => setEditRoomNameMobileModalState(null)}
                        >
                            {({onCloseWithAnimation}) => (
                                <RoomChatMobileEditor
                                    title="Edit chat"
                                    initiallyFocus={editRoomNameMobileModalState.initiallyFocus}
                                    initialName={initialName}
                                    onSave={async name => {
                                        const {chat} = await procedures.updateRoomChatName({name});
                                        onUpdateChat(chat);
                                    }}
                                    onCloseWithAnimation={() => onCloseWithAnimation()}
                                />
                            )}
                        </MobileFullScreenModal>
                    );
                })()}
            {showTurnIntoChatRoomModalDialog && (
                <ModalDialog
                    title="Turn into chat room"
                    description="Chat rooms are named and can be shared with more people. Your message history will be preserved. Please enter a name for the new chat room:"
                    onClose={() => setShowTurnIntoChatRoomModalDialog(false)}
                    withTextInput={true}
                    textInputPlaceholder="My Team"
                    primaryButtonLabel="Convert"
                    primaryButtonPressErrorTitle="Couldn&#x2019;t turn into chat room"
                    onPrimaryButtonPress={async textInputValue => {
                        const {chat} = await procedures.convertDirectChatToRoomChat({
                            name: textInputValue,
                        });

                        onUpdateChat(chat);
                    }}
                />
            )}
        </Box>
    );
}

function AccountFullName({account}: {account: AccountModel}) {
    return <>{useAccountModel(account).name}</>;
}

function ChatMessagingView({
    chat,
    messageDraft,
    isConnected,
    procedures,
    subscribeToEvents,
    subscribeToPongs,
    initialCheckpoint,
    initialMessages,
    initialOtherReferencedMessages,
    initialScrollToMessageIndex,
    initiallyFocus,
    chatAccessPolicy,
}: {
    chat: ChatModel;
    messageDraft?: MessageDraftWithFiles;
    isConnected: boolean;
    procedures: ChatRealtimeWebSocketClientProcedures;
    subscribeToEvents: Memo<(listener: (event: ChatRealtimeEvent) => void) => () => void>;
    subscribeToPongs: Memo<(subscriber: (message: WebSocketPongMessage) => void) => () => void>;
    initialCheckpoint: ServerSynchronizationCheckpoint;
    initialMessages: ReadonlyArray<ChatMessageModel>;
    initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
    initialScrollToMessageIndex: number | null;
    initiallyFocus?: boolean;
    chatAccessPolicy:
        | {type: "Direct"}
        | {type: "Room"; accessPolicy: ResolvedAccessPolicyWithGenerations};
}) {
    const context = useAppContext();
    const messagingRef = useRef<MessagingViewRef<ChatId>>(null);
    const spaceContext = useSpaceContext();
    let currentlyViewingSearchEntityId = useCurrentlyViewingSearchEntityId();

    // We only send the currently viewed entity for 1:1 chats with a bot. We do some
    // validation here and on the server.
    currentlyViewingSearchEntityId = getSafeCurrentlyViewedEntityIfPossibleForClient(
        spaceContext,
        chat,
        currentlyViewingSearchEntityId,
    );

    const hasInitializedRef = useRef(false);

    // TODO(calebmer): Support server-side rendering for immediately jumping to a
    // comment in the middle of a post. This will make transitions seamless when you
    // click on a link to a comment.
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

    const messageDraftSurface = useMemo(
        () => ({type: "Chat" as const, chatId: chat.id}),
        [chat.id],
    );

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
            accessPolicy={
                chatAccessPolicy.type === "Room" ? chatAccessPolicy.accessPolicy : undefined
            }
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
            messageDraftSurface={messageDraftSurface}
            messageDraft={messageDraft}
            isConnected={isConnected}
            // There's a strange TypeScript error here that only shows up when Bazel runs
            // TypeScript where it thinks the type of `subscribeToEvents` should include
            // `{ [x: number]: never; }`. Not fixing for now, may be a TypeScript bug that
            // disappears on upgrade.
            // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
            // @ts-ignore
            subscribeToEvents={useCallback(
                (subscriber: (event: MessagingRealtimeEvent<ChatMessageModel>) => void) => {
                    return subscribeToEvents(event => {
                        if (event.type !== "UpdateChat") {
                            subscriber(event);
                        }
                    });
                },
                [subscribeToEvents],
            )}
            subscribeToPongs={subscribeToPongs}
            getMessageUrl={useCallback(
                messageIndex =>
                    new URL(`/chat/${chat.id}?message=${messageIndex}`, window.location.href),
                [chat.id],
            )}
            dangerousCurrentlyViewingSearchEntityId={currentlyViewingSearchEntityId}
            extraChildren={<ChatDirectOneOnOneInvitePendingOverlayController chat={chat} />}
        />
    );
}
