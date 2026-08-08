import {ReactNode} from "react";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/shared/docs/documentation_markdown_component.js";

/** Italic inline text (`*…*`). */
export const DocumentationItalic = documentationComponent({
    react: ({children}: {children?: ReactNode}) => <em>{children}</em>,
    markdown: props => `*${flattenDocumentationMarkdownChildren(props.children)}*`,
});
