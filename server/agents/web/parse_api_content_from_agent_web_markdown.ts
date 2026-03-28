import {AgentWebMarkdownStreamParser} from "~/server/agents/web/agent_web_markdown_stream_parser.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    ApiContentBlockElementResponse,
    ApiContentResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

export async function parseApiContentFromAgentWebMarkdown(
    storage: AgentWebSessionStorage,
    markdown: string,
    {documentId = null}: {documentId?: DocumentId | null} = emptyObject,
): Promise<ApiContentResponse> {
    const parser = new AgentWebMarkdownStreamParser({
        storage,
        documentId,
    });

    parser.pushText(null, markdown);

    const elements: Array<ApiContentBlockElementResponse> = [];

    for (const {part} of await parser.update(null)) {
        // We only push text so there should be only content parts.
        if (part.payload.type !== "Content") continue;

        for (const element of part.payload.content.elements) {
            elements.push(element);
        }
    }

    return {elements};
}
