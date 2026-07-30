import {ReactNode} from "react";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {flattenDocumentationMarkdownChildren} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

/** One `<Tab>`: a fourth-level heading with its body underneath in markdown. */
export const DocumentationTab = documentationComponent({
    react: ({children}: {title: string; children?: ReactNode}) => <>{children}</>,
    markdown: props => {
        const title = typeof props.title === "string" ? props.title : "";
        const body = flattenDocumentationMarkdownChildren(props.children).trim();
        return `#### ${title}\n\n${body}`.trim();
    },
});
