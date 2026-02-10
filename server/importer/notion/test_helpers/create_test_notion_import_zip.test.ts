/* eslint-disable cyberworlds/string-quotes -- Tests assert CSV and HTML output which require straight quotes */
import {strFromU8, unzipSync} from "fflate";

import {
    ExportedNotionDatabase,
    ExportedNotionDocument,
    ExportedNotionFile,
    ExportedNotionTeamspace,
    createTestNotionImportZip,
} from "~/server/importer/notion/test_helpers/create_test_notion_import_zip.js";

/**
 * Unzips the outer and inner zips, returning file paths relative to
 * the export root directory (stripping the `Export-<uuid>/` prefix).
 */
function extractFiles(zip: Uint8Array): Record<string, Uint8Array> {
    const outerFiles = unzipSync(zip);
    const outerEntries = Object.keys(outerFiles);
    expect(outerEntries).toHaveLength(1);

    const innerZipName = outerEntries[0]!;
    expect(innerZipName).toMatch(/^Export-.+-Part-1\.zip$/);

    const innerFiles = unzipSync(outerFiles[innerZipName]!);
    const result: Record<string, Uint8Array> = {};

    for (const [path, content] of Object.entries(innerFiles)) {
        const relativePath = path.slice(path.indexOf("/") + 1);
        result[relativePath] = content;
    }

    return result;
}

function fileNames(files: Record<string, Uint8Array>): Array<string> {
    return Object.keys(files).sort();
}

function formatAsUuid(notionId: string): string {
    return [
        notionId.slice(0, 8),
        notionId.slice(8, 12),
        notionId.slice(12, 16),
        notionId.slice(16, 20),
        notionId.slice(20, 32),
    ].join("-");
}

function extractWorkspaceId(html: string): string {
    const match = html.match(/Workspace identifier: ([0-9a-f-]{36})/);
    expect(match).not.toBeNull();
    return match![1]!;
}

describe("zip structure", () => {
    test("produces nested zip matching Notion export format", () => {
        const doc = new ExportedNotionDocument("Page", "content");
        const zip = createTestNotionImportZip([doc]);

        const outerFiles = unzipSync(zip);
        const outerEntries = Object.keys(outerFiles);

        // Outer zip contains exactly one inner zip
        expect(outerEntries).toHaveLength(1);
        expect(outerEntries[0]).toMatch(/^Export-[0-9a-f-]+-Part-1\.zip$/);

        // Inner zip contains the actual files
        const innerFiles = unzipSync(outerFiles[outerEntries[0]!]!);
        const innerPaths = Object.keys(innerFiles);

        // All files are under a root directory
        const rootDir = innerPaths[0]!.split("/")[0]!;
        for (const path of innerPaths) {
            expect(path.startsWith(rootDir + "/")).toBe(true);
        }
    });

    test("includes index.html in output", () => {
        const doc = new ExportedNotionDocument("Page", "");
        const files = extractFiles(createTestNotionImportZip([doc]));

        expect(files["index.html"]).toBeDefined();
    });
});

describe("documents", () => {
    test("generates markdown with title heading", () => {
        const doc = new ExportedNotionDocument("My Document", "");
        const files = extractFiles(createTestNotionImportZip([doc]));

        expect(strFromU8(files[`My Document ${doc.notionId}.md`]!)).toBe("# My Document\n");
    });

    test("generates markdown with content body", () => {
        const doc = new ExportedNotionDocument("Page", "Some paragraph text\n\n- bullet");
        const files = extractFiles(createTestNotionImportZip([doc]));

        expect(strFromU8(files[`Page ${doc.notionId}.md`]!)).toBe(
            ["# Page", "", "Some paragraph text", "", "- bullet", ""].join("\n"),
        );
    });

    test("document filename includes notion ID", () => {
        const doc = new ExportedNotionDocument("Test", "");
        const files = extractFiles(createTestNotionImportZip([doc]));

        expect(doc.notionId).toMatch(/^[0-9a-f]{32}$/);
        expect(files[`Test ${doc.notionId}.md`]).toBeDefined();
    });
});

describe("child links in markdown", () => {
    test("document with child page lists link before content with divider (flat)", () => {
        const child = new ExportedNotionDocument("Child Page", "child body");
        const parent = new ExportedNotionDocument("Parent", "parent body", [child]);
        const files = extractFiles(createTestNotionImportZip([parent]));

        expect(strFromU8(files[`Parent ${parent.notionId}.md`]!)).toBe(
            [
                "# Parent",
                "",
                `[Child Page](Child%20Page%20${child.notionId}.md)`,
                "",
                "---",
                "",
                "parent body",
                "",
            ].join("\n"),
        );
    });

    test("document with child page uses nested path in link (nested)", () => {
        const child = new ExportedNotionDocument("Child Page", "child body");
        const parent = new ExportedNotionDocument("Parent", "parent body", [child]);
        const files = extractFiles(
            createTestNotionImportZip([parent], {createFoldersForSubpages: true}),
        );

        expect(strFromU8(files[`Parent ${parent.notionId}.md`]!)).toBe(
            [
                "# Parent",
                "",
                `[Child Page](Parent/Child%20Page%20${child.notionId}.md)`,
                "",
                "---",
                "",
                "parent body",
                "",
            ].join("\n"),
        );
    });

    test("document with child database lists link (flat)", () => {
        const database = new ExportedNotionDatabase("Tasks", [["Name"], ["Task 1"]]);
        const parent = new ExportedNotionDocument("Parent", "body", [database]);
        const files = extractFiles(createTestNotionImportZip([parent]));

        expect(strFromU8(files[`Parent ${parent.notionId}.md`]!)).toBe(
            [
                "# Parent",
                "",
                `[Tasks](Tasks%20${database.notionId}.md)`,
                "",
                "---",
                "",
                "body",
                "",
            ].join("\n"),
        );
    });

    test("multiple children are listed with blank lines between", () => {
        const child1 = new ExportedNotionDocument("Alpha", "");
        const child2 = new ExportedNotionDocument("Beta", "");
        const parent = new ExportedNotionDocument("Parent", "content", [child1, child2]);
        const files = extractFiles(createTestNotionImportZip([parent]));

        expect(strFromU8(files[`Parent ${parent.notionId}.md`]!)).toBe(
            [
                "# Parent",
                "",
                `[Alpha](Alpha%20${child1.notionId}.md)`,
                "",
                `[Beta](Beta%20${child2.notionId}.md)`,
                "",
                "---",
                "",
                "content",
                "",
            ].join("\n"),
        );
    });

    test("no divider when document has children but no content", () => {
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "", [child]);
        const files = extractFiles(createTestNotionImportZip([parent]));

        expect(strFromU8(files[`Parent ${parent.notionId}.md`]!)).toBe(
            ["# Parent", "", `[Child](Child%20${child.notionId}.md)`, ""].join("\n"),
        );
    });
});

describe("toReference() resolution", () => {
    test("child document reference resolves to markdown link (flat)", () => {
        const child = new ExportedNotionDocument("Sub Page", "");
        const parent = new ExportedNotionDocument(
            "Parent",
            `See ${child.toReference()} for details`,
            [child],
        );
        const files = extractFiles(createTestNotionImportZip([parent]));

        expect(strFromU8(files[`Parent ${parent.notionId}.md`]!)).toBe(
            [
                "# Parent",
                "",
                `[Sub Page](Sub%20Page%20${child.notionId}.md)`,
                "",
                "---",
                "",
                `See [Sub Page](Sub%20Page%20${child.notionId}.md) for details`,
                "",
            ].join("\n"),
        );
    });

    test("child document reference resolves with nested path", () => {
        const child = new ExportedNotionDocument("Sub Page", "");
        const parent = new ExportedNotionDocument("Parent", `See ${child.toReference()}`, [child]);
        const files = extractFiles(
            createTestNotionImportZip([parent], {createFoldersForSubpages: true}),
        );

        expect(strFromU8(files[`Parent ${parent.notionId}.md`]!)).toBe(
            [
                "# Parent",
                "",
                `[Sub Page](Parent/Sub%20Page%20${child.notionId}.md)`,
                "",
                "---",
                "",
                `See [Sub Page](Parent/Sub%20Page%20${child.notionId}.md)`,
                "",
            ].join("\n"),
        );
    });

    test("database reference resolves to md link", () => {
        const database = new ExportedNotionDatabase("Tasks", [["Name"], ["T1"]]);
        const parent = new ExportedNotionDocument("Page", `Data: ${database.toReference()}`, [
            database,
        ]);
        const files = extractFiles(createTestNotionImportZip([parent]));

        expect(strFromU8(files[`Page ${parent.notionId}.md`]!)).toBe(
            [
                "# Page",
                "",
                `[Tasks](Tasks%20${database.notionId}.md)`,
                "",
                "---",
                "",
                `Data: [Tasks](Tasks%20${database.notionId}.md)`,
                "",
            ].join("\n"),
        );
    });

    test("file reference resolves to image embed (flat)", () => {
        const image = new ExportedNotionFile("photo.png", "image");
        const page = new ExportedNotionDocument("Gallery", `Here: ${image.toReference()}`);
        page.addFiles([image]);
        const files = extractFiles(createTestNotionImportZip([page]));

        expect(strFromU8(files[`Gallery ${page.notionId}.md`]!)).toBe(
            ["# Gallery", "", "Here: ![photo.png](photo.png)", ""].join("\n"),
        );
    });

    test("file reference resolves with nested path", () => {
        const image = new ExportedNotionFile("photo.png", "image");
        const page = new ExportedNotionDocument("Gallery", `Here: ${image.toReference()}`);
        page.addFiles([image]);
        const files = extractFiles(
            createTestNotionImportZip([page], {createFoldersForSubpages: true}),
        );

        expect(strFromU8(files[`Gallery ${page.notionId}.md`]!)).toBe(
            ["# Gallery", "", "Here: ![photo.png](Gallery/photo.png)", ""].join("\n"),
        );
    });

    test("file reference with spaces in name is encoded", () => {
        const image = new ExportedNotionFile("my photo.png", "image");
        const page = new ExportedNotionDocument("Page", image.toReference());
        page.addFiles([image]);
        const files = extractFiles(createTestNotionImportZip([page]));

        expect(strFromU8(files[`Page ${page.notionId}.md`]!)).toBe(
            ["# Page", "", "![my photo.png](my%20photo.png)", ""].join("\n"),
        );
    });

    test("deeply nested file reference encodes each path segment", () => {
        const image = new ExportedNotionFile("deep.png", "image");
        const grandchild = new ExportedNotionDocument("Leaf Node", image.toReference());
        grandchild.addFiles([image]);
        const child = new ExportedNotionDocument("Mid Level", "", [grandchild]);
        const root = new ExportedNotionDocument("Root Page", "", [child]);
        const files = extractFiles(
            createTestNotionImportZip([root], {createFoldersForSubpages: true}),
        );

        expect(strFromU8(files[`Root Page/Mid Level/Leaf Node ${grandchild.notionId}.md`]!)).toBe(
            [
                "# Leaf Node",
                "",
                "![deep.png](Root%20Page/Mid%20Level/Leaf%20Node/deep.png)",
                "",
            ].join("\n"),
        );
    });

    test("multiple references in same content are all resolved", () => {
        const img1 = new ExportedNotionFile("a.png", "image");
        const img2 = new ExportedNotionFile("b.png", "image");
        const child = new ExportedNotionDocument("Sub", "");
        const page = new ExportedNotionDocument(
            "Page",
            `${img1.toReference()} and ${img2.toReference()} with ${child.toReference()}`,
            [child],
        );
        page.addFiles([img1, img2]);
        const files = extractFiles(createTestNotionImportZip([page]));

        expect(strFromU8(files[`Page ${page.notionId}.md`]!)).toBe(
            [
                "# Page",
                "",
                `[Sub](Sub%20${child.notionId}.md)`,
                "",
                "---",
                "",
                `![a.png](a.png) and ![b.png](b.png) with [Sub](Sub%20${child.notionId}.md)`,
                "",
            ].join("\n"),
        );
    });
});

describe("parent/child relationships (flat)", () => {
    test("child documents are at root level alongside parent", () => {
        const child = new ExportedNotionDocument("Child Page", "child");
        const parent = new ExportedNotionDocument("Parent Page", "parent", [child]);
        const files = extractFiles(createTestNotionImportZip([parent]));

        expect(files[`Parent Page ${parent.notionId}.md`]).toBeDefined();
        expect(files[`Child Page ${child.notionId}.md`]).toBeDefined();
    });

    test("deeply nested children are all at root level", () => {
        const grandchild = new ExportedNotionDocument("Grandchild", "gc");
        const child = new ExportedNotionDocument("Child", "c", [grandchild]);
        const parent = new ExportedNotionDocument("Parent", "p", [child]);
        const files = extractFiles(createTestNotionImportZip([parent]));

        expect(files[`Parent ${parent.notionId}.md`]).toBeDefined();
        expect(files[`Child ${child.notionId}.md`]).toBeDefined();
        expect(files[`Grandchild ${grandchild.notionId}.md`]).toBeDefined();
    });

    test("multiple top-level documents", () => {
        const doc1 = new ExportedNotionDocument("First", "");
        const doc2 = new ExportedNotionDocument("Second", "");
        const files = extractFiles(createTestNotionImportZip([doc1, doc2]));

        expect(files[`First ${doc1.notionId}.md`]).toBeDefined();
        expect(files[`Second ${doc2.notionId}.md`]).toBeDefined();
    });
});

describe("parent/child relationships (nested)", () => {
    test("child documents are in parent subdirectory", () => {
        const child = new ExportedNotionDocument("Child Page", "child");
        const parent = new ExportedNotionDocument("Parent Page", "parent", [child]);
        const files = extractFiles(
            createTestNotionImportZip([parent], {createFoldersForSubpages: true}),
        );

        expect(files[`Parent Page ${parent.notionId}.md`]).toBeDefined();
        expect(files[`Parent Page/Child Page ${child.notionId}.md`]).toBeDefined();
    });

    test("deeply nested children use nested subdirectories", () => {
        const grandchild = new ExportedNotionDocument("Grandchild", "gc");
        const child = new ExportedNotionDocument("Child", "c", [grandchild]);
        const parent = new ExportedNotionDocument("Parent", "p", [child]);
        const files = extractFiles(
            createTestNotionImportZip([parent], {createFoldersForSubpages: true}),
        );

        expect(files[`Parent ${parent.notionId}.md`]).toBeDefined();
        expect(files[`Parent/Child ${child.notionId}.md`]).toBeDefined();
        expect(files[`Parent/Child/Grandchild ${grandchild.notionId}.md`]).toBeDefined();
    });

    test("sibling children share the same parent directory", () => {
        const child1 = new ExportedNotionDocument("Alpha", "a");
        const child2 = new ExportedNotionDocument("Beta", "b");
        const parent = new ExportedNotionDocument("Container", "", [child1, child2]);
        const files = extractFiles(
            createTestNotionImportZip([parent], {createFoldersForSubpages: true}),
        );

        expect(files[`Container/Alpha ${child1.notionId}.md`]).toBeDefined();
        expect(files[`Container/Beta ${child2.notionId}.md`]).toBeDefined();
    });
});

describe("databases", () => {
    test("inline database generates csv in flat mode", () => {
        const database = new ExportedNotionDatabase("Tasks", [
            ["Name", "Status"],
            ["Task 1", "Done"],
        ]);
        const page = new ExportedNotionDocument("My Page", "", [database]);
        const files = extractFiles(createTestNotionImportZip([page]));

        expect(files[`Tasks ${database.notionId}.csv`]).toBeDefined();
    });

    test("inline database generates csv in nested mode", () => {
        const database = new ExportedNotionDatabase("Tasks", [
            ["Name", "Status"],
            ["Task 1", "Done"],
        ]);
        const page = new ExportedNotionDocument("My Page", "", [database]);
        const files = extractFiles(
            createTestNotionImportZip([page], {createFoldersForSubpages: true}),
        );

        expect(files[`My Page/Tasks ${database.notionId}.csv`]).toBeDefined();
    });

    test("full-page database generates csv at root", () => {
        const database = new ExportedNotionDatabase("People", [
            ["Name", "Email"],
            ["Alice", "alice@example.com"],
        ]);
        const files = extractFiles(createTestNotionImportZip([database]));

        expect(files[`People ${database.notionId}.csv`]).toBeDefined();
    });

    test("database generates both .csv and _all.csv", () => {
        const database = new ExportedNotionDatabase("Tracker", [["Col1"], ["Val1"]]);
        const files = extractFiles(createTestNotionImportZip([database]));

        expect(files[`Tracker ${database.notionId}.csv`]).toBeDefined();
        expect(files[`Tracker ${database.notionId}_all.csv`]).toBeDefined();
    });

    test("csv and _all.csv have identical content", () => {
        const database = new ExportedNotionDatabase("Data", [
            ["Name", "Value"],
            ["Row1", "100"],
        ]);
        const files = extractFiles(createTestNotionImportZip([database]));

        expect(strFromU8(files[`Data ${database.notionId}.csv`]!)).toBe(
            strFromU8(files[`Data ${database.notionId}_all.csv`]!),
        );
    });

    test("csv content starts with UTF-8 BOM bytes", () => {
        const database = new ExportedNotionDatabase("DB", [["Header"], ["Value"]]);
        const files = extractFiles(createTestNotionImportZip([database]));

        const raw = files[`DB ${database.notionId}.csv`]!;
        expect(raw[0]).toBe(0xef);
        expect(raw[1]).toBe(0xbb);
        expect(raw[2]).toBe(0xbf);
    });

    test("csv content has proper header and data rows", () => {
        const database = new ExportedNotionDatabase("Projects", [
            ["Name", "Priority", "Status"],
            ["Alpha", "High", "Active"],
            ["Beta", "Low", "Done"],
        ]);
        const files = extractFiles(createTestNotionImportZip([database]));

        expect(strFromU8(files[`Projects ${database.notionId}.csv`]!)).toBe(
            "Name,Priority,Status\nAlpha,High,Active\nBeta,Low,Done\n",
        );
    });

    test("csv escapes fields containing commas", () => {
        const database = new ExportedNotionDatabase("DB", [
            ["Name", "Description"],
            ["Item", "First, second, third"],
        ]);
        const files = extractFiles(createTestNotionImportZip([database]));

        expect(strFromU8(files[`DB ${database.notionId}.csv`]!)).toBe(
            'Name,Description\nItem,"First, second, third"\n',
        );
    });

    test("csv escapes fields containing quotes", () => {
        const database = new ExportedNotionDatabase("DB", [["Name"], ['She said "hello"']]);
        const files = extractFiles(createTestNotionImportZip([database]));

        expect(strFromU8(files[`DB ${database.notionId}.csv`]!)).toBe(
            'Name\n"She said ""hello"""\n',
        );
    });

    test("deeply nested database", () => {
        const database = new ExportedNotionDatabase("Child DB", [["A"], ["B"]]);
        const child = new ExportedNotionDocument("SubPage", "", [database]);
        const parent = new ExportedNotionDocument("TopPage", "", [child]);
        const files = extractFiles(
            createTestNotionImportZip([parent], {createFoldersForSubpages: true}),
        );

        expect(files[`TopPage/SubPage/Child DB ${database.notionId}.csv`]).toBeDefined();
        expect(files[`TopPage/SubPage/Child DB ${database.notionId}_all.csv`]).toBeDefined();
    });
});

describe("file attachments", () => {
    test("image file is placed at root in flat mode", () => {
        const image = new ExportedNotionFile("photo.png", "image");
        const page = new ExportedNotionDocument("Gallery", image.toReference());
        page.addFiles([image]);
        const files = extractFiles(createTestNotionImportZip([page]));

        expect(files["photo.png"]).toBeDefined();
        expect(files["photo.png"]!.length).toBeGreaterThan(0);
    });

    test("image file is placed in document subdirectory in nested mode", () => {
        const image = new ExportedNotionFile("vacation.jpg", "image");
        const page = new ExportedNotionDocument("Trip Notes", image.toReference());
        page.addFiles([image]);
        const files = extractFiles(
            createTestNotionImportZip([page], {createFoldersForSubpages: true}),
        );

        expect(files["Trip Notes/vacation.jpg"]).toBeDefined();
        expect(files["Trip Notes/vacation.jpg"]!.length).toBeGreaterThan(0);
    });

    test("video file is included", () => {
        const video = new ExportedNotionFile("clip.mp4", "video");
        const page = new ExportedNotionDocument("Videos", video.toReference());
        page.addFiles([video]);
        const files = extractFiles(createTestNotionImportZip([page]));

        expect(files["clip.mp4"]).toBeDefined();
        expect(files["clip.mp4"]!.length).toBeGreaterThan(0);
    });

    test("audio file is included", () => {
        const audio = new ExportedNotionFile("song.mp3", "audio");
        const page = new ExportedNotionDocument("Music", audio.toReference());
        page.addFiles([audio]);
        const files = extractFiles(createTestNotionImportZip([page]));

        expect(files["song.mp3"]).toBeDefined();
        expect(files["song.mp3"]!.length).toBeGreaterThan(0);
    });

    test("multiple files attached to same document", () => {
        const img = new ExportedNotionFile("image.png", "image");
        const vid = new ExportedNotionFile("clip.mp4", "video");
        const page = new ExportedNotionDocument("Gallery", "");
        page.addFiles([img, vid]);
        const files = extractFiles(createTestNotionImportZip([page]));

        expect(files["image.png"]).toBeDefined();
        expect(files["clip.mp4"]).toBeDefined();
    });

    test("files in deeply nested documents (nested mode)", () => {
        const image = new ExportedNotionFile("deep.png", "image");
        const grandchild = new ExportedNotionDocument("Leaf", image.toReference());
        grandchild.addFiles([image]);
        const child = new ExportedNotionDocument("Branch", "", [grandchild]);
        const root = new ExportedNotionDocument("Root", "", [child]);
        const files = extractFiles(
            createTestNotionImportZip([root], {createFoldersForSubpages: true}),
        );

        expect(files["Root/Branch/Leaf/deep.png"]).toBeDefined();
    });

    test("all file types use real fixture data", () => {
        const image = new ExportedNotionFile("img.png", "image");
        const video = new ExportedNotionFile("vid.mp4", "video");
        const audio = new ExportedNotionFile("aud.mp3", "audio");
        const page = new ExportedNotionDocument("Media", "");
        page.addFiles([image, video, audio]);
        const files = extractFiles(createTestNotionImportZip([page]));

        // PNG starts with magic bytes 0x89 0x50
        expect(files["img.png"]![0]).toBe(0x89);
        expect(files["img.png"]![1]).toBe(0x50);
        // MP3 MPEG frame sync starts with 0xFF 0xF3
        expect(files["aud.mp3"]![0]).toBe(0xff);
        expect(files["aud.mp3"]![1]).toBe(0xf3);
    });

    test("files are not listed as child links in markdown", () => {
        const image = new ExportedNotionFile("photo.png", "image");
        const page = new ExportedNotionDocument("Gallery", "body");
        page.addFiles([image]);
        const files = extractFiles(createTestNotionImportZip([page]));

        expect(strFromU8(files[`Gallery ${page.notionId}.md`]!)).toBe(
            ["# Gallery", "", "body", ""].join("\n"),
        );
    });

    test("files at root in flat mode even when document has children", () => {
        const image = new ExportedNotionFile("banner.png", "image");
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "", [child]);
        parent.addFiles([image]);
        const files = extractFiles(createTestNotionImportZip([parent]));

        expect(files["banner.png"]).toBeDefined();
    });

    test("files in document subdirectory alongside children (nested)", () => {
        const image = new ExportedNotionFile("banner.png", "image");
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "", [child]);
        parent.addFiles([image]);
        const files = extractFiles(
            createTestNotionImportZip([parent], {createFoldersForSubpages: true}),
        );

        expect(files["Parent/banner.png"]).toBeDefined();
        expect(files[`Parent/Child ${child.notionId}.md`]).toBeDefined();
    });
});

describe("index.html", () => {
    test("single document at root (flat)", () => {
        const doc = new ExportedNotionDocument("Page", "");
        const files = extractFiles(createTestNotionImportZip([doc]));

        const html = strFromU8(files["index.html"]!);
        const wsId = extractWorkspaceId(html);
        expect(html).toBe(
            [
                `<!DOCTYPE html><html><head>`,
                `\t\t\t\t\t\t<title>Export</title>`,
                `\t\t\t\t\t</head>`,
                `\t\t\t\t<body>`,
                `\t\t\t\t\t<ul id="id::${wsId}">`,
                `\t\t\t\t`,
                `\t\t\t\t<li><h3>Workspace details:</h3>` +
                    `<p>Workspace identifier: ${wsId}</p>` +
                    `<p>Workspace name: Test Workspace</p></li>` +
                    `<li><ul id="id::${formatAsUuid(doc.notionId)}">` +
                    `<a href="./Page ${doc.notionId}.md">Page ${doc.notionId}.md</a>` +
                    `</ul></li>` +
                    `</ul>`,
                `\t\t\t\t\t</body>`,
                `</html>`,
            ].join("\n"),
        );
    });

    test("custom workspace name", () => {
        const doc = new ExportedNotionDocument("Page", "");
        const files = extractFiles(
            createTestNotionImportZip([doc], {workspaceName: "My Workspace"}),
        );

        const html = strFromU8(files["index.html"]!);
        const wsId = extractWorkspaceId(html);
        expect(html).toBe(
            [
                `<!DOCTYPE html><html><head>`,
                `\t\t\t\t\t\t<title>Export</title>`,
                `\t\t\t\t\t</head>`,
                `\t\t\t\t<body>`,
                `\t\t\t\t\t<ul id="id::${wsId}">`,
                `\t\t\t\t`,
                `\t\t\t\t<li><h3>Workspace details:</h3>` +
                    `<p>Workspace identifier: ${wsId}</p>` +
                    `<p>Workspace name: My Workspace</p></li>` +
                    `<li><ul id="id::${formatAsUuid(doc.notionId)}">` +
                    `<a href="./Page ${doc.notionId}.md">Page ${doc.notionId}.md</a>` +
                    `</ul></li>` +
                    `</ul>`,
                `\t\t\t\t\t</body>`,
                `</html>`,
            ].join("\n"),
        );
    });

    test("nested documents use relative paths in hrefs", () => {
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "", [child]);
        const files = extractFiles(
            createTestNotionImportZip([parent], {createFoldersForSubpages: true}),
        );

        const html = strFromU8(files["index.html"]!);
        const wsId = extractWorkspaceId(html);
        expect(html).toBe(
            [
                `<!DOCTYPE html><html><head>`,
                `\t\t\t\t\t\t<title>Export</title>`,
                `\t\t\t\t\t</head>`,
                `\t\t\t\t<body>`,
                `\t\t\t\t\t<ul id="id::${wsId}">`,
                `\t\t\t\t`,
                `\t\t\t\t<li><h3>Workspace details:</h3>` +
                    `<p>Workspace identifier: ${wsId}</p>` +
                    `<p>Workspace name: Test Workspace</p></li>` +
                    `<li><ul id="id::${formatAsUuid(parent.notionId)}">` +
                    `<a href="./Parent ${parent.notionId}.md">Parent ${parent.notionId}.md</a>` +
                    `<li><ul id="id::${formatAsUuid(child.notionId)}">` +
                    `<a href="Parent/Child ${child.notionId}.md">Child ${child.notionId}.md</a>` +
                    `</ul></li>` +
                    `</ul></li>` +
                    `</ul>`,
                `\t\t\t\t\t</body>`,
                `</html>`,
            ].join("\n"),
        );
    });

    test("flat mode uses ./ prefix for all hrefs", () => {
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "", [child]);
        const files = extractFiles(createTestNotionImportZip([parent]));

        const html = strFromU8(files["index.html"]!);
        const wsId = extractWorkspaceId(html);
        expect(html).toBe(
            [
                `<!DOCTYPE html><html><head>`,
                `\t\t\t\t\t\t<title>Export</title>`,
                `\t\t\t\t\t</head>`,
                `\t\t\t\t<body>`,
                `\t\t\t\t\t<ul id="id::${wsId}">`,
                `\t\t\t\t`,
                `\t\t\t\t<li><h3>Workspace details:</h3>` +
                    `<p>Workspace identifier: ${wsId}</p>` +
                    `<p>Workspace name: Test Workspace</p></li>` +
                    `<li><ul id="id::${formatAsUuid(parent.notionId)}">` +
                    `<a href="./Parent ${parent.notionId}.md">Parent ${parent.notionId}.md</a>` +
                    `<li><ul id="id::${formatAsUuid(child.notionId)}">` +
                    `<a href="./Child ${child.notionId}.md">Child ${child.notionId}.md</a>` +
                    `</ul></li>` +
                    `</ul></li>` +
                    `</ul>`,
                `\t\t\t\t\t</body>`,
                `</html>`,
            ].join("\n"),
        );
    });

    test("database entry", () => {
        const database = new ExportedNotionDatabase("My DB", [["Col"], ["Val"]]);
        const files = extractFiles(createTestNotionImportZip([database]));

        const html = strFromU8(files["index.html"]!);
        const wsId = extractWorkspaceId(html);
        expect(html).toBe(
            [
                `<!DOCTYPE html><html><head>`,
                `\t\t\t\t\t\t<title>Export</title>`,
                `\t\t\t\t\t</head>`,
                `\t\t\t\t<body>`,
                `\t\t\t\t\t<ul id="id::${wsId}">`,
                `\t\t\t\t`,
                `\t\t\t\t<li><h3>Workspace details:</h3>` +
                    `<p>Workspace identifier: ${wsId}</p>` +
                    `<p>Workspace name: Test Workspace</p></li>` +
                    `<li><ul id="id::${formatAsUuid(database.notionId)}.csv">` +
                    `<a href="./My DB ${database.notionId}.csv">My DB ${database.notionId}.csv</a>` +
                    `</ul></li>` +
                    `</ul>`,
                `\t\t\t\t\t</body>`,
                `</html>`,
            ].join("\n"),
        );
    });

    test("files are not listed in index.html", () => {
        const image = new ExportedNotionFile("photo.png", "image");
        const page = new ExportedNotionDocument("Page", "");
        page.addFiles([image]);
        const files = extractFiles(createTestNotionImportZip([page]));

        const html = strFromU8(files["index.html"]!);
        expect(html).not.toContain("photo.png");
    });

    test("tree structure with nested documents and databases", () => {
        const database = new ExportedNotionDatabase("Tasks", [["Name"], ["T1"]]);
        const grandchild = new ExportedNotionDocument("Deep Page", "");
        const child = new ExportedNotionDocument("Mid Page", "", [grandchild, database]);
        const parent = new ExportedNotionDocument("Root Page", "", [child]);
        const files = extractFiles(
            createTestNotionImportZip([parent], {createFoldersForSubpages: true}),
        );

        const html = strFromU8(files["index.html"]!);
        const wsId = extractWorkspaceId(html);
        expect(html).toBe(
            [
                `<!DOCTYPE html><html><head>`,
                `\t\t\t\t\t\t<title>Export</title>`,
                `\t\t\t\t\t</head>`,
                `\t\t\t\t<body>`,
                `\t\t\t\t\t<ul id="id::${wsId}">`,
                `\t\t\t\t`,
                `\t\t\t\t<li><h3>Workspace details:</h3>` +
                    `<p>Workspace identifier: ${wsId}</p>` +
                    `<p>Workspace name: Test Workspace</p></li>` +
                    `<li><ul id="id::${formatAsUuid(parent.notionId)}">` +
                    `<a href="./Root Page ${parent.notionId}.md">Root Page ${parent.notionId}.md</a>` +
                    `<li><ul id="id::${formatAsUuid(child.notionId)}">` +
                    `<a href="Root Page/Mid Page ${child.notionId}.md">Mid Page ${child.notionId}.md</a>` +
                    `<li><ul id="id::${formatAsUuid(grandchild.notionId)}">` +
                    `<a href="Root Page/Mid Page/Deep Page ${grandchild.notionId}.md">Deep Page ${grandchild.notionId}.md</a>` +
                    `</ul></li>` +
                    `<li><ul id="id::${formatAsUuid(database.notionId)}.csv">` +
                    `<a href="./Tasks ${database.notionId}.csv">Tasks ${database.notionId}.csv</a>` +
                    `</ul></li>` +
                    `</ul></li>` +
                    `</ul></li>` +
                    `</ul>`,
                `\t\t\t\t\t</body>`,
                `</html>`,
            ].join("\n"),
        );
    });
});

describe("mixed content scenarios", () => {
    test("document with database, child page, and file (flat)", () => {
        const image = new ExportedNotionFile("cover.png", "image");
        const database = new ExportedNotionDatabase("Inline DB", [
            ["Name", "Value"],
            ["Entry", "42"],
        ]);
        const child = new ExportedNotionDocument("Sub", "");
        const page = new ExportedNotionDocument("Article", image.toReference(), [database, child]);
        page.addFiles([image]);
        const files = extractFiles(createTestNotionImportZip([page]));

        const names = fileNames(files);
        expect(names).toContain(`Article ${page.notionId}.md`);
        expect(names).toContain(`Inline DB ${database.notionId}.csv`);
        expect(names).toContain(`Inline DB ${database.notionId}_all.csv`);
        expect(names).toContain(`Sub ${child.notionId}.md`);
        expect(names).toContain("cover.png");
        expect(names).toContain("index.html");
    });

    test("document with database, child page, and file (nested)", () => {
        const image = new ExportedNotionFile("cover.png", "image");
        const database = new ExportedNotionDatabase("Inline DB", [
            ["Name", "Value"],
            ["Entry", "42"],
        ]);
        const child = new ExportedNotionDocument("Sub", "");
        const page = new ExportedNotionDocument("Article", image.toReference(), [database, child]);
        page.addFiles([image]);
        const files = extractFiles(
            createTestNotionImportZip([page], {createFoldersForSubpages: true}),
        );

        const names = fileNames(files);
        expect(names).toContain(`Article ${page.notionId}.md`);
        expect(names).toContain(`Article/Inline DB ${database.notionId}.csv`);
        expect(names).toContain(`Article/Inline DB ${database.notionId}_all.csv`);
        expect(names).toContain(`Article/Sub ${child.notionId}.md`);
        expect(names).toContain("Article/cover.png");
        expect(names).toContain("index.html");
    });

    test("complex hierarchy with mixed item types (nested)", () => {
        const nestedDatabase = new ExportedNotionDatabase("Child DB", [["X"], ["Y"]]);
        const nestedImage = new ExportedNotionFile("nested.jpg", "image");
        const childPage = new ExportedNotionDocument("Child", "text", [nestedDatabase]);
        childPage.addFiles([nestedImage]);
        const topDatabase = new ExportedNotionDatabase("Top DB", [["A"], ["B"]]);
        const topImage = new ExportedNotionFile("top.png", "image");
        const parentPage = new ExportedNotionDocument("Parent", "", [childPage, topDatabase]);
        parentPage.addFiles([topImage]);
        const files = extractFiles(
            createTestNotionImportZip([parentPage], {createFoldersForSubpages: true}),
        );

        expect(files[`Parent ${parentPage.notionId}.md`]).toBeDefined();
        expect(files[`Parent/Child ${childPage.notionId}.md`]).toBeDefined();
        expect(files[`Parent/Top DB ${topDatabase.notionId}.csv`]).toBeDefined();
        expect(files["Parent/top.png"]).toBeDefined();
        expect(files[`Parent/Child/Child DB ${nestedDatabase.notionId}.csv`]).toBeDefined();
        expect(files["Parent/Child/nested.jpg"]).toBeDefined();
    });

    test("only top-level items are included when children have parents", () => {
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "", [child]);
        // Pass both parent and child, but child has parent set
        const files = extractFiles(createTestNotionImportZip([parent, child]));

        const docFiles = Object.keys(files).filter(f => f.endsWith(".md"));
        expect(docFiles).toHaveLength(2);
    });
});

describe("bidirectional parent/child management", () => {
    test("addChildren sets parent on child", () => {
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "");
        parent.addChildren([child]);

        expect(child.parent).toBe(parent);
        expect(parent.children).toContain(child);
    });

    test("setParent adds child to new parent", () => {
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "");
        child.setParent(parent);

        expect(child.parent).toBe(parent);
        expect(parent.children).toContain(child);
    });

    test("addChildren to new parent removes child from old parent", () => {
        const child = new ExportedNotionDocument("Child", "");
        const oldParent = new ExportedNotionDocument("Old Parent", "", [child]);
        const newParent = new ExportedNotionDocument("New Parent", "");

        newParent.addChildren([child]);

        expect(child.parent).toBe(newParent);
        expect(newParent.children).toContain(child);
        expect(oldParent.children).not.toContain(child);
    });

    test("setParent to new parent removes child from old parent", () => {
        const child = new ExportedNotionDocument("Child", "");
        const oldParent = new ExportedNotionDocument("Old Parent", "", [child]);
        const newParent = new ExportedNotionDocument("New Parent", "");

        child.setParent(newParent);

        expect(child.parent).toBe(newParent);
        expect(newParent.children).toContain(child);
        expect(oldParent.children).not.toContain(child);
    });

    test("setParent to null removes from current parent", () => {
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "", [child]);

        child.setParent(null);

        expect(child.parent).toBeNull();
        expect(parent.children).not.toContain(child);
    });

    test("removeChild clears parent on the child", () => {
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "", [child]);

        parent.removeChild(child);

        expect(child.parent).toBeNull();
        expect(parent.children).not.toContain(child);
    });

    test("setParent to same parent is a no-op", () => {
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", "", [child]);

        child.setParent(parent);

        expect(parent.children.filter(c => c === child)).toHaveLength(1);
    });

    test("moving database between parents", () => {
        const database = new ExportedNotionDatabase("DB", [["Col"], ["Val"]]);
        const page1 = new ExportedNotionDocument("Page1", "", [database]);
        const page2 = new ExportedNotionDocument("Page2", "");

        page2.addChildren([database]);

        expect(database.parent).toBe(page2);
        expect(page1.children).not.toContain(database);
        expect(page2.children).toContain(database);
    });

    test("moved child is generated under new parent in zip", () => {
        const child = new ExportedNotionDocument("Child", "");
        const oldParent = new ExportedNotionDocument("Old", "", [child]);
        const newParent = new ExportedNotionDocument("New", "");

        newParent.addChildren([child]);

        const files = extractFiles(
            createTestNotionImportZip([oldParent, newParent], {createFoldersForSubpages: true}),
        );

        expect(files[`New/Child ${child.notionId}.md`]).toBeDefined();
        expect(files[`Old/Child ${child.notionId}.md`]).toBeUndefined();
    });
});

describe("notion ID format", () => {
    test("all items get unique 32 hex char IDs", () => {
        const document1 = new ExportedNotionDocument("A", "");
        const document2 = new ExportedNotionDocument("B", "");
        const database = new ExportedNotionDatabase("C", [["X"]]);

        expect(document1.notionId).toMatch(/^[0-9a-f]{32}$/);
        expect(document2.notionId).toMatch(/^[0-9a-f]{32}$/);
        expect(database.notionId).toMatch(/^[0-9a-f]{32}$/);
        expect(document1.notionId).not.toBe(document2.notionId);
        expect(document1.notionId).not.toBe(database.notionId);
    });
});

describe("circular references", () => {
    test("child resolves parent reference via global resolution", () => {
        // Create child first so parent can reference it
        const child = new ExportedNotionDocument("Child", "");
        const parent = new ExportedNotionDocument("Parent", `Link to ${child.toReference()}`, [
            child,
        ]);
        // Now create a new child that references parent
        const childWithBackRef = new ExportedNotionDocument(
            "Child",
            `Back to ${parent.toReference()}`,
        );
        parent.removeChild(child);
        parent.addChildren([childWithBackRef]);

        const files = extractFiles(createTestNotionImportZip([parent]));

        // Parent's reference to original child stays unresolved (child
        // was removed from the tree and never processed)
        expect(strFromU8(files[`Parent ${parent.notionId}.md`]!)).toBe(
            [
                "# Parent",
                "",
                `[Child](Child%20${childWithBackRef.notionId}.md)`,
                "",
                "---",
                "",
                `Link to ${child.toReference()}`,
                "",
            ].join("\n"),
        );
        // Child resolves parent reference via global resolution
        expect(strFromU8(files[`Child ${childWithBackRef.notionId}.md`]!)).toBe(
            ["# Child", "", `Back to [Parent](Parent%20${parent.notionId}.md)`, ""].join("\n"),
        );
    });

    test("siblings referencing each other resolve via global resolution", () => {
        const alpha = new ExportedNotionDocument("Alpha", "alpha content");
        const beta = new ExportedNotionDocument("Beta", `See ${alpha.toReference()}`);
        const parent = new ExportedNotionDocument("Parent", "", [alpha, beta]);

        const files = extractFiles(createTestNotionImportZip([parent]));

        // Beta references alpha — resolved via global resolution pass
        expect(strFromU8(files[`Beta ${beta.notionId}.md`]!)).toBe(
            ["# Beta", "", `See [Alpha](Alpha%20${alpha.notionId}.md)`, ""].join("\n"),
        );
    });

    test("self-reference in content leaves placeholder unresolved", () => {
        const doc = new ExportedNotionDocument("Self", "");
        const selfRef = new ExportedNotionDocument("Self", `Link to myself: ${doc.toReference()}`);
        const parent = new ExportedNotionDocument("Parent", "", [selfRef]);

        const files = extractFiles(createTestNotionImportZip([parent]));

        // Self-reference can't resolve (doc is not a child of itself)
        expect(strFromU8(files[`Self ${selfRef.notionId}.md`]!)).toBe(
            ["# Self", "", `Link to myself: ${doc.toReference()}`, ""].join("\n"),
        );
    });

    test("chain: grandparent -> parent -> child all resolve forward references", () => {
        const grandchild = new ExportedNotionDocument("Leaf", "leaf content");
        const child = new ExportedNotionDocument("Mid", `child refs ${grandchild.toReference()}`, [
            grandchild,
        ]);
        const root = new ExportedNotionDocument("Root", `root refs ${child.toReference()}`, [
            child,
        ]);

        const files = extractFiles(createTestNotionImportZip([root]));

        // Root resolves child reference
        expect(strFromU8(files[`Root ${root.notionId}.md`]!)).toBe(
            [
                "# Root",
                "",
                `[Mid](Mid%20${child.notionId}.md)`,
                "",
                "---",
                "",
                `root refs [Mid](Mid%20${child.notionId}.md)`,
                "",
            ].join("\n"),
        );
        // Child resolves grandchild reference
        expect(strFromU8(files[`Mid ${child.notionId}.md`]!)).toBe(
            [
                "# Mid",
                "",
                `[Leaf](Leaf%20${grandchild.notionId}.md)`,
                "",
                "---",
                "",
                `child refs [Leaf](Leaf%20${grandchild.notionId}.md)`,
                "",
            ].join("\n"),
        );
    });

    test("backward reference in chain (child refs grandparent) resolves", () => {
        const root = new ExportedNotionDocument("Root", "root content");
        const grandchild = new ExportedNotionDocument("Leaf", `back to ${root.toReference()}`);
        const child = new ExportedNotionDocument("Mid", "", [grandchild]);
        root.addChildren([child]);

        const files = extractFiles(createTestNotionImportZip([root]));

        // Grandchild resolves root reference via global resolution
        expect(strFromU8(files[`Leaf ${grandchild.notionId}.md`]!)).toBe(
            ["# Leaf", "", `back to [Root](Root%20${root.notionId}.md)`, ""].join("\n"),
        );
    });

    test("three siblings all referencing each other resolve correctly", () => {
        const a = new ExportedNotionDocument("Document A", "");
        const b = new ExportedNotionDocument("Document B", "");
        const c = new ExportedNotionDocument("Document C", "");

        // Set content with mutual cross-references
        a.content = `Links to ${b.toReference()} and ${c.toReference()}`;
        b.content = `Links to ${a.toReference()} and ${c.toReference()}`;
        c.content = `Links to ${a.toReference()} and ${b.toReference()}`;

        const parent = new ExportedNotionDocument("Parent", "", [a, b, c]);
        const files = extractFiles(createTestNotionImportZip([parent]));

        expect(strFromU8(files[`Document A ${a.notionId}.md`]!)).toBe(
            [
                "# Document A",
                "",
                `Links to [Document B](Document%20B%20${b.notionId}.md)` +
                    ` and [Document C](Document%20C%20${c.notionId}.md)`,
                "",
            ].join("\n"),
        );
        expect(strFromU8(files[`Document B ${b.notionId}.md`]!)).toBe(
            [
                "# Document B",
                "",
                `Links to [Document A](Document%20A%20${a.notionId}.md)` +
                    ` and [Document C](Document%20C%20${c.notionId}.md)`,
                "",
            ].join("\n"),
        );
        expect(strFromU8(files[`Document C ${c.notionId}.md`]!)).toBe(
            [
                "# Document C",
                "",
                `Links to [Document A](Document%20A%20${a.notionId}.md)` +
                    ` and [Document B](Document%20B%20${b.notionId}.md)`,
                "",
            ].join("\n"),
        );
    });
});

describe("teamspaces", () => {
    test("index.html with teamspaces uses <a> without href", () => {
        const page1 = new ExportedNotionDocument("Home", "");
        const page2 = new ExportedNotionDocument("Notes", "");
        const page3 = new ExportedNotionDocument("Projects", "");

        const ts1 = new ExportedNotionTeamspace("Private & Shared", [page1, page2]);
        const ts2 = new ExportedNotionTeamspace("Josh's Space HQ", [page3]);

        const files = extractFiles(createTestNotionImportZip([ts1, ts2]));
        const html = strFromU8(files["index.html"]!);
        const wsId = extractWorkspaceId(html);

        expect(html).toBe(
            [
                `<!DOCTYPE html><html><head>`,
                `\t\t\t\t\t\t<title>Export</title>`,
                `\t\t\t\t\t</head>`,
                `\t\t\t\t<body>`,
                `\t\t\t\t\t<ul id="id::${wsId}">`,
                `\t\t\t\t`,
                `\t\t\t\t<li><h3>Workspace details:</h3>` +
                    `<p>Workspace identifier: ${wsId}</p>` +
                    `<p>Workspace name: Test Workspace</p></li>` +
                    // Teamspace 1: "Private & Shared"
                    `<li><ul id="id::${formatAsUuid(ts1.notionId)}">` +
                    `<a>Private &amp; Shared</a>` +
                    `<li><ul id="id::${formatAsUuid(page1.notionId)}">` +
                    `<a href="./Home ${page1.notionId}.md">Home ${page1.notionId}.md</a>` +
                    `</ul></li>` +
                    `<li><ul id="id::${formatAsUuid(page2.notionId)}">` +
                    `<a href="./Notes ${page2.notionId}.md">Notes ${page2.notionId}.md</a>` +
                    `</ul></li>` +
                    `</ul></li>` +
                    // Teamspace 2: "Josh's Space HQ"
                    `<li><ul id="id::${formatAsUuid(ts2.notionId)}">` +
                    `<a>Josh&#39;s Space HQ</a>` +
                    `<li><ul id="id::${formatAsUuid(page3.notionId)}">` +
                    `<a href="./Projects ${page3.notionId}.md">Projects ${page3.notionId}.md</a>` +
                    `</ul></li>` +
                    `</ul></li>` +
                    `</ul>`,
                `\t\t\t\t\t</body>`,
                `</html>`,
            ].join("\n"),
        );
    });

    test("teamspace items are included as files in the zip", () => {
        const page1 = new ExportedNotionDocument("Page A", "content a");
        const page2 = new ExportedNotionDocument("Page B", "content b");
        const ts = new ExportedNotionTeamspace("Private & Shared", [page1, page2]);

        const files = extractFiles(createTestNotionImportZip([ts]));

        expect(files[`Page A ${page1.notionId}.md`]).toBeDefined();
        expect(files[`Page B ${page2.notionId}.md`]).toBeDefined();
        expect(strFromU8(files[`Page A ${page1.notionId}.md`]!)).toBe(
            ["# Page A", "", "content a", ""].join("\n"),
        );
    });

    test("teamspace notionId is a valid 32-char hex ID", () => {
        const ts = new ExportedNotionTeamspace("Test", []);
        expect(ts.notionId).toMatch(/^[0-9a-f]{32}$/);
    });
});
