import {deserializePostIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {ReactionsView} from "~/client/web/reactions/reactions_view.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {getPost} from "~/server/forum/data/get_post.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const LoaderSchema = Schema.object({
    post: createRynamoItemSchema(PostModel.schema()),
    accounts: Schema.array(AccountModel.schema),
});

export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const postId = deserializePostIdForLoader(params.postId ?? null);

    const post = await getPost(context, postId);

    const accounts = await runAllPromises(
        mapIterable(post.model.reactions.get().keys(), accountId =>
            getAccount(context, post.model.spaceId, accountId),
        ),
    );

    return jsonWithSchema(
        LoaderSchema,
        {post, accounts},
        {propagateEventData: {context: {channelId: post.model.channel.id}}},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {post}}) => [
    {
        title: `Reactions for post by ${getAccountShortNameWithoutFullNameTooltip(
            post.model.author.initialData,
        )}`,
    },
]);

export default function PostReactionsRoute() {
    const {post, accounts} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <ReactionsView
            entityNoun="post"
            // NOTE(calebmer): This route doesn't update `reactions` in realtime. Shouldn't be
            // a problem. People won't be doing a lot of collaborative work on this surface.
            reactions={post.model.reactions}
            accounts={accounts}
        />
    );
}
