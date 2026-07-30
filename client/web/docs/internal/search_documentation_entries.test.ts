import {
    DocumentationSearchEntry,
    buildDocumentationSearchIndex,
    createDocumentationSearchTags,
    getApiMethodSearchTags,
    parseDocumentationSearchIndex,
    searchDocumentationEntries,
} from "~/client/web/docs/search_documentation_entries.js";

const entries: Array<DocumentationSearchEntry> = [
    {type: "page", title: "Documents", url: "/docs/guides/documents", tags: ["files"]},
    {type: "page", title: "Tasks", url: "/docs/guides/tasks", tags: ["todo", "documents"]},
    {
        type: "api",
        title: "Create document",
        url: "/docs/api/post/documents",
        tags: ["create", "add"],
    },
    {
        type: "api",
        title: "Get document",
        url: "/docs/api/get/documents/id",
        tags: ["get", "read"],
    },
];

const searchIndex = buildDocumentationSearchIndex(entries);

test("ranks page title matches above page tag-only matches", () => {
    const results = searchDocumentationEntries(searchIndex, "documents");
    // "Documents" (page title) before "Tasks" (page, matched via its "documents" tag).
    expect(results.slice(0, 2).map(result => result.entry.title)).toEqual(["Documents", "Tasks"]);
});

test("ranks API docs last even when their title matches", () => {
    const results = searchDocumentationEntries(searchIndex, "document");
    // Both pages first (Documents by title, Tasks by tag), then the two API entries.
    expect(results.map(result => result.entry.type)).toEqual(["page", "page", "api", "api"]);
});

test("matches API endpoints by codegened method tags, not just title", () => {
    const results = searchDocumentationEntries(searchIndex, "create");
    expect(results.map(result => result.entry.title)).toEqual(["Create document"]);
});

test("does not surface tags in the result, only matches on them", () => {
    // "todo" only exists as a hidden tag on Tasks.
    const results = searchDocumentationEntries(searchIndex, "todo");
    expect(results).toEqual([
        {entry: expect.objectContaining({title: "Tasks"}), matchedTitle: false},
    ]);
});

test("uses Fuse typo tolerance", () => {
    const results = searchDocumentationEntries(searchIndex, "documnts");
    expect(results[0]?.entry.title).toBe("Documents");
});

test("searches a JSON-serialized generated index", () => {
    const parsedIndex = parseDocumentationSearchIndex(JSON.parse(JSON.stringify(searchIndex)));
    const results = searchDocumentationEntries(parsedIndex, "todo");
    expect(results).toEqual([
        {entry: expect.objectContaining({title: "Tasks"}), matchedTitle: false},
    ]);
});

test("an empty query returns no results", () => {
    const results = searchDocumentationEntries(searchIndex, "  ");
    expect(results).toEqual([]);
});

test("maps HTTP methods to intent tags", () => {
    expect({
        post: getApiMethodSearchTags("POST"),
        patch: getApiMethodSearchTags("PATCH"),
        del: getApiMethodSearchTags("DELETE"),
    }).toEqual({
        post: ["create", "add", "new", "send", "post"],
        patch: ["update", "edit", "modify", "patch"],
        del: ["delete", "remove", "destroy"],
    });
});

test("adds automatic API, blog, and author search tags without duplicates", () => {
    expect({
        api: createDocumentationSearchTags({type: "api", tags: ["API", "authentication"]}),
        blog: createDocumentationSearchTags({
            type: "blog",
            authorName: "Caleb Meredith",
            tags: ["Blog", "Product"],
        }),
    }).toEqual({
        api: ["api", "authentication"],
        blog: ["blog", "Caleb Meredith", "Product"],
    });
});
