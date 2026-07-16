import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownChildItems} from "~/client/web/docs/internal/markdown/documentation_markdown_child_items.js";

/** A table, rendered as a GFM pipe table in markdown. */
export const DocumentationTable = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box marginY="5" border="grey-10" borderRadius="2" overflow="hidden">
            <Box as="table" width="full" style={{borderCollapse: "collapse"}}>
                {children}
            </Box>
        </Box>
    ),
    markdown: props => `${documentationMarkdownChildItems(props.children).join("\n")}\n\n`,
});
