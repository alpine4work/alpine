import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {collectLinksFromMarkdownTreeForCursorAgent} from "~/server/agents/internal/cursor/collect_links_from_markdown_tree_for_cursor_agent.js";
import {printApiContentToAgentMarkdownTree} from "~/server/agents/internal/print_api_content_to_agent_markdown.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/content/into_api_content.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChannelId, DocumentId, TaskId} from "~/shared/id/types/id_types.js";

const storage = new DurableObjectStorage(new MemoryStorage());

afterEach(async () => {
    await storage.deleteAll();
});

describe("account mentions", () => {
    test("ignores account links", async () => {
        const accountId = generateId<AccountId>();

        const content: ApiContentResponseWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hello "},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: "Alice",
                        },
                        {type: "Text", text: ", can you help?"},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        // The markdown tree has the mention as a link with /account/ prefix
        expect(printMarkdownTree(markdownTree)).toContain("[Alice](/account/alice)");

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        // Account links should be ignored (not collected)
        expect(linkLabelByUrl.size).toBe(0);
    });

    test("ignores multiple account mentions", async () => {
        const aliceId = generateId<AccountId>();
        const bobId = generateId<AccountId>();

        const content: ApiContentResponseWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hey "},
                        {
                            type: "Mention",
                            target: {type: "Account", id: aliceId},
                            title: "Alice",
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Mention",
                            target: {type: "Account", id: bobId},
                            title: "Bob",
                        },
                        {type: "Text", text: "!"},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        expect(linkLabelByUrl.size).toBe(0);
    });
});

describe("non-account links", () => {
    test("collects document links", async () => {
        const documentId = generateId<DocumentId>();

        const content: ApiContentResponseWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Check out "},
                        {
                            type: "Mention",
                            target: {type: "Document", id: documentId},
                            title: "Project Plan",
                        },
                        {type: "Text", text: " for details."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        expect(linkLabelByUrl.size).toBe(1);
        expect(linkLabelByUrl.get("/document/project-plan")).toBe("Project Plan");
    });

    test("collects task links", async () => {
        const taskId = generateId<TaskId>();

        const content: ApiContentResponseWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Working on "},
                        {
                            type: "Mention",
                            target: {
                                type: "Task",
                                id: taskId,
                                status: {type: "Open", isActive: false},
                            },
                            title: "Fix the bug",
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        expect(linkLabelByUrl.size).toBe(1);
        // Task links include the status in the label
        expect(linkLabelByUrl.get("/task/fix-the-bug")).toBe("Fix the bug (Open)");
    });

    test("collects channel links", async () => {
        const channelId = generateId<ChannelId>();

        const content: ApiContentResponseWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Join "},
                        {
                            type: "Mention",
                            target: {type: "Channel", id: channelId},
                            title: "Engineering",
                        },
                        {type: "Text", text: " for updates."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        expect(linkLabelByUrl.size).toBe(1);
        expect(linkLabelByUrl.get("/channel/engineering")).toBe("Engineering");
    });

    test("collects mixed links but ignores account links", async () => {
        const accountId = generateId<AccountId>();
        const documentId = generateId<DocumentId>();
        const taskId = generateId<TaskId>();

        const content: ApiContentResponseWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: "Alice",
                        },
                        {type: "Text", text: " should review "},
                        {
                            type: "Mention",
                            target: {type: "Document", id: documentId},
                            title: "Design Doc",
                        },
                        {type: "Text", text: " for "},
                        {
                            type: "Mention",
                            target: {
                                type: "Task",
                                id: taskId,
                                status: {type: "Open", isActive: false},
                            },
                            title: "Implement feature",
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        // Should collect document and task links, but not account link
        expect(linkLabelByUrl.size).toBe(2);
        expect(linkLabelByUrl.has("/document/design-doc")).toBe(true);
        expect(linkLabelByUrl.has("/task/implement-feature")).toBe(true);

        // Account link should not be collected
        for (const url of linkLabelByUrl.keys()) {
            expect(url.startsWith("/account/")).toBe(false);
        }
    });
});

describe("nested content", () => {
    test("collects links from nested content like lists", async () => {
        const documentId = generateId<DocumentId>();

        const content: ApiContentResponseWithoutKeys = {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "See "},
                                        {
                                            type: "Mention",
                                            target: {type: "Document", id: documentId},
                                            title: "Nested Doc",
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        expect(linkLabelByUrl.size).toBe(1);
        expect(linkLabelByUrl.get("/document/nested-doc")).toBe("Nested Doc");
    });

    test("collects links from blockquotes", async () => {
        const documentId = generateId<DocumentId>();

        const content: ApiContentResponseWithoutKeys = {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "From "},
                                {
                                    type: "Mention",
                                    target: {type: "Document", id: documentId},
                                    title: "Quoted Source",
                                },
                            ],
                        },
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        expect(linkLabelByUrl.size).toBe(1);
        expect(linkLabelByUrl.get("/document/quoted-source")).toBe("Quoted Source");
    });
});

describe("edge cases", () => {
    test("returns empty map for content with no links", async () => {
        const content: ApiContentResponseWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Just plain text."}],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        expect(linkLabelByUrl.size).toBe(0);
    });

    test("returns empty map for empty content", async () => {
        const content: ApiContentResponseWithoutKeys = {
            elements: [],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        expect(linkLabelByUrl.size).toBe(0);
    });

    test("handles links with styled text", async () => {
        const documentId = generateId<DocumentId>();

        const content: ApiContentResponseWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Document", id: documentId},
                            title: "Important Doc",
                            marks: [{type: "Bold"}],
                        },
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        const linkLabelByUrl = collectLinksFromMarkdownTreeForCursorAgent(markdownTree);

        expect(linkLabelByUrl.size).toBe(1);
        expect(linkLabelByUrl.get("/document/important-doc")).toBe("Important Doc");
    });
});
