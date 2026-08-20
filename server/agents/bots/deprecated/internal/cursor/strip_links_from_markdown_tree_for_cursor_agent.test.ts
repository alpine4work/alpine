import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {stripLinksFromMarkdownTreeForCursorAgent} from "~/server/agents/bots/deprecated/internal/cursor/strip_links_from_markdown_tree_for_cursor_agent.js";
import {printApiContentToAgentMarkdownTree} from "~/server/agents/bots/deprecated/internal/print_api_content_to_agent_markdown.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";
import {ApiContentWithoutKeys} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, DocumentId, TaskId} from "~/shared/id/types/id_types.open_source.js";

const storage = new DurableObjectStorage(new MemoryStorage());

afterEach(async () => {
    await storage.deleteAll();
});

describe("account mentions", () => {
    test("converts account mention to @ mention", async () => {
        const accountId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hello "},
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: accountId,
                                title: "Alice",
                                shortName: "Alice",
                            },
                        },
                        {type: "Text", text: ", can you help?"},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("Hello @Alice, can you help?\n");
    });

    test("converts multiple account mentions to @ mentions", async () => {
        const aliceId = generateId<AccountId>();
        const bobId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hey "},
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: aliceId,
                                title: "Alice",
                                shortName: "Alice",
                            },
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Mention",
                            reference: {type: "Account", id: bobId, title: "Bob", shortName: "Bob"},
                        },
                        {type: "Text", text: "!"},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("Hey @Alice and @Bob!\n");
    });

    test("account link kept as link when shouldKeepLink returns true", async () => {
        const accountId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Talk to "},
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: accountId,
                                title: "Charlie",
                                shortName: "Charlie",
                            },
                        },
                        {type: "Text", text: " about this."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        // When shouldKeepLink returns true, the link is kept (not stripped)
        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => true,
        });

        expect(printMarkdownTree(markdownTree)).toBe(
            "Talk to [Charlie](/account/charlie) about this.\n",
        );
    });

    test("converts Cursor agent mention to @Cursor", async () => {
        // This test verifies that Cursor mentions are presented as @Cursor which is
        // important context for the agent to know it's being addressed
        const cursorAccountId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hey "},
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: cursorAccountId,
                                title: "Cursor",
                                shortName: "Cursor",
                            },
                        },
                        {type: "Text", text: ", can you help me with this code?"},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe(
            "Hey @Cursor, can you help me with this code?\n",
        );
    });
});

describe("non-account links", () => {
    test("strips document links when shouldKeepLink returns false", async () => {
        const documentId = generateId<DocumentId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Check out "},
                        {
                            type: "Mention",
                            reference: {type: "Document", id: documentId, title: "Project Plan"},
                        },
                        {type: "Text", text: " for details."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        // Document link stripped without @ prefix (only account links get @)
        expect(printMarkdownTree(markdownTree)).toBe("Check out Project Plan for details.\n");
    });

    test("keeps document links when shouldKeepLink returns true", async () => {
        const documentId = generateId<DocumentId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Check out "},
                        {
                            type: "Mention",
                            reference: {type: "Document", id: documentId, title: "Project Plan"},
                        },
                        {type: "Text", text: " for details."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => true,
        });

        expect(printMarkdownTree(markdownTree)).toBe(
            "Check out [Project Plan](/document/project-plan) for details.\n",
        );
    });

    test("strips task links without @ prefix", async () => {
        const taskId = generateId<TaskId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Working on "},
                        {
                            type: "Mention",
                            reference: {
                                type: "Task",
                                id: taskId,
                                status: {type: "Open", isActive: false},
                                title: "Fix the bug",
                            },
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        // Non-account links don't get the @ prefix
        expect(printMarkdownTree(markdownTree)).toBe("Working on Fix the bug (Open).\n");
    });
});

describe("mixed content", () => {
    test("correctly handles mix of account and non-account links", async () => {
        const accountId = generateId<AccountId>();
        const documentId = generateId<DocumentId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: accountId,
                                title: "Alice",
                                shortName: "Alice",
                            },
                        },
                        {type: "Text", text: " should review "},
                        {
                            type: "Mention",
                            reference: {type: "Document", id: documentId, title: "Design Doc"},
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        // Account gets @ prefix, document doesn't
        expect(printMarkdownTree(markdownTree)).toBe("@Alice should review Design Doc.\n");
    });

    test("keeps specified links while stripping others", async () => {
        const accountId = generateId<AccountId>();
        const documentId = generateId<DocumentId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: accountId,
                                title: "Alice",
                                shortName: "Alice",
                            },
                        },
                        {type: "Text", text: " should review "},
                        {
                            type: "Mention",
                            reference: {type: "Document", id: documentId, title: "Design Doc"},
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        // Keep only document links
        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: link => link.url.startsWith("/document/"),
        });

        // Account is stripped with @ prefix, document is kept as link
        expect(printMarkdownTree(markdownTree)).toBe(
            "@Alice should review [Design Doc](/document/design-doc).\n",
        );
    });
});

describe("nested content", () => {
    test("strips links in nested list content", async () => {
        const accountId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Assigned to "},
                                        {
                                            type: "Mention",
                                            reference: {
                                                type: "Account",
                                                id: accountId,
                                                title: "Bob",
                                                shortName: "Bob",
                                            },
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

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("- Assigned to @Bob\n");
    });

    test("strips links in blockquotes", async () => {
        const accountId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Mention",
                                    reference: {
                                        type: "Account",
                                        id: accountId,
                                        title: "Eve",
                                        shortName: "Eve",
                                    },
                                },
                                {type: "Text", text: " said this."},
                            ],
                        },
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("> @Eve said this.\n");
    });

    test("strips links in headings", async () => {
        const accountId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Heading",
                    level: 2,
                    elements: [
                        {type: "Text", text: "Message from "},
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: accountId,
                                title: "Admin",
                                shortName: "Admin",
                            },
                        },
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("### Message from @Admin\n");
    });
});

describe("edge cases", () => {
    test("handles content with no links", async () => {
        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Just plain text."}],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("Just plain text.\n");
    });

    test("handles empty content", async () => {
        const content: ApiContentWithoutKeys = {
            elements: [],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("");
    });

    test("handles link at start of paragraph", async () => {
        const accountId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: accountId,
                                title: "Alice",
                                shortName: "Alice",
                            },
                        },
                        {type: "Text", text: " is here."},
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("@Alice is here.\n");
    });

    test("handles link at end of paragraph", async () => {
        const accountId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Ask "},
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: accountId,
                                title: "Bob",
                                shortName: "Bob",
                            },
                        },
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("Ask @Bob\n");
    });

    test("handles link as only content", async () => {
        const accountId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: accountId,
                                title: "Solo",
                                shortName: "Solo",
                            },
                        },
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("@Solo\n");
    });

    test("handles multiple consecutive account mentions", async () => {
        const aliceId = generateId<AccountId>();
        const bobId = generateId<AccountId>();
        const charlieId = generateId<AccountId>();

        const content: ApiContentWithoutKeys = {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: aliceId,
                                title: "Alice",
                                shortName: "Alice",
                            },
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Mention",
                            reference: {type: "Account", id: bobId, title: "Bob", shortName: "Bob"},
                        },
                        {type: "Text", text: " "},
                        {
                            type: "Mention",
                            reference: {
                                type: "Account",
                                id: charlieId,
                                title: "Charlie",
                                shortName: "Charlie",
                            },
                        },
                    ],
                },
            ],
        };

        const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);

        stripLinksFromMarkdownTreeForCursorAgent(markdownTree, {
            shouldKeepLink: () => false,
        });

        expect(printMarkdownTree(markdownTree)).toBe("@Alice @Bob @Charlie\n");
    });
});
