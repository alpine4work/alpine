import {useTransition} from "@remix-run/react";
import {MetaFunction} from "@remix-run/server-runtime";
import {useEffect} from "react";
import {useLocation, useSearchParams} from "react-router-dom";
import {ChatAccountPicker} from "~/client/chat/chat_account_picker";
import {NewChatMessagingView} from "~/client/chat/new_chat_messaging_view";
import {Box} from "~/client/design/box";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {getAccount} from "~/server/dynamo/accounts_table";
import {selectChatForAccounts} from "~/server/dynamo/chat_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {isObject} from "~/shared/helpers/object/is_object";
import {AccountId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {ChatMessageModel, ChatModel} from "~/shared/models/chat_model";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    selectedAccounts: Schema.array(AccountModel.schema()),
    selectedChat: Schema.object({
        chat: ChatModel.schema(),
        initialMessages: Schema.array(ChatMessageModel.schema()),
        initialOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
    }).nullable(),
    suggestedChats: Schema.array(ChatModel.schema()),
});

export const meta: MetaFunction = () => {
    return {
        title: `New chat message${metaTitlePostfix}`,
    };
};

export async function loader({request, context: _context, params}: LoaderArgs) {
    const context = await _context.actor.authenticate();

    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);

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
            ? selectChatForAccounts(context, {
                  spaceId,
                  otherAccountIds: selectedAccountIds,
                  messagesLimit: getInitialLoadMessageCount(context.loader.clientInfo),
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

export default function NewChatRoute({withMobileLayout}: {withMobileLayout?: boolean}) {
    const loaderData = useLoaderDataWithSchema(LoaderSchema);

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
        const newSearchParams = new URLSearchParams(searchParams);
        if (selectedAccounts.length === 0) {
            newSearchParams.delete("accounts");
        } else {
            newSearchParams.set("accounts", selectedAccounts.map(account => account.id).join(" "));
        }

        if (searchParams.toString() !== newSearchParams.toString()) {
            setSearchParams(newSearchParams, {replace: true, state: {stateKey}});
        }
    }, [location.key, searchParams, selectedAccounts, setSearchParams, stateKey]);

    const transition = useTransition();

    const isAccountPickerPending =
        transition.state === "loading" && transition.location.pathname === location.pathname;

    const [shouldShowAccountPickerPendingSpinner, setShouldShowAccountPickerPendingSpinner] =
        useStateWithDependencies(false, [isAccountPickerPending]);

    useEffect(() => {
        if (!isAccountPickerPending) return;

        const timeout = createTimeout(() => {
            setShouldShowAccountPickerPendingSpinner(true);
        }, delayLoadingIndicatorLimitMs);
        return () => timeout.clear();
    }, [isAccountPickerPending, setShouldShowAccountPickerPendingSpinner]);

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
                    />
                </Box>
                <NewChatMessagingView selectedChat={loaderData.selectedChat} />
            </Box>
        </Box>
    );
}
