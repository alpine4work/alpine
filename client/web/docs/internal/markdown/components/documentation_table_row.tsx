import {ReactNode} from "react";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownChildItems} from "~/client/web/docs/internal/markdown/documentation_markdown_child_items.js";

/** A table row, rendered as a GFM `| cell | cell |` line with cells escaped. */
export const DocumentationTableRow = documentationComponent({
    react: ({children}: {children?: ReactNode}) => <tr>{children}</tr>,
    markdown: props => {
        const cells = documentationMarkdownChildItems(props.children).map(cell =>
            cell.replace(/\|/g, "\\|"),
        );
        return `| ${cells.join(" | ")} |`;
    },
});
