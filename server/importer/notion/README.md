# Notion Importer

Imports content from Notion workspace exports into Alpine spaces. Users upload a zip file exported
from Notion, and the importer parses it into documents, resolves cross-references, and creates the
corresponding Alpine documents.

## How Notion Exports Work

When you export a Notion workspace, you get a zip file with the following structure:

```
Export-<uuid>-Part-1.zip        <- outer zip
└── Export-<uuid>/              <- root directory inside inner zip
    ├── index.html              <- tree structure manifest
    ├── Page Title <notionId>.md
    ├── Database <notionId>.md
    ├── Database <notionId>.csv
    ├── Database <notionId>_all.csv
    ├── image.png
    └── ...
```

Key characteristics:

- **Double-nested zip**: Notion wraps exports in an outer zip containing one or more inner
  `Part-N.zip` files. This allows Notion to split large exports across multiple archives.
    - See [Multi-Part Exports](#multi-part-exports) for details on how Notion splits large
      workspaces.
- **Notion IDs**: Every page and database gets a 32-character hex ID (a UUID without dashes)
  appended to its filename, e.g. `My Page 2e780a22fe3780d8889ddf2a4ed08451.md`. See
  [Notion ID Formats](#notion-id-formats) for details on ID normalization.
- **Flat vs nested mode**: Exports can use a flat layout (all files in the root) or a nested layout
  (subdirectories matching the page tree). The parser handles both transparently.
- **index.html**: Contains the tree hierarchy as nested `<ul id="id::UUID">` elements. This is the
  source of truth for parent-child relationships between pages.

### Multi-Part Exports

Large Notion workspaces get split into multiple "Part" zip files. Caleb asked a friend who works at
Notion about how this works
([post](https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/posts/t1agveg0q7e2mfphhb9c7efhy4)):

- Each part has a **~50GB soft limit** and parts are created roughly every 3 hours during export.
- The export produces an **outer zip containing inner part zips** (e.g. `Export-<uuid>.zip`
  containing `Part-1.zip`, `Part-2.zip`, etc.).
- There is a **link integrity issue**: pages and subpages may get split across different parts. A
  parent page could end up in `Part-1.zip` while its children are in `Part-2.zip`, which means
  cross-part references won't resolve within a single part.

The `index.html` only exists in the final part zip.

TODO: add multi-part support to our in-memory Notion export framework and test it.

### Document Types

- **Pages** (`.md` files): Regular Notion pages exported as markdown. The filename encodes the title
  and Notion ID.
- **Full-page databases**: Get their own `.md` wrapper file containing the database title and a
  markdown link to the CSV data file. Example:

    ```markdown
    # To Do List

    [To Do List](To%20Do%20List%202e780a22fe3780d8889ddf2a4ed08451.csv)
    ```

    The `.md` wrapper becomes an Alpine document, and the CSV link is converted to an inline table.

- **Inline databases**: Databases embedded within a page. These are detected by checking if the CSV
  file is referenced in a document's body content (see
  [Inline vs Full-Page Databases](#inline-vs-full-page-databases)).
- **Attached files**: Images, videos, audio, and other files referenced in markdown content via
  `![name](path)` or `[name](path)` links.

### Document Markdown Structure

A Notion page export has this structure:

```markdown
# Document Title

[Child 1](./Child%201%20abc123.md)

[Child 2](./Child%202%20def456.md)

---

Actual document content starts here.

## Section Heading

More content...
```

The structure consists of:

1. **Title** - An `# H1` heading on the first line
2. **Children Header** (optional) - Links to child documents/databases, placed right after the title
3. **Divider** - A `---` separating the children header from body content
4. **Body Content** - The actual document content with `## H2` and lower headings

#### Children Header Section

When a document has child documents or databases, Notion generates a "children header" section
between the title and the body content. This section contains ONLY links to child items (one per
paragraph), followed by a `---` divider.

We detect this section by checking if:

1. There is a `---` divider after the title
2. The content before the divider contains ONLY markdown links (no other text)
3. ALL those links reference child documents (verified against the hierarchy from index.html)

When detected, we set `hasChildrenHeader: true` on the document and remove this entire section
during conversion. Alpine adds its own "Child documents" section at the bottom of each parent
document instead.

#### Empty Parent Documents

Some Notion pages have no real content - just a title and links to child pages. When we detect this
case (content consists only of child document links, no separator, no other text), we skip the
inline children. The document will still have Alpine's "## Child documents" section with properly
formatted mentions to all children.

#### Header Level Promotion

Since the document title becomes the page title (handled separately as an H1), we promote all
remaining headings by one level to maintain proper hierarchy:

- `## H2` → `# H1`
- `### H3` → `## H2`
- `#### H4` → `### H3`
- etc.

This ensures the first heading in the body content appears as an H1, not an H2, which would look
visually incorrect.

#### Database Page Property Lines

Database row pages (child pages of a Notion database) often have property lines at the start of
their content, like:

```markdown
# Click me to see even more detail

Due date: January 13, 2026 Status: Not started Assignee: Josh Johnson

Every item in your to do database table has a page...
```

Notion exports these property lines with single newlines between them, but markdown requires two
newlines (a blank line) to create separate paragraphs. Without this fix, the properties would be
merged into a single paragraph: "Due date: January 13, 2026 Status: Not started Assignee: Josh
Johnson".

During conversion, we detect consecutive "Property: Value" lines at the start of document content
and:

1. Add an extra newline between them to create separate paragraphs
2. Bold the property key (everything up to and including the colon)

For example, "Status: Not started" becomes "**Status:** Not started".

Property lines are identified by consecutive lines at the start of the content that match the
pattern: one or more words (letters only), then a colon and a value. We rely on Notion's export
having each property on its own line (separated by single newlines).

#### Skipped Home Files

Notion creates a `Home.md` file at the root of teamspaces (or the workspace root when there are no
teamspaces) that links to built-in views like "My tasks", "Home views", etc. These views don't map
to Alpine concepts (they're Notion-specific dashboard views).

If a `Home.md` file at the **teamspace root level** (no parent document) contains **only** links to
CSV files (no other content besides the title), we skip importing it entirely. This prevents
cluttering the imported space with an empty document that just lists views that weren't imported.

Note: We only filter Home files at the root level. If a user has a document named "Home" nested
under another document, it will be imported normally regardless of its content.

Example of a Home file that gets skipped:

```markdown
# Home

[Untitled](Untitled%20abc123.csv)

[My tasks](My%20tasks%20def456.csv)

[Home views](Home%20views%20ghi789.csv)
```

### index.html Structure

The `index.html` encodes the workspace tree. Teamspaces are not always present — some exports have
pages directly under the workspace root without any teamspace grouping.

> **See `test_fixtures/sample_index_without_teamspaces.html`** and
> **`test_fixtures/sample_index_with_teamspaces.html`** for real examples of both variants.

**Without teamspaces** (pages directly under workspace root):

```html
<ul id="id::workspace-uuid">
    <li>
        <ul id="id::page-uuid">
            <a href="./Page 2e780a22.md">Page 2e780a22.md</a>
            <li>
                <ul id="id::child-uuid">
                    <a href="./Child abc123.md">Child abc123.md</a>
                </ul>
            </li>
        </ul>
    </li>
    <li>
        <ul id="id::db-uuid.csv">
            <a href="./Database def456.csv">Database def456.csv</a>
        </ul>
    </li>
</ul>
```

**With teamspaces** (pages grouped under teamspace nodes):

```html
<ul id="id::workspace-uuid">
    <li>
        <ul id="id::teamspace-uuid-1">
            <a>Teamspace Name</a>
            <li>
                <ul id="id::page-uuid">
                    <a href="./Page 2e780a22.md">Page 2e780a22.md</a>
                </ul>
            </li>
        </ul>
    </li>
    <li>
        <ul id="id::teamspace-uuid-2">
            <a>Another Teamspace</a>
            <li>
                <ul id="id::page-uuid-2">
                    <a href="./Other abc123.md">Other abc123.md</a>
                </ul>
            </li>
        </ul>
    </li>
</ul>
```

The key difference is that teamspace `<a>` elements have **no `href` attribute** — they are just
labels. Regular page `<a>` elements always have an `href` pointing to the file. If ALL direct
children of the workspace root have `<a>` without `href`, the export has teamspaces. If any have
`href`, there are no teamspaces.

See `test_fixtures/JJ-Test-Flat.zip` and `test_fixtures/Workspace-Flat.zip` for real examples of
exports without and with teamspaces respectively (extract the inner zip and inspect `index.html`).

- The first `<ul>` is the workspace root (sentinel).
- Database entries have `.csv` appended to their UUID in the `id` attribute.
- Nesting of `<ul>` elements determines parent-child relationships.
- The workspace name is encoded as `<p>Workspace name: ...</p>` in the index.html header.

### Notion ID Formats

Notion uses UUIDs internally, but they appear in different formats throughout exports:

**Filename format (32-char hex, no dashes):**

```
My Page 2e780a22fe3780d8889ddf2a4ed08451.md
         └─────────────────────────────┘
                   32 characters
```

This is the format used in filenames. It's a UUID with the dashes removed.

**index.html format (UUID with dashes):**

```html
<ul id="id::2e780a22-fe37-80d8-889d-df2a4ed08451"></ul>
```

The `id` attribute in index.html uses the standard UUID format with dashes.

**Why this matters:** When parsing the hierarchy from index.html, we extract UUIDs with dashes and
need to look them up in our `notionIdToPath` map which uses the 32-char hex format (from filenames).
We normalize all IDs to the 32-char hex format (no dashes) for consistency:

```typescript
const notionId = uuid.replace(/-/g, ""); // Remove dashes to get 32-char hex
```

This normalization happens in:

- `unzip_notion_import_and_map_references.ts` when parsing index.html hierarchy
- `get_notion_import_teamspaces.ts` when extracting teamspace IDs

Both locations use the same pattern to ensure consistent ID format across the codebase.

### Teamspace Root Documents

When importing a Notion workspace with teamspaces, we create a **teamspace root document** for each
teamspace. This document serves as the entry point for the imported content and contains:

1. A note about the import (who started it, when)
2. Links to all first-layer documents in the teamspace (documents with no parent in Notion)

**Parent Links:** All first-layer documents (those that were at the root of the teamspace in Notion)
get a "Parent document" link pointing to the teamspace root document. This creates a consistent
hierarchy where every imported document has a parent.

**Root-Level CSV Databases:** Some databases in Notion exist at the teamspace root level and don't
have a `.md` wrapper file — only a `.csv` file. These are tracked separately in
`rootLevelCsvDatabases` and we create synthetic documents for them. The synthetic document contains:

- A parent link to the teamspace root document
- The database content as an inline table with cell linking (see below)

This ensures that root-level CSV-only databases appear in the teamspace root's "Child documents"
section alongside regular documents.

**Cell Linking:** When a database has child documents (sub-pages for database rows), cells in the
table that exactly match child document titles are automatically converted to links. For example, if
a "Meeting Notes" database has a row "Weekly - July 6, 2025" and a corresponding sub-page document
with that title, the cell in the table becomes a clickable link to that document.

**Important:** Database documents do NOT have a separate "Child documents" section at the bottom.
The children are database rows, and they appear as cell links in the table instead. This avoids
duplicate content (once in the table cells, once in a children section).

Cell linking applies to:

- Root-level CSV-only databases
- Inline databases embedded in document body content
- Full-page databases (where the CSV link in the `.md` wrapper is converted to a table)

### Inline vs Full-Page Databases

This is one of the most nuanced parts of the importer. Databases can appear in two ways:

**Full-Page Database:** The database has its own page that users navigate to. In the export, the
`.md` wrapper file becomes a document, and the CSV link inside it is converted to an inline table.

**Inline Database:** The database is embedded directly in another document's content. The parent
document references the `.csv` file directly in its body content (after the `---` divider).

**Detection Logic:** We determine if a database is inline by checking if its `.csv` file is
referenced in any document's **body content** (the content AFTER the `---` divider, NOT in the
children header section).

```markdown
# Project

[Database Link](./Database%20abc123.md) <- In children header (NOT inline)

---

Here is the task list: [Tasks](./Tasks%20def456.csv) <- In body content (IS inline)
```

- If a CSV is referenced in body content → **Inline database** → Remove from documents, embed as
  table
- If a CSV is NOT referenced in body content → **Full-page database** → Keep as document

**Important Nuance:** A user could technically reference a full-page database from within their body
content (e.g., "See our [Tasks](Tasks.csv) database for details"). We cannot distinguish this from a
true inline database. Our heuristic treats ANY CSV reference in body content as an inline database.
This may occasionally cause a full-page database that happens to be mentioned inline to be embedded
as a table rather than linked.

**Special Case - Child Database Referenced Inline:** If a database is BOTH:

1. A child of a document (appears in the hierarchy)
2. Referenced inline in that parent's body content

Then we treat it as inline and remove it from the children list. This prevents duplicate content
(once as a child link, once as an embedded table).

### Database CSV Formats (`.csv` vs `_all.csv`)

Notion exports each database as two CSV files:

- **`Database <notionId>.csv`** - Contains only the columns visible in the current database view,
  with rows in the view's sort order.
- **`Database <notionId>_all.csv`** - Contains ALL properties/columns from the database, including
  hidden columns and computed fields, potentially in a different row order.

For example, a "People" database might export as:

```
People.csv:      Name, Email, About, Membership Type     (4 columns - view columns)
People_all.csv:  Name, About, Email, Membership Type, Person  (5 columns - includes hidden "Person" column)
```

**Our approach:** We use the default view CSV (not `_all.csv`) when rendering the database as an
inline table. This matches what the user saw in Notion and avoids cluttering the table with hidden
or internal columns. However, when a user clicks into a database row's subpage, that page shows
**all** properties from `_all.csv` (rendered as property lines at the top of the document content).

This gives users the best of both worlds: a clean table view matching their Notion layout, with full
data accessible by drilling into individual rows.

### Database Children and Cell Linking

Database rows in Notion can have their own sub-pages. When such a database is converted to an inline
table, cells that exactly match child document titles are converted to links.

Example:

- Database "Team" has rows: Alice, Bob, Carol
- Alice and Bob have corresponding sub-page documents
- Carol does not

Result:

```markdown
| Name                       | Role     |
| -------------------------- | -------- |
| [Alice](link-to-alice-doc) | Engineer |
| [Bob](link-to-bob-doc)     | Designer |
| Carol                      | Manager  |
```

This linking applies to both inline databases and full-page databases (where the CSV link in the
`.md` wrapper is converted to a table).

#### Title-Based Matching Limitation

**Notion does not provide any explicit mapping between database cells and child pages.** The CSV
export contains only the raw cell text (e.g., "Alice"), and child pages are separate `.md` files
with their own notion IDs. There is no data in the export that directly associates a cell value with
its corresponding child page.

We work around this by **matching cell text to child document titles**. When a cell's text exactly
matches a child document's title, we convert that cell to a link. This is a heuristic, not a
guaranteed mapping.

**Implications:**

- **Duplicate titles**: If two child documents have the same title (e.g., two rows both named
  "Untitled"), we can only link to one of them. The other will remain as plain text.
- **Renamed pages**: If a user renamed a child page after creating it, the cell text (original name)
  won't match the current page title, so no link will be created.
- **False positives**: If a cell happens to contain text that matches a child document's title by
  coincidence, it will be incorrectly converted to a link.

This is a fundamental limitation of Notion's export format, not something we can fully solve without
Notion providing richer metadata in their exports.

### Deterministic Document IDs

When creating Alpine documents from Notion exports, we generate **deterministic document IDs** based
on the destination Alpine space ID, the Notion workspace ID, and the document's notion ID (the
32-character hex ID from the filename). This means importing the same Notion workspace into the same
space multiple times will produce the same document IDs.

**How it works:**

```typescript
const input = `notion:${spaceId}:${workspaceId}:${notionId}`;
// Hash the input and take first 16 bytes as the document ID
```

The space ID ensures that document IDs are unique per destination space. Without this, two different
spaces importing the same Notion workspace would create documents with identical IDs, which would
cause conflicts in any shared storage layer.

The workspace ID is extracted from `index.html` (from the `id::` attribute of the root `<ul>`
element). Combined with the space ID and document's notion ID, this creates a globally unique but
reproducible seed for ID generation.

**Why deterministic IDs matter:**

- **Idempotent imports**: Re-importing a Notion workspace into the same space produces the same
  documents with the same IDs, avoiding duplicate content.
- **Cross-reference stability**: Links between documents resolve correctly even if the import is run
  multiple times.
- **Cross-space isolation**: Different spaces get unique document IDs even when importing the same
  Notion workspace, preventing any cross-space conflicts.
- **Debugging**: Easier to trace issues when the same Notion page always maps to the same Alpine
  document within a given space.

**Special cases:**

- **Teamspace root documents**: Use the seed `teamspace-root:${teamspaceId}` since they don't have a
  notion ID (they're synthetic documents we create).
- **Root-level CSV databases**: Use the seed `csv-database:${notionId}` to distinguish them from
  their `.md` wrapper files (which may not exist for CSV-only databases).

## Import Pipeline

### 1. Start Import (`start_notion_import.ts`)

The user uploads a Notion export zip to the file storage and calls `startNotionImport` with the
space ID and file ID. This:

- Authorizes Admin access to the space
- Creates an import record in DynamoDB with status `Waiting`
- Enqueues a `NotionImport` job for async processing

### 2. Process Import Job (`process_notion_import_job.ts`)

The job worker picks up the import job and:

- Fetches the uploaded zip from R2 storage
- Calls `unzipNotionImportAndMapReferences` to parse the export
- Creates Alpine documents from the parsed result (TODO: in progress)
- Updates the import status to `Success` or `Failed`

### 3. Parse and Map References (`unzip_notion_import_and_map_references.ts`)

This is the core parsing logic. It takes the raw zip bytes and returns a
`NotionImportMappedReferencesResult`:

```typescript
type NotionImportMappedReferencesResult = {
    teamspaces: Array<{
        id: string;
        name: string;
        importOption: {type: "Public"} | {type: "Private"};
        documents: {
            [filePath: string]: {
                id: DocumentId;
                references: Map<string, DocumentId>;
                files: Set<FileId>;
                parent: DocumentId | null;
                parentPath: string | null;
                children: Set<DocumentId>;
                hasChildrenHeader: boolean; // True if Notion-generated children section exists
            };
        };
    }>;
    filesToUpload: {
        [filePath: string]: {
            id: FileId;
        };
    };
    unzippedFiles: Record<string, Uint8Array>; // Raw file contents
    inlineDatabaseChildren: Map<string, Map<string, DocumentId>>; // For cell linking
    rootLevelCsvDatabases: Map<
        string, // CSV file path
        {
            childPaths: Array<string>; // Paths of child documents (database rows)
            teamspaceId: string; // Which teamspace this database belongs to
        }
    >; // CSV-only databases at teamspace root level
};
```

The parser accepts a `teamspaces` parameter mapping teamspace IDs to import choices (`"Public"`,
`"Private"`, or `"DoNotImport"`). Documents under `"DoNotImport"` teamspaces are excluded from the
result entirely.

The parser works in four phases:

**Phase 1 - Unzip and collect files:**

- Uses `findNotionImportRoot` to recursively unzip until it finds the level containing `index.html`
- Strips the root directory prefix from all paths
- Skips `index.html` and `_all.csv` files (see
  [Database CSV Formats](#database-csv-formats-csv-vs-_allcsv) for why we use the default view CSV)
- Builds a `notionIdToPath` map from the 32-char hex IDs in filenames
- For databases, both `.md` and `.csv` files share the same notion ID; the `.md` file takes
  precedence in the map

**Phase 2 - Parse hierarchy from index.html:**

- Uses htmlparser2 to parse the HTML DOM
- Walks nested `<ul id="id::...">` elements to extract parent-child relationships
- Strips `.csv` suffix and dashes from UUIDs to get notion IDs
- Looks up notion IDs in `notionIdToPath` to find the corresponding `.md` file path
- Records parent-child relationships between documents
- Detects teamspaces (direct children of workspace root where `<a>` has no `href`) and tracks which
  teamspace each document belongs to
- If no teamspaces are detected, uses `getNotionImportMetadata` to treat the whole workspace as a
  single implicit teamspace (using the workspace ID and name)

**Phase 3 - Classify files and resolve references:**

- Files matching `<title> <notionId>.md` pattern become documents with generated `DocumentId`s
- CSV files are NOT added as documents (they are data files for databases)
- All other files become attached files with generated `FileId`s
- For each markdown document, parses all `[text](url)` and `![text](url)` links
- Decoded link paths that match known document paths become `references`
- Decoded link paths that match known file paths become `files`
- External URLs (http/https) are ignored
- Detects `hasChildrenHeader` by checking if content before `---` contains only child links
- Tracks CSV references in body content (after `---`) to identify inline databases

**Phase 4 - Remove inline databases:**

- For each CSV referenced in body content, find the corresponding `.md` wrapper file
- Save children info before removal (for cell linking in inline tables)
- Remove the `.md` wrapper from documents and from parent's children list
- Update child documents to have no parent (since their database parent is being inlined)
- Store `inlineDatabaseChildren` map for use during conversion

## Testing

### Test Framework (`test_helpers/create_test_notion_import_zip.ts`)

We use a custom test framework to generate Notion export zips on the fly rather than relying solely
on static fixture files. This approach has several advantages:

- **Precise control**: Tests can construct exact scenarios (circular references, deep nesting,
  specific file types) without needing to manually export from Notion.
- **Readable tests**: The test helper API makes the intended structure immediately clear, rather
  than having to inspect opaque zip files.
- **Deterministic IDs**: Each `ExportedNotionItem` gets a unique notion ID, making assertions
  straightforward.
- **No Notion dependency**: Tests don't break when Notion changes their export format. The framework
  generates exports matching the format we support.

The framework provides three classes:

#### `ExportedNotionDocument`

Represents a Notion page. Has a title, content (markdown body), optional children (sub-pages and
databases), and optional attached files.

```typescript
const page = new ExportedNotionDocument("My Page", "Some content");
const child = new ExportedNotionDocument("Child", "");
page.addChildren([child]);
```

#### `ExportedNotionDatabase`

Represents a Notion database. Takes a title and a 2D array of strings (header row + data rows).
Generates both a `.md` wrapper file (with title and CSV link) and the CSV data files.

```typescript
const db = new ExportedNotionDatabase("Tasks", [
    ["Name", "Status"],
    ["Task 1", "Done"],
]);
```

**Database References:**

- `db.toReference()` → Links to the `.md` wrapper file (standard Notion export behavior, used for
  child databases in the children header)
- `db.toCsvReference()` → Links directly to the `.csv` file (for testing inline database embedding)

```typescript
// Database as a child (appears in children header, linked to .md wrapper)
const parent = new ExportedNotionDocument("Project", "content", [db]);

// Database inline in body content (CSV link, gets embedded as table)
const doc = new ExportedNotionDocument("Project", `Here are the tasks:\n\n${db.toCsvReference()}`);
```

#### `ExportedNotionFile`

Represents an attached file (image, video, or audio). Reads real binary data from test fixtures to
produce realistic exports. Use `file.toReference()` in document content to create a placeholder that
resolves to the correct markdown link.

```typescript
const img = new ExportedNotionFile("photo.png", "image");
const doc = new ExportedNotionDocument("Page", `Here's an image: ${img.toReference()}`);
doc.addFiles([img]);
```

#### `createTestNotionImportZip`

Assembles the items into a properly structured zip (double-nested, with index.html). Supports
options for flat vs nested mode and custom workspace names.

```typescript
const zip = createTestNotionImportZip([page, db], {
    createFoldersForSubpages: true,
    workspaceName: "My Workspace",
});
const result = unzipNotionImportAndMapReferences(zip);
```

#### Cross-references

Documents and databases expose a `toReference()` method that returns a placeholder string. When the
zip is generated, these placeholders are globally resolved to the correct markdown links. This
allows testing circular references (A links to B, B links to A) naturally:

```typescript
const a = new ExportedNotionDocument("A", "");
const b = new ExportedNotionDocument("B", "");
a.content = `Link to ${b.toReference()}`;
b.content = `Link to ${a.toReference()}`;
```

#### Testing Inline vs Full-Page Databases

```typescript
// Full-page database: added as a child, referenced via toReference() in children
// header
const fullPageDb = new ExportedNotionDatabase("Tasks", [["Task"], ["Do stuff"]]);
const docWithChild = new ExportedNotionDocument("Project", "content", [fullPageDb]);
// Result: fullPageDb.md exists as a document, Project has it in children

// Inline database: referenced via toCsvReference() in body content
const inlineDb = new ExportedNotionDatabase("Tasks", [["Task"], ["Do stuff"]]);
const docWithInline = new ExportedNotionDocument(
    "Project",
    `Here are tasks:\n\n${inlineDb.toCsvReference()}`,
);
// Result: inlineDb.md is removed, CSV content embedded as table in Project

// Child database that is ALSO referenced inline: treated as inline
const mixedDb = new ExportedNotionDatabase("Tasks", [["Task"], ["Do stuff"]]);
const docWithBoth = new ExportedNotionDocument(
    "Project",
    `Inline table:\n\n${mixedDb.toCsvReference()}`,
    [mixedDb], // Also a child
);
// Result: mixedDb.md is removed, not in children, CSV embedded as table
```

### Real Export Fixtures (`test_fixtures/`)

In addition to generated zips, we test against real Notion exports:

- **`JJ-Test-Flat.zip`**: A workspace exported with flat file layout (no teamspaces).
- **`JJ-Test-Nested.zip`**: The same workspace exported with nested subdirectories (no teamspaces).
- **`Workspace-Flat.zip`**: A workspace with teamspaces, exported flat.
- **`Workspace-Nested.zip`**: The same workspace with teamspaces, exported nested.

The JJ-Test fixtures verify the parser handles real-world Notion output correctly, including UTF-8
characters (curly quotes, apostrophes), deeply nested pages, multiple database types, and various
attached media files.

The Workspace fixtures verify teamspace detection and filtering. They contain two teamspaces
(`"Private&Shared"` and `"Caleb Meredith’s Space HQ ..."`), which are used to test the `Private` and
`DoNotImport` teamspace choices.

All fixture tests assert exact document paths, file paths, parent-child relationships, and
cross-references.

### Running Tests

```bash
# Run just the parser tests
bazel test //server/importer/notion:internal/unzip_notion_import_and_map_references_test

# Run all tests in the notion importer
bazel test //server/importer/notion/...

# Run type checking and linting
bazel test //server/importer/notion:notion_typecheck_test //server/importer/notion:notion_lint_test
```
