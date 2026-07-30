import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownChildItems} from "~/client/web/docs/internal/markdown/documentation_markdown_child_items.js";
import {indentDocumentationMarkdownContinuationLines} from "~/client/web/docs/internal/markdown/indent_documentation_markdown_continuation_lines.js";

/** A bulleted list (`- …`). */
export const DocumentationUnorderedList = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box
            as="ul"
            marginY="4"
            marginX="0"
            paddingLeft="6"
            display="flex"
            flexDirection="column"
            gap="1.5"
        >
            {children}
        </Box>
    ),
    markdown: props => {
        const items = documentationMarkdownChildItems(props.children);
        return `${items
            .map(item => {
                const marker = "- ";
                return marker + indentDocumentationMarkdownContinuationLines(item, marker.length);
            })
            .join("\n")}\n\n`;
    },
});
