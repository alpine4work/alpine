import {AgentWebMarkdownStreamParser} from "~/server/agents/web/agent_web_markdown_stream_parser.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    ApiContent,
    ApiContentBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export type ApiContentAgentWebMarkdownParserOptions = {
    readonly spaceId: SpaceId;
};

export async function parseApiContentFromAgentWebMarkdown(
    storage: AgentWebSessionStorage,
    markdown: string,
    options: ApiContentAgentWebMarkdownParserOptions,
): Promise<ApiContent> {
    const parser = new AgentWebMarkdownStreamParser({
        storage,
        spaceId: options.spaceId,
    });

    parser.pushText(null, markdown);

    const elements: Array<ApiContentBlockElement> = [];

    for (const {part} of await parser.update(null)) {
        // We only push text so there should be only content parts.
        if (part.payload.type !== "Content") continue;

        for (const element of part.payload.content.elements) {
            elements.push(element);
        }
    }

    return {elements};
}
