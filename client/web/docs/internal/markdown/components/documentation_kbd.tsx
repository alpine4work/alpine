import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

/**
 * A keyboard shortcut key: mono text in a hairline card with a slightly thicker
 * bottom border to read like a key cap. In markdown it becomes inline code.
 */
export const DocumentationKbd = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box
            as="kbd"
            display="inline-flex"
            alignItems="center"
            paddingX="1.5"
            borderRadius="1.5"
            fontSize="50"
            fontStyle="code"
            color="grey-90"
            backgroundColor="grey-1"
            border="grey-10"
            borderBottomWidth="thick"
            marginX="0.5"
        >
            {children}
        </Box>
    ),
    markdown: props => `\`${flattenDocumentationMarkdownChildren(props.children).trim()}\``,
});
