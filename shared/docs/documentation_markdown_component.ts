/**
 * The contract for a docs component's **markdown variant**: the same props the
 * React component receives, but rendered to a markdown string instead of a React
 * tree. `render_documentation_mdx_to_markdown.ts` drives MDX through these
 * variants so `props.children` always arrives already rendered to markdown.
 */
export type DocumentationMarkdownComponent = (props: DocumentationMarkdownProps) => string;

export type DocumentationMarkdownProps = {
    children?: DocumentationMarkdownChildren;
    [key: string]: unknown;
};

/**
 * The shape `props.children` takes inside a markdown variant. Because every
 * variant returns a string, children are strings (a single child) or arrays of
 * strings (multiple children, with markup-insignificant whitespace interleaved).
 */
export type DocumentationMarkdownChildren =
    | string
    | number
    | boolean
    | null
    | undefined
    | ReadonlyArray<DocumentationMarkdownChildren>;

/** Concatenate a variant's children into a single markdown string. */
export function flattenDocumentationMarkdownChildren(
    children: DocumentationMarkdownChildren,
): string {
    if (children === null || children === undefined || typeof children === "boolean") return "";
    if (typeof children === "string") return children;
    if (typeof children === "number") return String(children);
    return children.map(flattenDocumentationMarkdownChildren).join("");
}
