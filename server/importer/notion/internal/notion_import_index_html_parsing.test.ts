/* eslint-disable cyberworlds/string-quotes -- Test descriptions may contain apostrophes */
import {strToU8} from "fflate";
import {readFileSync} from "fs";
import {DomUtils, parseDocument} from "htmlparser2";
import {join} from "path";

import type {NotionIndexHtmlElement} from "~/server/importer/notion/internal/notion_import_index_html_parsing.js";
import {
    findAnchorElement,
    findChildUnorderedListElements,
    isUnorderedListWithNotionId,
    normalizeNotionId,
    parseNotionImportIndexHtml,
    stripTrailingNotionId,
} from "~/server/importer/notion/internal/notion_import_index_html_parsing.js";

function readFixture(name: string): Uint8Array {
    const runfiles = process.env.RUNFILES;
    const base = runfiles ? join(runfiles, "cyberworlds") : ".";
    return new Uint8Array(readFileSync(join(base, "server/importer/notion/test_fixtures", name)));
}

/**
 * Helper to parse a minimal HTML snippet and find the first element matching a
 * predicate.
 */
function parseHtmlAndFind(
    html: string,
    predicate: (el: {name: string; attribs: Record<string, string>}) => boolean,
): NotionIndexHtmlElement | null {
    const doc = parseDocument(html);
    return DomUtils.findOne(predicate, doc.children, true);
}

describe("parseNotionImportIndexHtml", () => {
    describe("valid exports", () => {
        test("parses export without teamspaces", () => {
            const html = readFixture("sample_index_without_teamspaces.html");
            const rawFiles = {"index.html": html};

            const result = parseNotionImportIndexHtml(rawFiles);

            expect(result).not.toBeNull();
            expect(result!.workspaceName).toBe("Export");
            expect(result!.workspaceId).toBe("00f80a22fe3781a094cb00034a90e2b8");
            expect(result!.hasTeamspaces).toBe(false);
            expect(result!.topLevelChildren.length).toBeGreaterThan(0);
        });

        test("parses export with teamspaces", () => {
            const html = readFixture("sample_index_with_teamspaces.html");
            const rawFiles = {"index.html": html};

            const result = parseNotionImportIndexHtml(rawFiles);

            expect(result).not.toBeNull();
            expect(result!.workspaceName).toBe("Alpine Test Space");
            expect(result!.workspaceId).toBe("59a78915cb0e810ba91f0003b2f7d496");
            expect(result!.hasTeamspaces).toBe(true);
            expect(result!.topLevelChildren.length).toBe(2);
        });

        test("finds index.html in subdirectory", () => {
            const html = strToU8(`
                <html><body>
                    <p>Workspace name: Nested Workspace</p>
                    <ul id="id::abc123"></ul>
                </body></html>
            `);
            const rawFiles = {"Export-uuid/index.html": html};

            const result = parseNotionImportIndexHtml(rawFiles);

            expect(result).not.toBeNull();
            expect(result!.workspaceName).toBe("Nested Workspace");
        });

        test("handles empty workspace with no pages", () => {
            const rawFiles = {
                "index.html": strToU8(`
                    <html><body>
                        <p>Workspace name: Empty Workspace</p>
                        <ul id="id::abc123"></ul>
                    </body></html>
                `),
            };

            const result = parseNotionImportIndexHtml(rawFiles);

            expect(result).not.toBeNull();
            expect(result!.workspaceName).toBe("Empty Workspace");
            expect(result!.topLevelChildren).toEqual([]);
            expect(result!.hasTeamspaces).toBe(false);
        });
    });

    describe("invalid exports", () => {
        test("returns null when no index.html exists", () => {
            const rawFiles = {
                "readme.txt": strToU8("Not a Notion export"),
            };

            const result = parseNotionImportIndexHtml(rawFiles);

            expect(result).toBeNull();
        });

        test("returns null when no workspace name found", () => {
            const rawFiles = {
                "index.html": strToU8("<html><body><p>No workspace info</p></body></html>"),
            };

            const result = parseNotionImportIndexHtml(rawFiles);

            expect(result).toBeNull();
        });

        test("returns null when no root ul element found", () => {
            const rawFiles = {
                "index.html": strToU8(`
                    <html><body>
                        <p>Workspace name: My Workspace</p>
                        <div>No ul element here</div>
                    </body></html>
                `),
            };

            const result = parseNotionImportIndexHtml(rawFiles);

            expect(result).toBeNull();
        });

        test("returns null for empty files map", () => {
            const result = parseNotionImportIndexHtml({});

            expect(result).toBeNull();
        });
    });

    describe("workspace name extraction", () => {
        test("trims whitespace from workspace name", () => {
            const rawFiles = {
                "index.html": strToU8(`
                    <html><body>
                        <p>Workspace name:    Trimmed Name   </p>
                        <ul id="id::abc123"></ul>
                    </body></html>
                `),
            };

            const result = parseNotionImportIndexHtml(rawFiles);

            expect(result?.workspaceName).toBe("Trimmed Name");
        });

        test("handles special characters in workspace name", () => {
            const rawFiles = {
                "index.html": strToU8(`
                    <html><body>
                        <p>Workspace name: Josh's & Mary's Workspace</p>
                        <ul id="id::abc123"></ul>
                    </body></html>
                `),
            };

            const result = parseNotionImportIndexHtml(rawFiles);

            expect(result?.workspaceName).toBe("Josh's & Mary's Workspace");
        });
    });
});

describe("isUnorderedListWithNotionId", () => {
    test("returns true for ul with id:: prefix", () => {
        const element = {name: "ul", attribs: {id: "id::abc123"}};

        expect(isUnorderedListWithNotionId(element)).toBe(true);
    });

    test("returns true for ul with UUID id", () => {
        const element = {name: "ul", attribs: {id: "id::2e780a22-fe37-80d8-889d-df2a4ed08451"}};

        expect(isUnorderedListWithNotionId(element)).toBe(true);
    });

    test("returns true for ul with teamspace id format", () => {
        const element = {
            name: "ul",
            attribs: {id: "id::Caleb Meredith's Space HQ 2f178915cb0e81b2b9c90042322642ab"},
        };

        expect(isUnorderedListWithNotionId(element)).toBe(true);
    });

    test("returns false for ul without id attribute", () => {
        const element = {name: "ul", attribs: {}};

        expect(isUnorderedListWithNotionId(element)).toBe(false);
    });

    test("returns false for ul with non-notion id", () => {
        const element = {name: "ul", attribs: {id: "regular-id"}};

        expect(isUnorderedListWithNotionId(element)).toBe(false);
    });

    test("returns false for non-ul elements with notion id", () => {
        const element = {name: "li", attribs: {id: "id::abc123"}};

        expect(isUnorderedListWithNotionId(element)).toBe(false);
    });

    test("returns false for div elements", () => {
        const element = {name: "div", attribs: {id: "id::abc123"}};

        expect(isUnorderedListWithNotionId(element)).toBe(false);
    });
});

describe("findChildUnorderedListElements", () => {
    test("finds child ul elements inside li elements", () => {
        const html = `
            <ul id="id::parent">
                <li><ul id="id::child1"><a href="./page1.md">Page 1</a></ul></li>
                <li><ul id="id::child2"><a href="./page2.md">Page 2</a></ul></li>
            </ul>
        `;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::parent");

        const children = findChildUnorderedListElements(parent!);

        expect(children).toHaveLength(2);
        expect(children[0]!.attribs.id).toBe("id::child1");
        expect(children[1]!.attribs.id).toBe("id::child2");
    });

    test("returns empty array when parent has no children", () => {
        const html = `<ul id="id::empty"></ul>`;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::empty");

        const children = findChildUnorderedListElements(parent!);

        expect(children).toEqual([]);
    });

    test("ignores non-li children", () => {
        const html = `
            <ul id="id::parent">
                <a href="./page.md">Anchor not in li</a>
                <li><ul id="id::child"><a href="./page.md">Page</a></ul></li>
            </ul>
        `;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::parent");

        const children = findChildUnorderedListElements(parent!);

        expect(children).toHaveLength(1);
        expect(children[0]!.attribs.id).toBe("id::child");
    });

    test("ignores li children without ul elements", () => {
        const html = `
            <ul id="id::parent">
                <li><h3>Header in li</h3></li>
                <li><ul id="id::child"><a href="./page.md">Page</a></ul></li>
            </ul>
        `;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::parent");

        const children = findChildUnorderedListElements(parent!);

        expect(children).toHaveLength(1);
        expect(children[0]!.attribs.id).toBe("id::child");
    });

    test("ignores ul elements without notion id", () => {
        const html = `
            <ul id="id::parent">
                <li><ul class="no-id"><a href="./page.md">Page</a></ul></li>
                <li><ul id="id::child"><a href="./page.md">Page</a></ul></li>
            </ul>
        `;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::parent");

        const children = findChildUnorderedListElements(parent!);

        expect(children).toHaveLength(1);
        expect(children[0]!.attribs.id).toBe("id::child");
    });

    test("does not find deeply nested ul elements", () => {
        const html = `
            <ul id="id::parent">
                <li>
                    <ul id="id::child">
                        <li>
                            <ul id="id::grandchild"><a href="./page.md">Page</a></ul>
                        </li>
                    </ul>
                </li>
            </ul>
        `;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::parent");

        const children = findChildUnorderedListElements(parent!);

        // Should only find immediate children, not grandchildren
        expect(children).toHaveLength(1);
        expect(children[0]!.attribs.id).toBe("id::child");
    });
});

describe("normalizeNotionId", () => {
    test("removes id:: prefix from simple id", () => {
        expect(normalizeNotionId("id::abc123")).toBe("abc123");
    });

    test("removes dashes from UUID format", () => {
        expect(normalizeNotionId("id::2e780a22-fe37-80d8-889d-df2a4ed08451")).toBe(
            "2e780a22fe3780d8889ddf2a4ed08451",
        );
    });

    test("extracts trailing 32-char hex from teamspace format", () => {
        expect(
            normalizeNotionId("id::Caleb Meredith's Space HQ 2f178915cb0e81b2b9c90042322642ab"),
        ).toBe("2f178915cb0e81b2b9c90042322642ab");
    });

    test("returns raw id when no trailing hex id exists", () => {
        expect(normalizeNotionId("id::Private&Shared")).toBe("Private&Shared");
    });

    test("handles .csv suffix in id", () => {
        expect(normalizeNotionId("id::2e780a22-fe37-80d8-889d-df2a4ed08451.csv")).toBe(
            "2e780a22fe3780d8889ddf2a4ed08451.csv",
        );
    });

    test("handles id with spaces but no trailing hex", () => {
        expect(normalizeNotionId("id::Some Name Here")).toBe("Some Name Here");
    });

    test("handles empty id after prefix", () => {
        expect(normalizeNotionId("id::")).toBe("");
    });
});

describe("stripTrailingNotionId", () => {
    test("strips trailing 32-char hex id", () => {
        expect(stripTrailingNotionId("My Teamspace 2f178915cb0e81b2b9c90042322642ab")).toBe(
            "My Teamspace",
        );
    });

    test("strips id with apostrophes in name", () => {
        expect(
            stripTrailingNotionId("Caleb Meredith's Space HQ 2f178915cb0e81b2b9c90042322642ab"),
        ).toBe("Caleb Meredith's Space HQ");
    });

    test("returns name unchanged when no trailing id", () => {
        expect(stripTrailingNotionId("Private & Shared")).toBe("Private & Shared");
    });

    test("returns empty string unchanged", () => {
        expect(stripTrailingNotionId("")).toBe("");
    });

    test("does not strip non-hex trailing characters", () => {
        expect(stripTrailingNotionId("Name with spaces and 12345")).toBe(
            "Name with spaces and 12345",
        );
    });

    test("does not strip shorter hex strings", () => {
        expect(stripTrailingNotionId("Name abc123")).toBe("Name abc123");
    });

    test("does not strip longer hex strings", () => {
        expect(stripTrailingNotionId("Name 2f178915cb0e81b2b9c90042322642ab1234")).toBe(
            "Name 2f178915cb0e81b2b9c90042322642ab1234",
        );
    });

    test("only strips at the end of the string", () => {
        expect(stripTrailingNotionId("2f178915cb0e81b2b9c90042322642ab Name")).toBe(
            "2f178915cb0e81b2b9c90042322642ab Name",
        );
    });
});

describe("findAnchorElement", () => {
    test("finds anchor element as direct child", () => {
        const html = `
            <ul id="id::parent">
                <a href="./page.md">Page Link</a>
            </ul>
        `;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::parent");

        const anchor = findAnchorElement(parent!);

        expect(anchor).not.toBeNull();
        expect(anchor!.attribs.href).toBe("./page.md");
        expect(DomUtils.textContent(anchor!)).toBe("Page Link");
    });

    test("finds anchor without href (teamspace label)", () => {
        const html = `
            <ul id="id::teamspace">
                <a>Private &amp; Shared</a>
            </ul>
        `;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::teamspace");

        const anchor = findAnchorElement(parent!);

        expect(anchor).not.toBeNull();
        expect(anchor!.attribs.href).toBeUndefined();
        expect(DomUtils.textContent(anchor!)).toBe("Private & Shared");
    });

    test("returns null when no anchor exists", () => {
        const html = `
            <ul id="id::parent">
                <li>No anchor here</li>
            </ul>
        `;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::parent");

        const anchor = findAnchorElement(parent!);

        expect(anchor).toBeNull();
    });

    test("finds first anchor among multiple children", () => {
        const html = `
            <ul id="id::parent">
                <a href="./first.md">First</a>
                <a href="./second.md">Second</a>
            </ul>
        `;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::parent");

        const anchor = findAnchorElement(parent!);

        expect(anchor).not.toBeNull();
        expect(anchor!.attribs.href).toBe("./first.md");
    });

    test("finds anchor mixed with other elements", () => {
        const html = `
            <ul id="id::parent">
                <h3>Header</h3>
                <p>Paragraph</p>
                <a href="./page.md">Link</a>
                <li>List item</li>
            </ul>
        `;
        const parent = parseHtmlAndFind(html, el => el.attribs.id === "id::parent");

        const anchor = findAnchorElement(parent!);

        expect(anchor).not.toBeNull();
        expect(anchor!.attribs.href).toBe("./page.md");
    });
});
