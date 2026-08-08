import {
    deserializeDocumentCommentThreadIdForLoader,
    deserializeDocumentIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {ChatGptDebugView} from "~/client/web/debug/chat_gpt/chat_gpt_debug_view.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {loadChatGptConversationItems} from "~/server/debug/chat_gpt/load_chat_gpt_conversation_items.js";
import {authorizeDocumentAccess} from "~/server/documents/data/documents_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {ChatGptConversationItemSchema} from "~/shared/debug/chat_gpt/chat_gpt_conversation_item.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

const LoaderSchema = Schema.object({
    items: Schema.array(ChatGptConversationItemSchema),
});

export function meta() {
    return [{title: `ChatGPT Debugger${metaTitlePostfix}`}];
}

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const documentId = deserializeDocumentIdForLoader(params.documentId);
    const commentThreadId = deserializeDocumentCommentThreadIdForLoader(
        documentId,
        params.commentThreadId ?? null,
    );

    const {spaceId} = await authorizeDocumentAccess(context, documentId, "View");

    const items = await loadChatGptConversationItems(
        unauthenticatedContext,
        spaceId,
        `/documents/${documentId}/threads/${commentThreadId}`,
    );

    return jsonWithSchema(LoaderSchema, {items});
}

export default function ChatGptDebugRoute() {
    const {items} = useLoaderDataWithSchema(LoaderSchema);

    return <ChatGptDebugView items={items} />;
}
