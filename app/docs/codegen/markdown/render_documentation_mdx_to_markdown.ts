import {
    DocumentationMarkdownComponent,
    DocumentationMarkdownProps,
    flattenDocumentationMarkdownChildren,
} from "~/shared/docs/documentation_markdown_component.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";

// A JSX runtime that renders to markdown strings instead of React elements. Docs
// MDX is compiled to a function body that reads its runtime from `arguments[0]`
// (see `get_documentation_mdx_content.ts`); passing this runtime makes each
// `jsx()` call invoke the component's markdown variant and return its string, so
// evaluating the module yields the finished markdown with no React render and no
// HTML escaping.
const markdownRuntime = {
    Fragment: (props: DocumentationMarkdownProps) =>
        flattenDocumentationMarkdownChildren(props.children),
    jsx: markdownJsx,
    jsxs: markdownJsx,
};

function markdownJsx(type: unknown, props: DocumentationMarkdownProps): string {
    // Components (including our Fragment) are functions that return a markdown string.
    if (typeof type === "function") return String(type(props));

    throw new InternalError(
        `Unsupported docs markdown MDX element: ${describeMarkdownJsxType(type)}`,
    );
}

function describeMarkdownJsxType(type: unknown): string {
    return typeof type === "string" ? `<${type}>` : String(type);
}

/**
 * Render compiled docs MDX (the generated `mdxCode`) to markdown by evaluating it
 * against {@link markdownRuntime} and the given markdown component variants.
 * Guides pass the shared documentation markdown components; API pages pass the
 * same map plus model-bound variants for API-aware tags.
 */
export function renderDocumentationMdxToMarkdown(
    mdxCode: string,
    components: Record<string, DocumentationMarkdownComponent>,
): string {
    // The code is our own build output compiled from checked-in MDX, not user
    // input — same trust model as `get_documentation_mdx_content.ts`.
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    const initializeMdxModule = new Function(mdxCode);
    const mdxModule: unknown = initializeMdxModule(markdownRuntime);
    assert(
        isMarkdownMdxModule(mdxModule),
        "Expected compiled docs MDX to export a content component",
    );

    const rendered = String(mdxModule.default({components}));
    // Collapse the runs of blank lines the block variants leave behind and trim to a
    // single trailing newline.
    return `${rendered
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()}\n`;
}

function isMarkdownMdxModule(
    value: unknown,
): value is {default: (props: {components: unknown}) => unknown} {
    return isPlainObject(value) && typeof value.default === "function";
}
