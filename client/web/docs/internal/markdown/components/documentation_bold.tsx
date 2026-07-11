import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

/** Bold inline text (`**…**`). */
export const DocumentationBold = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <Box as="strong" fontStyle="bold" color="grey-90">
            {children}
        </Box>
    ),
    markdown: props => `**${flattenDocumentationMarkdownChildren(props.children)}**`,
});
