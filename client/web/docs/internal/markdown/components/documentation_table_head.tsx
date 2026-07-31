import {ReactNode} from "react";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownChildItems} from "~/shared/docs/documentation_markdown_child_items.js";

/**
 * A table header. In markdown it emits the header row followed by the GFM
 * `| --- |` separator sized to the number of columns.
 */
export const DocumentationTableHead = documentationComponent({
    react: ({children}: {children?: ReactNode}) => <thead>{children}</thead>,
    markdown: props => {
        const headerRow = documentationMarkdownChildItems(props.children)[0] ?? "";
        const columnCount = headerRow.split("|").filter(cell => cell.trim().length > 0).length;
        const separator = `| ${Array.from({length: columnCount}, () => "---").join(" | ")} |`;
        return `${headerRow}\n${separator}`;
    },
});
