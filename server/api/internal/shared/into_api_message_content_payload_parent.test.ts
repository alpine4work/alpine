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
                    elements: [
                        {type: "Paragraph", elements: [{type: "Text", text: "Short message"}]},
                    ],
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
                    elements: [
                        {type: "Paragraph", elements: [{type: "Text", text: "Test content"}]},
                    ],
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
                    elements: [
                        {type: "Paragraph", elements: [{type: "Text", text: "Post content"}]},
                    ],
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });
    });

    describe("content snippet structure", () => {
        test("preserves multiple paragraphs without truncation", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("First paragraph with some content"),
                ]),
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("Second paragraph with more content"),
                ]),
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text(
                        `Third paragraph with a lot of text ${"because it has a lot of text ".repeat(
                            50,
                        )}`.trim(),
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
                            type: "Paragraph",
                            elements: [{type: "Text", text: "First paragraph with some content"}],
                        },
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Second paragraph with more content"}],
                        },
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: `Third paragraph with a lot of text ${"because it has a lot of text ".repeat(
                                        50,
                                    )}`.trim(),
                                },
                            ],
                        },
                    ],
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("preserves list structure", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("unorderedListItem", {indent: 0}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("First list item"),
                    ]),
                ]),
                MessageContentProsemirrorSchema.node("unorderedListItem", {indent: 0}, [
                    MessageContentProsemirrorSchema.node("paragraph", {}, [
                        MessageContentProsemirrorSchema.text("Second list item"),
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
                            type: "UnorderedList",
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "First list item"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Second list item"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
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
                contentSnippet: {elements: []},
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
                contentSnippet: {elements: []},
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("drops empty paragraphs surrounding the content", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph"),
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("Middle paragraph"),
                ]),
                MessageContentProsemirrorSchema.node("paragraph"),
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
                        {type: "Paragraph", elements: [{type: "Text", text: "Middle paragraph"}]},
                    ],
                },
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
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "This is "},
                                {type: "Text", text: "code text", marks: [{type: "Code"}]},
                                {type: "Text", text: " here"},
                            ],
                        },
                    ],
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });

        test("includes bold and italic marks in content snippet", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession({role: "Admin"});
            const bot = await TestBot.createAndInstantiate(session);

            const content = MessageContentProsemirrorSchema.node("doc", {}, [
                MessageContentProsemirrorSchema.node("paragraph", {}, [
                    MessageContentProsemirrorSchema.text("This is "),
                    MessageContentProsemirrorSchema.text("bold text", [
                        MessageContentProsemirrorSchema.mark("bold"),
                    ]),
                    MessageContentProsemirrorSchema.text(" and "),
                    MessageContentProsemirrorSchema.text("italic text", [
                        MessageContentProsemirrorSchema.mark("italic"),
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
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "This is "},
                                {type: "Text", text: "bold text", marks: [{type: "Bold"}]},
                                {type: "Text", text: " and "},
                                {type: "Text", text: "italic text", marks: [{type: "Italic"}]},
                            ],
                        },
                    ],
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
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "Text with "},
                                {
                                    type: "Text",
                                    text: "code and strike",
                                    marks: [{type: "Strike"}, {type: "Code"}],
                                },
                            ],
                        },
                    ],
                },
                author: expect.objectContaining({
                    id: session.account.id,
                }),
            });
        });
    });
});
