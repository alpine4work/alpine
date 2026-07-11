import {DocumentationMarkdownProps} from "~/client/web/docs/internal/markdown/documentation_markdown_component.js";

/**
 * Read a string-valued prop from a markdown variant's props, defaulting to `""`
 * when the prop is absent or not a string (e.g. an `href`, `src`, or `alt`).
 */
export function documentationMarkdownStringProp(
    props: DocumentationMarkdownProps,
    key: string,
): string {
    const value = props[key];
    return typeof value === "string" ? value : "";
}
