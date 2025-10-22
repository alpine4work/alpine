import {Node} from "prosemirror-model";
import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {printContentSingleLineTextSnippetForServer} from "~/server/content/print_content_single_line_text_snippet_for_server.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {isTextEndedWithPunctuation} from "~/shared/content/print_content_single_line_text_snippet.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export async function printNotificationEventAlertContentBody(
    context: ServerActionContext,
    fileAuthorizer: FileAuthorizer,
    event: {spaceId: SpaceId; isContentSnippetComplete: boolean; contentSnippet: Node},
) {
    // We don't render files in the alert content so don't bother preloading files.
    const contentReferences = await getContentReferencesForNode(
        context,
        event.spaceId,
        fileAuthorizer,
        event.contentSnippet,
    );

    let body = printContentSingleLineTextSnippetForServer({
        doc: event.contentSnippet,
        references: contentReferences,
    });

    if (!event.isContentSnippetComplete && !isTextEndedWithPunctuation(body)) {
        body += "…";
    }

    return body;
}
