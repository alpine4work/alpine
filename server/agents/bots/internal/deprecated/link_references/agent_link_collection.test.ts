import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {AgentDocumentPageLink} from "~/server/agents/bots/internal/deprecated/link_references/agent_link.js";
import {
    CreateAgentLinkOptions,
    createAgentLink,
    findAgentLinkForApiPath,
    getAgentLink,
    normalizeMarkdownLinkLabelForPath,
    putAgentDocumentPageLink,
    putAgentNextMessagesPageLink,
} from "~/server/agents/bots/internal/deprecated/link_references/agent_link_collection.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
    printApiPathForAgentLink,
} from "~/server/agents/bots/internal/deprecated/link_references/print_agent_link_path.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

const storage = new DurableObjectStorage(new MemoryStorage());

afterEach(async () => {
    await storage.deleteAll();
});

const documentId = generateId<DocumentId>();
const commentThreadId = generateId<DocumentCommentThreadId>();
const chatId = generateId<ChatId>();

describe("normalizeMarkdownLinkLabelForPath", () => {
    describe("basic normalization", () => {
        test("converts spaces to hyphens", () => {
            expect(normalizeMarkdownLinkLabelForPath("My Document")).toBe("my-document");
        });

        test("converts to lowercase", () => {
            expect(normalizeMarkdownLinkLabelForPath("UPPERCASE TEXT")).toBe("uppercase-text");
        });

        test("handles mixed case", () => {
            expect(normalizeMarkdownLinkLabelForPath("My Document Title")).toBe(
                "my-document-title",
            );
        });

        test("trims leading and trailing whitespace", () => {
            expect(normalizeMarkdownLinkLabelForPath("  my document  ")).toBe("my-document");
        });

        test("replaces ampersands with \u201Cand\u201D", () => {
            expect(normalizeMarkdownLinkLabelForPath("D&D Notes")).toBe("d-and-d-notes");
        });

        test("replaces multiple ampersands with \u201Cand\u201D when surrounded by spaces", () => {
            expect(
                normalizeMarkdownLinkLabelForPath(
                    "Texas A & M is playing North Carolina A & T this weekend",
                ),
            ).toBe("texas-a-and-m-is-playing-north-carolina-a-and-t-th");
        });
    });

    describe("special character handling", () => {
        test("removes special characters", () => {
            expect(normalizeMarkdownLinkLabelForPath("My Document!@#$%^*()")).toBe("my-document");
        });

        test("preserves hyphens", () => {
            expect(normalizeMarkdownLinkLabelForPath("already-has-hyphens")).toBe(
                "already-has-hyphens",
            );
        });

        test("removes punctuation", () => {
            expect(normalizeMarkdownLinkLabelForPath("Document, with: punctuation.")).toBe(
                "document-with-punctuation",
            );
        });

        test("removes brackets and parentheses", () => {
            expect(normalizeMarkdownLinkLabelForPath("Document [with] (brackets)")).toBe(
                "document-with-brackets",
            );
        });

        test("removes quotes", () => {
            expect(normalizeMarkdownLinkLabelForPath("Document \u201Cwith\u201D quotes")).toBe(
                "document-with-quotes",
            );
        });
    });

    describe("whitespace handling", () => {
        test("collapses multiple spaces to single hyphen", () => {
            expect(normalizeMarkdownLinkLabelForPath("multiple    spaces    here")).toBe(
                "multiple-spaces-here",
            );
        });

        test("normalizes tabs and newlines", () => {
            expect(normalizeMarkdownLinkLabelForPath("text\twith\ttabs\nand\nnewlines")).toBe(
                "text-with-tabs-and-newlines",
            );
        });

        test("handles leading/trailing spaces with special characters but has content", () => {
            expect(normalizeMarkdownLinkLabelForPath("  !@# Document $%^  ")).toBe("document");
        });

        test("returns untitled for only special characters and spaces", () => {
            expect(normalizeMarkdownLinkLabelForPath("  !@# $%^  ")).toBe("untitled");
        });
    });

    describe("hyphen handling", () => {
        test("collapses multiple hyphens to single hyphen", () => {
            expect(normalizeMarkdownLinkLabelForPath("multiple---hyphens---here")).toBe(
                "multiple-hyphens-here",
            );
        });

        test("handles mixed spaces and hyphens", () => {
            expect(normalizeMarkdownLinkLabelForPath("text - with - spaced - hyphens")).toBe(
                "text-with-spaced-hyphens",
            );
        });

        test("removes leading hyphen created from special characters", () => {
            expect(normalizeMarkdownLinkLabelForPath("!@# Document")).toBe("document");
        });
    });

    describe("maxLength option", () => {
        test("truncates to maxLength when specified", () => {
            const result = normalizeMarkdownLinkLabelForPath("This is a very long document title", {
                maxLength: 10,
            });
            expect(result).toBe("this-is-a");
            expect(result.length).toBeLessThanOrEqual(10);
        });

        test("removes trailing hyphens after truncation", () => {
            const result = normalizeMarkdownLinkLabelForPath("my document title", {maxLength: 11});
            expect(result).toBe("my-document");
            expect(result).not.toMatch(/-$/);
        });

        test("removes trailing spaces after truncation", () => {
            const result = normalizeMarkdownLinkLabelForPath("test document", {maxLength: 5});
            expect(result).toBe("test");
            expect(result).not.toMatch(/\s$/);
        });

        test("does not truncate when length is under maxLength", () => {
            expect(normalizeMarkdownLinkLabelForPath("short", {maxLength: 10})).toBe("short");
        });

        test("handles exact maxLength match", () => {
            const result = normalizeMarkdownLinkLabelForPath("exactly10c", {maxLength: 10});
            expect(result).toBe("exactly10c");
            expect(result.length).toBe(10);
        });

        test("handles maxLength with multiple trailing hyphens", () => {
            const result = normalizeMarkdownLinkLabelForPath("word-word-word-word", {
                maxLength: 10,
            });
            expect(result).toBe("word-word");
            expect(result).not.toMatch(/-$/);
        });
    });

    describe("edge cases", () => {
        test("handles empty string", () => {
            expect(normalizeMarkdownLinkLabelForPath("")).toBe("untitled");
        });

        test("handles string with only spaces", () => {
            expect(normalizeMarkdownLinkLabelForPath("     ")).toBe("untitled");
        });

        test("handles string with only special characters", () => {
            expect(normalizeMarkdownLinkLabelForPath("!@#$%^*()")).toBe("untitled");
        });

        test("handles string with only hyphens", () => {
            expect(normalizeMarkdownLinkLabelForPath("---")).toBe("untitled");
        });

        test("handles single character", () => {
            expect(normalizeMarkdownLinkLabelForPath("a")).toBe("a");
        });

        test("handles numbers", () => {
            expect(normalizeMarkdownLinkLabelForPath("Document 123")).toBe("document-123");
        });

        test("handles underscores", () => {
            expect(normalizeMarkdownLinkLabelForPath("my-document-title")).toBe(
                "my-document-title",
            );
        });

        test("preserves numbers and underscores", () => {
            expect(normalizeMarkdownLinkLabelForPath("Bug-Report-2024-01")).toBe(
                "bug-report-2024-01",
            );
        });
    });

    describe("real-world examples", () => {
        test("normalizes typical document title", () => {
            expect(normalizeMarkdownLinkLabelForPath("Q3 Financial Report")).toBe(
                "q3-financial-report",
            );
        });

        test("normalizes title with version number", () => {
            expect(normalizeMarkdownLinkLabelForPath("Design Doc v2.1")).toBe("design-doc-v2-1");
        });

        test("normalizes user-generated content", () => {
            expect(normalizeMarkdownLinkLabelForPath("How do I...? (FAQ)")).toBe("how-do-i-faq");
        });

        test("normalizes email-like content", () => {
            expect(normalizeMarkdownLinkLabelForPath("user@example.com feedback")).toBe(
                "user-example-com-feedback",
            );
        });

        test("normalizes path-like strings", () => {
            expect(normalizeMarkdownLinkLabelForPath("/path/to/document")).toBe("path-to-document");
        });

        test("normalizes with maxLength for long titles", () => {
            const result = normalizeMarkdownLinkLabelForPath(
                "This is a very long document title that needs to be shortened",
                {maxLength: 30},
            );
            expect(result).toBe("this-is-a-very-long-document-t");
            expect(result.length).toBeLessThanOrEqual(30);
        });
    });

    describe("unicode and international characters", () => {
        test("removes accented characters", () => {
            expect(normalizeMarkdownLinkLabelForPath("Caf� Document")).toBe("caf-document");
        });

        test("removes emoji", () => {
            expect(normalizeMarkdownLinkLabelForPath("Document =� Title")).toBe("document-title");
        });

        test("removes non-ASCII characters", () => {
            expect(normalizeMarkdownLinkLabelForPath("Document �,� Title")).toBe("document-title");
        });
    });

    describe("consistency", () => {
        test("produces same result for equivalent inputs", () => {
            const inputs = [
                "My Document",
                "my document",
                "MY DOCUMENT",
                "  my   document  ",
                "my-document",
            ];
            const results = inputs.map(input => normalizeMarkdownLinkLabelForPath(input));
            expect(new Set(results).size).toBe(1);
            expect(results[0]).toBe("my-document");
        });

        test("handles idempotency", () => {
            const label = "My Document Title";
            const normalized = normalizeMarkdownLinkLabelForPath(label);
            const doubleNormalized = normalizeMarkdownLinkLabelForPath(normalized);
            expect(normalized).toBe(doubleNormalized);
        });
    });

    describe("untitled fallback", () => {
        test("returns untitled for empty string", () => {
            expect(normalizeMarkdownLinkLabelForPath("")).toBe("untitled");
        });

        test("returns untitled when all characters are stripped", () => {
            expect(normalizeMarkdownLinkLabelForPath("@#$%^*()")).toBe("untitled");
        });

        test("returns untitled for whitespace only", () => {
            expect(normalizeMarkdownLinkLabelForPath("   \t\n   ")).toBe("untitled");
        });

        test("returns untitled for special characters and whitespace mix", () => {
            expect(normalizeMarkdownLinkLabelForPath("  @@@ ### $$$ %%%  ")).toBe("untitled");
        });

        test("returns untitled when maxLength truncates to only hyphens", () => {
            const result = normalizeMarkdownLinkLabelForPath("!-!", {maxLength: 1});
            expect(result).toBe("untitled");
        });

        test("does not return untitled for valid short strings", () => {
            expect(normalizeMarkdownLinkLabelForPath("a")).toBe("a");
            expect(normalizeMarkdownLinkLabelForPath("1")).toBe("1");
        });

        test("untitled is returned for emoji-only string", () => {
            expect(normalizeMarkdownLinkLabelForPath("🚀 💻 🎉")).toBe("untitled");
        });

        test("untitled is returned for unicode-only string", () => {
            expect(normalizeMarkdownLinkLabelForPath("日本語")).toBe("untitled");
        });
    });
});

describe("getAgentLink", () => {
    test("retrieves existing link reference", async () => {
        const documentId = generateId<DocumentId>();

        const created = await createAgentLink(storage, {
            type: "Document",
            document: {
                id: documentId,
                title: "My Document",
            },
        });
        const retrieved = await getAgentLink(storage, printAgentLinkPath(created));

        expect(retrieved).toBeDefined();
        expect(retrieved).toEqual(created);
    });

    test("returns undefined for non-existent path", async () => {
        const result = await getAgentLink(storage, "/document/non-existent");

        expect(result).toBeUndefined();
    });

    test("retrieves deduplicated link correctly", async () => {
        const doc1Id = generateId<DocumentId>();
        const doc2Id = generateId<DocumentId>();

        await createAgentLink(storage, {
            type: "Document",
            document: {
                id: doc1Id,
                title: "Doc",
            },
        });

        await createAgentLink(storage, {
            type: "Document",
            document: {
                id: doc2Id,
                title: "Doc",
            },
        });

        const retrieved = await getAgentLink(storage, "/document/doc-2");

        expect(retrieved).toBeDefined();
        assert(retrieved?.type === "DocumentPage");
        expect(retrieved.dedupeNumber).toBe(2);
        expect(retrieved.localDocumentPage).toBeNull();
    });
});

describe("findAgentLinkForApiPath", () => {
    test("finds link by target path", async () => {
        const documentId = generateId<DocumentId>();

        const created = await createAgentLink(storage, {
            type: "Document",
            document: {
                id: documentId,
                title: "My Document",
            },
        });

        const found = await findAgentLinkForApiPath(storage, printApiPathForAgentLink(created));

        expect(printAgentLinkPath(found)).toBe("/document/my-document");
        expect(printAgentPlainTextLabel(found)).toBe("My Document");
    });

    test("finds deduplicated link by target path", async () => {
        const doc1Id = generateId<DocumentId>();
        const doc2Id = generateId<DocumentId>();

        await createAgentLink(storage, {
            type: "Document",
            document: {
                id: doc1Id,
                title: "My Document",
            },
        });

        const doc2 = await createAgentLink(storage, {
            type: "Document",
            document: {
                id: doc2Id,
                title: "My Document",
            },
        });

        const found = await findAgentLinkForApiPath(storage, printApiPathForAgentLink(doc2));

        expect(printAgentLinkPath(found)).toBe("/document/my-document-2");
    });

    test("throws error when link not found", async () => {
        const nonExistentLink: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId: generateId<DocumentId>(),
            title: "Non-existent",
            localDocumentPage: null,
        };
        await expect(
            findAgentLinkForApiPath(storage, printApiPathForAgentLink(nonExistentLink)),
        ).rejects.toThrow("Link not found");
    });

    test("finds correct link among multiple links", async () => {
        const doc1Id = generateId<DocumentId>();
        const doc2Id = generateId<DocumentId>();
        const doc3Id = generateId<DocumentId>();

        await createAgentLink(storage, {
            type: "Document",
            document: {
                id: doc1Id,
                title: "Doc A",
            },
        });

        const doc2 = await createAgentLink(storage, {
            type: "Document",
            document: {
                id: doc2Id,
                title: "Doc B",
            },
        });

        await createAgentLink(storage, {
            type: "Document",
            document: {
                id: doc3Id,
                title: "Doc C",
            },
        });

        const found = await findAgentLinkForApiPath(storage, printApiPathForAgentLink(doc2));

        expect(printAgentLinkPath(found)).toBe("/document/doc-b");
    });
});

describe("createAgentLink", () => {
    describe("creates messages list for message content", () => {
        describe("ChatMessage", () => {
            test("creates chat message link", async () => {
                const link: CreateAgentLinkOptions = {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 5,
                    preview: "Ian: hello world",
                };

                const result = await createAgentLink(storage, link);

                expect(printAgentLinkPath(result)).toBe("/chat/ian-hello-world");
                expect(printAgentPlainTextLabel(result)).toBe("Ian: hello world");
                expect(result.type).toBe("ChatMessages");
            });

            test("deduplicates chat messages with same label", async () => {
                const link1: CreateAgentLinkOptions = {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 5,
                    preview: "Ian: hello world",
                };

                const link2: CreateAgentLinkOptions = {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 8,
                    preview: "Ian: hello world",
                };

                const result1 = await createAgentLink(storage, link1);
                const result2 = await createAgentLink(storage, link2);

                expect(printAgentLinkPath(result1)).toBe("/chat/ian-hello-world");
                expect(printAgentLinkPath(result2)).toBe("/chat/ian-hello-world-2");
            });

            test("returns same link for identical chat message", async () => {
                const link: CreateAgentLinkOptions = {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 5,
                    preview: "Ian: hello world",
                };

                const result1 = await createAgentLink(storage, link);
                const result2 = await createAgentLink(storage, link);

                expect(printAgentLinkPath(result1)).toBe(printAgentLinkPath(result2));
                expect(printAgentLinkPath(result1)).toBe("/chat/ian-hello-world");
            });

            // See #dedupe-message-labels for more information on the deduplication of pages
            // and chat messages with the same label.
            test("deduplicates pages and labels for chat messages with same label", async () => {
                const chatId2 = generateId<ChatId>();
                const chatMessageLink1: CreateAgentLinkOptions = {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 0,
                    preview: "Ian: hello world",
                };
                const chatMessageLink2: CreateAgentLinkOptions = {
                    type: "ChatMessage",
                    chatId: chatId2,
                    messageIndex: 0,
                    preview: "Ian: hello world",
                };

                const chatMessage1 = await createAgentLink(storage, chatMessageLink1);
                const chatMessage2 = await createAgentLink(storage, chatMessageLink2);
                expect(printAgentLinkPath(chatMessage1)).toBe("/chat/ian-hello-world");
                expect(printAgentLinkPath(chatMessage2)).toBe("/chat/ian-hello-world-2");

                assert(chatMessage1.type === "ChatMessages");
                const chatMessage1Page2Link = await putAgentNextMessagesPageLink(
                    storage,
                    chatMessage1,
                    10,
                );
                expect(chatMessage1Page2Link).toEqual({
                    ...chatMessage1,
                    pageNumber: 2,
                    pageInfo: {from: "Start", cursor: 10},
                    rootMessage: {
                        dedupeNumber: 1,
                    },
                    tokenLimitForPage: 1500, // 1000 \* 1.5
                });
                expect(printAgentLinkPath(chatMessage1Page2Link)).toBe(
                    "/chat/ian-hello-world?page=2",
                );

                assert(chatMessage2.type === "ChatMessages");
                const chatMessage2Page2Link = await putAgentNextMessagesPageLink(
                    storage,
                    chatMessage2,
                    10,
                );
                expect(chatMessage2Page2Link).toEqual({
                    ...chatMessage2,
                    dedupeNumber: undefined,
                    pageNumber: 2,
                    pageInfo: {from: "Start", cursor: 10},
                    rootMessage: {
                        dedupeNumber: 2,
                    },
                    tokenLimitForPage: 1500, // 1000 \* 1.5
                });
                expect(printAgentLinkPath(chatMessage2Page2Link)).toBe(
                    "/chat/ian-hello-world-2?page=2",
                );

                const chatMessage1Page2WithNewStartIndex = await putAgentNextMessagesPageLink(
                    storage,
                    chatMessage1,
                    15,
                );
                expect(chatMessage1Page2WithNewStartIndex).toEqual({
                    ...chatMessage1,
                    pageNumber: 2,
                    pageInfo: {from: "Start", cursor: 15},
                    rootMessage: {
                        dedupeNumber: 1,
                    },
                    dedupeNumber: 2,
                    tokenLimitForPage: 1500, // 1000 \* 1.5
                });
                expect(printAgentLinkPath(chatMessage1Page2WithNewStartIndex)).toBe(
                    "/chat/ian-hello-world?page=2&version=2",
                );

                const chatMessage2Page2WithNewStartIndex = await putAgentNextMessagesPageLink(
                    storage,
                    chatMessage2,
                    15,
                );
                expect(chatMessage2Page2WithNewStartIndex).toEqual({
                    ...chatMessage2,
                    pageNumber: 2,
                    pageInfo: {from: "Start", cursor: 15},
                    rootMessage: {
                        dedupeNumber: 2,
                    },
                    dedupeNumber: 2,
                    tokenLimitForPage: 1500, // 1000 \* 1.5
                });
                expect(printAgentLinkPath(chatMessage2Page2WithNewStartIndex)).toBe(
                    "/chat/ian-hello-world-2?page=2&version=2",
                );
            });

            // See #dedupe-message-labels for more information on the deduplication of pages
            // and chat messages with the same label.
            test("deduplicates chunks and labels for chat messages with same label", async () => {
                const chatId2 = generateId<ChatId>();
                const chatMessageLink1: CreateAgentLinkOptions = {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 2,
                    preview: "Ian: hello world",
                };
                const chatMessageLink2: CreateAgentLinkOptions = {
                    type: "ChatMessage",
                    chatId: chatId2,
                    messageIndex: 3,
                    preview: "Ian: hello world",
                };

                const chatMessage1 = await createAgentLink(storage, chatMessageLink1);
                const chatMessage2 = await createAgentLink(storage, chatMessageLink2);
                expect(printAgentLinkPath(chatMessage1)).toBe("/chat/ian-hello-world");
                expect(printAgentLinkPath(chatMessage2)).toBe("/chat/ian-hello-world-2");

                assert(chatMessage1.type === "ChatMessages");
                const chatMessage1Page2Link = await putAgentNextMessagesPageLink(
                    storage,
                    chatMessage1,
                    10,
                );
                expect(chatMessage1Page2Link).toEqual({
                    ...chatMessage1,
                    pageNumber: 1,
                    pageInfo: {from: "Start", cursor: 10},
                    rootMessage: {
                        dedupeNumber: 1,
                    },
                    tokenLimitForPage: 1500, // 1000 \* 1.5
                });
                expect(printAgentLinkPath(chatMessage1Page2Link)).toBe(
                    "/chat/ian-hello-world?chunk=1",
                );

                assert(chatMessage2.type === "ChatMessages");
                const chatMessage2Page2Link = await putAgentNextMessagesPageLink(
                    storage,
                    chatMessage2,
                    10,
                );
                expect(chatMessage2Page2Link).toEqual({
                    ...chatMessage2,
                    dedupeNumber: undefined,
                    pageNumber: 1,
                    pageInfo: {from: "Start", cursor: 10},
                    rootMessage: {
                        dedupeNumber: 2,
                    },
                    tokenLimitForPage: 1500, // 1000 \* 1.5
                });
                expect(printAgentLinkPath(chatMessage2Page2Link)).toBe(
                    "/chat/ian-hello-world-2?chunk=1",
                );

                const chatMessage1Page2WithNewStartIndex = await putAgentNextMessagesPageLink(
                    storage,
                    chatMessage1,
                    15,
                );
                expect(chatMessage1Page2WithNewStartIndex).toEqual({
                    ...chatMessage1,
                    pageNumber: 1,
                    pageInfo: {from: "Start", cursor: 15},
                    rootMessage: {
                        dedupeNumber: 1,
                    },
                    dedupeNumber: 2,
                    tokenLimitForPage: 1500, // 1000 \* 1.5
                });
                expect(printAgentLinkPath(chatMessage1Page2WithNewStartIndex)).toBe(
                    "/chat/ian-hello-world?chunk=1&version=2",
                );

                const chatMessage2Page2WithNewStartIndex = await putAgentNextMessagesPageLink(
                    storage,
                    chatMessage2,
                    15,
                );
                expect(chatMessage2Page2WithNewStartIndex).toEqual({
                    ...chatMessage2,
                    pageNumber: 1,
                    pageInfo: {from: "Start", cursor: 15},
                    rootMessage: {
                        dedupeNumber: 2,
                    },
                    dedupeNumber: 2,
                    tokenLimitForPage: 1500, // 1000 \* 1.5
                });
                expect(printAgentLinkPath(chatMessage2Page2WithNewStartIndex)).toBe(
                    "/chat/ian-hello-world-2?chunk=1&version=2",
                );
            });
        });

        describe("DocumentComment", () => {
            test("creates document comment with parent document and thread", async () => {
                const link: CreateAgentLinkOptions = {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 3,
                    preview: "Ian: great point!",
                };

                const result = await createAgentLink(storage, link);

                expect(printAgentLinkPath(result)).toBe("/document-thread/ian-great-point");
                expect(printAgentPlainTextLabel(result)).toBe("Ian: great point!");
            });

            test("deduplicates comments with same label on same thread", async () => {
                const link1: CreateAgentLinkOptions = {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 0,
                    preview: "Alice: I agree",
                };

                const link2: CreateAgentLinkOptions = {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 5,
                    preview: "Alice: I agree",
                };

                const result1 = await createAgentLink(storage, link1);
                const result2 = await createAgentLink(storage, link2);

                expect(printAgentLinkPath(result1)).toBe("/document-thread/alice-i-agree");
                expect(printAgentLinkPath(result2)).toBe("/document-thread/alice-i-agree-2");
            });

            test("deduplicates comments with same label regardless of thread", async () => {
                const link1: CreateAgentLinkOptions = {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 0,
                    preview: "Alice: I agree",
                };

                const link2: CreateAgentLinkOptions = {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId: generateId<DocumentCommentThreadId>(),
                    commentIndex: 5,
                    preview: "Alice: I agree",
                };

                const result1 = await createAgentLink(storage, link1);
                const result2 = await createAgentLink(storage, link2);

                expect(printAgentLinkPath(result1)).toBe("/document-thread/alice-i-agree");
                expect(printAgentLinkPath(result2)).toBe("/document-thread/alice-i-agree-2");
            });

            test("deduplicates comments with same label regardless of document", async () => {
                const link1: CreateAgentLinkOptions = {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 0,
                    preview: "Alice: I agree",
                };

                const link2: CreateAgentLinkOptions = {
                    type: "DocumentComment",
                    documentId: generateId<DocumentId>(),
                    commentThreadId: generateId<DocumentCommentThreadId>(),
                    commentIndex: 5,
                    preview: "Alice: I agree",
                };

                const result1 = await createAgentLink(storage, link1);
                const result2 = await createAgentLink(storage, link2);

                expect(printAgentLinkPath(result1)).toBe("/document-thread/alice-i-agree");
                expect(printAgentLinkPath(result2)).toBe("/document-thread/alice-i-agree-2");
            });

            test("returns same link for identical comment", async () => {
                const link: CreateAgentLinkOptions = {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 0,
                    preview: "Alice: comment",
                };

                const result1 = await createAgentLink(storage, link);
                const result2 = await createAgentLink(storage, link);

                expect(printAgentLinkPath(result1)).toBe(printAgentLinkPath(result2));
                expect(printAgentLinkPath(result1)).toBe("/document-thread/alice-comment");
            });
        });

        describe("PostComment", () => {
            test("creates post message with parent post", async () => {
                const postId = generateId<PostId>();
                const link: CreateAgentLinkOptions = {
                    type: "PostComment",
                    postId,
                    commentIndex: 7,
                    preview: "Bob: nice update",
                };

                const result = await createAgentLink(storage, link);

                expect(printAgentLinkPath(result)).toBe("/post/bob-nice-update");
                expect(printAgentPlainTextLabel(result)).toBe("Bob: nice update");
            });

            test("deduplicates post messages with same label", async () => {
                const postId = generateId<PostId>();
                const link1: CreateAgentLinkOptions = {
                    type: "PostComment",
                    postId,
                    commentIndex: 1,
                    preview: "Alice: thanks!",
                };

                const link2: CreateAgentLinkOptions = {
                    type: "PostComment",
                    postId,
                    commentIndex: 5,
                    preview: "Alice: thanks!",
                };

                const result1 = await createAgentLink(storage, link1);
                const result2 = await createAgentLink(storage, link2);

                expect(printAgentLinkPath(result1)).toBe("/post/alice-thanks");
                expect(printAgentLinkPath(result2)).toBe("/post/alice-thanks-2");
            });

            test("returns same link for identical post message", async () => {
                const postId = generateId<PostId>();
                const link: CreateAgentLinkOptions = {
                    type: "PostComment",
                    postId,
                    commentIndex: 3,
                    preview: "Bob: comment",
                };

                const result1 = await createAgentLink(storage, link);
                const result2 = await createAgentLink(storage, link);

                expect(printAgentLinkPath(result1)).toBe(printAgentLinkPath(result2));
                expect(printAgentLinkPath(result1)).toBe("/post/bob-comment");
            });
        });

        describe("TaskComment", () => {
            test("creates task message with parent task", async () => {
                const taskId = generateId<TaskId>();
                const link: CreateAgentLinkOptions = {
                    type: "TaskComment",
                    taskId,
                    commentIndex: 2,
                    preview: "Alice: working on it",
                };

                const result = await createAgentLink(storage, link);

                expect(printAgentLinkPath(result)).toBe("/task-comments/alice-working-on-it");
                expect(printAgentPlainTextLabel(result)).toBe("Alice: working on it");
            });

            test("deduplicates task messages with same label", async () => {
                const taskId = generateId<TaskId>();
                const link1: CreateAgentLinkOptions = {
                    type: "TaskComment",
                    taskId,
                    commentIndex: 0,
                    preview: "Bob: on it",
                };

                const link2: CreateAgentLinkOptions = {
                    type: "TaskComment",
                    taskId,
                    commentIndex: 3,
                    preview: "Bob: on it",
                };

                const result1 = await createAgentLink(storage, link1);
                const result2 = await createAgentLink(storage, link2);

                expect(printAgentLinkPath(result1)).toBe("/task-comments/bob-on-it");
                expect(printAgentLinkPath(result2)).toBe("/task-comments/bob-on-it-2");
            });

            test("returns same link for identical task message", async () => {
                const taskId = generateId<TaskId>();
                const link: CreateAgentLinkOptions = {
                    type: "TaskComment",
                    taskId,
                    commentIndex: 1,
                    preview: "Ian: update",
                };

                const result1 = await createAgentLink(storage, link);
                const result2 = await createAgentLink(storage, link);

                expect(printAgentLinkPath(result1)).toBe(printAgentLinkPath(result2));
                expect(printAgentLinkPath(result1)).toBe("/task-comments/ian-update");
            });
        });
    });

    describe("creates static links for static content", () => {
        describe("root entities", () => {
            test("creates account link", async () => {
                const accountId = generateId<AccountId>();

                const result = await createAgentLink(storage, {
                    type: "Account",
                    account: {
                        id: accountId,
                        name: "Alice Smith",
                    },
                });

                expect(printAgentLinkPath(result)).toBe("/account/alice-smith");
                expect(printAgentPlainTextLabel(result)).toBe("Alice Smith");
            });

            test("creates channel link", async () => {
                const channelId = generateId<ChannelId>();

                const result = await createAgentLink(storage, {
                    type: "Channel",
                    channel: {
                        id: channelId,
                        name: "General",
                    },
                });

                expect(printAgentLinkPath(result)).toBe("/channel/general");
                expect(printAgentPlainTextLabel(result)).toBe("General");
            });

            test("creates document link", async () => {
                const result = await createAgentLink(storage, {
                    type: "Document",
                    document: {
                        id: documentId,
                        title: "My Document",
                    },
                });

                expect(printAgentLinkPath(result)).toBe("/document/my-document");
                expect(printAgentPlainTextLabel(result)).toBe("My Document");
            });

            test("creates post link", async () => {
                const postId = generateId<PostId>();

                const result = await createAgentLink(storage, {
                    type: "Post",
                    post: {
                        id: postId,
                        contentPreview: "Quarterly Results",
                    },
                });

                expect(printAgentLinkPath(result)).toBe("/post/quarterly-results");
                expect(printAgentPlainTextLabel(result)).toBe("Quarterly Results");
            });

            test("creates inactive task link", async () => {
                const taskId = generateId<TaskId>();

                const result = await createAgentLink(storage, {
                    type: "Task",
                    task: {
                        id: taskId,
                        title: "Fix Bug #123",
                        status: {type: "Open", isActive: false},
                    },
                });

                expect(printAgentLinkPath(result)).toBe("/task/fix-bug-123");
                expect(printAgentPlainTextLabel(result)).toBe("Fix Bug #123 (Open)");
            });

            test("creates active task link", async () => {
                const taskId = generateId<TaskId>();

                const result = await createAgentLink(storage, {
                    type: "Task",
                    task: {
                        id: taskId,
                        title: "Fix Bug #123",
                        status: {type: "Open", isActive: true},
                    },
                });

                expect(printAgentLinkPath(result)).toBe("/task/fix-bug-123");
                expect(printAgentPlainTextLabel(result)).toBe("Fix Bug #123 (Open)");
            });

            test("creates completed task link", async () => {
                const taskId = generateId<TaskId>();

                const result = await createAgentLink(storage, {
                    type: "Task",
                    task: {
                        id: taskId,
                        title: "Fix Bug #123",
                        status: {type: "Closed"},
                    },
                });

                expect(printAgentLinkPath(result)).toBe("/task/fix-bug-123");
                expect(printAgentPlainTextLabel(result)).toBe("Fix Bug #123 (Closed)");
            });

            test("creates task collection link", async () => {
                const collectionId = generateId<TaskCollectionId>();

                const result = await createAgentLink(storage, {
                    type: "TaskCollection",
                    taskCollection: {
                        id: collectionId,
                        name: "Product Launch",
                    },
                });

                expect(printAgentLinkPath(result)).toBe("/task-collection/product-launch");
                expect(printAgentPlainTextLabel(result)).toBe("Product Launch");
            });
        });

        describe("reverse index lookup", () => {
            test("finds link by document ID after deduplication", async () => {
                const doc2Id = generateId<DocumentId>();
                // Create first document
                const doc1 = await createAgentLink(storage, {
                    type: "Document",
                    document: {
                        id: documentId,
                        title: "My Document",
                    },
                });

                // Create second document with same title
                const doc2 = await createAgentLink(storage, {
                    type: "Document",
                    document: {
                        id: doc2Id,
                        title: "My Document",
                    },
                });

                expect(printAgentLinkPath(doc1)).toBe("/document/my-document");
                expect(printAgentLinkPath(doc2)).toBe("/document/my-document-2");

                const foundLink = await findAgentLinkForApiPath(
                    storage,
                    printApiPathForAgentLink(doc2),
                );

                expect(printAgentLinkPath(foundLink)).toBe("/document/my-document-2");
            });
        });
    });
});

describe("putAgentDocumentPageLink", () => {
    test("throws if page number is 1", async () => {
        const invalidLink: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "My Document",
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 1,
                documentKey: `/local/document/${documentId}-0`,
                pageStartElementIndex: 0,
                pageEndElementIndexExclusive: 100,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: "/document/my-document-0?page=1",
            },
        };

        await expect(putAgentDocumentPageLink(storage, invalidLink)).rejects.toThrow(
            InvalidArgumentError,
        );
    });
    test("throws if page number is 0", async () => {
        const invalidLink: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "My Document",
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 0,
                documentKey: `/local/document/${documentId}-0`,
                pageStartElementIndex: 0,
                pageEndElementIndexExclusive: 100,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: "/document/my-document-0?page=1",
            },
        };

        await expect(putAgentDocumentPageLink(storage, invalidLink)).rejects.toThrow(
            InvalidArgumentError,
        );
    });

    test("creates first page of document when `localDocumentPage` is null", async () => {
        const link: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "My Document",
            localDocumentPage: null,
        };

        const result = await putAgentDocumentPageLink(storage, link);
        expect(result).toEqual(link);
    });

    test("creates document page link", async () => {
        const link: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "My Document",
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 2,
                documentKey: `/local/document/${documentId}-0`,
                pageStartElementIndex: 50,
                pageEndElementIndexExclusive: 100,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: "/document/my-document-0?page=1",
            },
        };

        const result = await putAgentDocumentPageLink(storage, link);
        expect(result).toEqual(link);
    });

    test("creates multiple pages for same document", async () => {
        const page1Link: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "My Document",
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 2,
                documentKey: `/local/document/${documentId}-1`,
                pageStartElementIndex: 50,
                pageEndElementIndexExclusive: 100,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: "/document/my-document?page=1",
            },
        };
        const page2Link: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "My Document",
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 3,
                documentKey: `/local/document/${documentId}-1`,
                pageStartElementIndex: 100,
                pageEndElementIndexExclusive: 200,
                previousPageAgentLinkString: "/document/my-document?page=0",
                nextPageAgentLinkString: null,
            },
        };

        const page1Result = await putAgentDocumentPageLink(storage, page1Link);
        const page2Result = await putAgentDocumentPageLink(storage, page2Link);

        expect(page1Result).toEqual(page1Link);
        expect(printAgentLinkPath(page1Result)).toBe("/document/my-document?page=2");
        expect(page2Result).toEqual(page2Link);
        expect(printAgentLinkPath(page2Result)).toBe("/document/my-document?page=3");
    });

    test("returns same link for identical page", async () => {
        const link: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "My Document",
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 2,
                documentKey: `/local/document/${documentId}-0`,
                pageStartElementIndex: 50,
                pageEndElementIndexExclusive: 100,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: "/document/my-document-0?page=1",
            },
        };

        await putAgentDocumentPageLink(storage, link);
        await putAgentDocumentPageLink(storage, link);

        expect(await getAgentLink(storage, "/document/my-document?page=2")).toEqual(link);
        expect(await getAgentLink(storage, "/document/my-document?page=2")).toEqual(link);
    });

    test("deduplicates pages with same document label from different documents", async () => {
        const doc1Id = generateId<DocumentId>();
        const doc2Id = generateId<DocumentId>();
        const doc1Page: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId: doc1Id,
            title: "My Document",
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 2,
                documentKey: `/local/document/${doc1Id}-0`,
                pageStartElementIndex: 50,
                pageEndElementIndexExclusive: 100,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: null,
            },
        };

        const doc2Page: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId: doc2Id,
            title: "My Document",
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 2,
                documentKey: `/local/document/${doc2Id}-0`,
                pageStartElementIndex: 50,
                pageEndElementIndexExclusive: 100,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: null,
            },
        };

        const doc1Result = await putAgentDocumentPageLink(storage, doc1Page);
        expect(doc1Result).toEqual(doc1Page);
        expect(printAgentLinkPath(doc1Result)).toBe("/document/my-document?page=2");

        const doc2Result = await putAgentDocumentPageLink(storage, doc2Page);
        expect(doc2Result).toEqual({...doc2Page, dedupeNumber: 2});
        expect(printAgentLinkPath(doc2Result)).toBe("/document/my-document-2?page=2");
    });

    test("creates pages for different document versions", async () => {
        const version1Page: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "My Document",
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 2,
                documentKey: `/local/document/${documentId}-1`,
                pageStartElementIndex: 50,
                pageEndElementIndexExclusive: 100,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: null,
            },
        };

        const version2Page: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "My Document",
            localDocumentPage: {
                localDocumentVersion: 2,
                pageNumber: 2,
                documentKey: `/local/document/${documentId}-2`,
                pageStartElementIndex: 50,
                pageEndElementIndexExclusive: 150,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: null,
            },
        };

        const version1Result = await putAgentDocumentPageLink(storage, version1Page);
        expect(version1Result).toEqual(version1Page);

        const version2Result = await putAgentDocumentPageLink(storage, version2Page);
        expect(version2Result).toEqual(version2Page);

        expect(printAgentLinkPath(version1Result)).toBe("/document/my-document?page=2");
        expect(printAgentLinkPath(version2Result)).toBe("/document/my-document?page=2&version=2");
    });

    test("handles navigation links correctly", async () => {
        const firstPage: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "Long Document",
            dedupeNumber: 2,
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 2,
                documentKey: `/local/document/${documentId}-0`,
                pageStartElementIndex: 50,
                pageEndElementIndexExclusive: 100,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: "/document/long-document-2?page=1",
            },
        };

        const middlePage: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "Long Document",
            dedupeNumber: 2,
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 3,
                documentKey: `/local/document/${documentId}-0`,
                pageStartElementIndex: 100,
                pageEndElementIndexExclusive: 200,
                previousPageAgentLinkString: "/document/long-document-2?page=0",
                nextPageAgentLinkString: "/document/long-document-2?page=2",
            },
        };
        const lastPage: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "Long Document",
            dedupeNumber: 2,
            localDocumentPage: {
                localDocumentVersion: 1,
                pageNumber: 4,
                documentKey: `/local/document/${documentId}-0`,
                pageStartElementIndex: 200,
                pageEndElementIndexExclusive: 250,
                previousPageAgentLinkString: "/document/long-document-2?page=1",
                nextPageAgentLinkString: null,
            },
        };

        await putAgentDocumentPageLink(storage, firstPage);
        await putAgentDocumentPageLink(storage, middlePage);
        await putAgentDocumentPageLink(storage, lastPage);

        const firstPageResult = await getAgentLink<AgentDocumentPageLink>(
            storage,
            "/document/long-document-2?page=2",
        );
        const secondPageResult = await getAgentLink<AgentDocumentPageLink>(
            storage,
            "/document/long-document-2?page=3",
        );
        const thirdPageResult = await getAgentLink<AgentDocumentPageLink>(
            storage,
            "/document/long-document-2?page=4",
        );

        expect(firstPageResult?.localDocumentPage?.nextPageAgentLinkString).toBe(
            "/document/long-document-2?page=1",
        );
        expect(firstPageResult?.localDocumentPage?.previousPageAgentLinkString).toBe(null);

        expect(secondPageResult?.localDocumentPage?.nextPageAgentLinkString).toBe(
            "/document/long-document-2?page=2",
        );
        expect(secondPageResult?.localDocumentPage?.previousPageAgentLinkString).toBe(
            "/document/long-document-2?page=0",
        );

        expect(thirdPageResult?.localDocumentPage?.nextPageAgentLinkString).toBe(null);
        expect(thirdPageResult?.localDocumentPage?.previousPageAgentLinkString).toBe(
            "/document/long-document-2?page=1",
        );
    });

    test("preserves element indices for pages", async () => {
        const link: AgentDocumentPageLink = {
            type: "DocumentPage",
            documentId,
            title: "My Document",
            localDocumentPage: {
                documentKey: `/local/document/${documentId}-0`,
                localDocumentVersion: 1,
                pageStartElementIndex: 100,
                pageEndElementIndexExclusive: 250,
                pageNumber: 2,
                previousPageAgentLinkString: null,
                nextPageAgentLinkString: null,
            },
        };

        await putAgentDocumentPageLink(storage, link);
        const result = await getAgentLink<AgentDocumentPageLink>(
            storage,
            "/document/my-document?page=2",
        );
        expect(result?.localDocumentPage?.pageStartElementIndex).toBe(100);
        expect(result?.localDocumentPage?.pageEndElementIndexExclusive).toBe(250);
    });
});
