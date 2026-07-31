import {
    getFirstDocumentationSlug,
    humanizeDocumentationName,
    parseDocumentationNavTree,
    parseDocumentationOrderPrefix,
} from "~/shared/docs/documentation_nav.js";

test("parses and strips numeric ordering prefixes", () => {
    expect(parseDocumentationOrderPrefix("00-overview.mdx")).toEqual({
        order: 0,
        name: "overview.mdx",
    });
});

test("leaves names without a prefix untouched", () => {
    expect(parseDocumentationOrderPrefix("overview")).toEqual({order: null, name: "overview"});
});

test("humanizes slug segments into titles", () => {
    expect(humanizeDocumentationName("spaces-permissions")).toEqual("Spaces Permissions");
});

test("builds a directory-driven tree with groups and docs", () => {
    const {nodes} = parseDocumentationNavTree([
        {relativePath: "00-overview.mdx", title: "Overview"},
        {relativePath: "01-guides/00-documents.mdx", title: "Documents"},
        {relativePath: "01-guides/01-tasks.mdx", title: "Tasks"},
    ]);
    expect(nodes).toEqual([
        {type: "doc", slug: "overview", title: "Overview"},
        {
            type: "group",
            slug: "guides",
            title: "Guides",
            children: [
                {type: "doc", slug: "guides/documents", title: "Documents"},
                {type: "doc", slug: "guides/tasks", title: "Tasks"},
            ],
        },
    ]);
});

test("strips ordering prefixes from slugs and maps them to file paths", () => {
    const {filePathBySlug} = parseDocumentationNavTree([
        {relativePath: "01-guides/00-documents.mdx", title: "Documents"},
    ]);
    expect(filePathBySlug).toEqual({"guides/documents": "01-guides/00-documents.mdx"});
});

test("orders siblings by prefix, then unprefixed alphabetically", () => {
    const {nodes} = parseDocumentationNavTree([
        {relativePath: "zebra.mdx", title: "Zebra"},
        {relativePath: "02-third.mdx", title: "Third"},
        {relativePath: "00-first.mdx", title: "First"},
        {relativePath: "apple.mdx", title: "Apple"},
    ]);
    expect(nodes.map(node => node.slug)).toEqual(["first", "third", "apple", "zebra"]);
});

test("supports arbitrarily deep nesting", () => {
    const {nodes} = parseDocumentationNavTree([
        {relativePath: "00-a/00-b/00-c/00-deep.mdx", title: "Deep"},
    ]);
    expect(nodes).toEqual([
        {
            type: "group",
            slug: "a",
            title: "A",
            children: [
                {
                    type: "group",
                    slug: "a/b",
                    title: "B",
                    children: [
                        {
                            type: "group",
                            slug: "a/b/c",
                            title: "C",
                            children: [{type: "doc", slug: "a/b/c/deep", title: "Deep"}],
                        },
                    ],
                },
            ],
        },
    ]);
});

test("finds the first doc in sidebar order", () => {
    const {nodes} = parseDocumentationNavTree([
        {relativePath: "01-guides/00-documents.mdx", title: "Documents"},
        {relativePath: "00-overview.mdx", title: "Overview"},
    ]);
    expect(getFirstDocumentationSlug(nodes)).toEqual("overview");
});
