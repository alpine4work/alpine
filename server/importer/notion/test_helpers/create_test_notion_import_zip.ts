/* eslint-disable cyberworlds/string-quotes -- Generates CSV and HTML which require straight quotes */
import {strFromU8, strToU8, zipSync} from "fflate";
import {readFileSync} from "fs";
import {join} from "path";

import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Generates a 32 hex character ID matching Notion's format (UUID without dashes).
 */
function generateNotionId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

const referencePlaceholderPrefix = "CYBERWORLDS_TEST_REFERENCE_";

abstract class ExportedNotionItem {
    public readonly notionId = generateNotionId();
    protected _parent: ExportedNotionDocument | null = null;

    get parent(): ExportedNotionDocument | null {
        return this._parent;
    }

    /**
     * Returns a placeholder string that will be replaced with the actual markdown
     * reference when the zip is generated. For documents this becomes
     * `[Title](path.md)`, for databases `[Title](path.csv)`.
     */
    toReference(): string {
        return `[${referencePlaceholderPrefix}${this.notionId}]`;
    }

    /**
     * Sets the parent document of this item and adds this item to the parent's
     * children. If the item already has a parent, it is removed from the previous
     * parent's children.
     */
    setParent(
        parent: ExportedNotionDocument | null,
        options?: {skipBidirectionalRelationship?: boolean},
    ): ExportedNotionItem {
        if (this._parent !== null) {
            if (this._parent === parent) {
                return this;
            } else if (!options?.skipBidirectionalRelationship) {
                this._parent.removeChild(this, {skipBidirectionalRelationship: true});
            }
        }

        this._parent = parent;

        if (parent && !options?.skipBidirectionalRelationship) {
            parent.addChildren([this], {skipBidirectionalRelationship: true});
        }

        return this;
    }
}

/**
 * A Notion document export consists of a title, content, optional child items
 * (sub-pages and databases), and optional attached files.
 *
 * Files are NOT children in the tree hierarchy. They are referenced inline in the
 * markdown content and placed alongside the document (flat mode) or in the
 * document's subdirectory (nested mode).
 */
class ExportedNotionDocument extends ExportedNotionItem {
    public readonly title: string;
    public content: string;
    public readonly children: Array<ExportedNotionItem> = [];
    public readonly files: Array<ExportedNotionFile> = [];

    constructor(title: string, content: string, children: Array<ExportedNotionItem> = []) {
        super();
        this.title = title;
        this.content = content;
        if (children.length > 0) {
            this.addChildren(children);
        }
    }

    /**
     * Adds child items to this document and sets their parent to this document. If the
     * child items already have a parent, they are removed from their previous parent's
     * children.
     */
    addChildren(
        children: Array<ExportedNotionItem>,
        options?: {skipBidirectionalRelationship?: boolean},
    ): ExportedNotionDocument {
        if (!options?.skipBidirectionalRelationship) {
            for (const child of children) {
                if (child.parent && child.parent !== this) {
                    child.parent.removeChild(child, {skipBidirectionalRelationship: true});
                }
                child.setParent(this, {skipBidirectionalRelationship: true});
            }
        }

        this.children.push(...children);
        return this;
    }

    /**
     * Removes a child item from this document and clears its parent.
     */
    removeChild(
        child: ExportedNotionItem,
        options?: {skipBidirectionalRelationship?: boolean},
    ): ExportedNotionDocument {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            this.children.splice(index, 1);

            if (!options?.skipBidirectionalRelationship) {
                child.setParent(null, {skipBidirectionalRelationship: true});
            }
        }
        return this;
    }

    /**
     * Associates files with this document. In the generated zip, files are placed at
     * root level (flat) or in the document's subdirectory (nested). Use
     * `file.toReference()` in the content to create a placeholder that resolves to the
     * correct path.
     */
    addFiles(files: Array<ExportedNotionFile>): ExportedNotionDocument {
        this.files.push(...files);
        return this;
    }
}

/**
 * A Notion database export consists of a title and a 2D array of strings
 * representing rows and columns. The first row is the header row.
 *
 * When a database is a child of a document:
 *
 * - Use `toReference()` to create a link to the database's .md file (standard
 *   Notion export behavior)
 * - Use `toCsvReference()` to create a direct link to the CSV file (for testing
 *   inline database replacement)
 *
 * Databases can have children (documents that become rows in the database). In
 * Notion exports, these children are placed in a subdirectory named after the
 * database (without the Notion ID suffix).
 *
 * Set `inline: true` to make this a CSV-only database (no .md wrapper). This
 * simulates how Notion exports inline databases that are embedded directly in
 * document content.
 */
class ExportedNotionDatabase extends ExportedNotionItem {
    private readonly _csvRefId = generateNotionId();
    public readonly children: Array<ExportedNotionDocument> = [];
    /** If true, this database is CSV-only (no .md wrapper file). */
    public readonly inline: boolean;

    constructor(
        public readonly title: string,
        public readonly data: Array<Array<string>>,
        children: Array<ExportedNotionDocument> = [],
        options?: {inline?: boolean},
    ) {
        super();
        this.inline = options?.inline ?? false;
        if (children.length > 0) {
            this.addChildren(children);
        }
    }

    /**
     * Returns a placeholder string that will be replaced with a direct link to the CSV
     * file. Use this to test inline database replacement where the CSV content should
     * be inlined as a table.
     */
    toCsvReference(): string {
        return `[${referencePlaceholderPrefix}${this._csvRefId}]`;
    }

    /** Internal accessor for the CSV reference ID */
    get csvRefId(): string {
        return this._csvRefId;
    }

    /**
     * Adds child documents to this database. In Notion exports, database children are
     * placed in a subdirectory named after the database.
     */
    addChildren(
        children: Array<ExportedNotionDocument>,
        options?: {skipBidirectionalRelationship?: boolean},
    ): ExportedNotionDatabase {
        if (!options?.skipBidirectionalRelationship) {
            for (const child of children) {
                if (child.parent && child.parent !== (this as unknown as ExportedNotionDocument)) {
                    child.parent.removeChild(child, {skipBidirectionalRelationship: true});
                }
                child.setParent(this as unknown as ExportedNotionDocument, {
                    skipBidirectionalRelationship: true,
                });
            }
        }

        this.children.push(...children);
        return this;
    }
}

/**
 * Test fixtures for different media types.
 */
const fixtureName = {
    image: "image.png",
    video: "video.mp4",
    audio: "audio.mp3",
};

/**
 * A Notion exported file, such as an image, video, or audio file. Files are NOT
 * part of the document tree hierarchy. They are referenced inline in the markdown
 * content and placed in the document's directory in the zip.
 *
 * Reads real binary data from test fixtures to produce realistic exports.
 */
class ExportedNotionFile {
    public readonly name: string;
    public readonly type: "image" | "video" | "audio";
    private readonly _refId = generateNotionId();

    constructor(name: string, type: "image" | "video" | "audio") {
        this.name = name;
        this.type = type;
    }

    /**
     * Returns a placeholder string that will be replaced with the actual file
     * reference when the zip is generated. For images this becomes `![name](path)`.
     */
    toReference(): string {
        return `[${referencePlaceholderPrefix}${this._refId}]`;
    }

    get data(): Uint8Array {
        const runfiles = process.env.RUNFILES;
        assert(runfiles, "RUNFILES environment variable not set");
        const fixturePath = join(
            runfiles,
            "cyberworlds",
            "server/importer/notion/test_fixtures",
            fixtureName[this.type],
        );
        return new Uint8Array(readFileSync(fixturePath));
    }
}

/**
 * A Notion teamspace groups items under a named section in the workspace. In the
 * index.html, teamspaces are represented as `<ul id="id::UUID">` whose `<a>` has
 * no `href` attribute.
 */
class ExportedNotionTeamspace {
    public readonly notionId = generateNotionId();
    public readonly name: string;
    public readonly items: Array<ExportedNotionItem>;

    constructor(name: string, items: Array<ExportedNotionItem>) {
        this.name = name;
        this.items = items;
    }
}

interface CreateTestNotionImportZipOptions {
    createFoldersForSubpages?: boolean;
    workspaceName?: string;
}

/**
 * Creates a test ZIP file in memory for testing Notion import functionality.
 * Returns the ZIP file as a Uint8Array.
 *
 * The output matches the structure of Notion's export: an outer zip containing a
 * single inner zip (`Export-<uuid>-Part-1.zip`). The inner zip contains all the
 * exported files under a root directory. Notion always nests exports this way,
 * likely so partial exports can be split across multiple inner zip parts.
 */
export function createTestNotionImportZip(
    items: Array<ExportedNotionItem> | Array<ExportedNotionTeamspace>,
    options?: CreateTestNotionImportZipOptions,
): Uint8Array {
    const nested = options?.createFoldersForSubpages ?? false;
    const workspaceName = options?.workspaceName ?? "Test Workspace";
    const exportId = crypto.randomUUID();
    const rootDir = `Export-${exportId}`;

    const files: Record<string, Uint8Array> = {};
    const referenceMap = new Map<string, string>();

    const hasTeamspaces = items.length > 0 && items[0] instanceof ExportedNotionTeamspace;

    if (hasTeamspaces) {
        const teamspaces = items as Array<ExportedNotionTeamspace>;
        for (const teamspace of teamspaces) {
            for (const item of teamspace.items) {
                addItemToFiles(files, item, rootDir, "", nested, referenceMap);
            }
        }
    } else {
        const notionItems = items as Array<ExportedNotionItem>;
        // Collect top-level items (items without parents)
        const topLevelItems = notionItems.filter(item => item.parent === null);

        // Generate all file entries and populate the reference map
        for (const item of topLevelItems) {
            addItemToFiles(files, item, rootDir, "", nested, referenceMap);
        }
    }

    // Global resolution: replace all reference placeholders in markdown files. This
    // resolves cross-document references (e.g. siblings or ancestors referencing each
    // other).
    for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith(".md")) continue;
        let markdown = strFromU8(content);
        for (const [placeholder, resolved] of referenceMap) {
            markdown = markdown.replaceAll(placeholder, resolved);
        }
        files[path] = strToU8(markdown);
    }

    // Generate index.html
    const indexHtml = hasTeamspaces
        ? generateIndexHtmlWithTeamspaces(
              items as Array<ExportedNotionTeamspace>,
              workspaceName,
              nested,
          )
        : generateIndexHtml(items as Array<ExportedNotionItem>, workspaceName, nested);
    files[`${rootDir}/index.html`] = strToU8(indexHtml);

    // Create the inner zip containing the actual export files
    const innerZip = zipSync(files);

    // Wrap in outer zip — Notion always nests exports inside another zip named
    // `Export-<uuid>-Part-1.zip`. This allows Notion to split large exports across
    // multiple "Part" archives.
    const outerFiles: Record<string, Uint8Array> = {
        [`${rootDir}-Part-1.zip`]: innerZip,
    };

    return zipSync(outerFiles);
}

function addItemToFiles(
    files: Record<string, Uint8Array>,
    item: ExportedNotionItem,
    rootDir: string,
    parentPath: string,
    nested: boolean,
    referenceMap: Map<string, string>,
): void {
    if (item instanceof ExportedNotionDocument) {
        const fileName = `${item.title} ${item.notionId}.md`;
        const filePath = parentPath ? `${parentPath}/${fileName}` : fileName;

        // Register this document in the reference map
        referenceMap.set(item.toReference(), `[${item.title}](${encodePath(filePath)})`);

        // In nested mode, the document creates a subdirectory with its title that houses
        // all children and attached files.
        const childPath = nested ? (parentPath ? `${parentPath}/${item.title}` : item.title) : "";

        const markdown = buildDocumentMarkdown(item);
        files[`${rootDir}/${filePath}`] = strToU8(markdown);

        // Place attached files in the document's directory (nested) or at root level
        // (flat). Files are NOT tree children — they're referenced inline in the markdown
        // content.
        for (const file of item.files) {
            const fileFilePath = childPath ? `${childPath}/${file.name}` : file.name;
            referenceMap.set(file.toReference(), `![${file.name}](${encodePath(fileFilePath)})`);
            files[`${rootDir}/${fileFilePath}`] = file.data;
        }

        for (const child of item.children) {
            addItemToFiles(files, child, rootDir, childPath, nested, referenceMap);
        }
    } else if (item instanceof ExportedNotionDatabase) {
        const csvFileName = `${item.title} ${item.notionId}.csv`;
        const csvFilePath = parentPath ? `${parentPath}/${csvFileName}` : csvFileName;

        const mdFileName = `${item.title} ${item.notionId}.md`;
        const mdFilePath = parentPath ? `${parentPath}/${mdFileName}` : mdFileName;

        // Register the .csv file reference for inline database testing
        const csvRefPlaceholder = `[${referencePlaceholderPrefix}${item.csvRefId}]`;
        referenceMap.set(csvRefPlaceholder, `[${item.title}](${encodePath(csvFilePath)})`);

        if (item.inline) {
            // Inline databases are CSV-only (no .md wrapper). The reference placeholder still
            // points to the CSV directly.
            referenceMap.set(item.toReference(), `[${item.title}](${encodePath(csvFilePath)})`);
        } else {
            // Full-page databases have an .md wrapper that links to the CSV.
            referenceMap.set(item.toReference(), `[${item.title}](${encodePath(mdFilePath)})`);

            // Generate the .md file that links to the CSV
            const mdContent = `# ${item.title}\n\n[${item.title}](${encodePath(csvFileName)})\n`;
            files[`${rootDir}/${mdFilePath}`] = strToU8(mdContent);
        }

        // Generate the CSV files
        const csv = buildDatabaseCsv(item);
        files[`${rootDir}/${csvFilePath}`] = strToU8(csv);

        // Notion also exports an \_all.csv with the same content
        const allFileName = `${item.title} ${item.notionId}_all.csv`;
        const allFilePath = parentPath ? `${parentPath}/${allFileName}` : allFileName;
        files[`${rootDir}/${allFilePath}`] = strToU8(csv);

        // Database children (row documents) are placed in a subdirectory named after the
        // database title (without Notion ID). In nested mode, this is under the parent
        // path; in flat mode, it's at the root level.
        if (item.children.length > 0) {
            const databaseChildPath = parentPath ? `${parentPath}/${item.title}` : item.title;
            for (const child of item.children) {
                addItemToFiles(files, child, rootDir, databaseChildPath, nested, referenceMap);
            }
        }
    }
}

function buildDocumentMarkdown(doc: ExportedNotionDocument): string {
    let md = `# ${doc.title}\n`;

    // List child documents and databases as reference placeholders before the content.
    // The global resolution pass replaces these with the correct links after all file
    // paths are known.
    const childLinks = buildChildLinks(doc);
    if (childLinks) {
        md += `\n${childLinks}`;
    }

    if (doc.content) {
        if (childLinks) {
            md += `\n---\n\n`;
        } else {
            md += "\n";
        }
        md += `${doc.content}\n`;
    }

    return md;
}

/**
 * Encodes each segment of a path individually, preserving `/` separators.
 */
function encodePath(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
}

function buildChildLinks(doc: ExportedNotionDocument): string {
    const links: Array<string> = [];
    for (const child of doc.children) {
        if (child instanceof ExportedNotionDocument || child instanceof ExportedNotionDatabase) {
            links.push(child.toReference());
        }
    }
    if (links.length === 0) return "";
    return links.join("\n\n") + "\n";
}

function buildDatabaseCsv(database: ExportedNotionDatabase): string {
    // Notion CSVs start with a BOM
    const bom = "\ufeff";
    const rows = database.data.map(row => row.map(escapeCsvField).join(","));
    return bom + rows.join("\n") + "\n";
}

function escapeCsvField(field: string): string {
    if (field.includes(",") || field.includes('"') || field.includes("\n")) {
        return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
}

function generateIndexHtml(
    items: Array<ExportedNotionItem>,
    workspaceName: string,
    nested: boolean,
): string {
    const workspaceId = crypto.randomUUID();
    let html = `<!DOCTYPE html><html><head>\n`;
    html += `\t\t\t\t\t\t<title>Export</title>\n`;
    html += `\t\t\t\t\t</head>\n`;
    html += `\t\t\t\t<body>\n`;
    html += `\t\t\t\t\t<ul id="id::${workspaceId}">\n`;
    html += `\t\t\t\t\n`;
    html += `\t\t\t\t<li><h3>Workspace details:</h3>`;
    html += `<p>Workspace identifier: ${workspaceId}</p>`;
    html += `<p>Workspace name: ${workspaceName}</p></li>`;

    for (const item of items) {
        html += generateIndexHtmlEntry(item, "", nested);
    }

    html += `</ul>\n\t\t\t\t\t</body>\n</html>`;
    return html;
}

function generateIndexHtmlWithTeamspaces(
    teamspaces: Array<ExportedNotionTeamspace>,
    workspaceName: string,
    nested: boolean,
): string {
    const workspaceId = crypto.randomUUID();
    let html = `<!DOCTYPE html><html><head>\n`;
    html += `\t\t\t\t\t\t<title>Export</title>\n`;
    html += `\t\t\t\t\t</head>\n`;
    html += `\t\t\t\t<body>\n`;
    html += `\t\t\t\t\t<ul id="id::${workspaceId}">\n`;
    html += `\t\t\t\t\n`;
    html += `\t\t\t\t<li><h3>Workspace details:</h3>`;
    html += `<p>Workspace identifier: ${workspaceId}</p>`;
    html += `<p>Workspace name: ${workspaceName}</p></li>`;

    for (const teamspace of teamspaces) {
        html += `<li><ul id="id::${formatNotionIdAsUuid(teamspace.notionId)}">`;
        html += `<a>${encodeHtmlEntities(teamspace.name)}</a>`;

        for (const item of teamspace.items) {
            html += generateIndexHtmlEntry(item, "", nested);
        }

        html += `</ul></li>`;
    }

    html += `</ul>\n\t\t\t\t\t</body>\n</html>`;
    return html;
}

function encodeHtmlEntities(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function generateIndexHtmlEntry(
    item: ExportedNotionItem,
    parentPath: string,
    nested: boolean,
): string {
    if (item instanceof ExportedNotionDocument) {
        const fileName = `${item.title} ${item.notionId}.md`;
        const href = parentPath ? `${parentPath}/${fileName}` : `./${fileName}`;

        let html = `<li><ul id="id::${formatNotionIdAsUuid(item.notionId)}">`;
        html += `<a href="${href}">${fileName}</a>`;

        const childPath = nested ? (parentPath ? `${parentPath}/${item.title}` : item.title) : "";

        for (const child of item.children) {
            html += generateIndexHtmlEntry(child, childPath, nested);
        }

        html += `</ul></li>`;
        return html;
    } else if (item instanceof ExportedNotionDatabase) {
        const fileName = `${item.title} ${item.notionId}.csv`;
        let html = `<li><ul id="id::${formatNotionIdAsUuid(item.notionId)}.csv">`;
        html += `<a href="./${fileName}">${fileName}</a>`;

        // Database children are placed in a subdirectory named after the database title
        const childPath = parentPath ? `${parentPath}/${item.title}` : item.title;

        for (const child of item.children) {
            html += generateIndexHtmlEntry(child, childPath, nested);
        }

        html += `</ul></li>`;
        return html;
    }
    return "";
}

/**
 * Formats a 32-char hex notion ID as a UUID with dashes for use in index.html id
 * attributes.
 */
function formatNotionIdAsUuid(notionId: string): string {
    return [
        notionId.slice(0, 8),
        notionId.slice(8, 12),
        notionId.slice(12, 16),
        notionId.slice(16, 20),
        notionId.slice(20, 32),
    ].join("-");
}

export {
    ExportedNotionDatabase,
    ExportedNotionDocument,
    ExportedNotionFile,
    ExportedNotionTeamspace,
};
