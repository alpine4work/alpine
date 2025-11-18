import {
    deserializePostIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {ChatGptDebugView} from "~/client/debug/chat_gpt/chat_gpt_debug_view.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {loadChatGptConversationItems} from "~/server/debug/chat_gpt/load_chat_gpt_conversation_items.js";
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

export async function loader({context, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? null);
    const postId = deserializePostIdForLoader(params.postId ?? null);

    const items = await loadChatGptConversationItems(context, spaceId, `/posts/${postId}`);

    return jsonWithSchema(LoaderSchema, {items});
}

export default function ChatGptDebugRoute() {
    const {items} = useLoaderDataWithSchema(LoaderSchema);

    return <ChatGptDebugView items={items} />;
}
