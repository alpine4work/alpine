import {
    deserializeChatIdForLoader,
    deserializeMessageIndexForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {getMessageReactionsForSearchParam} from "~/app/helpers/get_message_reactions_for_search_param.js";
import {ReactionsView} from "~/client/web/reactions/reactions_view.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {getChatMessagePayload} from "~/server/chat/data/chat_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const LoaderSchema = Schema.object({
    author: AccountModel.schema,
    reactions: ReactionSet.schema,
    accounts: Schema.array(AccountModel.schema),
});

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const url = new URL(request.url);

    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const chatId = deserializeChatIdForLoader(params.chatId);
    const index = deserializeMessageIndexForLoader("message", params.index);

    const message = await getChatMessagePayload(context, {chatId, messageIndex: index});
    const reactions = getMessageReactionsForSearchParam(url, message);

    const [author, accounts] = await runAllPromises([
        getAccount(context, spaceId, message.authorId),
        runAllPromises(
            mapIterable(reactions.get().keys(), accountId =>
                getAccount(context, spaceId, accountId),
            ),
        ),
    ]);

    return jsonWithSchema(LoaderSchema, {author, reactions, accounts});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {author}}) => [
    {
        title: `Reactions for message by ${getAccountShortNameWithoutFullNameTooltip(
            author.initialData,
        )}`,
    },
]);

export default function ChatMessageReactionsRoute() {
    const {reactions, accounts} = useLoaderDataWithSchema(LoaderSchema);

    return <ReactionsView entityNoun="message" reactions={reactions} accounts={accounts} />;
}
