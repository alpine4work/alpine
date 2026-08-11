import {deserializePostIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {ChatGptDebugView} from "~/client/web/debug/chat_gpt/chat_gpt_debug_view.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {loadChatGptConversationItems} from "~/server/debug/chat_gpt/load_chat_gpt_conversation_items.js";
import {authorizePostAccess} from "~/server/forum/data/authorize_post_access.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {ChatGptConversationItemSchema} from "~/shared/debug/chat_gpt/chat_gpt_conversation_item.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    items: Schema.array(ChatGptConversationItemSchema),
});

export function meta() {
    return [{title: `ChatGPT Debugger${metaTitlePostfix}`}];
}

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const postId = deserializePostIdForLoader(params.postId);

    const {spaceId} = await authorizePostAccess(context, postId, "View");

    const items = await loadChatGptConversationItems(
        unauthenticatedContext,
        spaceId,
        `/posts/${postId}`,
    );

    return jsonWithSchema(LoaderSchema, {items});
}

export default function ChatGptDebugRoute() {
    const {items} = useLoaderDataWithSchema(LoaderSchema);

    return <ChatGptDebugView items={items} />;
}
