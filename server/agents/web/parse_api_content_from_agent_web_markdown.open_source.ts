import {Root} from "mdast";
import {convertMarkdownTreeToAgentWebMarkdownTree} from "~/server/agents/web/agent_web_markdown_stream_parser.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {
    parseApiContentFromMarkdownTree,
    parseMarkdownTree,
} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {ApiContentWithoutKeys} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

export async function parseApiContentFromAgentWebMarkdown(
    storage: AgentWebSessionStorage,
    markdown: string,
    options?: {documentId?: DocumentId | null},
): Promise<ApiContentWithoutKeys> {
    const root = parseMarkdownTree(markdown);
    return await parseApiContentFromAgentWebMarkdownTree(storage, root, options);
}

export async function parseApiContentFromAgentWebMarkdownTree(
    storage: AgentWebSessionStorage,
    root: Root,
    {documentId = null}: {documentId?: DocumentId | null} = emptyObject,
): Promise<ApiContentWithoutKeys> {
    ({root} = await convertMarkdownTreeToAgentWebMarkdownTree(storage, documentId, null, root));

    // In our Markdown `convertMarkdownTreeToAgentWebMarkdownTree()` pre-processing we
    // make sure to provide enough information that our parse function can return
    // `ApiContent` (e.g. setting `data.mentionElement` to a hydrated
    // `ApiContentMentionInlineElement` object).
    return parseApiContentFromMarkdownTree(root, {
        // Add dummy widths to `FileGallery` items since we need `width`s to match the
        // `ApiContent` type but we don't save old item widths in storage. We also set this
        // in `normalizeApiContentForAgentWebMarkdown()`.
        withDummyFileGalleryElementLayout: true,
    }) as ApiContentWithoutKeys;
}
