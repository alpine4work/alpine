import {useCallback, useEffect, useRef, useState} from "react";
import {
    ShouldRevalidateFunction,
    useLocation,
    useNavigation,
    useSearchParams,
} from "react-router-dom";
import {
    deserializeAccountIdForLoader,
    deserializeChatIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {
    ChatAccountPicker,
    ChatAccountPickerSelectionState,
} from "~/client/web/chat/chat_account_picker.js";
import {getChatOrAccountSearchAffinityEntityId} from "~/client/web/chat/get_chat_or_account_search_affinity_entity_id.js";
import {NewChatMessagingView} from "~/client/web/chat/new_chat_messaging_view.js";
import {Box} from "~/client/web/design/box.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useStateWithDependencies} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/web/helpers/use_resize_observer.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {MessagingViewRef} from "~/client/web/messaging/messaging_view.js";
import {NavigationBarContent} from "~/client/web/navigation/navigation_bar_content.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {getChatAndInitialMessages} from "~/server/chat/data/get_chat_and_initial_messages.js";
import {selectChatForAccounts} from "~/server/chat/data/select_chat_for_accounts.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    ServerSynchronizationCheckpointSchema,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const LoaderSchema = Schema.object({
    checkpoint: ServerSynchronizationCheckpointSchema,
    selectedAccounts: Schema.array(AccountModel.schema),
    selectedChat: Schema.object({
        chat: ChatModel.schema(),
        initialMessages: Schema.array(ChatMessageModel.schema()),
        initialOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
    }).nullable(),
    suggestedChats: Schema.array(ChatModel.schema()),
});

export const meta = () => [{title: `New chat message${metaTitlePostfix}`}];

export async function loader({request, context: _context, params}: LoaderArgs) {
    const context = await _context.actor.authenticate();

    const url = new URL(request.url);
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const chatSearchParam = url.searchParams.get("chat");
    const selectedRoomChatId = chatSearchParam ? deserializeChatIdForLoader(chatSearchParam) : null;

    const selectedAccountIds = (url.searchParams.get("accounts")?.split(" ") ?? []).map(accountId =>
        deserializeAccountIdForLoader(accountId),
    );

    // Generate checkpoint before we start loading data. So when we backfill we include
    // any realtime events that happened while loading data.
    const checkpoint = generateServerSynchronizationCheckpoint();

    if (selectedRoomChatId) {
        const {chat, initialMessages, initialOtherReferencedMessages} =
            await getChatAndInitialMessages(context, {
                chatId: selectedRoomChatId,
                messagesLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
            });

        if (chat.definition.type !== "Room") {
            throw new FailedPreconditionError("Expected `chat` search param to be a room chat");
        }

        return jsonWithSchema(
            LoaderSchema,
            {
                checkpoint,
                selectedAccounts: [],
                selectedChat: {
                    chat,
                    initialMessages,
                    initialOtherReferencedMessages,
                },
                suggestedChats: [],
            },
            {
                propagateEventData: {
                    context: {
                        chatId: selectedRoomChatId,
                    },
                },
            },
        );
    }

    const [selectedAccounts, selectedChatResult] = await runAllPromises([
        runAllPromises(
            selectedAccountIds.map(accountId => getAccount(context, spaceId, accountId)),
        ),
        // It's important that we check `selectedAccounts` is empty before removing the
        // current account ID. In case the user selects their own account.
        selectedAccountIds.length > 0
            ? selectChatForAccounts(context.actor.authorizeSession(), {
                  spaceId,
                  otherAccountIds: selectedAccountIds,
                  messagesLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
              })
            : null,
    ]);

    return jsonWithSchema(
        LoaderSchema,
        {
            checkpoint,
            selectedAccounts,
            selectedChat: selectedChatResult?.selectedChat ?? null,
            suggestedChats: selectedChatResult?.suggestedChats ?? [],
        },
        {
            propagateEventData: {
                context: {
                    chatId: selectedChatResult?.selectedChat.chat.id,
                },
            },
        },
    );
}

// We don't need to reload when certain search params change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: immutableCurrentUrl,
    nextUrl: immutableNextUrl,
}) => {
    const currentUrl = new URL(immutableCurrentUrl);
    const nextUrl = new URL(immutableNextUrl);

    // Used to initially focus the chat:
    nextUrl.searchParams.delete("focus");
    currentUrl.searchParams.delete("focus");

    return nextUrl.toString() !== currentUrl.toString();
};

export default function NewChatRoute() {
    const loaderData = useLoaderDataWithSchema(LoaderSchema);

    const [selectedChat, setSelectedChat] = useState(loaderData.selectedChat);

    if (
        selectedChat?.chat.id !== loaderData.selectedChat?.chat.id ||
        (selectedChat &&
            loaderData.selectedChat &&
            selectedChat.chat.version < loaderData.selectedChat.chat.version)
    ) {
        setSelectedChat(loaderData.selectedChat);
    }

    const handleUpdateSelectedChat = useCallback((newChat: ChatModel) => {
        setSelectedChat(oldSelectedChat => {
            // Don't allow child components to change the `ChatId` we're rendering.
            if (!oldSelectedChat || newChat.id !== oldSelectedChat.chat.id) return oldSelectedChat;

            // Only use `newChat` if it has a higher version.
            if (oldSelectedChat.chat.version >= newChat.version) return oldSelectedChat;

            return {...oldSelectedChat, chat: newChat};
        });
    }, []);

    const platform = usePlatform();
    const {currentAccount} = useSpaceContext();

    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    const focusSearchParam = searchParams.get("focus");
    const [initiallyFocus] = useState(
        focusSearchParam === "picker" ? ("ChatAccountPicker" as const) : null,
    );

    const hasSearchParamToDelete = searchParams.has("focus");
    useEffect(() => {
        if (hasSearchParamToDelete) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    newSearchParams.delete("focus");
                    return newSearchParams;
                },
                {replace: true},
            );
        }
    }, [hasSearchParamToDelete, setSearchParams]);

    // Having state here allows us to optimistically update selected accounts. Then
    // when we get a new result back from Remix (due to route transition), that always
    // wins.
    const [selectionState, setSelectionState] = useStateWithDependencies(
        ([loaderData]): ChatAccountPickerSelectionState => {
            if (loaderData.selectedChat?.chat.definition.type !== "Room") {
                return {type: "Accounts", accounts: loaderData.selectedAccounts};
            } else {
                const {
                    id,
                    definition: {name},
                } = loaderData.selectedChat.chat;

                return {type: "RoomChat", id, name};
            }
        },
        [loaderData],
    );

    useEffect(() => {
        const newSearchParams = new URLSearchParams(searchParams);

        switch (selectionState.type) {
            case "RoomChat": {
                newSearchParams.delete("accounts");
                newSearchParams.set("chat", selectionState.id);
                break;
            }
            case "Accounts": {
                newSearchParams.delete("chat");

                if (selectionState.accounts.length === 0) {
                    newSearchParams.delete("accounts");
                } else {
                    newSearchParams.set(
                        "accounts",
                        selectionState.accounts.map(account => account.id).join(" "),
                    );
                }
                break;
            }
            default:
                throw exhaustive(selectionState);
        }

        if (searchParams.toString() !== newSearchParams.toString()) {
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [location.key, searchParams, selectionState, setSearchParams]);

    const navigation = useNavigation();

    const isAccountPickerPending =
        navigation.state === "loading" && navigation.location.pathname === location.pathname;

    const shouldShowAccountPickerPendingSpinner = useDelayLoadingIndicator(isAccountPickerPending);

    // If you're spending time in a 1:1 chat, then we give affinity points to the
    // account you're messaging. Not the chat itself. The page we route you to for an
    // account in search is currently your 1:1 chat with the account anyways.
    //
    // By accruing points to the account we allow chat conversations to affect account
    // selector type-ahead affinity rankings.
    useSearchAffinityViewEntityInteraction(
        loaderData.selectedChat
            ? getChatOrAccountSearchAffinityEntityId(
                  currentAccount?.id,
                  loaderData.selectedChat?.chat,
              )
            : null,
    );

    const accountPickerContainerRef = useRef<HTMLDivElement>(null);
    const messagingViewRef = useRef<MessagingViewRef<ChatId>>(null);

    // If `<ChatAccountPicker>` grows then `<NewChatMessagingView>` will shrink. But
    // instead of keeping content at the top of `<NewChatMessagingView>` stable, we
    // want to keep content at the bottom of `<NewChatMessagingView>` stable. So make a
    // scroll adjustment on resize to make sure the last message stays in place.
    //
    // Note that this only really kicks into gear if the chat you START with when
    // `<ChatAccountPicker>` grows is filled with messages. Otherwise the chat
    // messaging view header (aptly named `chatMessagingViewHeaderItem`) that pushes
    // content to the bottom will end up keeping the scroll position correct.
    //
    // This effect does a similar job as
    // `useScrollToAvoidBottomBarsAndMobileKeyboard()`. But whereas
    // `useScrollToAvoidBottomBarsAndMobileKeyboard()` is focused on making sure we
    // adjust scroll when the message input height at the bottom grows, this hook is
    // focused on making sure we adjust scroll when the account picker height at the
    // top grows.
    useEffect(() => {
        const accountPickerContainerElement = assertExists(accountPickerContainerRef.current);

        let currentClientHeight = accountPickerContainerElement.clientHeight;

        const handleResize = () => {
            const {clientHeight} = accountPickerContainerElement;

            if (currentClientHeight === clientHeight) return;
            const lastClientHeight = currentClientHeight;
            currentClientHeight = clientHeight;

            if (clientHeight > lastClientHeight) {
                // We need to read `.current` every resize (instead of at the top of the effect)
                // since the `.current` reference changes when `selectedChat` changes.
                const messagingView = assertExists(messagingViewRef.current);

                messagingView.setScrollOffset(
                    messagingView.getScrollOffset() + (clientHeight - lastClientHeight),
                );
            }
        };

        addResizeListenerForElement(accountPickerContainerElement, handleResize);
        return () => {
            removeResizeListenerForElement(accountPickerContainerElement, handleResize);
        };
    }, []);

    return (
        <Box
            flexGrow="1"
            width="full"
            height="full"
            overflow="hidden"
            display="flex"
            flexDirection="column"
        >
            <Box
                ref={accountPickerContainerRef}
                position="relative"
                zIndex="10"
                flexShrink="0"
                paddingTop="safe-area-inset"
            >
                {platform === "mobile" && (
                    <NavigationBarContent
                        // We don't have the done button in regular chats so also don't show it here. It's
                        // more intuitive to tap on messages to close the keyboard.
                        withoutFocusedTextInputDoneButton={true}
                        title="New message"
                    />
                )}
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
                    position="relative"
                    zIndex="10"
                    width="full"
                    maxWidth={contentStyles.contentMaxWidth}
                    marginX="auto"
                    // For Playwright so we can tell when we're done loading a chat.
                    data-testid={
                        isAccountPickerPending ? "ChatAccountPickerContainer:Pending" : undefined
                    }
                >
                    <ChatAccountPicker
                        loaderSelectedChatId={loaderData.selectedChat?.chat.id ?? null}
                        selectionState={selectionState}
                        onUpdateSelectedAccounts={update => {
                            setSelectionState(selectionState => {
                                const newAccounts = update(
                                    selectionState.type === "Accounts"
                                        ? selectionState.accounts
                                        : emptyArray,
                                );

                                // Optimization: Noop if accounts didn't change.
                                if (
                                    selectionState.type === "Accounts" &&
                                    selectionState.accounts === newAccounts
                                ) {
                                    return selectionState;
                                }

                                return {type: "Accounts", accounts: newAccounts};
                            });
                        }}
                        onSelectRoomChat={roomChat => {
                            setSelectionState(
                                roomChat
                                    ? {type: "RoomChat", id: roomChat.id, name: roomChat.name}
                                    : {type: "Accounts", accounts: []},
                            );
                        }}
                        shouldShowPendingSpinner={shouldShowAccountPickerPendingSpinner}
                        suggestedChats={
                            // If we change to no selected accounts, don't wait for the loader to re-execute to
                            // clear suggested chats.
                            selectionState.type === "Accounts" && selectionState.accounts.length > 0
                                ? loaderData.suggestedChats
                                : emptyArray
                        }
                        shouldInitiallyFocus={initiallyFocus === "ChatAccountPicker"}
                        focusMessageInput={() => {
                            messagingViewRef.current?.focusInput();
                        }}
                    />
                </Box>
            </Box>
            <NewChatMessagingView
                ref={messagingViewRef}
                initialCheckpoint={loaderData.checkpoint}
                selectedChat={loaderData.selectedChat}
                onUpdateSelectedChat={handleUpdateSelectedChat}
            />
        </Box>
    );
}
