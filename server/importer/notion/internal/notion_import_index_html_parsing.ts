import {strFromU8} from "fflate";
import {DomUtils, parseDocument} from "htmlparser2";

/**
 * A parsed element from the index.html DOM tree. This is the return type of
 * DomUtils.findOne when an element is found.
 */
export type NotionIndexHtmlElement = NonNullable<ReturnType<typeof DomUtils.findOne>>;

/**
 * Result of parsing the index.html file from a Notion export.
 */
export interface NotionImportParsedIndexHtml {
    /** The parsed DOM document. */
    document: ReturnType<typeof parseDocument>;
    /** The root <ul> element representing the workspace. */
    workspaceRootElement: NotionIndexHtmlElement;
    /** The workspace ID extracted from the root element. */
    workspaceId: string;
    /** The workspace name extracted from the header. */
    workspaceName: string;
    /**
     * Direct children of the workspace root (either teamspaces or top-level pages).
     */
    topLevelChildren: Array<NotionIndexHtmlElement>;
    /**
     * Whether this export has teamspaces (vs direct pages under workspace root).
     */
    hasTeamspaces: boolean;
}

/**
 * Parses the index.html file from a Notion export and extracts the core structure.
 *
 * @see README.md "index.html Structure" section for the HTML DOM structure. @see
 * test_fixtures/sample_index_without_teamspaces.html for an example without
 * teamspaces. @see test_fixtures/sample_index_with_teamspaces.html for an example
 * with teamspaces.
 *
 * @param rawFiles - The unzipped file contents keyed by path @returns Parsed
 * index.html structure, or null if invalid
 */
export function parseNotionImportIndexHtml(
    rawFiles: Record<string, Uint8Array>,
): NotionImportParsedIndexHtml | null {
    // Find index.html - it may be at the root or inside a directory like
    // "Export-uuid/"
    const indexHtmlKey = Object.keys(rawFiles).find(
        key => key.endsWith("/index.html") || key === "index.html",
    );
    if (!indexHtmlKey) return null;

    // Parse the HTML into a DOM tree we can query
    const html = strFromU8(rawFiles[indexHtmlKey]!);
    const document = parseDocument(html);

    // Extract workspace name from "<p>Workspace name: ...</p>" in the header
    const workspaceName = extractWorkspaceName(document);
    if (!workspaceName) return null;

    // The first <ul id="id::..."> is the workspace root - it contains everything
    const workspaceRootElement = DomUtils.findOne(
        isUnorderedListWithNotionId,
        document.children,
        true,
    );
    if (!workspaceRootElement) return null;

    const workspaceId = normalizeNotionId(workspaceRootElement.attribs.id!);

    // Find direct children of the workspace root
    const topLevelChildren = findChildUnorderedListElements(workspaceRootElement);

    // Determine if this export has teamspaces: all top-level items must have <a>
    // without href
    const hasTeamspaces = detectHasTeamspaces(topLevelChildren);

    return {
        document,
        workspaceRootElement,
        workspaceId,
        workspaceName,
        topLevelChildren,
        hasTeamspaces,
    };
}

/**
 * Checks if an element is a <ul> with a Notion ID attribute. Notion uses
 *
 * <ul id="id::UUID"> elements to represent the tree structure.
 */
export function isUnorderedListWithNotionId(element: {
    name: string;
    attribs: Record<string, string>;
}): boolean {
    return element.name === "ul" && element.attribs.id?.startsWith("id::") === true;
}

/**
 * Finds immediate child <ul id="id::..."> elements of a parent element.
 *
 * The DOM structure is:
 *
 *   <ul id="id::parent">
 *     <li><ul id="id::child1">...</ul></li>
 *     <li><ul id="id::child2">...</ul></li>
 *   </ul>
 *
 * So we need to look inside each <li> to find the child <ul> elements.
 */
export function findChildUnorderedListElements(
    parent: NotionIndexHtmlElement,
): Array<NotionIndexHtmlElement> {
    const results: Array<NotionIndexHtmlElement> = [];

    for (const child of DomUtils.getChildren(parent)) {
        if ("name" in child && child.name === "li") {
            for (const listItemChild of DomUtils.getChildren(child)) {
                if ("attribs" in listItemChild && isUnorderedListWithNotionId(listItemChild)) {
                    results.push(listItemChild);
                }
            }
        }
    }

    return results;
}

/**
 * Extracts and normalizes a Notion ID from a <ul id="id::..."> attribute.
 *
 * The id attribute can have several formats:
 *
 * - UUID with dashes: "id::2e780a22-fe37-80d8-889d-df2a4ed08451"
 * - Teamspace with trailing ID: "id::Teamspace Name
 *   2e780a22fe3780d8889ddf2a4ed08451"
 * - Just a name: "id::Private&Shared"
 * - Database with .csv suffix: "id::2e780a22-fe37-80d8-889d-df2a4ed08451.csv"
 *
 * We normalize to 32-char hex (no dashes) for consistency with filenames.
 *
 * @see README.md "Notion ID Formats" section for ID format details.
 */
export function normalizeNotionId(idAttribute: string): string {
    // Strip the "id::" prefix
    const rawId = idAttribute.slice("id::".length);

    // If there's a trailing 32-char hex ID (after a space), extract it. Otherwise use
    // the raw ID (which may be a UUID with dashes or just a name).
    const trailingIdMatch = rawId.match(/ ([0-9a-f]{32})$/);

    // Remove dashes to normalize UUID format to 32-char hex
    return (trailingIdMatch?.[1] ?? rawId).replace(/-/g, "");
}

/**
 * Strips a trailing 32-character hex Notion ID from a name string. E.g.
 * `"My Teamspace abc123...def"` -> `"My Teamspace"`.
 */
export function stripTrailingNotionId(name: string): string {
    return name.replace(/ [0-9a-f]{32}$/, "");
}

/**
 * Finds the first <a> element that is a direct child of the given element.
 */
export function findAnchorElement(element: NotionIndexHtmlElement): NotionIndexHtmlElement | null {
    return DomUtils.findOne(el => el.name === "a", DomUtils.getChildren(element), true);
}

/**
 * Detects whether this export has teamspaces based on the top-level children.
 *
 * Teamspaces are optional in Notion - some workspaces use them, others don't. The
 * key difference is in the <a> element inside each top-level child:
 *
 * - WITH teamspaces: <a>Teamspace Name</a> (NO href - just a label)
 * - WITHOUT teamspaces: <a href="./Page.md">Page</a> (HAS href - direct page link)
 */
function detectHasTeamspaces(topLevelChildren: Array<NotionIndexHtmlElement>): boolean {
    if (topLevelChildren.length === 0) return false;

    return topLevelChildren.every(child => {
        const anchor = findAnchorElement(child);
        return anchor != null && !anchor.attribs.href;
    });
}

/**
 * Finds the workspace name from the index.html header. Notion includes this as:
 *
 * <p>Workspace name: My Workspace</p>
 */
function extractWorkspaceName(document: ReturnType<typeof parseDocument>): string | null {
    const paragraphTag = DomUtils.findOne(
        element =>
            element.name === "p" && DomUtils.textContent(element).startsWith("Workspace name:"),
        document.children,
        true,
    );
    if (!paragraphTag) return null;

    const text = DomUtils.textContent(paragraphTag);
    return text.replace(/^Workspace name:\s*/, "").trim() || null;
}
