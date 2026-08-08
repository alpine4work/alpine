import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/shared/docs/documentation_markdown_component.js";

/** A table header cell (`th`). */
export const DocumentationTableHeaderCell = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box
            as="th"
            fontSize="75"
            fontStyle="bold"
            color="grey-90"
            backgroundColor="grey-1"
            textAlign="left"
            borderBottom="grey-10"
            borderRight="grey-5"
            style={{padding: "10px 14px"}}
        >
            {children}
        </Box>
    ),
    markdown: props => flattenDocumentationMarkdownChildren(props.children).trim(),
});
