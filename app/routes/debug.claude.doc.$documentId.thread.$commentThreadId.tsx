import {
    deserializeDocumentCommentThreadIdForLoader,
    deserializeDocumentIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {ClaudeDebugView} from "~/client/web/debug/claude/claude_debug_view.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {loadClaudeConversationDebugData} from "~/server/debug/claude/load_claude_conversation_items.js";
import {authorizeDocumentAccess} from "~/server/documents/data/documents_actions.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {ClaudeConversationDebugDataSchema} from "~/shared/debug/claude/claude_conversation_item.js";

export function meta() {
    return [{title: `Claude Debugger${metaTitlePostfix}`}];
}

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const documentId = deserializeDocumentIdForLoader(params.documentId);
    const commentThreadId = deserializeDocumentCommentThreadIdForLoader(
        documentId,
        params.commentThreadId ?? null,
    );

    const {spaceId} = await authorizeDocumentAccess(context, documentId, "View");

    const data = await loadClaudeConversationDebugData(unauthenticatedContext, spaceId, {
        type: "DocumentThread",
        document: {type: "Document", id: documentId},
        id: commentThreadId,
    });

    return jsonWithSchema(ClaudeConversationDebugDataSchema, data);
}

export default function ClaudeDebugRoute() {
    const data = useLoaderDataWithSchema(ClaudeConversationDebugDataSchema);

    return <ClaudeDebugView data={data} />;
}
