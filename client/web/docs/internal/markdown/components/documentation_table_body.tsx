import {ReactNode} from "react";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownChildItems} from "~/shared/docs/documentation_markdown_child_items.js";

/** A table body, one markdown row per child `tr`. */
export const DocumentationTableBody = documentationComponent({
    react: ({children}: {children?: ReactNode}) => <tbody>{children}</tbody>,
    markdown: props => documentationMarkdownChildItems(props.children).join("\n"),
});
