import {parseNotionImportFileName} from "~/server/importer/notion/internal/parse_notion_import_file_name.js";

describe("parseNotionImportFileName", () => {
    test("parses markdown file name", () => {
        const result = parseNotionImportFileName("My Document 0123456789abcdef0123456789abcdef.md");

        expect(result).toMatchObject({
            title: "My Document",
            notionId: "0123456789abcdef0123456789abcdef",
            extension: "md",
        });
    });

    test("parses csv file name", () => {
        const result = parseNotionImportFileName("Database abc123def456abc123def456abc123de.csv");

        expect(result).toMatchObject({
            title: "Database",
            notionId: "abc123def456abc123def456abc123de",
            extension: "csv",
        });
    });

    test("parses title with multiple spaces", () => {
        const result = parseNotionImportFileName(
            "My Multi Word Title 0123456789abcdef0123456789abcdef.md",
        );

        expect(result).toMatchObject({
            title: "My Multi Word Title",
            notionId: "0123456789abcdef0123456789abcdef",
            extension: "md",
        });
    });

    test("parses title with special characters", () => {
        const result = parseNotionImportFileName(
            "Doc (v2) - Final! 0123456789abcdef0123456789abcdef.md",
        );

        expect(result).toMatchObject({
            title: "Doc (v2) - Final!",
            notionId: "0123456789abcdef0123456789abcdef",
            extension: "md",
        });
    });

    test("returns null for wrong extension", () => {
        expect(parseNotionImportFileName("Doc 0123456789abcdef0123456789abcdef.txt")).toBeNull();
    });

    test("returns null for missing extension", () => {
        expect(parseNotionImportFileName("Doc 0123456789abcdef0123456789abcdef")).toBeNull();
    });

    test("returns null for ID with uppercase letters", () => {
        expect(parseNotionImportFileName("Doc 0123456789ABCDEF0123456789abcdef.md")).toBeNull();
    });

    test("returns null for ID that is too short", () => {
        expect(parseNotionImportFileName("Doc 0123456789abcdef.md")).toBeNull();
    });

    test("returns null for ID that is too long", () => {
        expect(parseNotionImportFileName("Doc 0123456789abcdef0123456789abcdef00.md")).toBeNull();
    });

    test("returns null for empty string", () => {
        expect(parseNotionImportFileName("")).toBeNull();
    });

    test("returns null for file name without space before ID", () => {
        expect(parseNotionImportFileName("Doc0123456789abcdef0123456789abcdef.md")).toBeNull();
    });
});
