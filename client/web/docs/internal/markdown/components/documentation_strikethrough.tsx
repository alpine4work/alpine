import {ReactNode} from "react";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

/** Strikethrough inline text (`~~…~~`). */
export const DocumentationStrikethrough = documentationComponent({
    react: ({children}: {children?: ReactNode}) => <del>{children}</del>,
    markdown: props => `~~${flattenDocumentationMarkdownChildren(props.children)}~~`,
});
