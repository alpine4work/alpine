import {ContentMention} from "~/shared/content/content_mention.js";
import {truncateContentMentionText} from "~/shared/content/render_content_mention_to_text.js";
import {createPostSearchEntityTitle} from "~/shared/forum/create_post_search_entity_title.js";
import {
    assertPostContent,
    PostContentProsemirrorSchema as schema,
} from "~/shared/forum/post_content_schema.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {AccountId, DocumentId} from "~/shared/id/types/id_types.js";

test("creates title for document with file that doesn’t exist", () => {
    expect(
        createPostSearchEntityTitle(
            "Foundations",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: "Document:346p2absnbj88gcpmf048ff6r4"}),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Foundations: Document");
});

test("creates title for document with file that does exist", () => {
    expect(
        createPostSearchEntityTitle(
            "Foundations",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("fileRow", {}, [
                        schema.node("file", {fileId: "Document:346p2absnbj88gcpmf048ff6r4"}),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: entityId => {
                    if (
                        entityId !==
                        `Document:${assertId<DocumentId>("346p2absnbj88gcpmf048ff6r4")}`
                    ) {
                        return null;
                    }
                    return {
                        isPrivate: false,
                        title: "Test Document",
                        getAccountMediaShortName: null,
                    };
                },
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Foundations: Document");
});

test("creates title for content that has a trailing space", () => {
    expect(
        createPostSearchEntityTitle(
            "Foundations",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [schema.text("Ends with a trailing space: ")]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Foundations: Ends with a trailing space:");

    expect(
        createPostSearchEntityTitle(
            "Foundations",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [schema.text("Ends with a trailing tab: \t")]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Foundations: Ends with a trailing tab:");

    expect(
        createPostSearchEntityTitle(
            "Foundations",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Ends with a trailing no-break space: \u00A0"),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Foundations: Ends with a trailing no-break space:");
});

test("creates title with empty content", () => {
    expect(
        createPostSearchEntityTitle(
            "General",
            assertPostContent(schema.node("doc", {}, [schema.node("paragraph", {}, [])])),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in General:");
});

test("creates title with heading only", () => {
    expect(
        createPostSearchEntityTitle(
            "Engineering",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("heading", {level: 1}, [schema.text("Project Roadmap")]),
                    schema.node("paragraph", {}, [schema.text("This should be ignored")]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Engineering: Project Roadmap");
});

test("creates title with single short sentence", () => {
    expect(
        createPostSearchEntityTitle(
            "Design",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [schema.text("New design system launched.")]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Design: New design system launched");
});

test("creates title with multiple sentences fitting in soft max", () => {
    expect(
        createPostSearchEntityTitle(
            "Updates",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("First sentence. Second sentence. Third one."),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Updates: First sentence. Second sentence");
});

test("creates title with long first sentence", () => {
    const longSentence =
        "This is a very long sentence that contains " +
        "word ".repeat(30) +
        "end. Another sentence.";
    expect(
        createPostSearchEntityTitle(
            "Announcements",
            assertPostContent(
                schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text(longSentence)])]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual(
        "in Announcements: This is a very long sentence that contains " +
            "word ".repeat(14) +
            "[…]",
    );
});

test("creates title with mentions", () => {
    const accountId = generateId<AccountId>();

    expect(
        createPostSearchEntityTitle(
            "Team",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Hey "),
                        schema.node("mention", {
                            mention: cast<ContentMention>({
                                type: "Account",
                                accountId,
                                isShort: false,
                            }),
                        }),
                        schema.text(" check this out."),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: otherAccountId => {
                    if (otherAccountId !== accountId) return null;

                    return {
                        id: accountId,
                        version: 0,
                        name: "John Doe",
                        nameVersion: 0,
                    };
                },
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Team: Hey John Doe check this out");
});

test("creates title with code block", () => {
    expect(
        createPostSearchEntityTitle(
            "Code Review",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("codeBlock", {language: "javascript"}, [
                        schema.node("codeBlockLine", {}, [schema.text("function hello() {")]),
                        // eslint-disable-next-line string-quotes
                        schema.node("codeBlockLine", {}, [schema.text("  console.log('Hi');")]),
                        schema.node("codeBlockLine", {}, [schema.text("}")]),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
        // eslint-disable-next-line string-quotes
    ).toEqual("in Code Review: function hello() { console.log('Hi'); }");
});

test("creates title with list items", () => {
    expect(
        createPostSearchEntityTitle(
            "Tasks",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("unorderedListItem", {indent: 0}, [
                        schema.node("paragraph", {}, [schema.text("First item")]),
                    ]),
                    schema.node("unorderedListItem", {indent: 0}, [
                        schema.node("paragraph", {}, [schema.text("Second item")]),
                    ]),
                    schema.node("unorderedListItem", {indent: 0}, [
                        schema.node("paragraph", {}, [schema.text("Third item")]),
                    ]),
                    schema.node("unorderedListItem", {indent: 0}, [
                        schema.node("paragraph", {}, [schema.text("Fourth item")]),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Tasks: First item. Second item");
});

test("creates title with quote block", () => {
    expect(
        createPostSearchEntityTitle(
            "Quotes",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("quoteBlock", {}, [
                        schema.node("paragraph", {}, [schema.text("This is a quote.")]),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Quotes: This is a quote");
});

test("creates title with formatted text", () => {
    expect(
        createPostSearchEntityTitle(
            "Formatting",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("This is "),
                        schema.text("bold", [schema.mark("bold")]),
                        schema.text(" and "),
                        schema.text("italic", [schema.mark("italic")]),
                        schema.text(" text."),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Formatting: This is bold and italic text");
});

test("creates title with link", () => {
    expect(
        createPostSearchEntityTitle(
            "Links",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Check out "),
                        schema.text("this link", [
                            schema.mark("link", {url: "https://example.com"}),
                        ]),
                        schema.text(" for more."),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Links: Check out this link for more");
});

test("creates title near max boundary cases", () => {
    // Test case where first sentence is just under 1/4 of soft max (32 chars)
    const shortFirstSentence = "Short first. Second sentence that is a bit longer.";
    expect(
        createPostSearchEntityTitle(
            "Test",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [schema.text(shortFirstSentence)]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Test: Short first. Second sentence that is a bit longer");

    // Test case where first sentence is just over 1/4 of soft max (33+ chars)
    const longerFirstSentence = "This first sentence is exactly thirty-three. Second one.";
    expect(
        createPostSearchEntityTitle(
            "Test",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [schema.text(longerFirstSentence)]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Test: This first sentence is exactly thirty-three");
});

test("creates title with emoji content", () => {
    expect(
        createPostSearchEntityTitle(
            "Fun",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [schema.text("Hello 👋 World 🌍!")]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Fun: Hello 👋 World 🌍!");
});

test("creates title with break nodes", () => {
    expect(
        createPostSearchEntityTitle(
            "Breaks",
            assertPostContent(
                schema.node("doc", {}, [
                    schema.node("paragraph", {}, [
                        schema.text("Line one"),
                        schema.node("break"),
                        schema.text("Line two"),
                    ]),
                ]),
            ),
            {
                getAccountIfExists: () => null,
                getSearchEntityIfExists: () => null,
                getFileIfExists: () => null,
            },
        ),
    ).toEqual("in Breaks: Line one Line two");
});

test("verifies title never triggers assert with truncateContentMentionText", () => {
    // Test various edge cases to ensure the assert never fires
    const testCases = [
        {
            content: schema.node("doc", {}, [
                schema.node("paragraph", {}, [schema.text("a".repeat(200))]),
            ]),
            channel: "Test",
        },
        {
            content: schema.node("doc", {}, [
                schema.node("paragraph", {}, [
                    schema.text("Exactly at boundary " + "x".repeat(110) + " more text."),
                ]),
            ]),
            channel: "Boundary",
        },
        {
            content: schema.node("doc", {}, [
                schema.node("heading", {level: 1}, [schema.text("x".repeat(150))]),
            ]),
            channel: "LongHeading",
        },
    ];

    testCases.forEach(({content, channel}) => {
        const title = createPostSearchEntityTitle(channel, assertPostContent(content), {
            getAccountIfExists: () => null,
            getSearchEntityIfExists: () => null,
            getFileIfExists: () => null,
        });

        // This should always be true - the assert in the function should never fire
        expect(title).toEqual(truncateContentMentionText(title));
    });
});
