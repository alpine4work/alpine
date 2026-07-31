import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownChildItems} from "~/shared/docs/documentation_markdown_child_items.js";
import {indentDocumentationMarkdownContinuationLines} from "~/shared/docs/indent_documentation_markdown_continuation_lines.js";

/** A numbered list (`1. …`). */
export const DocumentationOrderedList = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box
            as="ol"
            marginY="4"
            marginX="0"
            paddingLeft="6"
            style={{listStylePosition: "outside", listStyleType: "decimal"}}
        >
            {children}
        </Box>
    ),
    markdown: props => {
        const items = documentationMarkdownChildItems(props.children);
        return `${items
            .map((item, index) => {
                const marker = `${index + 1}. `;
                return marker + indentDocumentationMarkdownContinuationLines(item, marker.length);
            })
            .join("\n")}\n\n`;
    },
});
