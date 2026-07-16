import {ReactNode} from "react";
import {createDocumentationHeadingId} from "~/client/web/docs/internal/create_documentation_heading_id.js";
import {
    DocumentationAnchorHeading,
    documentationHeadingToMarkdown,
} from "~/client/web/docs/internal/documentation_anchor_heading.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {getDocumentationNodeText} from "~/client/web/docs/internal/markdown/get_documentation_node_text.js";

/** A section heading (`## `), with an anchor id derived from its text. */
export const DocumentationHeader2 = documentationComponent({
    react: ({children}: {children?: ReactNode}) => (
        <DocumentationAnchorHeading
            level={2}
            id={createDocumentationHeadingId(getDocumentationNodeText(children))}
        >
            {children}
        </DocumentationAnchorHeading>
    ),
    markdown: props => documentationHeadingToMarkdown(2, props.children),
});
