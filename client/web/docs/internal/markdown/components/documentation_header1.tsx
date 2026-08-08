import {ReactNode} from "react";
import {
    DocumentationAnchorHeading,
    documentationHeadingToMarkdown,
} from "~/client/web/docs/internal/documentation_anchor_heading.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {getDocumentationNodeText} from "~/client/web/docs/internal/markdown/get_documentation_node_text.js";
import {createDocumentationHeadingId} from "~/shared/docs/create_documentation_heading_id.js";

/**
 * The page's top-level heading (`# `), with an anchor id derived from its text.
 */
export const DocumentationHeader1 = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <DocumentationAnchorHeading
            level={1}
            id={createDocumentationHeadingId(getDocumentationNodeText(children))}
        >
            {children}
        </DocumentationAnchorHeading>
    ),
    markdown: props => documentationHeadingToMarkdown(1, props.children),
});
