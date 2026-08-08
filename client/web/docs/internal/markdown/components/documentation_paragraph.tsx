import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/shared/docs/documentation_markdown_component.js";

/** A body paragraph. */
export const DocumentationParagraph = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box
            as="p"
            fontSize="200"
            color="grey-70"
            marginTop="0"
            marginBottom="4"
            marginX="0"
            style={{lineHeight: 1.65}}
        >
            {children}
        </Box>
    ),
    markdown: props => `${flattenDocumentationMarkdownChildren(props.children).trim()}\n\n`,
});
