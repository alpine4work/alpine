import {intoApiMessageContentPayloadParent} from "~/server/api/internal/shared/into_api_message_content_payload_parent.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {
    PostContentProsemirrorSchema,
    assertPostContent,
    createSimplePostContent,
} from "~/shared/forum/post_content_schema.js";

const context = createTestContext({});

describe("intoApiMessageContentPayloadParent", () => {
    describe("Message parent type", () => {
        test("returns correct response shape for Message parent", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = createSimpleMessageContent("Short message");

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 5,
                content,
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 5,
                contentSnippet: {
                    elements: [{type: "Text", text: "Short message"}],
                    isTruncated: false,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("returns correct response shape for MessagesRange parent", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = createSimpleMessageContent("Test content");

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "MessagesRange",
                startIndex: 0,
                endIndex: 1,
                content,
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                endIndex: 1,
                contentSnippet: {
                    elements: [{type: "Text", text: "Test content"}],
                    isTruncated: false,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });
    });

    describe("PostRange parent type", () => {
        test("returns correct response shape for PostRange parent", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = createSimplePostContent("Post content");

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "PostRange",
                content,
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Post",
                contentSnippet: {
                    elements: [{type: "Text", text: "Post content"}],
                    isTruncated: false,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });
    });

    describe("content snippet and truncation detection", () => {
        test("correctly detects non-truncated short content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = createSimpleMessageContent("Short");

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content,
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {elements: [{type: "Text", text: "Short"}], isTruncated: false},
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("correctly detects truncated multi-paragraph content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            // Create content with many paragraphs that will be truncated to 3 lines
            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("First paragraph with some content"),
                ]),
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("Second paragraph with more content"),
                ]),
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("Third paragraph with even more content"),
                ]),
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text(
                        "Fourth paragraph with much more text because the number 4 is pretty cool",
                    ),
                ]),
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text(
                        `Fifth paragraph should be truncated ${"because it has a lot of text ".repeat(
                            50,
                        )}`,
                    ),
                ]),
            ]);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content: assertMessageContent(content),
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {
                    elements: [
                        {
                            type: "Text",
                            text: "First paragraph with some content. Second paragraph with more content. Third paragraph with even more content. Fourth paragraph with much more text because the number 4 is pretty cool. Fifth paragraph should be truncated because it has a lot of text because it has a lot of text because it has a lot of text because it has a lot of text because it has a lot of text because it has a lot of text because",
                        },
                    ],
                    isTruncated: true,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });
        test("correctly detects truncated content with very long text", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            // Create a very long single paragraph that exceeds 3 lines
            const longText = "hello world ".repeat(1000); // Very long text that will definitely be truncated
            const content = createSimpleMessageContent(longText);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content,
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {
                    elements: [{type: "Text", text: "hello world ".repeat(33).trim()}],
                    isTruncated: true,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });
    });

    describe("edge cases", () => {
        test("handles empty message content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const emptyContent = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph"),
            ]);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content: assertMessageContent(emptyContent),
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {elements: [], isTruncated: false},
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("handles empty post content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const emptyContent = PostContentProsemirrorSchema.node("doc", {}, [
                PostContentProsemirrorSchema.node("paragraph"),
            ]);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "PostRange",
                content: assertPostContent(emptyContent),
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Post",
                contentSnippet: {elements: [], isTruncated: false},
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });
    });

    describe("content with marks", () => {
        test("includes code marks in content snippet", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("This is "),
                    MessageContentProsemirrorSchema.text("code text", [
                        MessageContentProsemirrorSchema.mark("code"),
                    ]),
                    MessageContentProsemirrorSchema.text(" here"),
                ]),
            ]);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content: assertMessageContent(content),
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {
                    elements: [
                        {
                            type: "Text",
                            text: "This is ",
                        },
                        {
                            type: "Text",
                            text: "code text",
                            marks: [{type: "Code"}],
                        },
                        {
                            type: "Text",
                            text: " here",
                        },
                    ],
                    isTruncated: false,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("doesn\u2019t include bold marks in content snippet", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("This is "),
                    MessageContentProsemirrorSchema.text("bold text", [
                        MessageContentProsemirrorSchema.mark("bold"),
                    ]),
                    MessageContentProsemirrorSchema.text(" here"),
                ]),
            ]);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content: assertMessageContent(content),
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {
                    elements: [
                        {
                            type: "Text",
                            text: "This is bold text here",
                        },
                    ],
                    isTruncated: false,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("doesn\u2019t include italic marks in content snippet", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("This is "),
                    MessageContentProsemirrorSchema.text("italic text", [
                        MessageContentProsemirrorSchema.mark("italic"),
                    ]),
                    MessageContentProsemirrorSchema.text(" here"),
                ]),
            ]);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content: assertMessageContent(content),
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {
                    elements: [
                        {
                            type: "Text",
                            text: "This is italic text here",
                        },
                    ],
                    isTruncated: false,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("includes strike marks in content snippet", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("Some "),
                    MessageContentProsemirrorSchema.text("strikethrough", [
                        MessageContentProsemirrorSchema.mark("strike"),
                    ]),
                    MessageContentProsemirrorSchema.text(" text"),
                ]),
            ]);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content: assertMessageContent(content),
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {
                    elements: [
                        {
                            type: "Text",
                            text: "Some ",
                        },
                        {
                            type: "Text",
                            text: "strikethrough",
                            marks: [{type: "Strike"}],
                        },
                        {
                            type: "Text",
                            text: " text",
                        },
                    ],
                    isTruncated: false,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("includes multiple marks on same text", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("Text with "),
                    MessageContentProsemirrorSchema.text("code and strike", [
                        MessageContentProsemirrorSchema.mark("code"),
                        MessageContentProsemirrorSchema.mark("strike"),
                    ]),
                ]),
            ]);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content: assertMessageContent(content),
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {
                    elements: [
                        {
                            type: "Text",
                            text: "Text with ",
                        },
                        {
                            type: "Text",
                            text: "code and strike",
                            marks: [{type: "Code"}, {type: "Strike"}],
                        },
                    ],
                    isTruncated: false,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("includes strike and code marks", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("Some "),
                    MessageContentProsemirrorSchema.text("strikethrough", [
                        MessageContentProsemirrorSchema.mark("strike"),
                    ]),
                    MessageContentProsemirrorSchema.text(" and "),
                    MessageContentProsemirrorSchema.text("code", [
                        MessageContentProsemirrorSchema.mark("code"),
                    ]),
                ]),
            ]);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content: assertMessageContent(content),
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {
                    elements: [
                        {
                            type: "Text",
                            text: "Some ",
                        },
                        {
                            type: "Text",
                            text: "strikethrough",
                            marks: [{type: "Strike"}],
                        },
                        {
                            type: "Text",
                            text: " and ",
                        },
                        {
                            type: "Text",
                            text: "code",
                            marks: [{type: "Code"}],
                        },
                    ],
                    isTruncated: false,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("preserves code marks in truncated content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("Normal text "),
                    MessageContentProsemirrorSchema.text("code text ".repeat(100), [
                        MessageContentProsemirrorSchema.mark("code"),
                    ]),
                ]),
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("This should be truncated"),
                ]),
            ]);

            const result = await intoApiMessageContentPayloadParent(bot.action(), space.id, {
                type: "Message",
                index: 0,
                content: assertMessageContent(content),
                authorId: session.account.id,
            });

            expect(result).toEqual({
                type: "Message",
                index: 0,
                contentSnippet: {
                    elements: [
                        {
                            type: "Text",
                            text: "Normal text ",
                        },
                        {
                            type: "Text",
                            text: "code text ".repeat(38) + "code",
                            marks: [{type: "Code"}],
                        },
                    ],
                    isTruncated: true,
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });
    });
});
