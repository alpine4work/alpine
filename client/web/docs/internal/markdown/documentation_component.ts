import {ReactNode} from "react";
import {DocumentationMarkdownComponent} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

/**
 * A documentation component that also knows how to render itself to markdown: the
 * function renders the HTML docs site, and `.markdown` renders the same node to a
 * markdown string. Every built-in and custom component is declared with {@link
 * documentationComponent}, and the markdown renderer derives its component map
 * from their `.markdown` variants — so each component lives in one place.
 */
export type DocumentationComponent<Props> = ((props: Props) => ReactNode) & {
    markdown: DocumentationMarkdownComponent;
};

/**
 * Declare a documentation component from a `react` renderer and a `markdown`
 * renderer, keeping both variants local to the component's own file.
 */
export function documentationComponent<Props>({
    react,
    markdown,
}: {
    react: (props: Props) => ReactNode;
    markdown: DocumentationMarkdownComponent;
}): DocumentationComponent<Props> {
    return Object.assign(react, {markdown});
}
