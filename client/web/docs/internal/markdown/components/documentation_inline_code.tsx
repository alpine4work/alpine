import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {toDocumentationMarkdownCodeBlock} from "~/client/web/docs/internal/documentation_code_block.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";
import {documentationMarkdownStringProp} from "~/client/web/docs/internal/markdown/documentation_markdown_string_prop.js";

/**
 * Inline `code`. MDX also nests `code` inside `pre` for fenced blocks, tagging it
 * with a `language-…` class, so the markdown variant emits a fenced block in that
 * case and a backtick span otherwise.
 */
export const DocumentationInlineCode = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box
            as="code"
            fontSize="75"
            fontStyle="code"
            paddingX="1"
            borderRadius="1"
            backgroundColor="grey-1"
            border="grey-5"
            color="grey-90"
        >
            {children}
        </Box>
    ),
    markdown: props => {
        const className = documentationMarkdownStringProp(props, "className");
        const content = flattenDocumentationMarkdownChildren(props.children);
        if (className.startsWith("language-")) {
            return toDocumentationMarkdownCodeBlock(content, className.slice("language-".length));
        }
        return `\`${content}\``;
    },
});
