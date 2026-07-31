import {createDocumentationHeadingId} from "~/shared/docs/create_documentation_heading_id.js";
import {DocumentationOnThisPageItem} from "~/shared/docs/documentation_on_this_page_item.js";

/**
 * Extract "On this page" items from raw authored MDX source by scanning `##` and
 * `###` heading lines.
 */
export function extractDocumentationMdxToc(mdxSource: string): Array<DocumentationOnThisPageItem> {
    const items: Array<DocumentationOnThisPageItem> = [];
    let insideCodeFence = false;

    for (const line of mdxSource.split("\n")) {
        if (line.startsWith("```")) {
            insideCodeFence = !insideCodeFence;
            continue;
        }
        if (insideCodeFence) continue;

        const match = /^(##|###)\s+(.+?)\s*$/.exec(line);
        if (match === null) continue;

        const text = match[2]!.replace(/[*_`]/g, "");
        items.push({
            id: createDocumentationHeadingId(text),
            text,
            level: match[1] === "##" ? 2 : 3,
        });
    }

    return items;
}
