import {
    deserializeMessageIndexForLoader,
    deserializeTaskIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {getMessageReactionsForSearchParam} from "~/app/helpers/get_message_reactions_for_search_param.js";
import {ReactionsView} from "~/client/web/reactions/reactions_view.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getTaskCommentPayload} from "~/server/tasks/data/get_task_comment_payload.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const LoaderSchema = Schema.object({
    spaceId: Schema.id<SpaceId>(),
    author: AccountModel.schema,
    reactions: ReactionSet.schema,
    accounts: Schema.array(AccountModel.schema),
});

export async function loader({request, params, context: unauthenticatedContext}: LoaderArgs) {
    const url = new URL(request.url);

    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const taskId = deserializeTaskIdForLoader(params.taskId);
    const index = deserializeMessageIndexForLoader("comment", params.index);

    const comment = await getTaskCommentPayload(context, {taskId, commentIndex: index});
    const reactions = getMessageReactionsForSearchParam(url, comment);

    const [author, accounts] = await runAllPromises([
        getAccount(context, comment.spaceId, comment.authorId),
        runAllPromises(
            mapIterable(reactions.get().keys(), accountId =>
                getAccount(context, comment.spaceId, accountId),
            ),
        ),
    ]);

    return jsonWithSchema(LoaderSchema, {
        spaceId: comment.spaceId,
        author,
        reactions,
        accounts,
    });
}

export const meta = createMetaFunction(LoaderSchema, ({data: {author}}) => [
    {
        title: `Reactions for comment by ${getAccountShortNameWithoutFullNameTooltip(
            author.initialData,
        )}`,
    },
]);

export default function TaskCommentReactionsRoute() {
    const {reactions, accounts} = useLoaderDataWithSchema(LoaderSchema);

    return <ReactionsView entityNoun="comment" reactions={reactions} accounts={accounts} />;
}
