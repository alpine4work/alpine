/* eslint-disable string-quotes */

import {
    decode as decodeO200kBase,
    encode as encodeO200kBase,
} from "gpt-tokenizer/esm/encoding/o200k_base";
import {AgentMessageStream} from "~/server/api/markdown/agent_message_stream.js";
import {normalizeApiContent} from "~/server/api/markdown/normalize_api_content.js";
import {parseApiContentFromMarkdown} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {printApiContentToMarkdown} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {
    ApiContent,
    ApiContentBlockElement,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {assertId, generateId} from "~/shared/id/id.js";
import {
    AccountId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();

async function testPrintApiContentToMarkdown(content: ApiContent, expectedMarkdown: string) {
    const actualMarkdown = printApiContentToMarkdown(content, {spaceId});

    expect(actualMarkdown).toEqual(expectedMarkdown);

    // We expect `parseApiContentFromMarkdown()` to return normalized `ApiContent`.
    expect(parseApiContentFromMarkdown(actualMarkdown, {spaceId})).toEqual(
        normalizeApiContent(content),
    );

    // Test that `AgentMessageStream` can parse all the content we test in this
    // file exactly the same as the test expects.
    await testTracer.withSpan("Test `AgentMessageStream`", async span => {
        const message = new AgentMessageStream({
            spaceId,
            getTargetPathIfExists: async () => null,
        });
        const markdownTokens = encodeO200kBase(actualMarkdown);

        let nextUpdate = randomInteger(1, 5);

        for (const markdownToken of markdownTokens) {
            message.pushText(span, decodeO200kBase([markdownToken]));

            // Update randomly within the message to exercise parse throttling choosing to
            // update at arbitrary times.
            nextUpdate--;
            if (nextUpdate === 0) {
                await message.update(span);
                nextUpdate = randomInteger(1, 5);
            }
        }

        // Always perform one last update.
        await message.update(span);

        const elements: Array<ApiContentBlockElement> = [];

        for (const part of message.getParts()) {
            if (part.payload.type === "Content") {
                for (const element of part.payload.content.elements) {
                    elements.push(element);
                }
            }
        }

        expect(normalizeApiContent({elements})).toEqual(normalizeApiContent(content));
    });
}

test("simple paragraph", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Hello, world!"}],
                },
            ],
        },
        `\
Hello, world!
`,
    );
});

test("simple paragraph with marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Hello, "},
                        {type: "Text", text: "world", marks: [{type: "Italic"}]},
                        {type: "Text", text: "!"},
                    ],
                },
            ],
        },
        `\
Hello, *world*!
`,
    );
});

// Basic text elements
test("empty paragraph", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [],
                },
            ],
        },
        `\
<p></p>
`,
    );
});

test("empty paragraph then paragraph with content", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "foo"}],
                },
            ],
        },
        `\
<p></p>

foo
`,
    );
});

test("empty paragraphs then paragraph with content", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [],
                },
                {
                    type: "Paragraph",
                    elements: [],
                },
                {
                    type: "Paragraph",
                    elements: [],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "foo"}],
                },
            ],
        },
        `\
<p></p>

<p></p>

<p></p>

foo
`,
    );
});

test("paragraph with content then empty paragraph", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "foo"}],
                },
                {
                    type: "Paragraph",
                    elements: [],
                },
            ],
        },
        `\
foo

<p></p>
`,
    );
});

test("paragraph with content then empty paragraphs", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "foo"}],
                },
                {
                    type: "Paragraph",
                    elements: [],
                },
                {
                    type: "Paragraph",
                    elements: [],
                },
                {
                    type: "Paragraph",
                    elements: [],
                },
            ],
        },
        `\
foo

<p></p>

<p></p>

<p></p>
`,
    );
});

test("paragraphs with content with empty paragraph between", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "foo"}],
                },
                {
                    type: "Paragraph",
                    elements: [],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "bar"}],
                },
            ],
        },
        `\
foo

<p></p>

bar
`,
    );
});

test("paragraphs with content with empty paragraphs between", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "foo"}],
                },
                {
                    type: "Paragraph",
                    elements: [],
                },
                {
                    type: "Paragraph",
                    elements: [],
                },
                {
                    type: "Paragraph",
                    elements: [],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "bar"}],
                },
            ],
        },
        `\
foo

<p></p>

<p></p>

<p></p>

bar
`,
    );
});

test("paragraph with only spaces", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "   "}],
                },
            ],
        },
        `\
&#x20; &#x20;
`,
    );
});

test("multiple text elements in paragraph", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "First"},
                        {type: "Text", text: " "},
                        {type: "Text", text: "Second"},
                        {type: "Text", text: " "},
                        {type: "Text", text: "Third"},
                    ],
                },
            ],
        },
        `\
First Second Third
`,
    );
});

// Individual marks
test("bold text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
        `\
This is **bold** text
`,
    );
});

test("italic text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
        `\
This is *italic* text
`,
    );
});

test("strikethrough text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {type: "Text", text: "struck", marks: [{type: "Strike"}]},
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
        `\
This is ~~struck~~ text
`,
    );
});

test("code text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {type: "Text", text: "code", marks: [{type: "Code"}]},
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
        `\
This is \`code\` text
`,
    );
});

test("link text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Click "},
                        {
                            type: "Text",
                            text: "here",
                            marks: [{type: "Link", url: "https://example.com"}],
                        },
                        {type: "Text", text: " to visit"},
                    ],
                },
            ],
        },
        `\
Click [here](https://example.com) to visit
`,
    );
});

// Combined marks
test("bold and italic text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {
                            type: "Text",
                            text: "bold italic",
                            marks: [{type: "Bold"}, {type: "Italic"}],
                        },
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
        `\
This is ***bold italic*** text
`,
    );
});

test("bold and strikethrough text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {
                            type: "Text",
                            text: "bold struck",
                            marks: [{type: "Bold"}, {type: "Strike"}],
                        },
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
        `\
This is **~~bold struck~~** text
`,
    );
});

test("italic and strikethrough text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {
                            type: "Text",
                            text: "italic struck",
                            marks: [{type: "Italic"}, {type: "Strike"}],
                        },
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
        `\
This is *~~italic struck~~* text
`,
    );
});

test("bold, italic and strikethrough text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {
                            type: "Text",
                            text: "all three",
                            marks: [{type: "Bold"}, {type: "Italic"}, {type: "Strike"}],
                        },
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
        `\
This is ***~~all three~~*** text
`,
    );
});

test("link with bold text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Click "},
                        {
                            type: "Text",
                            text: "this bold link",
                            marks: [{type: "Link", url: "https://example.com"}, {type: "Bold"}],
                        },
                        {type: "Text", text: " to visit"},
                    ],
                },
            ],
        },
        `\
Click [**this bold link**](https://example.com) to visit
`,
    );
});

test("link with italic text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Click "},
                        {
                            type: "Text",
                            text: "this italic link",
                            marks: [{type: "Link", url: "https://example.com"}, {type: "Italic"}],
                        },
                        {type: "Text", text: " to visit"},
                    ],
                },
            ],
        },
        `\
Click [*this italic link*](https://example.com) to visit
`,
    );
});

test("link with all marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Click "},
                        {
                            type: "Text",
                            text: "fancy link",
                            marks: [
                                {type: "Link", url: "https://example.com"},
                                {type: "Bold"},
                                {type: "Italic"},
                                {type: "Strike"},
                            ],
                        },
                        {type: "Text", text: " to visit"},
                    ],
                },
            ],
        },
        `\
Click [***~~fancy link~~***](https://example.com) to visit
`,
    );
});

// Line breaks
test("single line break", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "First line"},
                        {type: "Break"},
                        {type: "Text", text: "Second line"},
                    ],
                },
            ],
        },
        `\
First line\\
Second line
`,
    );
});

test("multiple line breaks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "First line"},
                        {type: "Break"},
                        {type: "Break"},
                        {type: "Text", text: "Third line"},
                    ],
                },
            ],
        },
        `\
First line\\
\\
Third line
`,
    );
});

test("line break with bold mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Regular line", marks: []},
                        {type: "Break", marks: [{type: "Bold"}]},
                        {type: "Text", text: "Still regular", marks: []},
                    ],
                },
            ],
        },
        `\
Regular lin&#x65;**<br/>**&#x53;till regular
`,
    );
});

test("line break with bold mark and spaces", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Regular line ", marks: []},
                        {type: "Break", marks: [{type: "Bold"}]},
                        {type: "Text", text: " Still regular", marks: []},
                    ],
                },
            ],
        },
        `\
Regular line **<br/>** Still regular
`,
    );
});

test("line break with italic mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Regular line", marks: []},
                        {type: "Break", marks: [{type: "Italic"}]},
                        {type: "Text", text: "Still regular", marks: []},
                    ],
                },
            ],
        },
        `\
Regular lin&#x65;*<br/>*&#x53;till regular
`,
    );
});

test("line break with italic mark and spaces", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Regular line ", marks: []},
                        {type: "Break", marks: [{type: "Italic"}]},
                        {type: "Text", text: " Still regular", marks: []},
                    ],
                },
            ],
        },
        `\
Regular line *<br/>* Still regular
`,
    );
});

test("line break with bold mark (surrounded by bold marks)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line", marks: [{type: "Bold"}]},
                        {type: "Break", marks: [{type: "Bold"}]},
                        {type: "Text", text: "Still bold", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
**Bold line<br/>Still bold**
`,
    );
});

test("line break with bold mark (surrounded by italic marks)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line", marks: [{type: "Italic"}]},
                        {type: "Break", marks: [{type: "Bold"}]},
                        {type: "Text", text: "Still bold", marks: [{type: "Italic"}]},
                    ],
                },
            ],
        },
        `\
_Bold line_**<br/>**_Still bold_
`,
    );
});

test("line break with bold mark (followed by italic mark)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line", marks: []},
                        {type: "Break", marks: [{type: "Bold"}]},
                        {type: "Text", text: "Still bold", marks: [{type: "Italic"}]},
                    ],
                },
            ],
        },
        `\
Bold lin&#x65;**<br/>**_Still bold_
`,
    );
});

test("line break with bold mark (preceded by italic mark)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line", marks: [{type: "Italic"}]},
                        {type: "Break", marks: [{type: "Bold"}]},
                        {type: "Text", text: "Still bold", marks: []},
                    ],
                },
            ],
        },
        `\
_Bold line_**<br/>**&#x53;till bold
`,
    );
});

test("line break with fake bold mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line**"},
                        {type: "Break"},
                        {type: "Text", text: "**Still bold"},
                    ],
                },
            ],
        },
        `\
Bold line\\*\\*\\
\\*\\*Still bold
`,
    );
});

test("line break with italic mark and fake bold mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line**"},
                        {type: "Break", marks: [{type: "Italic"}]},
                        {type: "Text", text: "**Still bold"},
                    ],
                },
            ],
        },
        `\
Bold line\\*\\**<br/>*\\*\\*Still bold
`,
    );
});

test("line break with italic mark (surrounded by bold marks)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line", marks: [{type: "Bold"}]},
                        {type: "Break", marks: [{type: "Italic"}]},
                        {type: "Text", text: "Still bold", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
**Bold line**_<br/>_**Still bold**
`,
    );
});

test("line break with strike mark (surrounded by bold marks)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line", marks: [{type: "Bold"}]},
                        {type: "Break", marks: [{type: "Strike"}]},
                        {type: "Text", text: "Still bold", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
**Bold line**~~<br/>~~**Still bold**
`,
    );
});

test("line break with code mark (surrounded by bold marks)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line", marks: [{type: "Bold"}]},
                        {type: "Break", marks: [{type: "Code"}]},
                        {type: "Text", text: "Still bold", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
**Bold line**<code><br/></code>**Still bold**
`,
    );
});

test("line break with bold and italic marks (surrounded by bold marks)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line", marks: [{type: "Bold"}]},
                        {type: "Break", marks: [{type: "Italic"}, {type: "Bold"}]},
                        {type: "Text", text: "Still bold", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
**Bold lin&#x65;*<br/>*&#x53;till bold**
`,
    );
});

test("line break with link mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Bold line", marks: [{type: "Bold"}]},
                        {type: "Break", marks: [{type: "Link", url: "https://example.com"}]},
                        {type: "Text", text: "Still bold", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
**Bold line**[<br/>](https://example.com)**Still bold**
`,
    );
});

// Blockquotes
test("simple blockquote", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "This is a quote"}],
                        },
                    ],
                },
            ],
        },
        `\
> This is a quote
`,
    );
});

test("blockquote with multiple paragraphs", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "First paragraph"}],
                        },
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Second paragraph"}],
                        },
                    ],
                },
            ],
        },
        `\
> First paragraph
>
> Second paragraph
`,
    );
});

test("blockquote with formatted text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "Quote with "},
                                {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                                {type: "Text", text: " and "},
                                {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                                {type: "Text", text: " text"},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
> Quote with **bold** and *italic* text
`,
    );
});

// Multiple paragraphs
test("two paragraphs", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "First paragraph"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Second paragraph"}],
                },
            ],
        },
        `\
First paragraph

Second paragraph
`,
    );
});

test("three paragraphs", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "First"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Second"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Third"}],
                },
            ],
        },
        `\
First

Second

Third
`,
    );
});

// Special characters and escaping
test("markdown special characters", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "* not a list item"}],
                },
            ],
        },
        `\
\\* not a list item
`,
    );
});

test("backticks in text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Use `backticks` for code"}],
                },
            ],
        },
        `\
Use \\\`backticks\\\` for code
`,
    );
});

test("underscores in text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "snake_case_variable"}],
                },
            ],
        },
        `\
snake\\_case\\_variable
`,
    );
});

test("brackets in text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "[not a link]"}],
                },
            ],
        },
        `\
\\[not a link]
`,
    );
});

test("html-like text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "<tag>content</tag>"}],
                },
            ],
        },
        `\
\\<tag>content\\</tag>
`,
    );
});

// Complex mixed content
test("paragraph with mixed formatting", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Normal text with "},
                        {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                        {type: "Text", text: ", "},
                        {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                        {type: "Text", text: ", "},
                        {type: "Text", text: "code", marks: [{type: "Code"}]},
                        {type: "Text", text: ", and "},
                        {
                            type: "Text",
                            text: "link",
                            marks: [{type: "Link", url: "https://example.com"}],
                        },
                        {type: "Text", text: "."},
                    ],
                },
            ],
        },
        `\
Normal text with **bold**, *italic*, \`code\`, and [link](https://example.com).
`,
    );
});

test("document with mixed elements", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Introduction paragraph"}],
                },
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "A "},
                                {type: "Text", text: "formatted", marks: [{type: "Italic"}]},
                                {type: "Text", text: " quote"},
                            ],
                        },
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Conclusion with "},
                        {type: "Text", text: "emphasis", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
Introduction paragraph

> A *formatted* quote

Conclusion with **emphasis**
`,
    );
});

// Edge cases
test("empty content", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [],
        },
        ``,
    );
});

test("code with backticks inside", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Use "},
                        {type: "Text", text: "`backticks`", marks: [{type: "Code"}]},
                        {type: "Text", text: " for inline code"},
                    ],
                },
            ],
        },
        `\
Use \`\` \`backticks\` \`\` for inline code
`,
    );
});

// List tests
test("simple unordered list", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- First item

- Second item

- Third item
`,
    );
});

test("simple ordered list", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. First item

2. Second item

3. Third item
`,
    );
});

test("unordered list with formatted text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Item with "},
                                        {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                                        {type: "Text", text: " text"},
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Item with "},
                                        {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                                        {type: "Text", text: " text"},
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Item with "},
                                        {type: "Text", text: "code", marks: [{type: "Code"}]},
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- Item with **bold** text

- Item with *italic* text

- Item with \`code\`
`,
    );
});

test("ordered list with links", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Visit "},
                                        {
                                            type: "Text",
                                            text: "Google",
                                            marks: [{type: "Link", url: "https://google.com"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Check out "},
                                        {
                                            type: "Text",
                                            text: "GitHub",
                                            marks: [{type: "Link", url: "https://github.com"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. Visit [Google](https://google.com)

2. Check out [GitHub](https://github.com)
`,
    );
});

test("nested unordered lists", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Parent item 1"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Child item 1.1"},
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Child item 1.2"},
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Parent item 2"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- Parent item 1

  - Child item 1.1

  - Child item 1.2

- Parent item 2
`,
    );
});

test("nested ordered lists", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First level"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Second level A"},
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Second level B"},
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Back to first"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. First level

   1. Second level A

   2. Second level B

2. Back to first
`,
    );
});

test("mixed nested lists", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Unordered parent"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Ordered child 1"},
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Ordered child 2"},
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- Unordered parent

  1. Ordered child 1

  2. Ordered child 2
`,
    );
});

test("ordered list with orderStart", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 5,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fifth item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Sixth item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Seventh item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
5. Fifth item

6. Sixth item

7. Seventh item
`,
    );
});

test("simple consecutive ordered lists respect orderStart", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 5,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fifth item"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    orderStart: 3,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Restart at 3"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "3rd list merged into second list"},
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    orderStart: 11,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Restart again at 11"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
5. Fifth item

3) Restart at 3

4) 3rd list merged into second list

11. Restart again at 11
`,
    );
});

test("consecutive ordered lists with orderStart", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 5,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fifth item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Sixth item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Seventh item"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    orderStart: 3,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Restart at 3"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    orderStart: 2,
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "Nested item starting at 2",
                                                        },
                                                    ],
                                                },
                                            ],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Nested unordered list item",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                            nestedListElements: [
                                                                {
                                                                    type: "OrderedList",
                                                                    orderStart: 5,
                                                                    items: [
                                                                        {
                                                                            elements: [
                                                                                {
                                                                                    type: "Paragraph",
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "deeply nested item with order start 5",
                                                                                        },
                                                                                    ],
                                                                                },
                                                                            ],
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    orderStart: 11,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Restart again at 11"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "nested item without ordered start begins at 1",
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
5. Fifth item

6. Sixth item

7. Seventh item

3) Restart at 3

   2. Nested item starting at 2

      - Nested unordered list item

        5. deeply nested item with order start 5

11. Restart again at 11

    1. nested item without ordered start begins at 1
`,
    );
});

test("nested ordered lists with separate orderStart values", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    orderStart: 2,
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    orderStart: 10,
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Tenth nested item"},
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: "Eleventh nested item",
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
2. Second item

   10. Tenth nested item

   11. Eleventh nested item

3. Third item
`,
    );
});

test("ordered list with orderStart nested inside unordered list", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Bullet item"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    orderStart: 3,
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Third nested item"},
                                                    ],
                                                },
                                            ],
                                        },
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [
                                                        {type: "Text", text: "Fourth nested item"},
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- Bullet item

  3. Third nested item

  4. Fourth nested item
`,
    );
});

test("list with multiple paragraphs in item", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First paragraph of item"}],
                                },
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Second paragraph of same item"},
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Single paragraph item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- First paragraph of item

  Second paragraph of same item

- Single paragraph item
`,
    );
});

test("list with line breaks in items", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {type: "Text", text: "Line one"},
                                        {type: "Break"},
                                        {type: "Text", text: "Line two"},
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Normal item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- Line one\\
  Line two

- Normal item
`,
    );
});

test("empty list item", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Non-empty item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- <p></p>

- Non-empty item
`,
    );
});

test("deeply nested lists", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Level 1"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [{type: "Text", text: "Level 2"}],
                                                },
                                            ],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Level 3",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- Level 1

  - Level 2

    - Level 3
`,
    );
});

test("list between paragraphs", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Before the list"}],
                },
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "List item"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "After the list"}],
                },
            ],
        },
        `\
Before the list

- List item

After the list
`,
    );
});

test("multiple lists", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First unordered"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First ordered"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- First unordered

1. First ordered
`,
    );
});

// Phantom list item tests
test("list starting at indent level 2 (phantom items for levels 0 and 1)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Starts at indent 2",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- - - Starts at indent 2
`,
    );
});

test("list with phantom jump from level 1 to 3", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Level 0"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [
                                                {
                                                    type: "Paragraph",
                                                    elements: [{type: "Text", text: "Level 1"}],
                                                },
                                            ],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [],
                                                            nestedListElements: [
                                                                {
                                                                    type: "UnorderedList",
                                                                    items: [
                                                                        {
                                                                            elements: [
                                                                                {
                                                                                    type: "Paragraph",
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "Level 3 (jumps from 1 to 3)",
                                                                                        },
                                                                                    ],
                                                                                },
                                                                            ],
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- Level 0

  - Level 1

    - - Level 3 (jumps from 1 to 3)
`,
    );
});

test("ordered list with big phantom jump from level 0 to 4", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Level 0"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [],
                                                            nestedListElements: [
                                                                {
                                                                    type: "UnorderedList",
                                                                    items: [
                                                                        {
                                                                            elements: [],
                                                                            nestedListElements: [
                                                                                {
                                                                                    type: "OrderedList",
                                                                                    items: [
                                                                                        {
                                                                                            elements:
                                                                                                [
                                                                                                    {
                                                                                                        type: "Paragraph",
                                                                                                        elements:
                                                                                                            [
                                                                                                                {
                                                                                                                    type: "Text",
                                                                                                                    text: "Level 4 (big jump)",
                                                                                                                },
                                                                                                            ],
                                                                                                    },
                                                                                                ],
                                                                                        },
                                                                                    ],
                                                                                },
                                                                            ],
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. Level 0

   - - - 1. Level 4 (big jump)
`,
    );
});

test("check list with big phantom jump from level 0 to 4", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "CheckList",
                    items: [
                        {
                            checked: true,
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Level 0"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [],
                                                            nestedListElements: [
                                                                {
                                                                    type: "UnorderedList",
                                                                    items: [
                                                                        {
                                                                            elements: [],
                                                                            nestedListElements: [
                                                                                {
                                                                                    type: "CheckList",
                                                                                    items: [
                                                                                        {
                                                                                            checked: false,
                                                                                            elements:
                                                                                                [
                                                                                                    {
                                                                                                        type: "Paragraph",
                                                                                                        elements:
                                                                                                            [
                                                                                                                {
                                                                                                                    type: "Text",
                                                                                                                    text: "Level 4 (big jump)",
                                                                                                                },
                                                                                                            ],
                                                                                                    },
                                                                                                ],
                                                                                        },
                                                                                    ],
                                                                                },
                                                                            ],
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- [x] Level 0

  - - - - [ ] Level 4 (big jump)
`,
    );
});

test("list starting at level 3 with all phantom parents", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [],
                                                            nestedListElements: [
                                                                {
                                                                    type: "OrderedList",
                                                                    items: [
                                                                        {
                                                                            elements: [
                                                                                {
                                                                                    type: "Paragraph",
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "Deep start at level 3",
                                                                                        },
                                                                                    ],
                                                                                },
                                                                            ],
                                                                        },
                                                                        {
                                                                            elements: [
                                                                                {
                                                                                    type: "Paragraph",
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "Another at level 3",
                                                                                        },
                                                                                    ],
                                                                                },
                                                                            ],
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. <p></p>

   - - 1. Deep start at level 3

       2. Another at level 3
`,
    );
});

test("mixed list types with phantom items", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [],
                            nestedListElements: [
                                {
                                    type: "OrderedList",
                                    items: [
                                        {
                                            elements: [],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Mixed types with phantoms",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- 1. <p></p>

     - Mixed types with phantoms
`,
    );
});

test("phantom items with multiple real items at deep level", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "First at level 2",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Second at level 2",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Third at level 2",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- - - First at level 2

    - Second at level 2

    - Third at level 2
`,
    );
});

test("complex phantom structure with real content scattered", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Real at 0"}],
                                },
                            ],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [],
                                            nestedListElements: [
                                                {
                                                    type: "UnorderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Real at 2",
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                            nestedListElements: [
                                                                {
                                                                    type: "OrderedList",
                                                                    items: [
                                                                        {
                                                                            elements: [
                                                                                {
                                                                                    type: "Paragraph",
                                                                                    elements: [
                                                                                        {
                                                                                            type: "Text",
                                                                                            text: "Real at 3",
                                                                                        },
                                                                                    ],
                                                                                },
                                                                            ],
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Back to level 0"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. Real at 0

   - - Real at 2

       1. Real at 3

2. Back to level 0
`,
    );
});

test("phantom items with formatted text in real items", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [],
                            nestedListElements: [
                                {
                                    type: "UnorderedList",
                                    items: [
                                        {
                                            elements: [],
                                            nestedListElements: [
                                                {
                                                    type: "OrderedList",
                                                    items: [
                                                        {
                                                            elements: [
                                                                {
                                                                    type: "Paragraph",
                                                                    elements: [
                                                                        {
                                                                            type: "Text",
                                                                            text: "Deep with ",
                                                                        },
                                                                        {
                                                                            type: "Text",
                                                                            text: "bold",
                                                                            marks: [{type: "Bold"}],
                                                                        },
                                                                        {
                                                                            type: "Text",
                                                                            text: " and ",
                                                                        },
                                                                        {
                                                                            type: "Text",
                                                                            text: "italic",
                                                                            marks: [
                                                                                {type: "Italic"},
                                                                            ],
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- - 1. Deep with **bold** and *italic*
`,
    );
});

test("phantom item without nested list elements", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [{elements: []}],
                },
            ],
        },
        `\
-
`,
    );
});

describe("checklist", () => {
    test("simple checklist with unchecked items", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "First task"}],
                                    },
                                ],
                            },
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Second task"}],
                                    },
                                ],
                            },
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Third task"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
- [ ] First task

- [ ] Second task

- [ ] Third task
`,
        );
    });

    test("simple checklist with checked items", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Completed task 1"}],
                                    },
                                ],
                            },
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Completed task 2"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
- [x] Completed task 1

- [x] Completed task 2
`,
        );
    });

    test("checklist with mixed checked and unchecked items", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Done"}],
                                    },
                                ],
                            },
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Not done"}],
                                    },
                                ],
                            },
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Also done"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
- [x] Done

- [ ] Not done

- [x] Also done
`,
        );
    });

    test("checklist with formatted text", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "Task with "},
                                            {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                                            {type: "Text", text: " text"},
                                        ],
                                    },
                                ],
                            },
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "Task with "},
                                            {
                                                type: "Text",
                                                text: "italic",
                                                marks: [{type: "Italic"}],
                                            },
                                            {type: "Text", text: " text"},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
- [ ] Task with **bold** text

- [x] Task with *italic* text
`,
        );
    });

    test("checklist with links", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "Review "},
                                            {
                                                type: "Text",
                                                text: "documentation",
                                                marks: [
                                                    {type: "Link", url: "https://example.com/docs"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "Read "},
                                            {
                                                type: "Text",
                                                text: "tutorial",
                                                marks: [
                                                    {
                                                        type: "Link",
                                                        url: "https://example.com/tutorial",
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
- [ ] Review [documentation](https://example.com/docs)

- [x] Read [tutorial](https://example.com/tutorial)
`,
        );
    });

    test("nested checklists", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Parent task"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "CheckList",
                                        items: [
                                            {
                                                checked: true,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "Subtask 1"},
                                                        ],
                                                    },
                                                ],
                                            },
                                            {
                                                checked: false,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "Subtask 2"},
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
- [ ] Parent task

  - [x] Subtask 1

  - [ ] Subtask 2
`,
        );
    });

    test("deeply nested checklists", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Level 0"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "CheckList",
                                        items: [
                                            {
                                                checked: true,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "Level 1"}],
                                                    },
                                                ],
                                                nestedListElements: [
                                                    {
                                                        type: "CheckList",
                                                        items: [
                                                            {
                                                                checked: false,
                                                                elements: [
                                                                    {
                                                                        type: "Paragraph",
                                                                        elements: [
                                                                            {
                                                                                type: "Text",
                                                                                text: "Level 2",
                                                                            },
                                                                        ],
                                                                    },
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
- [ ] Level 0

  - [x] Level 1

    - [ ] Level 2
`,
        );
    });

    test("checklist with multiple paragraphs in item", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "First paragraph"}],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Second paragraph"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
- [ ] First paragraph

  Second paragraph
`,
        );
    });

    test("mixed list types with checklists", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "UnorderedList",
                        items: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Unordered item"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "CheckList",
                                        items: [
                                            {
                                                checked: false,
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "Checklist item"},
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
- Unordered item

  - [ ] Checklist item
`,
        );
    });

    test("checklist with nested ordered list", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Checklist item"}],
                                    },
                                ],
                                nestedListElements: [
                                    {
                                        type: "OrderedList",
                                        items: [
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "Step 1"}],
                                                    },
                                                ],
                                            },
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "Step 2"}],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
- [x] Checklist item

  1. Step 1

  2. Step 2
`,
        );
    });

    test("empty checklist item", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: true,
                                elements: [],
                            },
                        ],
                    },
                ],
            },
            `\
- [x] <span></span>
`,
        );
    });

    test("checklist between paragraphs", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "Before checklist"}],
                    },
                    {
                        type: "CheckList",
                        items: [
                            {
                                checked: false,
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Task"}],
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "After checklist"}],
                    },
                ],
            },
            `\
Before checklist

- [ ] Task

After checklist
`,
        );
    });

    test("checklist in table", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "Table",
                        width: 1,
                        hasHeaderRow: true,
                        hasHeaderColumn: false,
                        columns: [{width: 1}, {width: 1}],
                        rows: [
                            {
                                cells: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Task List"}],
                                            },
                                        ],
                                    },
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Status"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                cells: [
                                    {
                                        elements: [
                                            {
                                                type: "CheckList",
                                                items: [
                                                    {
                                                        checked: true,
                                                        elements: [
                                                            {
                                                                type: "Paragraph",
                                                                elements: [
                                                                    {type: "Text", text: "Done"},
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                    {
                                                        checked: false,
                                                        elements: [
                                                            {
                                                                type: "Paragraph",
                                                                elements: [
                                                                    {type: "Text", text: "Todo"},
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "In progress"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            `\
<table>
<thead>
<tr>
<th>

Task List

</th>
<th>

Status

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

- [x] Done

- [ ] Todo

</td>
<td>

In progress

</td>
</tr>
</tbody>
</table>
`,
        );
    });

    test("checklists within quote blocks", async () => {
        await testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "Quote",
                        elements: [
                            {
                                type: "CheckList",
                                items: [
                                    {
                                        checked: false,
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Task"}],
                                            },
                                        ],
                                    },
                                    {
                                        checked: true,
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Completed task"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Task"}],
                            },
                        ],
                    },
                ],
            },
            `\
> - [ ] Task
>
> - [x] Completed task
>
> Task
`,
        );
    });
});

// Table tests
test("simple GFM table with header row", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}, {width: 1}, {width: 1}],
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Name"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Age"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "City"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Alice"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "30"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "New York"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Bob"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "25"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "London"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| Name | Age | City |
| - | - | - |
| Alice | 30 | New York |
| Bob | 25 | London |
`,
    );
});

test("simple GFM table with formatted text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}, {width: 1}],
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {
                                                    type: "Text",
                                                    text: "Bold ",
                                                    marks: [{type: "Bold"}],
                                                },
                                                {type: "Text", text: "Header"},
                                            ],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {
                                                    type: "Text",
                                                    text: "Italic ",
                                                    marks: [{type: "Italic"}],
                                                },
                                                {type: "Text", text: "Header"},
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {
                                                    type: "Text",
                                                    text: "Code text",
                                                    marks: [{type: "Code"}],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {
                                                    type: "Text",
                                                    text: "Link text",
                                                    marks: [
                                                        {type: "Link", url: "https://example.com"},
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| **Bold&#x20;**&#x48;eader | *Italic&#x20;*&#x48;eader |
| - | - |
| \`Code text\` | [Link text](https://example.com) |
`,
    );
});

test("simple GFM table with custom column widths", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 2}, {width: 1}, {width: 3}],
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Wide"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Normal"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Wider"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "A"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "B"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "C"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| Wide | Normal | Wider |
| - | - | - |
| A | B | C<span hidden data-column-widths="2,1,3"/> |
`,
    );
});

test("simple GFM table with custom table width", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 2.5,
                    columns: [{width: 1}, {width: 1}],
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Col1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Col2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Data1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Data2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| Col1 | Col2 |
| - | - |
| Data1 | Data2<span hidden data-width="2.5"/> |
`,
    );
});

test("HTML table with header column only", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}, {width: 1}, {width: 1}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Name"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Alice"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Bob"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Age"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "30"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "25"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<table>
<tbody>
<tr>
<th>

Name

</th>
<td>

Alice

</td>
<td>

Bob

</td>
</tr>
<tr>
<th>

Age

</th>
<td>

30

</td>
<td>

25

</td>
</tr>
</tbody>
</table>
`,
    );
});

test("HTML table with both header row and header column", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}, {width: 1}, {width: 1}],
                    hasHeaderRow: true,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: ""}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Q1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Q2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Sales"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "100"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "150"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Costs"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "50"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "60"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<table>
<thead>
<tr>
<th>

</th>
<th scope="col">

Q1

</th>
<th scope="col">

Q2

</th>
</tr>
</thead>
<tbody>
<tr>
<th scope="row">

Sales

</th>
<td>

100

</td>
<td>

150

</td>
</tr>
<tr>
<th scope="row">

Costs

</th>
<td>

50

</td>
<td>

60

</td>
</tr>
</tbody>
</table>
`,
    );
});

test("HTML table with complex cell content", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}, {width: 1}],
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Description"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Details"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Feature 1"}],
                                        },
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Additional info"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "UnorderedList",
                                            items: [
                                                {
                                                    elements: [
                                                        {
                                                            type: "Paragraph",
                                                            elements: [
                                                                {type: "Text", text: "Point 1"},
                                                            ],
                                                        },
                                                    ],
                                                },
                                                {
                                                    elements: [
                                                        {
                                                            type: "Paragraph",
                                                            elements: [
                                                                {type: "Text", text: "Point 2"},
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<table>
<thead>
<tr>
<th>

Description

</th>
<th>

Details

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

Feature 1

Additional info

</td>
<td>

- Point 1

- Point 2

</td>
</tr>
</tbody>
</table>
`,
    );
});

test("HTML table without any headers", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}, {width: 1}],
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "A1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "B1"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "A2"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "B2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<table>
<tbody>
<tr>
<td>

A1

</td>
<td>

B1

</td>
</tr>
<tr>
<td>

A2

</td>
<td>

B2

</td>
</tr>
</tbody>
</table>
`,
    );
});

test("HTML table with custom widths", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 3,
                    columns: [{width: 2}, {width: 3}],
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Label"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<table data-width="3" data-column-widths="2,3">
<tbody>
<tr>
<th>

Label

</th>
<td>

Value

</td>
</tr>
</tbody>
</table>
`,
    );
});

test("simple GFM table with empty cells", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}, {width: 1}],
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Header1"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Header2"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: ""}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Value"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Data"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: ""}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| Header1 | Header2 |
| - | - |
| | Value |
| Data | |
`,
    );
});

test("simple GFM table with line breaks in cells", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}, {width: 1}],
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Col A"}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Col B"}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {type: "Text", text: "Line 1"},
                                                {type: "Break"},
                                                {type: "Text", text: "Line 2"},
                                            ],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Single line"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| Col A | Col B |
| - | - |
| Line 1<br/>Line 2 | Single line |
`,
    );
});

test("single cell GFM table", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    columns: [{width: 1}],
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Only Cell"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| Only Cell | |
| - | - |
`,
    );
});

// Code block tests
test("simple code block", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "javascript",
                    lines: [
                        {
                            elements: [{type: "Text", text: "const x = 42;"}],
                        },
                        {
                            elements: [{type: "Text", text: "console.log(x);"}],
                        },
                    ],
                },
            ],
        },
        `\
\`\`\`javascript
const x = 42;
console.log(x);
\`\`\`
`,
    );
});

test("simple code with newline character in lines", async () => {
    await expect(() =>
        testPrintApiContentToMarkdown(
            {
                elements: [
                    {
                        type: "Code",
                        language: "javascript",
                        lines: [
                            {
                                elements: [{type: "Text", text: "const x = 42;\nconsole.log(x);"}],
                            },
                        ],
                    },
                ],
            },
            `\
\`\`\`javascript
const x = 42;
console.log(x);
\`\`\`
`,
        ),
    ).rejects.toThrow("Assertion failure");
});

test("code block with language", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "javascript",
                    lines: [
                        {
                            elements: [{type: "Text", text: "function hello() {"}],
                        },
                        {
                            elements: [{type: "Text", text: "  return 'world';"}],
                        },
                        {
                            elements: [{type: "Text", text: "}"}],
                        },
                    ],
                },
            ],
        },
        `\
\`\`\`javascript
function hello() {
  return 'world';
}
\`\`\`
`,
    );
});

test("code block with empty lines", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "python",
                    lines: [
                        {
                            elements: [{type: "Text", text: "def foo():"}],
                        },
                        {
                            elements: [{type: "Text", text: ""}],
                        },
                        {
                            elements: [{type: "Text", text: "    pass"}],
                        },
                        {
                            elements: [{type: "Text", text: ""}],
                        },
                        {
                            elements: [{type: "Text", text: ""}],
                        },
                        {
                            elements: [{type: "Text", text: "foo()"}],
                        },
                    ],
                },
            ],
        },
        `\
\`\`\`python
def foo():

    pass


foo()
\`\`\`
`,
    );
});

test("code block with trailing spaces", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [{type: "Text", text: "line with trailing spaces   "}],
                        },
                        {
                            elements: [{type: "Text", text: "    indented with trailing    "}],
                        },
                        {
                            elements: [{type: "Text", text: "no trailing"}],
                        },
                        {
                            elements: [
                                {type: "Text", text: "   "}, // Only spaces
                            ],
                        },
                    ],
                },
            ],
        },
        `\
\`\`\`text
line with trailing spaces  \u0020
    indented with trailing   \u0020
no trailing
  \u0020
\`\`\`
`,
    );
});

test("code block with various indentation levels", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "python",
                    lines: [
                        {
                            elements: [{type: "Text", text: "class Foo:"}],
                        },
                        {
                            elements: [{type: "Text", text: "    def bar(self):"}],
                        },
                        {
                            elements: [{type: "Text", text: "        if True:"}],
                        },
                        {
                            elements: [{type: "Text", text: "            return 42"}],
                        },
                        {
                            elements: [
                                {type: "Text", text: "\t\tdef baz(self):"}, // Tabs
                            ],
                        },
                        {
                            elements: [
                                {type: "Text", text: "\t\t\t\treturn 'tabs'"}, // More tabs
                            ],
                        },
                    ],
                },
            ],
        },
        `\
\`\`\`python
class Foo:
    def bar(self):
        if True:
            return 42
\t\tdef baz(self):
\t\t\t\treturn 'tabs'
\`\`\`
`,
    );
});

test("code block with bold marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "javascript",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "const "},
                                {type: "Text", text: "highlighted", marks: [{type: "Bold"}]},
                                {type: "Text", text: " = true;"},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-javascript">
const <strong>highlighted</strong> = true;
</code>
</pre>
`,
    );
});

test("code block with italic marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "markdown",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "This is "},
                                {type: "Text", text: "emphasized", marks: [{type: "Italic"}]},
                                {type: "Text", text: " text"},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-markdown">
This is <em>emphasized</em> text
</code>
</pre>
`,
    );
});

test("code block with strikethrough marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "- "},
                                {type: "Text", text: "removed", marks: [{type: "Strike"}]},
                            ],
                        },
                        {
                            elements: [{type: "Text", text: "+ added"}],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-text">
- <del>removed</del>
+ added
</code>
</pre>
`,
    );
});

test("code block with link marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "Visit "},
                                {
                                    type: "Text",
                                    text: "https://example.com",
                                    marks: [{type: "Link", url: "https://example.com"}],
                                },
                                {type: "Text", text: " for more"},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-html">
Visit <a href="https://example.com">https://example.com</a> for more
</code>
</pre>
`,
    );
});

test("code block with multiple marks on same text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "normal "},
                                {
                                    type: "Text",
                                    text: "bold+italic",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "all",
                                    marks: [{type: "Bold"}, {type: "Italic"}, {type: "Strike"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-text">
normal <strong><em>bold+italic</em></strong> <strong><em><del>all</del></em></strong>
</code>
</pre>
`,
    );
});

test("code block with mark merging - adjacent same marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "javascript",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "const ", marks: [{type: "Bold"}]},
                                {type: "Text", text: "merged", marks: [{type: "Bold"}]},
                                {type: "Text", text: " = true;"},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-javascript">
<strong>const merged</strong> = true;
</code>
</pre>
`,
    );
});

test("code block with mark merging - links with same URL", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [
                                {
                                    type: "Text",
                                    text: "https://",
                                    marks: [{type: "Link", url: "https://example.com"}],
                                },
                                {
                                    type: "Text",
                                    text: "example",
                                    marks: [{type: "Link", url: "https://example.com"}],
                                },
                                {
                                    type: "Text",
                                    text: ".com",
                                    marks: [{type: "Link", url: "https://example.com"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-text">
<a href="https://example.com">https://example.com</a>
</code>
</pre>
`,
    );
});

test("code block with no mark merging - links with different URLs", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [
                                {
                                    type: "Text",
                                    text: "link1",
                                    marks: [{type: "Link", url: "https://example1.com"}],
                                },
                                {type: "Text", text: " "},
                                {
                                    type: "Text",
                                    text: "link2",
                                    marks: [{type: "Link", url: "https://example2.com"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-text">
<a href="https://example1.com">link1</a> <a href="https://example2.com">link2</a>
</code>
</pre>
`,
    );
});

test("code block with marks across multiple lines", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "javascript",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "function ", marks: [{type: "Bold"}]},
                                {type: "Text", text: "foo() {"},
                            ],
                        },
                        {
                            elements: [
                                {type: "Text", text: "  return ", marks: [{type: "Italic"}]},
                                {
                                    type: "Text",
                                    text: "42",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                                {type: "Text", text: ";"},
                            ],
                        },
                        {
                            elements: [{type: "Text", text: "}"}],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-javascript">
<strong>function </strong>foo() {
<em>  return </em><strong><em>42</em></strong>;
}
</code>
</pre>
`,
    );
});

test("code block with empty lines and marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [{type: "Text", text: "line 1", marks: [{type: "Bold"}]}],
                        },
                        {
                            elements: [{type: "Text", text: ""}],
                        },
                        {
                            elements: [{type: "Text", text: "line 3", marks: [{type: "Italic"}]}],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-text">
<strong>line 1</strong>

<em>line 3</em>
</code>
</pre>
`,
    );
});

test("code block with empty lines at start/end and mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {elements: []},
                        {
                            elements: [
                                {type: "Text", text: "Hello, "},
                                {type: "Text", text: "world", marks: [{type: "Bold"}]},
                                {type: "Text", text: "!"},
                            ],
                        },
                        {elements: []},
                        {elements: [{type: "Text", text: "foobar"}]},
                        {elements: []},
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-text">

Hello, <strong>world</strong>!

foobar

</code>
</pre>
`,
    );
});

test("code block with complex mark nesting 1", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "start "},
                                {type: "Text", text: "bold ", marks: [{type: "Bold"}]},
                                {
                                    type: "Text",
                                    text: "bold+italic ",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                                {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                                {type: "Text", text: " end"},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-text">
start <strong>bold <em>bold+italic </em></strong><em>italic</em> end
</code>
</pre>
`,
    );
});

test("code block with complex mark nesting 2", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: "start "},
                                {type: "Text", text: "bold ", marks: [{type: "Italic"}]},
                                {
                                    type: "Text",
                                    text: "bold+italic ",
                                    marks: [{type: "Bold"}, {type: "Italic"}],
                                },
                                {type: "Text", text: "italic", marks: [{type: "Bold"}]},
                                {type: "Text", text: " end"},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-text">
start <em>bold </em><strong><em>bold+italic </em>italic</strong> end
</code>
</pre>
`,
    );
});

test("code block with special HTML characters", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "html",
                    lines: [
                        {
                            elements: [{type: "Text", text: "<div>"}],
                        },
                        {
                            elements: [
                                {type: "Text", text: "  &nbsp;"},
                                {type: "Text", text: "<strong>", marks: [{type: "Bold"}]},
                                {type: "Text", text: "bold"},
                                {type: "Text", text: "</strong>", marks: [{type: "Bold"}]},
                            ],
                        },
                        {
                            elements: [{type: "Text", text: "</div>"}],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-html">
&lt;div&gt;
  &amp;nbsp;<strong>&lt;strong&gt;</strong>bold<strong>&lt;/strong&gt;</strong>
&lt;/div&gt;
</code>
</pre>
`,
    );
});

test("code block with only spaces on some lines", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [{type: "Text", text: "first"}],
                        },
                        {
                            elements: [
                                {type: "Text", text: "    "}, // Only spaces
                            ],
                        },
                        {
                            elements: [{type: "Text", text: "third"}],
                        },
                    ],
                },
            ],
        },
        `\
\`\`\`text
first
   \u0020
third
\`\`\`
`,
    );
});

test("code block with marks and empty text elements", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "text",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: ""},
                                {type: "Text", text: "text", marks: [{type: "Bold"}]},
                                {type: "Text", text: ""},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-text">
<strong>text</strong>
</code>
</pre>
`,
    );
});

test("code block with language containing special characters", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "cpp",
                    lines: [
                        {
                            elements: [{type: "Text", text: "#include <iostream>"}],
                        },
                    ],
                },
            ],
        },
        `\
\`\`\`cpp
#include <iostream>
\`\`\`
`,
    );
});

// Tests for code marks with break elements
test("text and break both with code mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Code line", marks: [{type: "Code"}]},
                        {type: "Break", marks: [{type: "Code"}]},
                        {type: "Text", text: "Still code", marks: [{type: "Code"}]},
                    ],
                },
            ],
        },
        `\
\`Code line\`<code><br/></code>\`Still code\`
`,
    );
});

test("break with code mark between non-code text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Normal"},
                        {type: "Break", marks: [{type: "Code"}]},
                        {type: "Text", text: "Also normal"},
                    ],
                },
            ],
        },
        `\
Normal<code><br/></code>Also normal
`,
    );
});

test("multiple breaks with code marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Line 1", marks: [{type: "Code"}]},
                        {type: "Break", marks: [{type: "Code"}]},
                        {type: "Text", text: "Line 2", marks: [{type: "Code"}]},
                        {type: "Break", marks: [{type: "Code"}]},
                        {type: "Text", text: "Line 3", marks: [{type: "Code"}]},
                    ],
                },
            ],
        },
        `\
\`Line 1\`<code><br/></code>\`Line 2\`<code><br/></code>\`Line 3\`
`,
    );
});

test("break without code mark between code text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Code line 1", marks: [{type: "Code"}]},
                        {type: "Break"},
                        {type: "Text", text: "Code line 2", marks: [{type: "Code"}]},
                    ],
                },
            ],
        },
        `\
\`Code line 1\`\\
\`Code line 2\`
`,
    );
});

// Tests for code marks with mention elements
test("mention with code mark", async () => {
    const accountId = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: "@alice",
                            marks: [{type: "Code"}],
                        },
                    ],
                },
            ],
        },
        `\
<code>[@alice](https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention)</code>
`,
    );
});

test("mention with code mark in sentence", async () => {
    const accountId = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Ask "},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: "@bob",
                            marks: [{type: "Code"}],
                        },
                        {type: "Text", text: " about it"},
                    ],
                },
            ],
        },
        `\
Ask <code>[@bob](https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention)</code> about it
`,
    );
});

test("mention and text both with code mark", async () => {
    const accountId = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "The user ", marks: [{type: "Code"}]},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: "@charlie",
                            marks: [{type: "Code"}],
                        },
                        {type: "Text", text: " is mentioned", marks: [{type: "Code"}]},
                    ],
                },
            ],
        },
        `\
\`The user \`<code>[@charlie](https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention)</code>\` is mentioned\`
`,
    );
});

test("multiple mentions with code marks", async () => {
    const accountId1 = generateId<AccountId>();
    const accountId2 = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "CC: ", marks: [{type: "Code"}]},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId1},
                            title: "@eve",
                            marks: [{type: "Code"}],
                        },
                        {type: "Text", text: " and ", marks: [{type: "Code"}]},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId2},
                            title: "@frank",
                            marks: [{type: "Code"}],
                        },
                    ],
                },
            ],
        },
        `\
\`CC: \`<code>[@eve](https://alpine.inc/s/${spaceId}/accounts/${accountId1}?mention)</code>\`  and  \`<code>[@frank](https://alpine.inc/s/${spaceId}/accounts/${accountId2}?mention)</code>
`,
    );
});

// Complex combinations
test("break and mention both with code marks", async () => {
    const accountId = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "User: ", marks: [{type: "Code"}]},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: "@grace",
                            marks: [{type: "Code"}],
                        },
                        {type: "Break", marks: [{type: "Code"}]},
                        {type: "Text", text: "Status: active", marks: [{type: "Code"}]},
                    ],
                },
            ],
        },
        `\
\`User: \`<code>[@grace](https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention)</code><code><br/></code>\`Status: active\`
`,
    );
});

test("mention without code mark between code text", async () => {
    const accountId = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Code before ", marks: [{type: "Code"}]},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: "@henry",
                        },
                        {type: "Text", text: " code after", marks: [{type: "Code"}]},
                    ],
                },
            ],
        },
        `\
\`Code before \`[@henry](https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention)\` code after\`
`,
    );
});

test("mention with isAccountShortName and code mark", async () => {
    const accountId = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: "iris",
                            isAccountShortName: true,
                            marks: [{type: "Code"}],
                        },
                    ],
                },
            ],
        },
        `\
<code>[iris](https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention=short)</code>
`,
    );
});

test("mention without title and with code mark", async () => {
    const taskId = generateId<TaskId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Task", id: taskId},
                            marks: [{type: "Code"}],
                        },
                    ],
                },
            ],
        },
        `\
<code>[Unknown task](https://alpine.inc/s/${spaceId}/tasks/${taskId}?mention)</code>
`,
    );
});

test("complex paragraph with mixed code marks", async () => {
    const accountId1 = generateId<AccountId>();
    const accountId2 = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Function: ", marks: [{type: "Code"}]},
                        {type: "Text", text: "getUserData(", marks: [{type: "Code"}]},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId1},
                            title: "@jack",
                            marks: [{type: "Code"}],
                        },
                        {type: "Text", text: ")", marks: [{type: "Code"}]},
                        {type: "Break", marks: [{type: "Code"}]},
                        {type: "Text", text: "Returns: user object", marks: [{type: "Code"}]},
                        {type: "Break"},
                        {type: "Text", text: "Author: "},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId2},
                            title: "@kate",
                        },
                    ],
                },
            ],
        },
        `\
\`Function: getUserData(\`<code>[@jack](https://alpine.inc/s/${spaceId}/accounts/${accountId1}?mention)</code>\`)\`<code><br/></code>\`Returns: user object\`\\
Author: [@kate](https://alpine.inc/s/${spaceId}/accounts/${accountId2}?mention)
`,
    );
});

// Additional comprehensive tests
test("bold text next to bold link text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "This is bold ",
                            marks: [{type: "Bold"}],
                        },
                        {
                            type: "Text",
                            text: "and this is a bold link",
                            marks: [{type: "Bold"}, {type: "Link", url: "https://example.com"}],
                        },
                    ],
                },
            ],
        },
        `\
**This is bold [and this is a bold link](https://example.com)**
`,
    );
});

test("bold link text next to bold text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "This is a bold link",
                            marks: [{type: "Bold"}, {type: "Link", url: "https://example.com"}],
                        },
                        {
                            type: "Text",
                            text: " and this is bold",
                            marks: [{type: "Bold"}],
                        },
                    ],
                },
            ],
        },
        `\
**[This is a bold link](https://example.com) and this is bold**
`,
    );
});

test("bold text next to bold link text next to bold text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "This is bold ",
                            marks: [{type: "Bold"}],
                        },
                        {
                            type: "Text",
                            text: "and this is a bold link",
                            marks: [{type: "Bold"}, {type: "Link", url: "https://example.com"}],
                        },
                        {
                            type: "Text",
                            text: " and this is bold",
                            marks: [{type: "Bold"}],
                        },
                    ],
                },
            ],
        },
        `\
**This is bold [and this is a bold link](https://example.com) and this is bold**
`,
    );
});

test("bold + strike text next to bold + strike link text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "This is bold ",
                            marks: [{type: "Bold"}, {type: "Strike"}],
                        },
                        {
                            type: "Text",
                            text: "and this is a bold link",
                            marks: [
                                {type: "Bold"},
                                {type: "Strike"},
                                {type: "Link", url: "https://example.com"},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
**~~This is bold [and this is a bold link](https://example.com)~~**
`,
    );
});

test("bold + strike link text next to bold + strike text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "This is a bold link",
                            marks: [
                                {type: "Bold"},
                                {type: "Strike"},
                                {type: "Link", url: "https://example.com"},
                            ],
                        },
                        {
                            type: "Text",
                            text: " and this is bold",
                            marks: [{type: "Bold"}, {type: "Strike"}],
                        },
                    ],
                },
            ],
        },
        `\
**~~[This is a bold link](https://example.com) and this is bold~~**
`,
    );
});

test("bold + strike text next to bold + strike link text next to bold + strike text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "This is bold ",
                            marks: [{type: "Bold"}, {type: "Strike"}],
                        },
                        {
                            type: "Text",
                            text: "and this is a bold link",
                            marks: [
                                {type: "Bold"},
                                {type: "Strike"},
                                {type: "Link", url: "https://example.com"},
                            ],
                        },
                        {
                            type: "Text",
                            text: " and this is bold",
                            marks: [{type: "Bold"}, {type: "Strike"}],
                        },
                    ],
                },
            ],
        },
        `\
**~~This is bold [and this is a bold link](https://example.com) and this is bold~~**
`,
    );
});

test("code mark takes precedence over other marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "code with bold",
                            marks: [{type: "Code"}, {type: "Bold"}],
                        },
                    ],
                },
            ],
        },
        `\
**\`code with bold\`**
`,
    );
});

test("multiple marks are sorted correctly", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        // Test mark sorting order - should be Link > Bold > Italic > Strike
                        {
                            type: "Text",
                            text: "strike then italic",
                            marks: [{type: "Strike"}, {type: "Italic"}],
                        },
                        {type: "Text", text: " and "},
                        {
                            type: "Text",
                            text: "italic then strike",
                            marks: [{type: "Italic"}, {type: "Strike"}],
                        },
                    ],
                },
            ],
        },
        `\
*~~strike then italic~~* and *~~italic then strike~~*
`,
    );
});

test("link mark comes first in order", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "styled link",
                            marks: [
                                {type: "Strike"},
                                {type: "Link", url: "https://example.com"},
                                {type: "Bold"},
                                {type: "Italic"},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
[***~~styled link~~***](https://example.com)
`,
    );
});

test("paragraph with only break", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Break"}],
                },
            ],
        },
        `\
<br/>
`,
    );
});

test("paragraph with only bold break", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Break", marks: [{type: "Bold"}]}],
                },
            ],
        },
        `\
**<br/>**
`,
    );
});

test("paragraph with only breaks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Break"}, {type: "Break"}, {type: "Break"}],
                },
            ],
        },
        `\
<br/><br/><br/>
`,
    );
});

test("break at start of paragraph", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Break"}, {type: "Text", text: "Text after break"}],
                },
            ],
        },
        `\
\\
Text after break
`,
    );
});

test("breaks at start of paragraph", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Break"},
                        {type: "Break"},
                        {type: "Break"},
                        {type: "Text", text: "Text after break"},
                    ],
                },
            ],
        },
        `\
\\
\\
\\
Text after break
`,
    );
});

test("break at end of paragraph", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Text before break"}, {type: "Break"}],
                },
            ],
        },
        `\
Text before break<br/>
`,
    );
});

test("breaks at end of paragraph", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Text before break"},
                        {type: "Break"},
                        {type: "Break"},
                        {type: "Break"},
                    ],
                },
            ],
        },
        `\
Text before break<br/><br/><br/>
`,
    );
});

test("adjacent text elements with same marks should stay separate", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "First bold", marks: [{type: "Bold"}]},
                        {type: "Text", text: " second bold", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
**First bold second bold**
`,
    );
});

test("empty text elements are handled", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Before"},
                        {type: "Text", text: ""},
                        {type: "Text", text: "After"},
                    ],
                },
            ],
        },
        `\
BeforeAfter
`,
    );
});

test("text with only marks but no content", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "", marks: [{type: "Bold"}]}],
                },
            ],
        },
        `\
<p></p>
`,
    );
});

test("multiple consecutive breaks with different marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Start"},
                        {type: "Break"},
                        {type: "Break", marks: [{type: "Bold"}]},
                        {type: "Break", marks: [{type: "Italic"}]},
                        {type: "Text", text: "End"},
                    ],
                },
            ],
        },
        `\
Start<br/>**<br/>**_<br/>_&#x45;nd
`,
    );
});

test("dollar signs are escaped for math", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Price is $100 or $$200"}],
                },
            ],
        },
        `\
Price is \\$100 or \\$\\$200
`,
    );
});

test("hash symbols at start of line", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "# Not a heading"}],
                },
            ],
        },
        `\
\\# Not a heading
`,
    );
});

test("numbers with dots at start of line", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "1. Not a list item"}],
                },
            ],
        },
        `\
1\\. Not a list item
`,
    );
});

test("dashes at start of line", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "- Not a list item"}],
                },
            ],
        },
        `\
\\- Not a list item
`,
    );
});

test("plus signs at start of line", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "+ Not a list item"}],
                },
            ],
        },
        `\
\\+ Not a list item
`,
    );
});

test("greater than at start of line", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "> Not a quote"}],
                },
            ],
        },
        `\
\\> Not a quote
`,
    );
});

test("pipes in text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "A | B | C"}],
                },
            ],
        },
        `\
A | B | C
`,
    );
});

test("exclamation marks before brackets", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "![Not an image]"}],
                },
            ],
        },
        `\
!\\[Not an image]
`,
    );
});

test("parentheses after brackets", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "[text](not-a-link)"}],
                },
            ],
        },
        `\
\\[text]\\(not-a-link)
`,
    );
});

test("triple backticks in plain text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Use ``` for code blocks"}],
                },
            ],
        },
        `\
Use \\\`\\\`\\\` for code blocks
`,
    );
});

test("tilde characters", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "~not struck~ ~~also not struck~~"}],
                },
            ],
        },
        `\
\\~not struck\\~ \\~\\~also not struck\\~\\~
`,
    );
});

test("link with parentheses in URL", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "link",
                            marks: [{type: "Link", url: "https://example.com/path(with)parens"}],
                        },
                    ],
                },
            ],
        },
        `\
[link](https://example.com/path\\(with\\)parens)
`,
    );
});

test("link with spaces in URL", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "link",
                            marks: [{type: "Link", url: "https://example.com/path with spaces"}],
                        },
                    ],
                },
            ],
        },
        `\
[link](<https://example.com/path with spaces>)
`,
    );
});

test("angle brackets in URL", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "link",
                            marks: [{type: "Link", url: "https://example.com/<path>"}],
                        },
                    ],
                },
            ],
        },
        `\
[link](https://example.com/\\<path\\>)
`,
    );
});

test("reference-style link syntax in text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "[link][reference]"}],
                },
            ],
        },
        `\
\\[link]\\[reference]
`,
    );
});

test("footnote syntax in text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Text[^1] with footnote"}],
                },
            ],
        },
        `\
Text\\[^1] with footnote
`,
    );
});

test("horizontal rule characters", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "---"}],
                },
            ],
        },
        `\
\\---
`,
    );
});

test("asterisk horizontal rule", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "***"}],
                },
            ],
        },
        `\
\\*\\*\\*
`,
    );
});

test("code fence in text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "```javascript"}],
                },
            ],
        },
        `\
\\\`\\\`\\\`javascript
`,
    );
});

test("account mention", async () => {
    const accountId = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            isAccountShortName: false,
                            marks: [],
                        },
                    ],
                },
            ],
        },
        `\
[Unknown](https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention)
`,
    );
});

test("task mention with empty title", async () => {
    const taskId = generateId<TaskId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Task", id: taskId},
                            title: "",
                            isAccountShortName: false,
                            marks: [],
                        },
                    ],
                },
            ],
        },
        `\
[](https://alpine.inc/s/${spaceId}/tasks/${taskId}?mention)
`,
    );
});

test("unicode multi-code point grapheme after bold", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: " ", marks: [{type: "Bold"}]},
                        {type: "Text", text: "\uD800\uDC00", marks: []},
                    ],
                },
                {type: "Paragraph", elements: []},
            ],
        },
        `\
**&#x20;**&#x10000;

<p></p>
`,
    );
});

test("unicode multi-code point grapheme before bold", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "\uD800\uDC00", marks: []},
                        {type: "Text", text: " ", marks: [{type: "Bold"}]},
                    ],
                },
                {type: "Paragraph", elements: []},
            ],
        },
        `\
&#x10000;**&#x20;**

<p></p>
`,
    );
});

test("mention with link mark", async () => {
    const taskId = generateId<TaskId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Task", id: taskId},
                            title: undefined,
                            isAccountShortName: false,
                            marks: [{type: "Link", url: "http://a.aa"}],
                        },
                    ],
                },
                {type: "Paragraph", elements: []},
            ],
        },
        `\
<a href="http://a.aa">[Unknown task](https://alpine.inc/s/${spaceId}/tasks/${taskId}?mention)</a>

<p></p>
`,
    );
});

test("mention with strike mark", async () => {
    const documentId = generateId<DocumentId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "Document", id: documentId},
                            title: undefined,
                            isAccountShortName: false,
                            marks: [{type: "Strike"}],
                        },
                        {type: "Text", text: "0", marks: []},
                    ],
                },
                {type: "Paragraph", elements: []},
            ],
        },
        `\
~~[Unknown document](https://alpine.inc/s/${spaceId}/documents/${documentId}?mention)~~&#x30;

<p></p>
`,
    );
});

test("space with bold mark in quote block", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: " ", marks: [{type: "Bold"}]}],
                        },
                    ],
                },
            ],
        },
        `\
> **&#x20;**
`,
    );
});

test("character with strike mark in quote block", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "x", marks: [{type: "Strike"}]}],
                        },
                    ],
                },
            ],
        },
        `\
> ~~x~~
`,
    );
});

test("space with strike mark in quote block", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: " ", marks: [{type: "Strike"}]}],
                        },
                    ],
                },
            ],
        },
        `\
> ~~&#x20;~~
`,
    );
});

test("ignores content that looks like inline math", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "$[", marks: []},
                        {type: "Text", text: "$", marks: []},
                    ],
                },
            ],
        },
        `\
\\$\\[\\$
`,
    );
});

test("bold with single space next to italics", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: " ", marks: [{type: "Bold"}]},
                        {type: "Text", text: "0", marks: [{type: "Italic"}]},
                    ],
                },
            ],
        },
        `\
**&#x20;**_0_
`,
    );
});

test("italicized escaped space", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "\\ ", marks: [{type: "Italic"}]}],
                },
            ],
        },
        `\
*\\\\&#x20;*
`,
    );
});

test("bolded escaped space", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "\\ ", marks: [{type: "Bold"}]}],
                },
            ],
        },
        `\
**\\\\&#x20;**
`,
    );
});

test("struck escaped space", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "\\ ", marks: [{type: "Strike"}]}],
                },
            ],
        },
        `\
~~\\\\&#x20;~~
`,
    );
});

test("italicized double space", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "  ", marks: [{type: "Italic"}]}],
                },
            ],
        },
        `\
*&#x20;&#x20;*
`,
    );
});

test("italic space after bold italic space in quote block", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {
                                    type: "Text",
                                    text: " ",
                                    marks: [{type: "Italic"}, {type: "Bold"}],
                                },
                                {type: "Text", text: " ", marks: [{type: "Italic"}]},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
> ***&#x20;***_&#x20;_
`,
    );
});

test("empty text after break", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Break", marks: []},
                        {type: "Text", text: "", marks: []},
                    ],
                },
            ],
        },
        `\
<br/>
`,
    );
});

test("escaped character followed by bold space", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "\\A", marks: []},
                        {type: "Text", text: " ", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
\\\\&#x41;**&#x20;**
`,
    );
});

test("math like text followed by space", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "$*$ ", marks: []}],
                },
            ],
        },
        `\
\\$\\*\\$&#x20;
`,
    );
});

test("mention with link that contains HTML unsafe character", async () => {
    const collectionId = generateId<TaskCollectionId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Mention",
                            target: {type: "TaskCollection", id: collectionId},
                            title: "",
                            isAccountShortName: false,
                            marks: [{type: "Link", url: "http://a.aa/&"}],
                        },
                    ],
                },
            ],
        },
        `\
<a href="http://a.aa/&amp;">[](https://alpine.inc/s/${spaceId}/tasks/collections/${collectionId}?mention)</a>
`,
    );
});

test("break followed by mention with link", async () => {
    const accountId = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Break", marks: []},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: undefined,
                            isAccountShortName: false,
                            marks: [{type: "Link", url: "http://a.aa"}],
                        },
                    ],
                },
            ],
        },
        `\
<br/><a href="http://a.aa">[Unknown](https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention)</a>
`,
    );
});

test("marked break followed by mention with link", async () => {
    const accountId = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Break", marks: [{type: "Bold"}]},
                        {
                            type: "Mention",
                            target: {type: "Account", id: accountId},
                            title: undefined,
                            isAccountShortName: false,
                            marks: [{type: "Link", url: "http://a.aa"}],
                        },
                    ],
                },
            ],
        },
        `\
**<br/>**<a href="http://a.aa">[Unknown](https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention)</a>
`,
    );
});

test("mention inside math like text", async () => {
    const documentId = generateId<DocumentId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "$_", marks: []},
                        {
                            type: "Mention",
                            target: {type: "Document", id: documentId},
                            title: undefined,
                            isAccountShortName: false,
                            marks: [],
                        },
                        {type: "Text", text: "$", marks: []},
                    ],
                },
            ],
        },
        `\
\\$\\_[Unknown document](https://alpine.inc/s/${spaceId}/documents/${documentId}?mention)\\$
`,
    );
});

test("escapes dollar sign in text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "a $ b", marks: []}],
                },
            ],
        },
        `\
a \\$ b
`,
    );
});

test("escapes dollar sign at start of text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "$ b", marks: []}],
                },
            ],
        },
        `\
\\$ b
`,
    );
});

test("escapes dollar sign at end of text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "a $", marks: []}],
                },
            ],
        },
        `\
a \\$
`,
    );
});

test("escapes dollar sign at start and end of text", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "$ ab $", marks: []}],
                },
            ],
        },
        `\
\\$ ab \\$
`,
    );
});

test("escapes dollar sign at start and end of text when followed by underscores", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "$_ab_$", marks: []}],
                },
            ],
        },
        `\
\\$\\_ab\\_\\$
`,
    );
});

test("escapes dollar sign at start and end of text when followed by asterisks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "$*ab*$", marks: []}],
                },
            ],
        },
        `\
\\$\\*ab\\*\\$
`,
    );
});

test("escapes dollar sign at start and end of text when followed by parenthesis", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "$(ab)$", marks: []}],
                },
            ],
        },
        `\
\\$(ab)\\$
`,
    );
});

test("italicized unicode code point from multiple utf-16 code units", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "0", marks: []},
                        {type: "Text", text: "\uD800\uDC00", marks: [{type: "Italic"}]},
                        {type: "Text", text: " ", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
&#x30;_&#x10000;_**&#x20;**
`,
    );
});

test("unicode code point that looks like punctuation if you just look at the first utf-16 code unit", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: " ", marks: [{type: "Bold"}]},
                                {type: "Text", text: "\uD806\uDC00", marks: []},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
> **&#x20;**&#x11800;
`,
    );
});

test("separate text elements escaping character that gets encoded", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "\\", marks: []},
                        {type: "Text", text: "0", marks: []},
                        {type: "Text", text: " ", marks: [{type: "Italic"}]},
                    ],
                },
            ],
        },
        `\
\\\\&#x30;*&#x20;*
`,
    );
});

test("two breaks followed by a mention with a link mark", async () => {
    const postId = generateId<PostId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Break", marks: []},
                        {type: "Break", marks: []},
                        {
                            type: "Mention",
                            target: {type: "Post", id: postId},
                            title: "",
                            isAccountShortName: false,
                            marks: [{type: "Link", url: "http://a.aa"}],
                        },
                    ],
                },
            ],
        },
        `\
<br/><br/><a href="http://a.aa">[](https://alpine.inc/s/${spaceId}/posts/${postId}?mention)</a>
`,
    );
});

test("punctuation unicode code point represented by two utf-16 code units is escaped", async () => {
    const unicode = "\u{1E95E}";

    expect(unicode.length).toEqual(2);
    expect(unicode).toMatch(/\p{P}/u);

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: " ", marks: [{type: "Bold"}]},
                        {type: "Text", text: unicode, marks: []},
                    ],
                },
            ],
        },
        `\
**&#x20;**&#x1E95E;
`,
    );
});

test("unicode code point with two utf-16 code units at the end of strike mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: " \uD806\uDC00", marks: [{type: "Strike"}]},
                        {type: "Text", text: "A", marks: []},
                    ],
                },
            ],
        },
        `\
~~&#x20;&#x11800;~~&#x41;
`,
    );
});

test("doesn\u2019t parse angle brackets with @ content as autolink", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "<@", marks: []},
                        {type: "Text", text: "0>", marks: []},
                    ],
                },
            ],
        },
        `\
\\<@0>
`,
    );
});

test("doesn\u2019t parse angle brackets with number content as autolink", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "<0@0>", marks: []}],
                },
            ],
        },
        `\
\\<0@0>
`,
    );
});

test("doesn\u2019t parse angle brackets with bracket content as autolink", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "<<@0>", marks: []}],
                },
            ],
        },
        `\
<\\<@0>
`,
    );
});

test("doesn\u2019t parse angle brackets with space content as autolink", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "< @0>", marks: []}],
                },
            ],
        },
        `\
< @0>
`,
    );
});

test("uses HTML form of break if followed by italic space", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Break", marks: []},
                        {type: "Text", text: " ", marks: [{type: "Italic"}]},
                    ],
                },
            ],
        },
        `\
<br/>*&#x20;*
`,
    );
});

test("uses HTML form of break if followed by bold space", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Break", marks: []},
                        {type: "Text", text: " ", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
<br/>**&#x20;**
`,
    );
});

test("uses HTML form of break if followed by strike space", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Break", marks: []},
                        {type: "Text", text: " ", marks: [{type: "Strike"}]},
                    ],
                },
            ],
        },
        `\
<br/>~~&#x20;~~
`,
    );
});

test("empty code block", async () => {
    await testPrintApiContentToMarkdown(
        {elements: [{type: "Code", language: "erlang", lines: []}]},
        `\
\`\`\`erlang
\`\`\`
`,
    );
});

test("empty code block (with empty line)", async () => {
    await testPrintApiContentToMarkdown(
        {elements: [{type: "Code", language: "erlang", lines: [{elements: []}]}]},
        `\
\`\`\`erlang
\`\`\`
`,
    );
});

test("empty code block (with empty line with no text but marks)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "lua",
                    lines: [
                        {
                            elements: [
                                {
                                    type: "Text",
                                    text: "",
                                    marks: [{type: "Italic"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
\`\`\`lua
\`\`\`
`,
    );
});

test("code block with empty mark and separate unmarked text elements", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "lua",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: " ", marks: []},
                                {type: "Text", text: "<", marks: []},
                                {
                                    type: "Text",
                                    text: "",
                                    marks: [{type: "Link", url: "http://a.aa"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
\`\`\`lua
 <
\`\`\`
`,
    );
});

test("code block with empty mark and separate marked text elements", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "lua",
                    lines: [
                        {
                            elements: [
                                {type: "Text", text: " ", marks: []},
                                {type: "Text", text: "<", marks: [{type: "Bold"}]},
                                {
                                    type: "Text",
                                    text: "",
                                    marks: [{type: "Link", url: "http://a.aa"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-lua">
 <strong>&lt;</strong>
</code>
</pre>
`,
    );
});

test("backticks at start/end of text in inline code", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "`test`",
                            marks: [{type: "Code"}],
                        },
                    ],
                },
            ],
        },
        `\
\`\` \`test\` \`\`
`,
    );
});

test("backticks after/before spaces at start/end of text in inline code", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: " `test` ",
                            marks: [{type: "Code"}],
                        },
                    ],
                },
            ],
        },
        `\
\`\`  \`test\`  \`\`
`,
    );
});

test("text that looks like a definition inside code + link", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "]:",
                            marks: [{type: "Code"}, {type: "Link", url: "http://a.aa"}],
                        },
                    ],
                },
            ],
        },
        `\
[<code>\\]:</code>](http://a.aa)
`,
    );
});

test("italic content next to bold content when italic content is merged with previous link", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: " ",
                            marks: [{type: "Bold"}, {type: "Italic"}],
                        },
                        {
                            type: "Text",
                            text: " ",
                            marks: [{type: "Link", url: "http://a.aa"}, {type: "Italic"}],
                        },
                        {
                            type: "Text",
                            text: " ",
                            marks: [{type: "Italic"}],
                        },
                    ],
                },
            ],
        },
        `\
***&#x20;***_[ ](http://a.aa)&#x20;_
`,
    );
});

test("empty table", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [],
                },
            ],
        },
        `\
<table>
<tbody>
<tr>
<td>

</td>
<td>

</td>
</tr>
</tbody>
</table>
`,
    );
});

test("empty table with header row", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [],
                },
            ],
        },
        `\
| | |
| - | - |
`,
    );
});

test("empty table with header column", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: true,
                    columns: [],
                    rows: [],
                },
            ],
        },
        `\
<table>
<tbody>
<tr>
<th>

</th>
<td>

</td>
</tr>
</tbody>
</table>
`,
    );
});

test("empty table with header row and column", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: true,
                    columns: [],
                    rows: [],
                },
            ],
        },
        `\
<table>
<thead>
<tr>
<th>

</th>
<th scope="col">

</th>
</tr>
</thead>
</table>
`,
    );
});

test("adjacent unordered lists", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fourth item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- First item

- Second item

- Third item

- Fourth item
`,
    );
});

test("adjacent ordered lists", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fourth item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. First item

2. Second item

3. Third item

4. Fourth item
`,
    );
});

test("adjacent unordered lists with empty list in between", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                    ],
                },
                {type: "UnorderedList", items: []},
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fourth item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
- First item

- Second item

- Third item

- Fourth item
`,
    );
});

test("adjacent ordered lists with empty list in between", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                    ],
                },
                {type: "OrderedList", items: []},
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fourth item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. First item

2. Second item

3. Third item

4. Fourth item
`,
    );
});

test("adjacent ordered lists with empty unordered list in between", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "First item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Second item"}],
                                },
                            ],
                        },
                    ],
                },
                {type: "UnorderedList", items: []},
                {
                    type: "OrderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Third item"}],
                                },
                            ],
                        },
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "Fourth item"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
1. First item

2. Second item

3. Third item

4. Fourth item
`,
    );
});

test("table with one row and three empty cells", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {elements: [{type: "Paragraph", elements: []}]},
                                {elements: [{type: "Paragraph", elements: []}]},
                                {elements: [{type: "Paragraph", elements: []}]},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| | | |
| - | - | - |
`,
    );
});

test("table with one row and three empty cells without header row", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [{cells: [{elements: []}, {elements: []}, {elements: []}]}],
                },
            ],
        },
        `\
<table>
<tbody>
<tr>
<td>

</td>
<td>

</td>
<td>

</td>
</tr>
</tbody>
</table>
`,
    );
});

test("table with two rows and three empty cells without header row (first row has no cells)", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [{cells: []}, {cells: [{elements: []}, {elements: []}, {elements: []}]}],
                },
            ],
        },
        `\
<table>
<tbody>
<tr>
<td>

</td>
<td>

</td>
</tr>
<tr>
<td>

</td>
<td>

</td>
<td>

</td>
</tr>
</tbody>
</table>
`,
    );
});

test("table with more column widths than columns", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [
                        {width: 0.009999999776482582},
                        {width: 0.009999999776482582},
                        {width: 0.009999999776482582},
                    ],
                    rows: [],
                },
            ],
        },
        `\
| | <span hidden data-column-widths="0.009999999776482582,0.009999999776482582,0.009999999776482582"/> |
| - | - |
`,
    );
});

test("paragraph that\u2019s a single space in table cell", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: " ", marks: []}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| &#x20; | |
| - | - |
`,
    );
});

test("paragraph with trailing spaces in table cell", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "foo   ", marks: []}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| foo  &#x20; | |
| - | - |
`,
    );
});

test("paragraph with leading spaces in table cell", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "   foo", marks: []}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| &#x20;  foo | |
| - | - |
`,
    );
});

test("paragraph with trailing spaces that\u2019s a single space in table cell", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {type: "Text", text: " ", marks: []},
                                                {type: "Text", text: " ", marks: []},
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| &#x20;&#x20; | |
| - | - |
`,
    );
});

test("italic before to bolded link which has lifted its mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "-X", marks: [{type: "Italic"}]},
                        {
                            type: "Text",
                            text: "-y/@`/$bz1",
                            marks: [
                                {type: "Link", url: "https://63o.kry"},
                                {type: "Bold"},
                                {type: "Strike"},
                            ],
                        },
                        {type: "Text", text: "G", marks: [{type: "Bold"}]},
                    ],
                },
            ],
        },
        `\
_-X_**[~~-y/@\\\`/\\$bz1~~](https://63o.kry)G**
`,
    );
});

test("simple table with a really long cell", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Title", marks: []}],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "Body", marks: []}],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {type: "Text", text: "Lorem Ipsum", marks: []},
                                            ],
                                        },
                                    ],
                                },
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {
                                                    type: "Text",
                                                    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer eget tortor libero. Praesent ac tortor vel justo cursus vestibulum. Etiam feugiat dictum ipsum at gravida. Curabitur condimentum libero non arcu vulputate, at commodo arcu ultrices. Ut pellentesque eleifend ante. Nulla fermentum orci eget nulla eleifend gravida in sed purus. Cras mollis dictum augue, at ultrices libero sollicitudin nec.",
                                                    marks: [],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| Title | Body |
| - | - |
| Lorem Ipsum | Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer eget tortor libero. Praesent ac tortor vel justo cursus vestibulum. Etiam feugiat dictum ipsum at gravida. Curabitur condimentum libero non arcu vulputate, at commodo arcu ultrices. Ut pellentesque eleifend ante. Nulla fermentum orci eget nulla eleifend gravida in sed purus. Cras mollis dictum augue, at ultrices libero sollicitudin nec. |
`,
    );
});

test("link that looks like mention", async () => {
    const documentId = generateId<DocumentId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Click "},
                        {
                            type: "Text",
                            text: "here",
                            marks: [
                                {
                                    type: "Link",
                                    url: `https://alpine.inc/s/${spaceId}/documents/${documentId}?mention`,
                                },
                            ],
                        },
                        {type: "Text", text: " to visit"},
                    ],
                },
            ],
        },
        `\
Click <a href="https://alpine.inc/s/${spaceId}/documents/${documentId}?mention">here</a> to visit
`,
    );
});

test("link that looks like a short account mention", async () => {
    const accountId = generateId<AccountId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Click "},
                        {
                            type: "Text",
                            text: "here",
                            marks: [
                                {
                                    type: "Link",
                                    url: `https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention=short`,
                                },
                            ],
                        },
                        {type: "Text", text: " to visit"},
                    ],
                },
            ],
        },
        `\
Click <a href="https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention=short">here</a> to visit
`,
    );
});

test("pipe in table cell", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "|"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| \\| | |
| - | - |
`,
    );
});

test("escaped pipe in table cell", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "\\|"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| \\\\\\| | |
| - | - |
`,
    );
});

test("pipe in table cell with code mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {
                                                    type: "Text",
                                                    text: "|",
                                                    marks: [{type: "Code"}],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| \`\\|\` | |
| - | - |
`,
    );
});

test("escaped pipe in table cell with code mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {
                                                    type: "Text",
                                                    text: "\\|",
                                                    marks: [{type: "Code"}],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<table>
<thead>
<tr>
<th>

\`\\|\`

</th>
<th>

</th>
</tr>
</thead>
</table>
`,
    );
});

test("escaped pipe between text in table cell with code mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {
                                                    type: "Text",
                                                    text: "a\\|b",
                                                    marks: [{type: "Code"}],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<table>
<thead>
<tr>
<th>

\`a\\|b\`

</th>
<th>

</th>
</tr>
</thead>
</table>
`,
    );
});

// Tests for Heading and Divider elements
test("heading level 1", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Main Title"}],
                },
            ],
        },
        `\
# Main Title
`,
    );
});

test("heading level 2", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Heading",
                    level: 2,
                    elements: [{type: "Text", text: "Subtitle"}],
                },
            ],
        },
        `\
## Subtitle
`,
    );
});

test("heading level 3", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Heading",
                    level: 3,
                    elements: [{type: "Text", text: "Section"}],
                },
            ],
        },
        `\
### Section
`,
    );
});

test("heading with marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Heading",
                    level: 2,
                    elements: [
                        {type: "Text", text: "Bold "},
                        {type: "Text", text: "and", marks: [{type: "Bold"}]},
                        {type: "Text", text: " "},
                        {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                        {type: "Text", text: " heading"},
                    ],
                },
            ],
        },
        `\
## Bold **and** *italic* heading
`,
    );
});

test("heading with empty content", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Heading",
                    level: 1,
                    elements: [],
                },
            ],
        },
        `\
#
`,
    );
});

test("heading with break nodes", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Heading",
                    level: 2,
                    elements: [
                        {type: "Text", text: "Multi"},
                        {type: "Break"},
                        {type: "Text", text: "line heading"},
                    ],
                },
            ],
        },
        `\
## Multi<br/>line heading
`,
    );
});

test("multiple headings", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Heading",
                    level: 1,
                    elements: [{type: "Text", text: "Chapter 1"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Some content here."}],
                },
                {
                    type: "Heading",
                    level: 2,
                    elements: [{type: "Text", text: "Section A"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "More content."}],
                },
            ],
        },
        `\
# Chapter 1

Some content here.

## Section A

More content.
`,
    );
});

test("divider", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Divider",
                },
            ],
        },
        `\
<hr/>
`,
    );
});

test("divider between paragraphs", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Before divider"}],
                },
                {
                    type: "Divider",
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "After divider"}],
                },
            ],
        },
        `\
Before divider

---

After divider
`,
    );
});

test("multiple dividers", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Section 1"}],
                },
                {
                    type: "Divider",
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Section 2"}],
                },
                {
                    type: "Divider",
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "Section 3"}],
                },
            ],
        },
        `\
Section 1

---

Section 2

---

Section 3
`,
    );
});

test("dividers that look like frontmatter", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {type: "Divider"},
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "title: Hello, world!"}],
                },
                {type: "Divider"},
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "The quick brown fox jumps over the lazy dog."},
                    ],
                },
            ],
        },
        `\
<hr/>

title: Hello, world!

---

The quick brown fox jumps over the lazy dog.
`,
    );
});

test("paragraph that looks like frontmatter", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "---"},
                        {type: "Break"},
                        {type: "Text", text: "title: Hello, world!"},
                        {type: "Break"},
                        {type: "Text", text: "---"},
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "The quick brown fox jumps over the lazy dog."},
                    ],
                },
            ],
        },
        `\
\\---\\
title: Hello, world!\\
\\---

The quick brown fox jumps over the lazy dog.
`,
    );
});

test("paragraphs that look like frontmatter", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "---"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "title: Hello, world!"}],
                },
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "---"}],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "The quick brown fox jumps over the lazy dog."},
                    ],
                },
            ],
        },
        `\
\\---

title: Hello, world!

\\---

The quick brown fox jumps over the lazy dog.
`,
    );
});

test("divider before empty unordered list", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {type: "Divider"},
                {
                    type: "UnorderedList",
                    items: [
                        {elements: [{type: "Paragraph", elements: []}], nestedListElements: []},
                    ],
                },
            ],
        },
        `\
<hr/>

- <p></p>
`,
    );
});

test("divider after paragraph but before empty unordered list", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {type: "Paragraph", elements: [{type: "Text", text: "a"}]},
                {type: "Divider"},
                {
                    type: "UnorderedList",
                    items: [
                        {elements: [{type: "Paragraph", elements: []}], nestedListElements: []},
                    ],
                },
            ],
        },
        `\
a

---

- <p></p>
`,
    );
});

// Highlight mark tests
test("text with highlight mark", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {
                            type: "Text",
                            text: "highlighted",
                            marks: [{type: "Highlight", color: "Red"}],
                        },
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
        `\
This is <mark class="highlight-red">highlighted</mark> text
`,
    );
});

test("text with different highlight colors", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "Red ", marks: [{type: "Highlight", color: "Red"}]},
                        {
                            type: "Text",
                            text: "Orange ",
                            marks: [{type: "Highlight", color: "Orange"}],
                        },
                        {
                            type: "Text",
                            text: "Green ",
                            marks: [{type: "Highlight", color: "Green"}],
                        },
                        {type: "Text", text: "Blue ", marks: [{type: "Highlight", color: "Blue"}]},
                        {
                            type: "Text",
                            text: "Purple",
                            marks: [{type: "Highlight", color: "Purple"}],
                        },
                    ],
                },
            ],
        },
        `\
<mark class="highlight-red">Red </mark><mark class="highlight-orange">Orange </mark><mark class="highlight-green">Green </mark><mark class="highlight-blue">Blue </mark><mark class="highlight-purple">Purple</mark>
`,
    );
});

test("text with highlight and other marks", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "bold highlighted text",
                            marks: [{type: "Bold"}, {type: "Highlight", color: "Blue"}],
                        },
                    ],
                },
            ],
        },
        `\
<mark class="highlight-blue">**bold highlighted text**</mark>
`,
    );
});

// Comment mark tests
test("text with comment mark", async () => {
    const threadId = generateId<DocumentCommentThreadId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This is "},
                        {type: "Text", text: "commented", marks: [{type: "Comment", threadId}]},
                        {type: "Text", text: " text"},
                    ],
                },
            ],
        },
        `\
This is <mark data-comment="${threadId}">commented</mark> text
`,
    );
});

test("text with comment and highlight marks", async () => {
    const threadId = generateId<DocumentCommentThreadId>();

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "highlighted and commented",
                            marks: [
                                {type: "Highlight", color: "Green"},
                                {type: "Comment", threadId},
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<mark data-comment="${threadId}"><mark class="highlight-green">highlighted and commented</mark></mark>
`,
    );
});

test("text with multiple comment marks preserves all comments", async () => {
    const threadId1 = assertId<DocumentCommentThreadId>("89z0rd2c0wh8fkdb1jc71mj5a4");
    const threadId2 = assertId<DocumentCommentThreadId>("ynd1e11m2grtkxtr58qek5mktr");
    const threadId3 = assertId<DocumentCommentThreadId>("3xqx9qc10mk0wq0nqke1vjqea8");

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This text has "},
                        {
                            type: "Text",
                            text: "multiple comments",
                            marks: [
                                {type: "Comment", threadId: threadId1},
                                {type: "Comment", threadId: threadId2},
                                {type: "Comment", threadId: threadId3},
                            ],
                        },
                        {type: "Text", text: " on it"},
                    ],
                },
            ],
        },
        `\
This text has <mark data-comment="${threadId3}"><mark data-comment="${threadId1}"><mark data-comment="${threadId2}">multiple comments</mark></mark></mark> on it
`,
    );
});

test("text with multiple highlight marks only prints one highlight", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {type: "Text", text: "This text has "},
                        {
                            type: "Text",
                            text: "multiple highlights",
                            marks: [
                                {type: "Highlight", color: "Red"},
                                {type: "Highlight", color: "Blue"},
                                {type: "Highlight", color: "Green"},
                            ],
                        },
                        {type: "Text", text: " but only one should print"},
                    ],
                },
            ],
        },
        `\
This text has <mark class="highlight-green">multiple highlights</mark> but only one should print
`,
    );
});

test("comment mark inside code block", async () => {
    const threadId = assertId<DocumentCommentThreadId>("00000000000000000000000000");

    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Code",
                    language: "javascript",
                    lines: [
                        {
                            elements: [
                                {
                                    type: "Text",
                                    text: " ",
                                    marks: [{type: "Comment", threadId}],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<pre>
<code class="language-javascript">
<mark data-comment="${threadId}"> </mark>
</code>
</pre>
`,
    );
});

test("code block with highlight mark inside", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Code",
                                            language: "elixir",
                                            lines: [
                                                {
                                                    elements: [
                                                        {
                                                            type: "Text",
                                                            text: " ",
                                                            marks: [
                                                                {
                                                                    type: "Highlight",
                                                                    color: "Purple",
                                                                },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
<table>
<tbody>
<tr>
<td>

<pre>
<code class="language-elixir">
<mark class="highlight-purple"> </mark>
</code>
</pre>

</td>
<td>

</td>
</tr>
</tbody>
</table>
`,
    );
});

test("identical adjacent marks in simple table cell", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [
                                                {
                                                    type: "Text",
                                                    text: " ",
                                                    marks: [{type: "Highlight", color: "Red"}],
                                                },
                                                {
                                                    type: "Text",
                                                    text: " ",
                                                    marks: [{type: "Highlight", color: "Red"}],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| <mark class="highlight-red">  </mark> | |
| - | - |
`,
    );
});

test("backslash before escaped space in simple table cell", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Table",
                    width: 1,
                    hasHeaderRow: true,
                    hasHeaderColumn: false,
                    columns: [],
                    rows: [
                        {
                            cells: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            elements: [{type: "Text", text: "\\ ", marks: []}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        `\
| \\\\&#x20; | |
| - | - |
`,
    );
});

test("less than in link URL", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: " ",
                            marks: [{type: "Link", url: "<"}],
                        },
                    ],
                },
            ],
        },
        `\
[ ](\\<)
`,
    );
});

test("less than with text followed by greater than in link URL", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: " ",
                            marks: [{type: "Link", url: "<test>"}],
                        },
                    ],
                },
            ],
        },
        `\
[ ](\\<test\\>)
`,
    );
});

test("less than after text in link URL", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: " ",
                            marks: [{type: "Link", url: "test<"}],
                        },
                    ],
                },
            ],
        },
        `\
[ ](test\\<)
`,
    );
});

test("less than followed by text (with space) followed by greater than in link URL", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: " ",
                            marks: [{type: "Link", url: "<hello world>"}],
                        },
                    ],
                },
            ],
        },
        `\
[ ](<\\<hello world\\>>)
`,
    );
});

test("greater than in link URL", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: " ",
                            marks: [{type: "Link", url: ">"}],
                        },
                    ],
                },
            ],
        },
        `\
[ ](\\>)
`,
    );
});

test("less than or not equals in link URL", async () => {
    await testPrintApiContentToMarkdown(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: " ",
                            marks: [{type: "Link", url: "≮"}],
                        },
                    ],
                },
            ],
        },
        `\
[ ](\\≮)
`,
    );
});

describe("comment mark conversion", () => {
    describe("`withSimpleCommentMarkHtml` is false", () => {
        test("comment mark mixed with other marks", async () => {
            const threadId = generateId<DocumentCommentThreadId>();

            await testPrintApiContentToMarkdown(
                {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "Next, something outrageous happened. "},
                                {
                                    type: "Text",
                                    text: "The Eagles sought to defend ",
                                    marks: [{type: "Comment", threadId}],
                                },
                                {
                                    type: "Text",
                                    text: "their title",
                                    marks: [
                                        {type: "Comment", threadId},
                                        {type: "Link", url: "https://example.com"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " (and honor) in the 2025-2026 season. They promoted a ",
                                    marks: [{type: "Comment", threadId}],
                                },
                                {
                                    type: "Text",
                                    text: "mere",
                                    marks: [{type: "Comment", threadId}, {type: "Italic"}],
                                },
                                {
                                    type: "Text",
                                    text: " ",
                                    marks: [{type: "Comment", threadId}],
                                },
                                {
                                    type: "Text",
                                    text: "squire",
                                    marks: [{type: "Comment", threadId}, {type: "Bold"}],
                                },
                                {
                                    type: "Text",
                                    text: " to the ",
                                    marks: [{type: "Comment", threadId}],
                                },
                                {
                                    type: "Text",
                                    text: "captain",
                                    marks: [{type: "Comment", threadId}, {type: "Strike"}],
                                },
                                {
                                    type: "Text",
                                    text: " of their ",
                                    marks: [{type: "Comment", threadId}],
                                },
                                {
                                    type: "Text",
                                    text: "army",
                                    marks: [
                                        {type: "Comment", threadId},
                                        {type: "Highlight", color: "Red"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: ".",
                                    marks: [{type: "Comment", threadId}],
                                },
                            ],
                        },
                    ],
                },
                `\
Next, something outrageous happened. <mark data-comment="${threadId}">The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their <mark class="highlight-red">army</mark>.</mark>
`,
            );
        });

        test("comment mark mixed with nested comment marks (nested comment mark is less than parent)", async () => {
            const threadAId = generateId<DocumentCommentThreadId>();
            const threadBId = generateId<DocumentCommentThreadId>();

            const thread1Id = threadAId > threadBId ? threadAId : threadBId;
            const thread2Id = threadAId > threadBId ? threadBId : threadAId;

            await testPrintApiContentToMarkdown(
                {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "Next, something outrageous happened. "},
                                {
                                    type: "Text",
                                    text: "The Eagles sought to defend ",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                                {
                                    type: "Text",
                                    text: "their title",
                                    marks: [
                                        {type: "Comment", threadId: thread1Id},
                                        {type: "Link", url: "https://example.com"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " (and honor) in the 2025-2026 season. They promoted a ",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                                {
                                    type: "Text",
                                    text: "mere",
                                    marks: [
                                        {type: "Comment", threadId: thread1Id},
                                        {type: "Italic"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " ",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                                {
                                    type: "Text",
                                    text: "squire",
                                    marks: [{type: "Comment", threadId: thread1Id}, {type: "Bold"}],
                                },
                                {
                                    type: "Text",
                                    text: " to the ",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                                {
                                    type: "Text",
                                    text: "captain",
                                    marks: [
                                        {type: "Comment", threadId: thread1Id},
                                        {type: "Strike"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " of their ",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                                {
                                    type: "Text",
                                    text: "army",
                                    marks: [
                                        {type: "Comment", threadId: thread1Id},
                                        {type: "Comment", threadId: thread2Id},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: ".",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                            ],
                        },
                    ],
                },
                `\
Next, something outrageous happened. <mark data-comment="${thread1Id}">The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their </mark><mark data-comment="${thread2Id}"><mark data-comment="${thread1Id}">army</mark></mark><mark data-comment="${thread1Id}">.</mark>
`,
            );
        });

        test("comment mark mixed with nested comment marks (nested comment mark is greater than parent)", async () => {
            const threadAId = generateId<DocumentCommentThreadId>();
            const threadBId = generateId<DocumentCommentThreadId>();

            const thread1Id = threadAId < threadBId ? threadAId : threadBId;
            const thread2Id = threadAId < threadBId ? threadBId : threadAId;

            await testPrintApiContentToMarkdown(
                {
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [
                                {type: "Text", text: "Next, something outrageous happened. "},
                                {
                                    type: "Text",
                                    text: "The Eagles sought to defend ",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                                {
                                    type: "Text",
                                    text: "their title",
                                    marks: [
                                        {type: "Comment", threadId: thread1Id},
                                        {type: "Link", url: "https://example.com"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " (and honor) in the 2025-2026 season. They promoted a ",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                                {
                                    type: "Text",
                                    text: "mere",
                                    marks: [
                                        {type: "Comment", threadId: thread1Id},
                                        {type: "Italic"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " ",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                                {
                                    type: "Text",
                                    text: "squire",
                                    marks: [{type: "Comment", threadId: thread1Id}, {type: "Bold"}],
                                },
                                {
                                    type: "Text",
                                    text: " to the ",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                                {
                                    type: "Text",
                                    text: "captain",
                                    marks: [
                                        {type: "Comment", threadId: thread1Id},
                                        {type: "Strike"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " of their ",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                                {
                                    type: "Text",
                                    text: "army",
                                    marks: [
                                        {type: "Comment", threadId: thread1Id},
                                        {type: "Comment", threadId: thread2Id},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: ".",
                                    marks: [{type: "Comment", threadId: thread1Id}],
                                },
                            ],
                        },
                    ],
                },
                `\
Next, something outrageous happened. <mark data-comment="${thread1Id}">The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their <mark data-comment="${thread2Id}">army</mark>.</mark>
`,
            );
        });
    });

    describe("`withSimpleCommentMarkHtml` is true", () => {
        test("simple comment mark", async () => {
            const threadId = generateId<DocumentCommentThreadId>();

            const content: ApiContent = {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {
                                type: "Text",
                                text: "The Eagles sought to defend.",
                                marks: [{type: "Comment", threadId}],
                            },
                        ],
                    },
                ],
            };

            expect(
                printApiContentToMarkdown(content, {spaceId, withSimpleCommentMarkHtml: true}),
            ).toEqual(`<comment>The Eagles sought to defend.</comment>\n`);
        });

        test("comment mark mixed with other marks", async () => {
            const threadId = generateId<DocumentCommentThreadId>();

            const content: ApiContent = {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "Next, something outrageous happened. "},
                            {
                                type: "Text",
                                text: "The Eagles sought to defend ",
                                marks: [{type: "Comment", threadId}],
                            },
                            {
                                type: "Text",
                                text: "their title",
                                marks: [
                                    {type: "Comment", threadId},
                                    {type: "Link", url: "https://example.com"},
                                ],
                            },
                            {
                                type: "Text",
                                text: " (and honor) in the 2025-2026 season. They promoted a ",
                                marks: [{type: "Comment", threadId}],
                            },
                            {
                                type: "Text",
                                text: "mere",
                                marks: [{type: "Comment", threadId}, {type: "Italic"}],
                            },
                            {
                                type: "Text",
                                text: " ",
                                marks: [{type: "Comment", threadId}],
                            },
                            {
                                type: "Text",
                                text: "squire",
                                marks: [{type: "Comment", threadId}, {type: "Bold"}],
                            },
                            {
                                type: "Text",
                                text: " to the ",
                                marks: [{type: "Comment", threadId}],
                            },
                            {
                                type: "Text",
                                text: "captain",
                                marks: [{type: "Comment", threadId}, {type: "Strike"}],
                            },
                            {
                                type: "Text",
                                text: " of their ",
                                marks: [{type: "Comment", threadId}],
                            },
                            {
                                type: "Text",
                                text: "army",
                                marks: [
                                    {type: "Comment", threadId},
                                    {type: "Highlight", color: "Red"},
                                ],
                            },
                            {
                                type: "Text",
                                text: ".",
                                marks: [{type: "Comment", threadId}],
                            },
                        ],
                    },
                ],
            };

            expect(
                printApiContentToMarkdown(content, {spaceId, withSimpleCommentMarkHtml: true}),
            ).toEqual(
                `\
Next, something outrageous happened. <comment>The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their <mark class="highlight-red">army</mark>.</comment>
`,
            );
        });

        test("comment mark mixed with nested comment marks (nested comment mark is less than parent)", async () => {
            const threadAId = generateId<DocumentCommentThreadId>();
            const threadBId = generateId<DocumentCommentThreadId>();

            const thread1Id = threadAId > threadBId ? threadAId : threadBId;
            const thread2Id = threadAId > threadBId ? threadBId : threadAId;

            const content: ApiContent = {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "Next, something outrageous happened. "},
                            {
                                type: "Text",
                                text: "The Eagles sought to defend ",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                            {
                                type: "Text",
                                text: "their title",
                                marks: [
                                    {type: "Comment", threadId: thread1Id},
                                    {type: "Link", url: "https://example.com"},
                                ],
                            },
                            {
                                type: "Text",
                                text: " (and honor) in the 2025-2026 season. They promoted a ",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                            {
                                type: "Text",
                                text: "mere",
                                marks: [{type: "Comment", threadId: thread1Id}, {type: "Italic"}],
                            },
                            {
                                type: "Text",
                                text: " ",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                            {
                                type: "Text",
                                text: "squire",
                                marks: [{type: "Comment", threadId: thread1Id}, {type: "Bold"}],
                            },
                            {
                                type: "Text",
                                text: " to the ",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                            {
                                type: "Text",
                                text: "captain",
                                marks: [{type: "Comment", threadId: thread1Id}, {type: "Strike"}],
                            },
                            {
                                type: "Text",
                                text: " of their ",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                            {
                                type: "Text",
                                text: "army",
                                marks: [
                                    {type: "Comment", threadId: thread1Id},
                                    {type: "Comment", threadId: thread2Id},
                                ],
                            },
                            {
                                type: "Text",
                                text: ".",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                        ],
                    },
                ],
            };

            expect(
                printApiContentToMarkdown(content, {spaceId, withSimpleCommentMarkHtml: true}),
            ).toEqual(
                `\
Next, something outrageous happened. <comment>The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their <comment>army</comment>.</comment>
`,
            );
        });

        test("comment mark mixed with nested comment marks (nested comment mark is greater than parent)", async () => {
            const threadAId = generateId<DocumentCommentThreadId>();
            const threadBId = generateId<DocumentCommentThreadId>();

            const thread1Id = threadAId < threadBId ? threadAId : threadBId;
            const thread2Id = threadAId < threadBId ? threadBId : threadAId;

            const content: ApiContent = {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "Next, something outrageous happened. "},
                            {
                                type: "Text",
                                text: "The Eagles sought to defend ",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                            {
                                type: "Text",
                                text: "their title",
                                marks: [
                                    {type: "Comment", threadId: thread1Id},
                                    {type: "Link", url: "https://example.com"},
                                ],
                            },
                            {
                                type: "Text",
                                text: " (and honor) in the 2025-2026 season. They promoted a ",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                            {
                                type: "Text",
                                text: "mere",
                                marks: [{type: "Comment", threadId: thread1Id}, {type: "Italic"}],
                            },
                            {
                                type: "Text",
                                text: " ",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                            {
                                type: "Text",
                                text: "squire",
                                marks: [{type: "Comment", threadId: thread1Id}, {type: "Bold"}],
                            },
                            {
                                type: "Text",
                                text: " to the ",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                            {
                                type: "Text",
                                text: "captain",
                                marks: [{type: "Comment", threadId: thread1Id}, {type: "Strike"}],
                            },
                            {
                                type: "Text",
                                text: " of their ",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                            {
                                type: "Text",
                                text: "army",
                                marks: [
                                    {type: "Comment", threadId: thread1Id},
                                    {type: "Comment", threadId: thread2Id},
                                ],
                            },
                            {
                                type: "Text",
                                text: ".",
                                marks: [{type: "Comment", threadId: thread1Id}],
                            },
                        ],
                    },
                ],
            };

            expect(
                printApiContentToMarkdown(content, {spaceId, withSimpleCommentMarkHtml: true}),
            ).toEqual(
                `\
Next, something outrageous happened. <comment>The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their <comment>army</comment>.</comment>
`,
            );
        });
    });
});
