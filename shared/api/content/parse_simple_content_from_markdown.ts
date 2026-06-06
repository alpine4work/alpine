import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {
    SimpleContent,
    SimpleContentProsemirrorSchema,
    assertSimpleContent,
} from "~/shared/content/simple_content_schema.js";

export function parseSimpleContentFromMarkdown(markdown: string): SimpleContent {
    const apiContent = parseApiContentFromMarkdown(markdown);
    const content = fromApiContent(SimpleContentProsemirrorSchema, apiContent);
    return assertSimpleContent(content);
}
