import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

/** A table body cell (`td`). */
export const DocumentationTableCell = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box
            as="td"
            fontSize="75"
            color="grey-50"
            borderTop="grey-5"
            borderRight="grey-5"
            style={{padding: "10px 14px", verticalAlign: "top"}}
        >
            {children}
        </Box>
    ),
    markdown: props => flattenDocumentationMarkdownChildren(props.children).trim(),
});
