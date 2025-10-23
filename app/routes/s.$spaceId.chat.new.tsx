import {useEffect, useRef, useState} from "react";
import {
    ShouldRevalidateFunction,
    useLocation,
    useNavigation,
    useSearchParams,
} from "react-router-dom";
import {
    deserializeAccountIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {ChatAccountPicker} from "~/client/chat/chat_account_picker.js";
import {NewChatMessagingView} from "~/client/chat/new_chat_messaging_view.js";
import {Box} from "~/client/design/box.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/helpers/use_resize_observer.js";
import {getInitialLoadMessageCount} from "~/client/messaging/get_initial_load_message_count.js";
import {MessagingViewRef} from "~/client/messaging/messaging_view.js";
import {NavigationBarContent} from "~/client/navigation/navigation_bar_content.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/search/use_search_affinity_view_entity_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {selectChatForAccounts} from "~/server/chat/data/chat_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";
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

    const selectedAccountIds = (url.searchParams.get("accounts")?.split(" ") ?? []).map(accountId =>
        deserializeAccountIdForLoader(accountId),
    );

    // Generate checkpoint before we start loading data. So when we backfill we
    // include any realtime events that happened while loading data.
    const checkpoint = generateServerSynchronizationCheckpoint();

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

    const propagateEventData: TracerEventData = {
        context: {
            chatId: selectedChatResult?.selectedChat.chat.id,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {
            checkpoint,
            selectedAccounts,
            selectedChat: selectedChatResult?.selectedChat ?? null,
            suggestedChats: selectedChatResult?.suggestedChats ?? [],
        },
        {propagateEventData},
    );
}

// We don't need to reload when certain search params change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: _currentUrl,
    nextUrl: _nextUrl,
}) => {
    const currentUrl = new URL(_currentUrl);
    const nextUrl = new URL(_nextUrl);

    // Used to initially focus the chat:
    nextUrl.searchParams.delete("focus");
    currentUrl.searchParams.delete("focus");

    return nextUrl.toString() !== currentUrl.toString();
};

export default function NewChatRoute() {
    const loaderData = useLoaderDataWithSchema(LoaderSchema);

    const platform = usePlatform();
    const {currentAccount} = useSpaceContext();

    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    const focusSearchParam = searchParams.get("focus");
    const [initiallyFocus] = useState(
        focusSearchParam === "picker" ? ("ChatAccountPicker" as const) : null,
    );

    useEffect(() => {
        if (searchParams.has("focus")) {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.delete("focus");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [searchParams, setSearchParams]);

    // Having state here allows us to optimistically update selected accounts. Then
    // when we get a new result back from Remix (due to route transition), that
    // always wins.
    const [selectedAccounts, setSelectedAccounts] = useStateWithDependencies(
        ([selectedAccounts]) => selectedAccounts,
        [loaderData.selectedAccounts],
    );

    useEffect(() => {
        const newSearchParams = new URLSearchParams(searchParams);
        if (selectedAccounts.length === 0) {
            newSearchParams.delete("accounts");
        } else {
            newSearchParams.set("accounts", selectedAccounts.map(account => account.id).join(" "));
        }

        if (searchParams.toString() !== newSearchParams.toString()) {
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [location.key, searchParams, selectedAccounts, setSearchParams]);

    const navigation = useNavigation();

    const isAccountPickerPending =
        navigation.state === "loading" && navigation.location.pathname === location.pathname;

    const shouldShowAccountPickerPendingSpinner = useDelayLoadingIndicator(isAccountPickerPending);

    // If you're spending time in a 1:1 chat, then we give affinity points to the
    // account you're messaging. Not the chat itself. The page we route you to for
    // an account in search is currently your 1:1 chat with the account anyways.
    //
    // By accruing points to the account we allow chat conversations to affect
    // account selector type-ahead affinity rankings.
    useSearchAffinityViewEntityInteraction(
        loaderData.selectedChat
            ? currentAccount && loaderData.selectedChat.chat.accounts.length === 2
                ? `Account:${
                      loaderData.selectedChat.chat.accounts.filter(
                          account => account.id !== currentAccount.id,
                      )[0]!.id
                  }`
                : `Chat:${loaderData.selectedChat.chat.id}`
            : null,
    );

    const accountPickerContainerRef = useRef<HTMLDivElement>(null);
    const messagingViewRef = useRef<MessagingViewRef<ChatId>>(null);

    // If `<ChatAccountPicker>` grows then `<NewChatMessagingView>` will shrink.
    // But instead of keeping content at the top of `<NewChatMessagingView>` stable,
    // we want to keep content at the bottom of `<NewChatMessagingView>` stable. So
    // make a scroll adjustment on resize to make sure the last message stays in
    // place.
    //
    // Note that this only really kicks into gear if the chat you START with when
    // `<ChatAccountPicker>` grows is filled with messages. Otherwise the chat
    // messaging view header (aptly named `chatMessagingViewHeaderItem`) that pushes
    // content to the bottom will end up keeping the scroll position correct.
    //
    // This effect does a similar job as
    // `useScrollToAvoidBottomBarsAndMobileKeyboard()`. But whereas
    // `useScrollToAvoidBottomBarsAndMobileKeyboard()` is focused on making sure we
    // adjust scroll when the message input height at the bottom grows, this hook
    // is focused on making sure we adjust scroll when the account picker height at
    // the top grows.
    useEffect(() => {
        const accountPickerContainerElement = assertExists(accountPickerContainerRef.current);

        let currentClientHeight = accountPickerContainerElement.clientHeight;

        const handleResize = () => {
            const {clientHeight} = accountPickerContainerElement;

            if (currentClientHeight === clientHeight) return;
            const lastClientHeight = currentClientHeight;
            currentClientHeight = clientHeight;

            if (clientHeight > lastClientHeight) {
                // We need to read `.current` every resize (instead of at the top of the
                // effect) since the `.current` reference changes when `selectedChat` changes.
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
                        // We don't have the done button in regular chats so also don't show it here.
                        // It's more intuitive to tap on messages to close the keyboard.
                        withoutFocusedTextInputDoneButton={true}
                        title="New message"
                    />
                )}
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
                        selectedAccounts={selectedAccounts}
                        onUpdateSelectedAccounts={setSelectedAccounts}
                        shouldShowPendingSpinner={shouldShowAccountPickerPendingSpinner}
                        suggestedChats={
                            // If we change to no selected accounts, don't wait for the loader to
                            // re-execute to clear suggested chats.
                            selectedAccounts.length > 0 ? loaderData.suggestedChats : emptyArray
                        }
                        shouldInitiallyFocus={initiallyFocus === "ChatAccountPicker"}
                    />
                </Box>
            </Box>
            <NewChatMessagingView
                ref={messagingViewRef}
                initialCheckpoint={loaderData.checkpoint}
                selectedChat={loaderData.selectedChat}
            />
        </Box>
    );
}
