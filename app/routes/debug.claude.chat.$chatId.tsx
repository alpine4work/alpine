import {deserializeChatIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {ClaudeDebugView} from "~/client/web/debug/claude/claude_debug_view.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {loadClaudeConversationDebugData} from "~/server/debug/claude/load_claude_conversation_items.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {ClaudeConversationDebugDataSchema} from "~/shared/debug/claude/claude_conversation_item.js";

export function meta() {
    return [{title: `Claude Debugger${metaTitlePostfix}`}];
}

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const chatId = deserializeChatIdForLoader(params.chatId);

    const {spaceId} = await authorizeChatAccess(context, chatId, "View");

    const data = await loadClaudeConversationDebugData(unauthenticatedContext, spaceId, {
        type: "Chat",
        id: chatId,
    });

    return jsonWithSchema(ClaudeConversationDebugDataSchema, data);
}

export default function ClaudeDebugRoute() {
    const data = useLoaderDataWithSchema(ClaudeConversationDebugDataSchema);

    return <ClaudeDebugView data={data} />;
}
