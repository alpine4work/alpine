import {Parent, Root} from "mdast";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.open_source.js";

export function collectLinksFromMarkdownTreeForCursorAgent(root: Root) {
    const linkLabelByUrl = new Map<string, string>();

    const traverse = (node: Parent) => {
        for (const child of node.children) {
            if (
                child.type === "link" &&
                // Don't collect account links. The data we load for account links isn't
                // interesting.
                !child.url.startsWith("/account/")
            ) {
                linkLabelByUrl.set(child.url, printMarkdownPhrasingContentText(child.children));
            }

            if ("children" in child) traverse(child);
        }
    };

    traverse(root);

    return linkLabelByUrl;
}
