import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

/** A single list item, inside an ordered or unordered list. */
export const DocumentationListItem = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box as="li" fontSize="200" color="grey-70" marginBottom="1.5" style={{lineHeight: 1.6}}>
            {children}
        </Box>
    ),
    markdown: props => flattenDocumentationMarkdownChildren(props.children).trim(),
});
