import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownChildItems} from "~/client/web/docs/internal/markdown/documentation_markdown_child_items.js";

/**
 * A responsive grid of link cards for hub and landing pages. In markdown it
 * becomes a bulleted list of its `<Card>` links.
 */
export const DocumentationCardGrid = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box
            display="grid"
            gap="3"
            marginY="3"
            style={{gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))"}}
        >
            {children}
        </Box>
    ),
    markdown: props => `${documentationMarkdownChildItems(props.children).join("\n")}\n\n`,
});
