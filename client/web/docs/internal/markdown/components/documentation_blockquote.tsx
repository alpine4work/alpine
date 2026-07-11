import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

/** A blockquote (`> …`), quoting each line of its content. */
export const DocumentationBlockquote = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box
            as="blockquote"
            borderLeft="grey-10"
            borderLeftWidth="thick"
            paddingLeft="4"
            marginY="5"
            marginX="0"
            color="grey-50"
        >
            {children}
        </Box>
    ),
    markdown: props => {
        const content = flattenDocumentationMarkdownChildren(props.children).trim();
        const quoted = content
            .split("\n")
            .map(line => (line.length > 0 ? `> ${line}` : ">"))
            .join("\n");
        return `${quoted}\n\n`;
    },
});
