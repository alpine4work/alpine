import {ShouldReloadFunction} from "@remix-run/react";
import {MetaFunction} from "@remix-run/server-runtime";
import {useEffect, useState} from "react";
import {useSearchParams} from "react-router-dom";
import {ChatView} from "~/client/chat/chat_view";
import {Box} from "~/client/design/box";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {AccountId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {getRecommendedChats} from "~/shared/rpc/chat_rpc_definitions";
import {Schema} from "~/shared/schema/schema";

const LoaderSchema = Schema.object({
    selectedAccounts: Schema.array(AccountModel.schema()),
    recommendedChats: getRecommendedChats.outputSchema
        .merge(Schema.object({input: getRecommendedChats.inputSchema}))
        .nullable(),
});

export const meta: MetaFunction = () => {
    return {
        title: `New chat message${metaTitlePostfix}`,
    };
};

// If only the `accounts` search param on the URL changed, we don't need to reload.
export const unstable_shouldReload: ShouldReloadFunction = ({url: _url, prevUrl: _prevUrl}) => {
    const url = new URL(_url);
    const prevUrl = new URL(_prevUrl);

    url.searchParams.delete("accounts");
    prevUrl.searchParams.delete("accounts");

    return url.toString() !== prevUrl.toString();
};

export async function loader({request, context: _context, params}: LoaderArgs) {
    const context = await _context.auth.authenticate();

    const url = new URL(request.url);
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);

    const selectedAccountIds = (url.searchParams.get("accounts")?.split(" ") ?? []).map(accountId =>
        Schema.id<AccountId>().deserialize(accountId),
    );

    const [selectedAccounts, recommendedChats] = await runAllPromises([
        runAllPromises(
            selectedAccountIds.map(accountId => getAccountOrThrow(context, spaceId, accountId)),
        ),
        selectedAccountIds.length > 0
            ? (async () => {
                  const input = {
                      spaceId,
                      otherAccountIds: Array.from(new Set(selectedAccountIds))
                          .filter(accountId => accountId !== context.auth.getAccountId())
                          .sort(),
                      exactMatchInitialMessagesLimit: getInitialLoadMessageCount(
                          context.loader.clientInfo,
                      ),
                  };

                  const output = await getRecommendedChats(context, input);

                  return Object.assign(output, {input});
              })()
            : null,
    ]);

    return jsonWithSchema(LoaderSchema, {selectedAccounts, recommendedChats});
}

export default function NewChatRoute({isPeek}: {isPeek?: boolean}) {
    const {selectedAccounts: initialSelectedAccounts, recommendedChats: initialRecommendedChats} =
        useLoaderDataWithSchema(LoaderSchema);

    const [searchParams, setSearchParams] = useSearchParams();
    const [selectedAccounts, setSelectedAccounts] =
        useState<ReadonlyArray<AccountModel>>(initialSelectedAccounts);

    useEffect(() => {
        const newSearchParams = new URLSearchParams(searchParams);
        if (selectedAccounts.length === 0) {
            newSearchParams.delete("accounts");
        } else {
            newSearchParams.set("accounts", selectedAccounts.map(account => account.id).join(" "));
        }
        setSearchParams(newSearchParams);
    }, [searchParams, selectedAccounts, setSearchParams]);

    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            padding={!isPeek ? {desktop: "4"} : undefined}
            display="flex"
            justifyContent="center"
        >
            <Box
                maxWidth="160"
                width="full"
                height="full"
                backgroundColor="grey-0"
                borderRadius={!isPeek ? {desktop: "md"} : undefined}
                boxShadow="elevation-5"
            >
                <ChatView
                    selectedAccounts={selectedAccounts}
                    onUpdateSelectedAccounts={setSelectedAccounts}
                    initialRecommendedChats={initialRecommendedChats}
                />
            </Box>
        </Box>
    );
}
