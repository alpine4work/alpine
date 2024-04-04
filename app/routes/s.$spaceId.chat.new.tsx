import {useEffect} from "react";
import {useLocation, useNavigation, useSearchParams} from "react-router-dom";
import {ChatAccountPicker} from "~/client/chat/chat_account_picker.js";
import {NewChatMessagingView} from "~/client/chat/new_chat_messaging_view.js";
import {Box} from "~/client/design/box.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {selectChatForAccounts} from "~/server/chat/data/chat_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
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
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const selectedAccountIds = (url.searchParams.get("accounts")?.split(" ") ?? []).map(accountId =>
        Schema.id<AccountId>().deserialize(accountId),
    );

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
            selectedAccounts,
            selectedChat: selectedChatResult?.selectedChat ?? null,
            suggestedChats: selectedChatResult?.suggestedChats ?? [],
        },
        {propagateEventData},
    );
}

export default function NewChatRoute({withMobileLayout = false}: {withMobileLayout?: boolean}) {
    const loaderData = useLoaderDataWithSchema(LoaderSchema);
    const {currentAccount} = useSpaceContext();

    const location = useLocation();
    const stateKey =
        isObject(location.state) && typeof location.state.stateKey === "string"
            ? location.state.stateKey
            : location.key;

    const [searchParams, setSearchParams] = useSearchParams();

    // Having state here allows us to optimistically update selected accounts. Then
    // when we get a new result back from Remix (due to route transition), that
    // always wins.
    const [selectedAccounts, setSelectedAccounts] = useStateWithDependencies(
        selectedAccounts => selectedAccounts,
        [loaderData.selectedAccounts],
    );

    useEffect(() => {
        // Use `window.location.search` since we may have silently updated search params
        // in a way Remix state doesn't know about.
        const newSearchParams = new URLSearchParams(window.location.search);
        if (selectedAccounts.length === 0) {
            newSearchParams.delete("accounts");
        } else {
            newSearchParams.set("accounts", selectedAccounts.map(account => account.id).join(" "));
        }

        if (searchParams.toString() !== newSearchParams.toString()) {
            setSearchParams(newSearchParams, {replace: true, state: {stateKey}});
        }
    }, [location.key, searchParams, selectedAccounts, setSearchParams, stateKey]);

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
    useSearchAffinityViewInteraction(
        loaderData.selectedChat
            ? loaderData.selectedChat.chat.accounts.length === 2
                ? `Account:${
                      loaderData.selectedChat.chat.accounts.filter(
                          account => account.id !== currentAccount.id,
                      )[0]!.id
                  }`
                : `Chat:${loaderData.selectedChat.chat.id}`
            : null,
    );

    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            padding={!withMobileLayout ? {desktop: "4"} : undefined}
            display="flex"
            justifyContent="center"
        >
            <Box
                maxWidth="160"
                width="full"
                height="full"
                overflow="hidden"
                backgroundColor="grey-0"
                borderRadius={!withMobileLayout ? {desktop: "md"} : undefined}
                boxShadow="elevation-5"
                display="flex"
                flexDirection="column"
            >
                <Box flexShrink="0" borderBottom="grey-10">
                    <ChatAccountPicker
                        selectedAccounts={selectedAccounts}
                        onUpdateSelectedAccounts={setSelectedAccounts}
                        shouldShowPendingSpinner={shouldShowAccountPickerPendingSpinner}
                        suggestedChats={loaderData.suggestedChats}
                        withMobileLayout={withMobileLayout}
                    />
                </Box>
                <NewChatMessagingView selectedChat={loaderData.selectedChat} />
            </Box>
        </Box>
    );
}
