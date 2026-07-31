import {documentationHomeUrl} from "~/shared/docs/documentation_home_url.js";

/**
 * The docs content sidebar is driven by the directory tree under
 * `app/docs/codegen/content`. A `.mdx` file is a page; a directory is a
 * collapsible group. Both files and directories may carry a numeric ordering
 * prefix (`00-`, `01-`, …) which is stripped from the slug/URL and used only to
 * order siblings in the sidebar. Nesting is arbitrarily deep.
 *
 * `parseDocumentationNavTree()` turns the flat list of content files into this
 * tree.
 */
export type DocumentationNavDoc = {
    type: "doc";
    /** The URL slug, e.g. `guides/documents` (ordering prefixes stripped). */
    slug: string;
    title: string;
};

export type DocumentationNavGroup = {
    type: "group";
    /** The directory's slug path, e.g. `guides` (ordering prefixes stripped). */
    slug: string;
    title: string;
    children: Array<DocumentationNavNode>;
};

export type DocumentationNavNode = DocumentationNavDoc | DocumentationNavGroup;

export type DocumentationNavTree = {
    nodes: Array<DocumentationNavNode>;
    /**
     * Maps each doc slug back to its content file's path relative to `content/`.
     */
    filePathBySlug: Record<string, string>;
};

/**
 * One content file discovered under `content/`, with its display title resolved
 * (frontmatter `navTitle`/`title`, falling back to the humanized file name).
 */
export type DocumentationContentFile = {
    /** Path relative to `content/`, e.g. `02-guides/00-documents.mdx`. */
    relativePath: string;
    title: string;
};

const orderPrefixRegExp = /^(\d+)-/;

/**
 * Split a leading numeric ordering prefix (`00-`) from a file or directory name.
 * The prefix orders siblings; the remaining name becomes the slug segment.
 */
export function parseDocumentationOrderPrefix(name: string): {order: number | null; name: string} {
    const match = orderPrefixRegExp.exec(name);
    if (match === null) return {order: null, name};
    return {order: Number(match[1]), name: name.slice(match[0].length)};
}

/**
 * Turn a slug segment (`spaces-permissions`) into a display title
 * (`Spaces Permissions`). Used for group titles and as a fallback page title.
 */
export function humanizeDocumentationName(name: string): string {
    return name
        .split("-")
        .filter(word => word.length > 0)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}

export function createDocumentationDocUrl(slug: string): string {
    return `${documentationHomeUrl}/${slug}`;
}

/**
 * The first doc in the tree in sidebar order. Used to redirect `/docs` to a real
 * page.
 */
export function getFirstDocumentationSlug(nodes: Array<DocumentationNavNode>): string | null {
    for (const node of nodes) {
        if (node.type === "doc") return node.slug;
        const nested = getFirstDocumentationSlug(node.children);
        if (nested !== null) return nested;
    }
    return null;
}

/**
 * Whether a group contains the active doc (directly or nested), so it can default
 * to expanded. A group's slug is always a path prefix of its descendants' slugs.
 */
export function documentationGroupContainsSlug(
    group: DocumentationNavGroup,
    slug: string,
): boolean {
    return slug === group.slug || slug.startsWith(`${group.slug}/`);
}

// A mutable tree node used only while building; `parseDocumentationNavTree()`
// freezes these into the exported `DocumentationNavNode` shape.
type MutableGroup = {
    type: "group";
    slug: string;
    title: string;
    order: number | null;
    childrenByName: Map<string, MutableNode>;
};
type MutableDoc = {type: "doc"; slug: string; title: string; order: number | null};
type MutableNode = MutableGroup | MutableDoc;

/**
 * Build the navigation tree (and the slug → file path lookup) from the flat list
 * of content files. Pure: does no IO, so the interesting logic (prefix stripping,
 * grouping, ordering, nesting) is unit tested directly.
 */
export function parseDocumentationNavTree(
    files: Array<DocumentationContentFile>,
): DocumentationNavTree {
    const rootChildren = new Map<string, MutableNode>();
    const filePathBySlug: Record<string, string> = {};

    for (const file of files) {
        const rawSegments = file.relativePath.split("/").filter(segment => segment.length > 0);
        if (rawSegments.length === 0) continue;

        let currentLevel = rootChildren;
        const slugSegments: Array<string> = [];

        for (let index = 0; index < rawSegments.length; index++) {
            const isFile = index === rawSegments.length - 1;
            const rawSegment = isFile
                ? rawSegments[index]!.replace(/\.mdx$/, "")
                : rawSegments[index]!;
            const {order, name} = parseDocumentationOrderPrefix(rawSegment);
            slugSegments.push(name);
            const slug = slugSegments.join("/");

            if (isFile) {
                currentLevel.set(name, {type: "doc", slug, title: file.title, order});
                filePathBySlug[slug] = file.relativePath;
            } else {
                const existing = currentLevel.get(name);
                if (existing !== undefined && existing.type === "group") {
                    currentLevel = existing.childrenByName;
                } else {
                    const group: MutableGroup = {
                        type: "group",
                        slug,
                        title: humanizeDocumentationName(name),
                        order,
                        childrenByName: new Map(),
                    };
                    currentLevel.set(name, group);
                    currentLevel = group.childrenByName;
                }
            }
        }
    }

    return {nodes: freezeDocumentationNavNodes(rootChildren), filePathBySlug};
}

function freezeDocumentationNavNodes(nodes: Map<string, MutableNode>): Array<DocumentationNavNode> {
    return Array.from(nodes.values())
        .sort(compareDocumentationNavNodes)
        .map(node =>
            node.type === "group"
                ? {
                      type: "group",
                      slug: node.slug,
                      title: node.title,
                      children: freezeDocumentationNavNodes(node.childrenByName),
                  }
                : {type: "doc", slug: node.slug, title: node.title},
        );
}

function compareDocumentationNavNodes(node1: MutableNode, node2: MutableNode): number {
    const order1 = node1.order ?? Number.MAX_SAFE_INTEGER;
    const order2 = node2.order ?? Number.MAX_SAFE_INTEGER;
    if (order1 !== order2) return order1 - order2;
    return node1.slug.localeCompare(node2.slug);
}
