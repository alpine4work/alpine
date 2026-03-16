import {
    findFilePathsInCsv,
    findFilePathsInDatabaseProperties,
    looksLikeFilePath,
} from "~/server/importer/notion/internal/find_notion_import_file_paths.js";
import {FileId} from "~/shared/id/types/id_types.js";

function fileMap(entries: Array<[string, string]>): Map<string, FileId> {
    return new Map(entries.map(([k, v]) => [k, v as FileId]));
}

describe("looksLikeFilePath", () => {
    test("rejects plain text", () => {
        expect(looksLikeFilePath("hello world")).toBe(false);
    });

    test("rejects dates", () => {
        expect(looksLikeFilePath("02/20/2025")).toBe(false);
    });

    test("rejects email addresses", () => {
        expect(looksLikeFilePath("user@example.com")).toBe(false);
    });

    test("matches file with extension", () => {
        expect(looksLikeFilePath("image.jpg")).toBe(true);
    });

    test("matches path with extension", () => {
        expect(looksLikeFilePath("folder/photo.png")).toBe(true);
    });

    test("matches URL-encoded path", () => {
        expect(looksLikeFilePath("my%20file")).toBe(true);
    });

    test("matches URL-encoded path without extension", () => {
        expect(looksLikeFilePath("path%2Fto%2Ffile")).toBe(true);
    });

    test("rejects single character extension", () => {
        expect(looksLikeFilePath("file.a")).toBe(false);
    });

    test("matches two character extension", () => {
        expect(looksLikeFilePath("file.js")).toBe(true);
    });

    test("matches four character extension", () => {
        expect(looksLikeFilePath("file.jpeg")).toBe(true);
    });

    test("rejects five character extension", () => {
        expect(looksLikeFilePath("file.abcde")).toBe(false);
    });
});

describe("findFilePathsInDatabaseProperties", () => {
    test("finds file path in a property line after the title", () => {
        const markdown = "# My Page\nFiles: photo.jpg";
        const pathMap = fileMap([["photo.jpg", "f1"]]);

        expect(findFilePathsInDatabaseProperties(markdown, "photo.jpg", pathMap)).toEqual([
            "photo.jpg",
        ]);
    });

    test("finds multiple comma-separated file paths", () => {
        const markdown = "# My Page\nAttachments: a.png, b.pdf";
        const pathMap = fileMap([
            ["a.png", "f1"],
            ["b.pdf", "f2"],
        ]);

        expect(findFilePathsInDatabaseProperties(markdown, "doc.md", pathMap)).toEqual([
            "a.png",
            "b.pdf",
        ]);
    });

    test("skips values that do not look like file paths", () => {
        const markdown = "# My Page\nStatus: Active\nFile: report.pdf";
        const pathMap = fileMap([["report.pdf", "f1"]]);

        expect(findFilePathsInDatabaseProperties(markdown, "doc.md", pathMap)).toEqual([
            "report.pdf",
        ]);
    });

    test("skips file paths not in pathToFileId", () => {
        const markdown = "# My Page\nFile: missing.png";
        const pathMap = fileMap([]);

        expect(findFilePathsInDatabaseProperties(markdown, "doc.md", pathMap)).toEqual([]);
    });

    test("stops collecting properties at non-property line", () => {
        const markdown = "# My Page\nFile: a.png\n\nSome body text\nFile: b.png";
        const pathMap = fileMap([
            ["a.png", "f1"],
            ["b.png", "f2"],
        ]);

        expect(findFilePathsInDatabaseProperties(markdown, "doc.md", pathMap)).toEqual(["a.png"]);
    });

    test("handles URL-encoded file paths", () => {
        const markdown = "# My Page\nFile: my%20photo.jpg";
        const pathMap = fileMap([["my photo.jpg", "f1"]]);

        expect(findFilePathsInDatabaseProperties(markdown, "doc.md", pathMap)).toEqual([
            "my photo.jpg",
        ]);
    });

    test("resolves relative paths using document directory", () => {
        const markdown = "# My Page\nFile: image.png";
        const pathMap = fileMap([["teamspace/image.png", "f1"]]);

        expect(findFilePathsInDatabaseProperties(markdown, "teamspace/doc.md", pathMap)).toEqual([
            "teamspace/image.png",
        ]);
    });

    test("handles markdown without a title", () => {
        const markdown = "File: a.png";
        const pathMap = fileMap([["a.png", "f1"]]);

        expect(findFilePathsInDatabaseProperties(markdown, "doc.md", pathMap)).toEqual(["a.png"]);
    });

    test("skips blank lines between title and first property", () => {
        const markdown = "# My Page\n\nFile: a.png";
        const pathMap = fileMap([["a.png", "f1"]]);

        expect(findFilePathsInDatabaseProperties(markdown, "doc.md", pathMap)).toEqual(["a.png"]);
    });

    test("strips ./ prefix from file paths", () => {
        const markdown = "# My Page\nFile: ./image.jpg";
        const pathMap = fileMap([["image.jpg", "f1"]]);

        expect(findFilePathsInDatabaseProperties(markdown, "doc.md", pathMap)).toEqual([
            "image.jpg",
        ]);
    });

    test("handles multi-word property names", () => {
        const markdown = "# My Page\nCover Image: photo.jpg";
        const pathMap = fileMap([["photo.jpg", "f1"]]);

        expect(findFilePathsInDatabaseProperties(markdown, "doc.md", pathMap)).toEqual([
            "photo.jpg",
        ]);
    });
});

describe("findFilePathsInCsv", () => {
    test("finds file paths in CSV data rows", () => {
        const csv = "Name,File\nRow 1,image.png";
        const pathMap = fileMap([["image.png", "f1"]]);

        expect(findFilePathsInCsv(csv, "db", pathMap)).toEqual(["image.png"]);
    });

    test("skips header row", () => {
        const csv = "file.png\nactual.jpg";
        const pathMap = fileMap([
            ["file.png", "f1"],
            ["actual.jpg", "f2"],
        ]);

        // Header is skipped so file.png is not included
        expect(findFilePathsInCsv(csv, "", pathMap)).toEqual(["actual.jpg"]);
    });

    test("returns empty for single-line CSV (header only)", () => {
        const csv = "Name,File";
        const pathMap = fileMap([["anything.png", "f1"]]);

        expect(findFilePathsInCsv(csv, "db", pathMap)).toEqual([]);
    });

    test("resolves paths relative to grandparent of CSV directory", () => {
        const csv = "Name,File\nRow,photo.jpg";
        const pathMap = fileMap([["workspace/photo.jpg", "f1"]]);

        expect(findFilePathsInCsv(csv, "workspace/db", pathMap)).toEqual(["workspace/photo.jpg"]);
    });

    test("skips cells that do not look like file paths", () => {
        const csv = "Name,Status\nAlice,Active";
        const pathMap = fileMap([]);

        expect(findFilePathsInCsv(csv, "db", pathMap)).toEqual([]);
    });

    test("finds file paths across multiple rows and columns", () => {
        const csv = "Name,Photo,Resume\nAlice,alice.jpg,resume.pdf\nBob,bob.png,cv.pdf";
        const pathMap = fileMap([
            ["alice.jpg", "f1"],
            ["resume.pdf", "f2"],
            ["bob.png", "f3"],
            ["cv.pdf", "f4"],
        ]);

        expect(findFilePathsInCsv(csv, "", pathMap)).toEqual([
            "alice.jpg",
            "resume.pdf",
            "bob.png",
            "cv.pdf",
        ]);
    });

    test("handles URL-encoded paths in CSV cells", () => {
        const csv = "Name,File\nRow,my%20photo.jpg";
        const pathMap = fileMap([["my photo.jpg", "f1"]]);

        expect(findFilePathsInCsv(csv, "", pathMap)).toEqual(["my photo.jpg"]);
    });

    test("skips paths not found in pathToFileId", () => {
        const csv = "Name,File\nRow,missing.png";
        const pathMap = fileMap([]);

        expect(findFilePathsInCsv(csv, "", pathMap)).toEqual([]);
    });

    test("handles CSV with empty csvDir", () => {
        const csv = "Name,File\nRow,doc.pdf";
        const pathMap = fileMap([["doc.pdf", "f1"]]);

        expect(findFilePathsInCsv(csv, "", pathMap)).toEqual(["doc.pdf"]);
    });
});
