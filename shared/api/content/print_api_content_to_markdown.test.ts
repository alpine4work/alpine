/* eslint-disable cyberworlds/string-quotes */

import {normalizeApiContent} from "~/shared/api/content/normalize_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printApiContentToMarkdown} from "~/shared/api/content/print_api_content_to_markdown.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {Tuple} from "~/shared/helpers/types/tuple.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

type PrintMarkdownFixtureTestCase = {
    only?: CommitBlocker;
    description: string;
    content: ApiContent;
    expectedMarkdown: string;
};

type PrintMarkdownTestCaseGroup = {
    contentType: string;
    cases: ReadonlyArray<PrintMarkdownFixtureTestCase>;
};

const printTestCommentMarkMixedThreadId = generateId<DocumentCommentThreadId>();

const accountId = generateId<AccountId>();
const accountId2 = generateId<AccountId>();
const documentId = generateId<DocumentId>();
const taskId = generateId<TaskId>();
const taskCollectionId = generateId<TaskCollectionId>();
const postId = generateId<PostId>();
const fileId = generateChronologicalId<FileId>();
const fileId2 = generateChronologicalId<FileId>();
const channelId = generateId<ChannelId>();

const [threadId, threadId2, threadId3, threadId4] = (() => {
    const threadIds = createArrayWithLength(4, () => generateId<DocumentCommentThreadId>());
    return threadIds.sort() as Tuple<DocumentCommentThreadId, 4>;
})();

describe.each(
    cast<ReadonlyArray<PrintMarkdownTestCaseGroup>>([
        {
            contentType: "paragraphs",
            cases: [
                {
                    description: "simple paragraph",
                    content: {
                        elements: [
                            {type: "Paragraph", elements: [{type: "Text", text: "Hello, world!"}]},
                        ],
                    },
                    expectedMarkdown: `\
Hello, world!
`,
                },
                {
                    description: "simple paragraph with marks",
                    content: {
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
                    expectedMarkdown: `\
Hello, *world*!
`,
                },
                {
                    description: "empty paragraph",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<p></p>
`,
                },
                {
                    description: "empty paragraph then paragraph with content",
                    content: {
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
                    expectedMarkdown: `\
<p></p>

foo
`,
                },
                {
                    description: "empty paragraphs then paragraph with content",
                    content: {
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
                    expectedMarkdown: `\
<p></p>

<p></p>

<p></p>

foo
`,
                },
                {
                    description: "paragraph with content then empty paragraph",
                    content: {
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
                    expectedMarkdown: `\
foo

<p></p>
`,
                },
                {
                    description: "paragraph with content then empty paragraphs",
                    content: {
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
                    expectedMarkdown: `\
foo

<p></p>

<p></p>

<p></p>
`,
                },
                {
                    description: "paragraphs with content with empty paragraph between",
                    content: {
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
                    expectedMarkdown: `\
foo

<p></p>

bar
`,
                },
                {
                    description: "paragraphs with content with empty paragraphs between",
                    content: {
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
                    expectedMarkdown: `\
foo

<p></p>

<p></p>

<p></p>

bar
`,
                },
                {
                    description: "paragraph with only spaces",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "   "}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
&#x20; &#x20;
`,
                },
                {
                    description: "multiple text elements in paragraph",
                    content: {
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
                    expectedMarkdown: `\
First Second Third
`,
                },
                {
                    description: "two paragraphs",
                    content: {
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
                    expectedMarkdown: `\
First paragraph

Second paragraph
`,
                },
                {
                    description: "three paragraphs",
                    content: {
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
                    expectedMarkdown: `\
First

Second

Third
`,
                },
            ],
        },
        {
            contentType: "styled text",
            cases: [
                {
                    description: "bold text",
                    content: {
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
                    expectedMarkdown: `\
This is **bold** text
`,
                },
                {
                    description: "italic text",
                    content: {
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
                    expectedMarkdown: `\
This is *italic* text
`,
                },
                {
                    description: "strikethrough text",
                    content: {
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
                    expectedMarkdown: `\
This is ~~struck~~ text
`,
                },
                {
                    description: "code text",
                    content: {
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
                    expectedMarkdown: `\
This is \`code\` text
`,
                },
                {
                    description: "link text",
                    content: {
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
                    expectedMarkdown: `\
Click [here](https://example.com) to visit
`,
                },
                {
                    description: "bold and italic text",
                    content: {
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
                    expectedMarkdown: `\
This is ***bold italic*** text
`,
                },
                {
                    description: "bold and strikethrough text",
                    content: {
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
                    expectedMarkdown: `\
This is **~~bold struck~~** text
`,
                },
                {
                    description: "italic and strikethrough text",
                    content: {
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
                    expectedMarkdown: `\
This is *~~italic struck~~* text
`,
                },
                {
                    description: "bold, italic and strikethrough text",
                    content: {
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
                    expectedMarkdown: `\
This is ***~~all three~~*** text
`,
                },
                {
                    description: "link with bold text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Click "},
                                    {
                                        type: "Text",
                                        text: "this bold link",
                                        marks: [
                                            {type: "Link", url: "https://example.com"},
                                            {type: "Bold"},
                                        ],
                                    },
                                    {type: "Text", text: " to visit"},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Click [**this bold link**](https://example.com) to visit
`,
                },
                {
                    description: "link with italic text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Click "},
                                    {
                                        type: "Text",
                                        text: "this italic link",
                                        marks: [
                                            {type: "Link", url: "https://example.com"},
                                            {type: "Italic"},
                                        ],
                                    },
                                    {type: "Text", text: " to visit"},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Click [*this italic link*](https://example.com) to visit
`,
                },
                {
                    description: "link with all marks",
                    content: {
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
                    expectedMarkdown: `\
Click [***~~fancy link~~***](https://example.com) to visit
`,
                },
                {
                    description: "simple blockquote",
                    content: {
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
                    expectedMarkdown: `\
> This is a quote
`,
                },
                {
                    description: "blockquote with multiple paragraphs",
                    content: {
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
                    expectedMarkdown: `\
> First paragraph
>
> Second paragraph
`,
                },
                {
                    description: "blockquote with formatted text",
                    content: {
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
                    expectedMarkdown: `\
> Quote with **bold** and *italic* text
`,
                },
                {
                    description: "paragraph with mixed formatting",
                    content: {
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
                    expectedMarkdown: `\
Normal text with **bold**, *italic*, \`code\`, and [link](https://example.com).
`,
                },
                {
                    description: "document with mixed elements",
                    content: {
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
                                            {
                                                type: "Text",
                                                text: "formatted",
                                                marks: [{type: "Italic"}],
                                            },
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
                    expectedMarkdown: `\
Introduction paragraph

> A *formatted* quote

Conclusion with **emphasis**
`,
                },
            ],
        },
        {
            contentType: "highlight marks",
            cases: [
                {
                    description: "text with highlight mark",
                    content: {
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
                    expectedMarkdown: `\
This is <mark class="highlight-red">highlighted</mark> text
`,
                },
                {
                    description: "text with different highlight colors",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "Red ",
                                        marks: [{type: "Highlight", color: "Red"}],
                                    },
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
                                    {
                                        type: "Text",
                                        text: "Blue ",
                                        marks: [{type: "Highlight", color: "Blue"}],
                                    },
                                    {
                                        type: "Text",
                                        text: "Purple",
                                        marks: [{type: "Highlight", color: "Purple"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<mark class="highlight-red">Red </mark><mark class="highlight-orange">Orange </mark><mark class="highlight-green">Green </mark><mark class="highlight-blue">Blue </mark><mark class="highlight-purple">Purple</mark>
`,
                },
                {
                    description: "text with highlight and other marks",
                    content: {
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
                    expectedMarkdown: `\
<mark class="highlight-blue">**bold highlighted text**</mark>
`,
                },
                {
                    description: "text with multiple highlight marks only prints one highlight",
                    content: {
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
                    expectedMarkdown: `\
This text has <mark class="highlight-green">multiple highlights</mark> but only one should print
`,
                },
            ],
        },
        {
            contentType: "line breaks",
            cases: [
                {
                    description: "single line break",
                    content: {
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
                    expectedMarkdown: `\
First line\\
Second line
`,
                },
                {
                    description: "multiple line breaks",
                    content: {
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
                    expectedMarkdown: `\
First line\\
\\
Third line
`,
                },
                {
                    description: "line break with bold mark",
                    content: {
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
                    expectedMarkdown: `\
Regular lin&#x65;**<br />**&#x53;till regular
`,
                },
                {
                    description: "line break with bold mark and spaces",
                    content: {
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
                    expectedMarkdown: `\
Regular line **<br />** Still regular
`,
                },
                {
                    description: "line break with italic mark",
                    content: {
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
                    expectedMarkdown: `\
Regular lin&#x65;*<br />*&#x53;till regular
`,
                },
                {
                    description: "line break with italic mark and spaces",
                    content: {
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
                    expectedMarkdown: `\
Regular line *<br />* Still regular
`,
                },
                {
                    description: "line break with bold mark (surrounded by bold marks)",
                    content: {
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
                    expectedMarkdown: `\
**Bold line<br />Still bold**
`,
                },
                {
                    description: "line break with bold mark (surrounded by italic marks)",
                    content: {
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
                    expectedMarkdown: `\
_Bold line_**<br />**_Still bold_
`,
                },
                {
                    description: "line break with bold mark (followed by italic mark)",
                    content: {
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
                    expectedMarkdown: `\
Bold lin&#x65;**<br />**_Still bold_
`,
                },
                {
                    description: "line break with bold mark (preceded by italic mark)",
                    content: {
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
                    expectedMarkdown: `\
_Bold line_**<br />**&#x53;till bold
`,
                },
                {
                    description: "line break with fake bold mark",
                    content: {
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
                    expectedMarkdown: `\
Bold line\\*\\*\\
\\*\\*Still bold
`,
                },
                {
                    description: "line break with italic mark and fake bold mark",
                    content: {
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
                    expectedMarkdown: `\
Bold line\\*\\**<br />*\\*\\*Still bold
`,
                },
                {
                    description: "line break with italic mark (surrounded by bold marks)",
                    content: {
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
                    expectedMarkdown: `\
**Bold line**_<br />_**Still bold**
`,
                },
                {
                    description: "line break with strike mark (surrounded by bold marks)",
                    content: {
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
                    expectedMarkdown: `\
**Bold line**~~<br />~~**Still bold**
`,
                },
                {
                    description: "line break with code mark (surrounded by bold marks)",
                    content: {
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
                    expectedMarkdown: `\
**Bold line**<code><br /></code>**Still bold**
`,
                },
                {
                    description: "line break with bold and italic marks (surrounded by bold marks)",
                    content: {
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
                    expectedMarkdown: `\
**Bold lin&#x65;*<br />*&#x53;till bold**
`,
                },
                {
                    description: "line break with link mark",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Bold line", marks: [{type: "Bold"}]},
                                    {
                                        type: "Break",
                                        marks: [{type: "Link", url: "https://example.com"}],
                                    },
                                    {type: "Text", text: "Still bold", marks: [{type: "Bold"}]},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
**Bold line**[<br />](https://example.com)**Still bold**
`,
                },
            ],
        },
        {
            contentType: "special characters",
            cases: [
                {
                    description: "markdown special characters",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "* not a list item"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\* not a list item
`,
                },
                {
                    description: "backticks in text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Use `backticks` for code"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Use \\\`backticks\\\` for code
`,
                },
                {
                    description: "underscores in text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "snake_case_variable"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
snake\\_case\\_variable
`,
                },
                {
                    description: "brackets in text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "[not a link]"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\[not a link]
`,
                },
                {
                    description: "html-like text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "<tag>content</tag>"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\<tag>content\\</tag>
`,
                },
                {
                    description: "character references in text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "&quot; &#34; &#x22;"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\&quot; \\&#34; \\&#x22;
`,
                },
                {
                    description: "less than in link URL",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: " ", marks: [{type: "Link", url: "<"}]},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[ ](\\<)
`,
                },
                {
                    description: "query params and character references in link URL",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "link",
                                        marks: [
                                            {
                                                type: "Link",
                                                url: "/tasks?after=a1b2c3&status=open&sort=-priority,due&literal=&quot;",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[link](/tasks?after=a1b2c3&status=open&sort=-priority,due&literal=&quot\\;)
`,
                },
                {
                    description: "multiple character references in link URL",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "link",
                                        marks: [
                                            {
                                                type: "Link",
                                                url: "/tasks?literal=&quot;&amp;&#34;&#x22;",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[link](/tasks?literal=&quot\\;&amp\\;&#34\\;&#x22\\;)
`,
                },
                {
                    // NOTE(calebmer): A character reference can occur in the middle of a destination,
                    // not only immediately before the closing parenthesis.
                    description: "character reference in middle of link URL",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "link",
                                        marks: [
                                            {
                                                type: "Link",
                                                url: "/tasks?literal=before&quot;after&status=open",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[link](/tasks?literal=before&quot\\;after&status=open)
`,
                },
                {
                    description: "character references in link URL with spaces",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "link",
                                        marks: [
                                            {
                                                type: "Link",
                                                url: "/task collection?literal=&quot;",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[link](</task collection?literal=&quot\\;>)
`,
                },
                {
                    description: "less than with text followed by greater than in link URL",
                    content: {
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
                    expectedMarkdown: `\
[ ](\\<test\\>)
`,
                },
                {
                    description: "less than after text in link URL",
                    content: {
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
                    expectedMarkdown: `\
[ ](test\\<)
`,
                },
                {
                    description:
                        "less than followed by text (with space) followed by greater than in link URL",
                    content: {
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
                    expectedMarkdown: `\
[ ](<\\<hello world\\>>)
`,
                },
                {
                    description: "greater than in link URL",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: " ", marks: [{type: "Link", url: ">"}]},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[ ](\\>)
`,
                },
                {
                    description: "less than or not equals in link URL",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: " ", marks: [{type: "Link", url: "≮"}]},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[ ](≮)
`,
                },
            ],
        },
        {
            contentType: "lists",
            cases: [
                {
                    description: "simple unordered list",
                    content: {
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
                    expectedMarkdown: `\
- First item

- Second item

- Third item
`,
                },
                {
                    description: "simple ordered list",
                    content: {
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
                    expectedMarkdown: `\
1. First item

2. Second item

3. Third item
`,
                },
                {
                    description: "unordered list with formatted text",
                    content: {
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
                                                    {
                                                        type: "Text",
                                                        text: "bold",
                                                        marks: [{type: "Bold"}],
                                                    },
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
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [
                                                    {type: "Text", text: "Item with "},
                                                    {
                                                        type: "Text",
                                                        text: "code",
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
                    expectedMarkdown: `\
- Item with **bold** text

- Item with *italic* text

- Item with \`code\`
`,
                },
                {
                    description: "ordered list with links",
                    content: {
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
                                                        marks: [
                                                            {
                                                                type: "Link",
                                                                url: "https://google.com",
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
                                                elements: [
                                                    {type: "Text", text: "Check out "},
                                                    {
                                                        type: "Text",
                                                        text: "GitHub",
                                                        marks: [
                                                            {
                                                                type: "Link",
                                                                url: "https://github.com",
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
                    expectedMarkdown: `\
1. Visit [Google](https://google.com)

2. Check out [GitHub](https://github.com)
`,
                },
                {
                    description: "nested unordered lists",
                    content: {
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
                                                                    {
                                                                        type: "Text",
                                                                        text: "Child item 1.1",
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
                                                                        text: "Child item 1.2",
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
                                                elements: [{type: "Text", text: "Parent item 2"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
- Parent item 1

  - Child item 1.1

  - Child item 1.2

- Parent item 2
`,
                },
                {
                    description: "nested ordered lists",
                    content: {
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
                                                                    {
                                                                        type: "Text",
                                                                        text: "Second level A",
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
                                                                        text: "Second level B",
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
                                                elements: [{type: "Text", text: "Back to first"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
1. First level

   1. Second level A

   2. Second level B

2. Back to first
`,
                },
                {
                    description: "mixed nested lists",
                    content: {
                        elements: [
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [
                                                    {type: "Text", text: "Unordered parent"},
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
                                                                        text: "Ordered child 1",
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
                                                                        text: "Ordered child 2",
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
                    expectedMarkdown: `\
- Unordered parent

  1. Ordered child 1

  2. Ordered child 2
`,
                },
                {
                    description: "ordered list with orderStart",
                    content: {
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
                    expectedMarkdown: `\
5. Fifth item

6. Sixth item

7. Seventh item
`,
                },
                {
                    description: "simple consecutive ordered lists respect orderStart",
                    content: {
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
                                                    {
                                                        type: "Text",
                                                        text: "3rd list merged into second list",
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
                                                elements: [
                                                    {type: "Text", text: "Restart again at 11"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
5. Fifth item

3) Restart at 3

4) 3rd list merged into second list

11. Restart again at 11
`,
                },
                {
                    description: "consecutive ordered lists with orderStart",
                    content: {
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
                                                                                                elements:
                                                                                                    [
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
                                                elements: [
                                                    {type: "Text", text: "Restart again at 11"},
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "nested ordered lists with separate orderStart values",
                    content: {
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
                                                                    {
                                                                        type: "Text",
                                                                        text: "Tenth nested item",
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
                    expectedMarkdown: `\
2. Second item

   10. Tenth nested item

   11. Eleventh nested item

3. Third item
`,
                },
                {
                    description: "ordered list with orderStart nested inside unordered list",
                    content: {
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
                                                                    {
                                                                        type: "Text",
                                                                        text: "Third nested item",
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
                                                                        text: "Fourth nested item",
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
                    expectedMarkdown: `\
- Bullet item

  3. Third nested item

  4. Fourth nested item
`,
                },
                {
                    description: "list with multiple paragraphs in item",
                    content: {
                        elements: [
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [
                                                    {type: "Text", text: "First paragraph of item"},
                                                ],
                                            },
                                            {
                                                type: "Paragraph",
                                                elements: [
                                                    {
                                                        type: "Text",
                                                        text: "Second paragraph of same item",
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
                                                    {type: "Text", text: "Single paragraph item"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
- First paragraph of item

  Second paragraph of same item

- Single paragraph item
`,
                },
                {
                    description: "list with line breaks in items",
                    content: {
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
                    expectedMarkdown: `\
- Line one\\
  Line two

- Normal item
`,
                },
                {
                    description: "empty list item",
                    content: {
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
                    expectedMarkdown: `\
- <p></p>

- Non-empty item
`,
                },
                {
                    description: "deeply nested lists",
                    content: {
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
                                                                elements: [
                                                                    {type: "Text", text: "Level 2"},
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
                    expectedMarkdown: `\
- Level 1

  - Level 2

    - Level 3
`,
                },
                {
                    description: "list between paragraphs",
                    content: {
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
                    expectedMarkdown: `\
Before the list

- List item

After the list
`,
                },
                {
                    description: "multiple lists",
                    content: {
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
                    expectedMarkdown: `\
- First unordered

1. First ordered
`,
                },
                {
                    description:
                        "list starting at indent level 2 (phantom items for levels 0 and 1)",
                    content: {
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
                    expectedMarkdown: `\
- - - Starts at indent 2
`,
                },
                {
                    description: "list with phantom jump from level 1 to 3",
                    content: {
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
                                                                elements: [
                                                                    {type: "Text", text: "Level 1"},
                                                                ],
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
                                                                                                elements:
                                                                                                    [
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
                    expectedMarkdown: `\
- Level 0

  - Level 1

    - - Level 3 (jumps from 1 to 3)
`,
                },
                {
                    description: "ordered list with big phantom jump from level 0 to 4",
                    content: {
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
                                                                                        elements:
                                                                                            [],
                                                                                        nestedListElements:
                                                                                            [
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
                    expectedMarkdown: `\
1. Level 0

   - - - 1. Level 4 (big jump)
`,
                },
                {
                    description: "check list with big phantom jump from level 0 to 4",
                    content: {
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
                                                                                        elements:
                                                                                            [],
                                                                                        nestedListElements:
                                                                                            [
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
                    expectedMarkdown: `\
- [x] Level 0

  - - - - [ ] Level 4 (big jump)
`,
                },
                {
                    description: "list starting at level 3 with all phantom parents",
                    content: {
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
                                                                                                elements:
                                                                                                    [
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
                                                                                                elements:
                                                                                                    [
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
                    expectedMarkdown: `\
1. <p></p>

   - - 1. Deep start at level 3

       2. Another at level 3
`,
                },
                {
                    description: "mixed list types with phantom items",
                    content: {
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
                    expectedMarkdown: `\
- 1. <p></p>

     - Mixed types with phantoms
`,
                },
                {
                    description: "phantom items with multiple real items at deep level",
                    content: {
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
                    expectedMarkdown: `\
- - - First at level 2

    - Second at level 2

    - Third at level 2
`,
                },
                {
                    description: "complex phantom structure with real content scattered",
                    content: {
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
                                                                                                elements:
                                                                                                    [
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
                    expectedMarkdown: `\
1. Real at 0

   - - Real at 2

       1. Real at 3

2. Back to level 0
`,
                },
                {
                    description: "phantom items with formatted text in real items",
                    content: {
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
                                                                                        marks: [
                                                                                            {
                                                                                                type: "Bold",
                                                                                            },
                                                                                        ],
                                                                                    },
                                                                                    {
                                                                                        type: "Text",
                                                                                        text: " and ",
                                                                                    },
                                                                                    {
                                                                                        type: "Text",
                                                                                        text: "italic",
                                                                                        marks: [
                                                                                            {
                                                                                                type: "Italic",
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
                    expectedMarkdown: `\
- - 1. Deep with **bold** and *italic*
`,
                },
                {
                    description: "phantom item without nested list elements",
                    content: {
                        elements: [
                            {
                                type: "UnorderedList",
                                items: [{elements: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
-
`,
                },
            ],
        },
        {
            contentType: "checklists",
            cases: [
                {
                    description: "simple checklist with unchecked items",
                    content: {
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
                    expectedMarkdown: `\
- [ ] First task

- [ ] Second task

- [ ] Third task
`,
                },
                {
                    description: "simple checklist with checked items",
                    content: {
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
                                                    {type: "Text", text: "Completed task 1"},
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
                                                    {type: "Text", text: "Completed task 2"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
- [x] Completed task 1

- [x] Completed task 2
`,
                },
                {
                    description: "checklist with mixed checked and unchecked items",
                    content: {
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
                    expectedMarkdown: `\
- [x] Done

- [ ] Not done

- [x] Also done
`,
                },
                {
                    description: "checklist with formatted text",
                    content: {
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
                                                    {
                                                        type: "Text",
                                                        text: "bold",
                                                        marks: [{type: "Bold"}],
                                                    },
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
                    expectedMarkdown: `\
- [ ] Task with **bold** text

- [x] Task with *italic* text
`,
                },
                {
                    description: "checklist with links",
                    content: {
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
                                                            {
                                                                type: "Link",
                                                                url: "https://example.com/docs",
                                                            },
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
                    expectedMarkdown: `\
- [ ] Review [documentation](https://example.com/docs)

- [x] Read [tutorial](https://example.com/tutorial)
`,
                },
                {
                    description: "nested checklists",
                    content: {
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
                                                                    {
                                                                        type: "Text",
                                                                        text: "Subtask 1",
                                                                    },
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
                                                                    {
                                                                        type: "Text",
                                                                        text: "Subtask 2",
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
                    expectedMarkdown: `\
- [ ] Parent task

  - [x] Subtask 1

  - [ ] Subtask 2
`,
                },
                {
                    description: "deeply nested checklists",
                    content: {
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
                                                                elements: [
                                                                    {type: "Text", text: "Level 1"},
                                                                ],
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
                    expectedMarkdown: `\
- [ ] Level 0

  - [x] Level 1

    - [ ] Level 2
`,
                },
                {
                    description: "checklist with multiple paragraphs in item",
                    content: {
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
                                                elements: [
                                                    {type: "Text", text: "Second paragraph"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
- [ ] First paragraph

  Second paragraph
`,
                },
                {
                    description: "mixed list types with checklists",
                    content: {
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
                                                                    {
                                                                        type: "Text",
                                                                        text: "Checklist item",
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
                    expectedMarkdown: `\
- Unordered item

  - [ ] Checklist item
`,
                },
                {
                    description: "checklist with nested ordered list",
                    content: {
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
                                                                elements: [
                                                                    {type: "Text", text: "Step 1"},
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                    {
                                                        elements: [
                                                            {
                                                                type: "Paragraph",
                                                                elements: [
                                                                    {type: "Text", text: "Step 2"},
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
                    expectedMarkdown: `\
- [x] Checklist item

  1. Step 1

  2. Step 2
`,
                },
                {
                    description: "empty checklist item",
                    content: {
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
                    expectedMarkdown: `\
- [x] <span></span>
`,
                },
                {
                    description: "checklist between paragraphs",
                    content: {
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
                    expectedMarkdown: `\
Before checklist

- [ ] Task

After checklist
`,
                },
                {
                    description: "checklist in table",
                    content: {
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
                                                        elements: [
                                                            {type: "Text", text: "Task List"},
                                                        ],
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
                                                                            {
                                                                                type: "Text",
                                                                                text: "Done",
                                                                            },
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
                                                                            {
                                                                                type: "Text",
                                                                                text: "Todo",
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
                                                        elements: [
                                                            {type: "Text", text: "In progress"},
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "checklists within quote blocks",
                    content: {
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
                                                        elements: [
                                                            {type: "Text", text: "Completed task"},
                                                        ],
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
                    expectedMarkdown: `\
> - [ ] Task
>
> - [x] Completed task
>
> Task
`,
                },
            ],
        },
        {
            contentType: "comment marks",
            cases: [
                {
                    description: "comment mark mixed with other marks",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Next, something outrageous happened. "},
                                    {
                                        type: "Text",
                                        text: "The Eagles sought to defend ",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: "their title",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                            {type: "Link", url: "https://example.com"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " (and honor) in the 2025-2026 season. They promoted a ",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: "mere",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                            {type: "Italic"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " ",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: "squire",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                            {type: "Bold"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " to the ",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: "captain",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                            {type: "Strike"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " of their ",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: "army",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                            {type: "Highlight", color: "Red"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: ".",
                                        marks: [
                                            {
                                                type: "Comment",
                                                thread: {id: printTestCommentMarkMixedThreadId},
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Next, something outrageous happened. <mark data-comment="${printTestCommentMarkMixedThreadId}">The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their <mark class="highlight-red">army</mark>.</mark>
`,
                },
                {
                    description:
                        "comment mark mixed with nested comment marks (nested comment mark is greater than parent)",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Next, something outrageous happened. "},
                                    {
                                        type: "Text",
                                        text: "The Eagles sought to defend ",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "their title",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId}},
                                            {type: "Link", url: "https://example.com"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " (and honor) in the 2025-2026 season. They promoted a ",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "mere",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId}},
                                            {type: "Italic"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " ",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "squire",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId}},
                                            {type: "Bold"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " to the ",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "captain",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId}},
                                            {type: "Strike"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " of their ",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "army",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId}},
                                            {type: "Comment", thread: {id: threadId2}},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: ".",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Next, something outrageous happened. <mark data-comment="${threadId}">The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their <mark data-comment="${threadId2}">army</mark>.</mark>
`,
                },
                {
                    description:
                        "comment mark mixed with nested comment marks (nested comment mark is greater than parent, other order)",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Next, something outrageous happened. "},
                                    {
                                        type: "Text",
                                        text: "The Eagles sought to defend ",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "their title",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId}},
                                            {type: "Link", url: "https://example.com"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " (and honor) in the 2025-2026 season. They promoted a ",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "mere",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId}},
                                            {type: "Italic"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " ",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "squire",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId}},
                                            {type: "Bold"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " to the ",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "captain",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId}},
                                            {type: "Strike"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " of their ",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "army",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Comment", thread: {id: threadId}},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: ".",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Next, something outrageous happened. <mark data-comment="${threadId}">The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their </mark><mark data-comment="${threadId2}"><mark data-comment="${threadId}">army</mark></mark><mark data-comment="${threadId}">.</mark>
`,
                },
                {
                    description:
                        "comment mark mixed with nested comment marks (nested comment mark is less than parent)",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Next, something outrageous happened. "},
                                    {
                                        type: "Text",
                                        text: "The Eagles sought to defend ",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "their title",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Link", url: "https://example.com"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " (and honor) in the 2025-2026 season. They promoted a ",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "mere",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Italic"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " ",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "squire",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Bold"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " to the ",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "captain",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Strike"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " of their ",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "army",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Comment", thread: {id: threadId}},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: ".",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Next, something outrageous happened. <mark data-comment="${threadId2}">The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their <mark data-comment="${threadId}">army</mark>.</mark>
`,
                },
                {
                    description:
                        "comment mark mixed with nested comment marks (nested comment mark is less than parent, other order)",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Next, something outrageous happened. "},
                                    {
                                        type: "Text",
                                        text: "The Eagles sought to defend ",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "their title",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Link", url: "https://example.com"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " (and honor) in the 2025-2026 season. They promoted a ",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "mere",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Italic"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " ",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "squire",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Bold"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " to the ",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "captain",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Strike"},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: " of their ",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                    {
                                        type: "Text",
                                        text: "army",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId}},
                                            {type: "Comment", thread: {id: threadId2}},
                                        ],
                                    },
                                    {
                                        type: "Text",
                                        text: ".",
                                        marks: [{type: "Comment", thread: {id: threadId2}}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Next, something outrageous happened. <mark data-comment="${threadId2}">The Eagles sought to defend \
[their title](https://example.com) (and honor) in the 2025-2026 season. They promoted a *mere* \
**squire** to the ~~captain~~ of their </mark><mark data-comment="${threadId}"><mark data-comment="${threadId2}">army</mark></mark><mark data-comment="${threadId2}">.</mark>
`,
                },
                {
                    description: "text with comment mark",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "This is "},
                                    {
                                        type: "Text",
                                        text: "commented",
                                        marks: [{type: "Comment", thread: {id: threadId}}],
                                    },
                                    {type: "Text", text: " text"},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
This is <mark data-comment="${threadId}">commented</mark> text
`,
                },
                {
                    description: "text with comment and highlight marks",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "highlighted and commented",
                                        marks: [
                                            {type: "Highlight", color: "Green"},
                                            {type: "Comment", thread: {id: threadId}},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<mark data-comment="${threadId}"><mark class="highlight-green">highlighted and commented</mark></mark>
`,
                },
                {
                    description: "text with multiple comment marks preserves all comments",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "This text has "},
                                    {
                                        type: "Text",
                                        text: "multiple comments",
                                        marks: [
                                            {type: "Comment", thread: {id: threadId2}},
                                            {type: "Comment", thread: {id: threadId3}},
                                            {type: "Comment", thread: {id: threadId4}},
                                        ],
                                    },
                                    {type: "Text", text: " on it"},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
This text has <mark data-comment="${threadId2}"><mark data-comment="${threadId3}"><mark data-comment="${threadId4}">multiple comments</mark></mark></mark> on it
`,
                },
                {
                    description: "comment mark inside code block",
                    content: {
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
                                                marks: [
                                                    {
                                                        type: "Comment",
                                                        thread: {
                                                            id: threadId,
                                                        },
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<pre>
<code class="language-javascript">
<mark data-comment="${threadId}"> </mark>
</code>
</pre>
`,
                },
            ],
        },
        {
            contentType: "tables",
            cases: [
                {
                    description: "simple GFM table with header row",
                    content: {
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
                                                        elements: [
                                                            {type: "Text", text: "New York"},
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
                    expectedMarkdown: `\
| Name | Age | City |
| - | - | - |
| Alice | 30 | New York |
| Bob | 25 | London |
`,
                },
                {
                    description: "simple GFM table with formatted text",
                    content: {
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
                                                                    {
                                                                        type: "Link",
                                                                        url: "https://example.com",
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
                    expectedMarkdown: `\
| **Bold&#x20;**&#x48;eader | *Italic&#x20;*&#x48;eader |
| - | - |
| \`Code text\` | [Link text](https://example.com) |
`,
                },
                {
                    description: "simple GFM table with custom column widths",
                    content: {
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
                    expectedMarkdown: `\
<table data-column-widths="2,1,3">
<thead>
<tr>
<th>

Wide

</th>
<th>

Normal

</th>
<th>

Wider

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

A

</td>
<td>

B

</td>
<td>

C

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description: "simple GFM table with custom table width",
                    content: {
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
                    expectedMarkdown: `\
<table data-width="2.5">
<thead>
<tr>
<th>

Col1

</th>
<th>

Col2

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

Data1

</td>
<td>

Data2

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description: "HTML table with header column only",
                    content: {
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "HTML table with both header row and header column",
                    content: {
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "HTML table with complex cell content",
                    content: {
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
                                                            {type: "Text", text: "Description"},
                                                        ],
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
                                                        elements: [
                                                            {type: "Text", text: "Feature 1"},
                                                        ],
                                                    },
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "Additional info"},
                                                        ],
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
                                                                            {
                                                                                type: "Text",
                                                                                text: "Point 1",
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
                                                                                text: "Point 2",
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "HTML table with underscores around a break",
                    content: {
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
                                                            {type: "Text", text: "_"},
                                                            {type: "Break"},
                                                            {type: "Text", text: "_"},
                                                        ],
                                                    },
                                                ],
                                            },
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "Header"}],
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
                                                        elements: [{type: "Text", text: "Line 1"}],
                                                    },
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "Line 2"}],
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
                    expectedMarkdown: `\
<table>
<thead>
<tr>
<th>

\\_\\
\\_

</th>
<th>

Header

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

Line 1

Line 2

</td>
<td>

Value

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description: "HTML table with mixed asterisks around a break",
                    content: {
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
                                                            {type: "Text", text: "**"},
                                                            {type: "Break"},
                                                            {type: "Text", text: "*"},
                                                        ],
                                                    },
                                                ],
                                            },
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "Header"}],
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
                                                        elements: [{type: "Text", text: "Line 1"}],
                                                    },
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "Line 2"}],
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
                    expectedMarkdown: `\
<table>
<thead>
<tr>
<th>

\\*\\*\\
\\*

</th>
<th>

Header

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

Line 1

Line 2

</td>
<td>

Value

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description:
                        "HTML table which otherwise qualifies as a GFM table with underscores around break",
                    content: {
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
                                                            {type: "Text", text: "_", marks: []},
                                                            {type: "Break", marks: []},
                                                            {type: "Text", text: "_", marks: []},
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
                    expectedMarkdown: `\
<table>
<thead>
<tr>
<th>

\\_\\
\\_

</th>
<th>

</th>
</tr>
</thead>
</table>
`,
                },
                {
                    description: "HTML table without any headers",
                    content: {
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "HTML table with custom widths",
                    content: {
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "Simple GFM table with empty cells",
                    content: {
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
                    expectedMarkdown: `\
| Header1 | Header2 |
| - | - |
| | Value |
| Data | |
`,
                },
                {
                    description: "Simple GFM table with line breaks in cells",
                    content: {
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
                                                        elements: [
                                                            {type: "Text", text: "Single line"},
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
                    expectedMarkdown: `\
<table>
<thead>
<tr>
<th>

Col A

</th>
<th>

Col B

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

Line 1\\
Line 2

</td>
<td>

Single line

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description: "Simple GFM table with single cell",
                    content: {
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
                                                        elements: [
                                                            {type: "Text", text: "Only Cell"},
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
                    expectedMarkdown: `\
| Only Cell | |
| - | - |
`,
                },
                {
                    description: "identical adjacent marks in simple table cell",
                    content: {
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
                                                                marks: [
                                                                    {
                                                                        type: "Highlight",
                                                                        color: "Red",
                                                                    },
                                                                ],
                                                            },
                                                            {
                                                                type: "Text",
                                                                text: " ",
                                                                marks: [
                                                                    {
                                                                        type: "Highlight",
                                                                        color: "Red",
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
                    expectedMarkdown: `\
| <mark class="highlight-red">  </mark> | |
| - | - |
`,
                },
                {
                    description: "backslash before escaped space in simple table cell",
                    content: {
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
                                                                text: "\\ ",
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
                    expectedMarkdown: `\
| \\\\&#x20; | |
| - | - |
`,
                },
                {
                    description: "code block with highlight mark inside",
                    content: {
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "adjacent files in table",
                    content: {
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
                                            {elements: []},
                                            {
                                                elements: [
                                                    {type: "File", file: {id: fileId}},
                                                    {type: "File", file: {id: fileId}},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<table>
<tbody>
<tr>
<td>

</td>
<td>

![](https://alpine.inc/file/${fileId}/content)

![](https://alpine.inc/file/${fileId}/content)

</td>
</tr>
</tbody>
</table>
`,
                },
            ],
        },
        {
            contentType: "code blocks",
            cases: [
                {
                    description: "simple code block",
                    content: {
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
                    expectedMarkdown: `\
\`\`\`javascript
const x = 42;
console.log(x);
\`\`\`
`,
                },
                {
                    description: "code block with language",
                    content: {
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
                    expectedMarkdown: `\
\`\`\`javascript
function hello() {
  return 'world';
}
\`\`\`
`,
                },
                {
                    description: "code block with empty lines",
                    content: {
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
                    expectedMarkdown: `\
\`\`\`python
def foo():

    pass


foo()
\`\`\`
`,
                },
                {
                    description: "code block with trailing spaces",
                    content: {
                        elements: [
                            {
                                type: "Code",
                                language: "text",
                                lines: [
                                    {
                                        elements: [
                                            {type: "Text", text: "line with trailing spaces   "},
                                        ],
                                    },
                                    {
                                        elements: [
                                            {type: "Text", text: "    indented with trailing    "},
                                        ],
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
                    expectedMarkdown: `\
\`\`\`text
line with trailing spaces  \u0020
    indented with trailing   \u0020
no trailing
  \u0020
\`\`\`
`,
                },
                {
                    description: "code block with various indentation levels",
                    content: {
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
                    expectedMarkdown: `\
\`\`\`python
class Foo:
    def bar(self):
        if True:
            return 42
\t\tdef baz(self):
\t\t\t\treturn 'tabs'
\`\`\`
`,
                },
                {
                    description: "code block with bold marks",
                    content: {
                        elements: [
                            {
                                type: "Code",
                                language: "javascript",
                                lines: [
                                    {
                                        elements: [
                                            {type: "Text", text: "const "},
                                            {
                                                type: "Text",
                                                text: "highlighted",
                                                marks: [{type: "Bold"}],
                                            },
                                            {type: "Text", text: " = true;"},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<pre>
<code class="language-javascript">
const <strong>highlighted</strong> = true;
</code>
</pre>
`,
                },
                {
                    description: "code block with italic marks",
                    content: {
                        elements: [
                            {
                                type: "Code",
                                language: "markdown",
                                lines: [
                                    {
                                        elements: [
                                            {type: "Text", text: "This is "},
                                            {
                                                type: "Text",
                                                text: "emphasized",
                                                marks: [{type: "Italic"}],
                                            },
                                            {type: "Text", text: " text"},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<pre>
<code class="language-markdown">
This is <em>emphasized</em> text
</code>
</pre>
`,
                },
                {
                    description: "code block with strikethrough marks",
                    content: {
                        elements: [
                            {
                                type: "Code",
                                language: "text",
                                lines: [
                                    {
                                        elements: [
                                            {type: "Text", text: "- "},
                                            {
                                                type: "Text",
                                                text: "removed",
                                                marks: [{type: "Strike"}],
                                            },
                                        ],
                                    },
                                    {
                                        elements: [{type: "Text", text: "+ added"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<pre>
<code class="language-text">
- <del>removed</del>
+ added
</code>
</pre>
`,
                },
                {
                    description: "code block with link marks",
                    content: {
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
                    expectedMarkdown: `\
<pre>
<code class="language-html">
Visit <a href="https://example.com">https://example.com</a> for more
</code>
</pre>
`,
                },
                {
                    description: "code block with multiple marks on same text",
                    content: {
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
                                                marks: [
                                                    {type: "Bold"},
                                                    {type: "Italic"},
                                                    {type: "Strike"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<pre>
<code class="language-text">
normal <strong><em>bold+italic</em></strong> <strong><em><del>all</del></em></strong>
</code>
</pre>
`,
                },
                {
                    description: "code block with mark merging - adjacent same marks",
                    content: {
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
                    expectedMarkdown: `\
<pre>
<code class="language-javascript">
<strong>const merged</strong> = true;
</code>
</pre>
`,
                },
                {
                    description: "code block with mark merging - links with same URL",
                    content: {
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
                    expectedMarkdown: `\
<pre>
<code class="language-text">
<a href="https://example.com">https://example.com</a>
</code>
</pre>
`,
                },
                {
                    description: "code block with no mark merging - links with different URLs",
                    content: {
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
                                                marks: [
                                                    {type: "Link", url: "https://example1.com"},
                                                ],
                                            },
                                            {type: "Text", text: " "},
                                            {
                                                type: "Text",
                                                text: "link2",
                                                marks: [
                                                    {type: "Link", url: "https://example2.com"},
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<pre>
<code class="language-text">
<a href="https://example1.com">link1</a> <a href="https://example2.com">link2</a>
</code>
</pre>
`,
                },
                {
                    description: "code block with marks across multiple lines",
                    content: {
                        elements: [
                            {
                                type: "Code",
                                language: "javascript",
                                lines: [
                                    {
                                        elements: [
                                            {
                                                type: "Text",
                                                text: "function ",
                                                marks: [{type: "Bold"}],
                                            },
                                            {type: "Text", text: "foo() {"},
                                        ],
                                    },
                                    {
                                        elements: [
                                            {
                                                type: "Text",
                                                text: "  return ",
                                                marks: [{type: "Italic"}],
                                            },
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
                    expectedMarkdown: `\
<pre>
<code class="language-javascript">
<strong>function </strong>foo() {
<em>  return </em><strong><em>42</em></strong>;
}
</code>
</pre>
`,
                },
                {
                    description: "code block with empty lines and marks",
                    content: {
                        elements: [
                            {
                                type: "Code",
                                language: "text",
                                lines: [
                                    {
                                        elements: [
                                            {type: "Text", text: "line 1", marks: [{type: "Bold"}]},
                                        ],
                                    },
                                    {
                                        elements: [{type: "Text", text: ""}],
                                    },
                                    {
                                        elements: [
                                            {
                                                type: "Text",
                                                text: "line 3",
                                                marks: [{type: "Italic"}],
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<pre>
<code class="language-text">
<strong>line 1</strong>

<em>line 3</em>
</code>
</pre>
`,
                },
                {
                    description: "code block with empty lines at start/end and mark",
                    content: {
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
                    expectedMarkdown: `\
<pre>
<code class="language-text">

Hello, <strong>world</strong>!

foobar

</code>
</pre>
`,
                },
                {
                    description: "code block with complex mark nesting 1",
                    content: {
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
                                            {
                                                type: "Text",
                                                text: "italic",
                                                marks: [{type: "Italic"}],
                                            },
                                            {type: "Text", text: " end"},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<pre>
<code class="language-text">
start <strong>bold <em>bold+italic </em></strong><em>italic</em> end
</code>
</pre>
`,
                },
                {
                    description: "code block with complex mark nesting 2",
                    content: {
                        elements: [
                            {
                                type: "Code",
                                language: "text",
                                lines: [
                                    {
                                        elements: [
                                            {type: "Text", text: "start "},
                                            {
                                                type: "Text",
                                                text: "bold ",
                                                marks: [{type: "Italic"}],
                                            },
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
                    expectedMarkdown: `\
<pre>
<code class="language-text">
start <em>bold </em><strong><em>bold+italic </em>italic</strong> end
</code>
</pre>
`,
                },
                {
                    description: "code block with special HTML characters",
                    content: {
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
                                            {
                                                type: "Text",
                                                text: "<strong>",
                                                marks: [{type: "Bold"}],
                                            },
                                            {type: "Text", text: "bold"},
                                            {
                                                type: "Text",
                                                text: "</strong>",
                                                marks: [{type: "Bold"}],
                                            },
                                        ],
                                    },
                                    {
                                        elements: [{type: "Text", text: "</div>"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<pre>
<code class="language-html">
&lt;div&gt;
  &amp;nbsp;<strong>&lt;strong&gt;</strong>bold<strong>&lt;/strong&gt;</strong>
&lt;/div&gt;
</code>
</pre>
`,
                },
                {
                    description: "code block with only spaces on some lines",
                    content: {
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
                    expectedMarkdown: `\
\`\`\`text
first
   \u0020
third
\`\`\`
`,
                },
                {
                    description: "code block with marks and empty text elements",
                    content: {
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
                    expectedMarkdown: `\
<pre>
<code class="language-text">
<strong>text</strong>
</code>
</pre>
`,
                },
                {
                    description: "code block with language containing special characters",
                    content: {
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
                    expectedMarkdown: `\
\`\`\`cpp
#include <iostream>
\`\`\`
`,
                },
            ],
        },
        {
            contentType: "inline code and breaks",
            cases: [
                {
                    description: "text and break both with code mark",
                    content: {
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
                    expectedMarkdown: `\
\`Code line\`<code><br /></code>\`Still code\`
`,
                },
                {
                    description: "break with code mark between non-code text",
                    content: {
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
                    expectedMarkdown: `\
Normal<code><br /></code>Also normal
`,
                },
                {
                    description: "multiple breaks with code marks",
                    content: {
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
                    expectedMarkdown: `\
\`Line 1\`<code><br /></code>\`Line 2\`<code><br /></code>\`Line 3\`
`,
                },
                {
                    description: "break without code mark between code text",
                    content: {
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
                    expectedMarkdown: `\
\`Code line 1\`\\
\`Code line 2\`
`,
                },
            ],
        },
        {
            contentType: "inline code and mentions",
            cases: [
                {
                    description: "mention with code mark",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId,
                                            title: "@alice",
                                        },
                                        marks: [{type: "Code"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<code>[@alice](https://alpine.inc/mention/${accountId})</code>
`,
                },
                {
                    description: "mention with code mark in sentence",
                    content: {
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
                                            title: "@bob",
                                        },
                                        marks: [{type: "Code"}],
                                    },
                                    {type: "Text", text: " about it"},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Ask <code>[@bob](https://alpine.inc/mention/${accountId})</code> about it
`,
                },
                {
                    description: "mention and text both with code mark",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "The user ", marks: [{type: "Code"}]},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId,
                                            title: "@charlie",
                                        },
                                        marks: [{type: "Code"}],
                                    },
                                    {type: "Text", text: " is mentioned", marks: [{type: "Code"}]},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\`The user \`<code>[@charlie](https://alpine.inc/mention/${accountId})</code>\` is mentioned\`
`,
                },
                {
                    description: "multiple mentions with code marks",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "CC: ", marks: [{type: "Code"}]},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId,
                                            title: "@eve",
                                        },
                                        marks: [{type: "Code"}],
                                    },
                                    {type: "Text", text: " and ", marks: [{type: "Code"}]},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId2,
                                            title: "@frank",
                                        },
                                        marks: [{type: "Code"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\`CC: \`<code>[@eve](https://alpine.inc/mention/${accountId})</code>\`  and  \`<code>[@frank](https://alpine.inc/mention/${accountId2})</code>
`,
                },
            ],
        },
        {
            contentType: "complex inline combinations",
            cases: [
                {
                    description: "break and mention both with code marks",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "User: ", marks: [{type: "Code"}]},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId,
                                            title: "@grace",
                                        },
                                        marks: [{type: "Code"}],
                                    },
                                    {type: "Break", marks: [{type: "Code"}]},
                                    {type: "Text", text: "Status: active", marks: [{type: "Code"}]},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\`User: \`<code>[@grace](https://alpine.inc/mention/${accountId})</code><code><br /></code>\`Status: active\`
`,
                },
                {
                    description: "mention without code mark between code text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Code before ", marks: [{type: "Code"}]},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId,
                                            title: "@henry",
                                        },
                                    },
                                    {type: "Text", text: " code after", marks: [{type: "Code"}]},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\`Code before \`[@henry](https://alpine.inc/mention/${accountId})\` code after\`
`,
                },
                {
                    description: "mention with isAccountShortName and code mark",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId,
                                            title: "iris",
                                        },
                                        isAccountShortName: true,
                                        marks: [{type: "Code"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<code>[iris](https://alpine.inc/mention/${accountId}#short)</code>
`,
                },
                {
                    description: "mention without title and with code mark",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Mention",
                                        reference: {type: "Task", id: taskId},
                                        marks: [{type: "Code"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<code>[Unknown task](https://alpine.inc/task/${taskId}#mention)</code>
`,
                },
                {
                    description: "complex paragraph with mixed code marks",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Function: ", marks: [{type: "Code"}]},
                                    {type: "Text", text: "getUserData(", marks: [{type: "Code"}]},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId,
                                            title: "@jack",
                                        },
                                        marks: [{type: "Code"}],
                                    },
                                    {type: "Text", text: ")", marks: [{type: "Code"}]},
                                    {type: "Break", marks: [{type: "Code"}]},
                                    {
                                        type: "Text",
                                        text: "Returns: user object",
                                        marks: [{type: "Code"}],
                                    },
                                    {type: "Break"},
                                    {type: "Text", text: "Author: "},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId2,
                                            title: "@kate",
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\`Function: getUserData(\`<code>[@jack](https://alpine.inc/mention/${accountId})</code>\`)\`<code><br /></code>\`Returns: user object\`\\
Author: [@kate](https://alpine.inc/mention/${accountId2})
`,
                },
            ],
        },
        {
            contentType: "comprehensive markdown",
            cases: [
                {
                    description: "bold text next to bold link text",
                    content: {
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
                                        marks: [
                                            {type: "Bold"},
                                            {type: "Link", url: "https://example.com"},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
**This is bold [and this is a bold link](https://example.com)**
`,
                },
                {
                    description: "bold link text next to bold text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "This is a bold link",
                                        marks: [
                                            {type: "Bold"},
                                            {type: "Link", url: "https://example.com"},
                                        ],
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
                    expectedMarkdown: `\
**[This is a bold link](https://example.com) and this is bold**
`,
                },
                {
                    description: "bold text next to bold link text next to bold text",
                    content: {
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
                                        marks: [
                                            {type: "Bold"},
                                            {type: "Link", url: "https://example.com"},
                                        ],
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
                    expectedMarkdown: `\
**This is bold [and this is a bold link](https://example.com) and this is bold**
`,
                },
                {
                    description: "bold + strike text next to bold + strike link text",
                    content: {
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
                    expectedMarkdown: `\
**~~This is bold [and this is a bold link](https://example.com)~~**
`,
                },
                {
                    description: "bold + strike link text next to bold + strike text",
                    content: {
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
                    expectedMarkdown: `\
**~~[This is a bold link](https://example.com) and this is bold~~**
`,
                },
                {
                    description:
                        "bold + strike text next to bold + strike link text next to bold + strike text",
                    content: {
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
                    expectedMarkdown: `\
**~~This is bold [and this is a bold link](https://example.com) and this is bold~~**
`,
                },
                {
                    description: "code mark takes precedence over other marks",
                    content: {
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
                    expectedMarkdown: `\
**\`code with bold\`**
`,
                },
                {
                    description: "multiple marks are sorted correctly",
                    content: {
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
                    expectedMarkdown: `\
*~~strike then italic~~* and *~~italic then strike~~*
`,
                },
                {
                    description: "link mark comes first in order",
                    content: {
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
                    expectedMarkdown: `\
[***~~styled link~~***](https://example.com)
`,
                },
                {
                    description: "paragraph with only break",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Break"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<br />
`,
                },
                {
                    description: "paragraph with only bold break",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Break", marks: [{type: "Bold"}]}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
**<br />**
`,
                },
                {
                    description: "paragraph with only breaks",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Break"}, {type: "Break"}, {type: "Break"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<br /><br /><br />
`,
                },
                {
                    description: "break at start of paragraph",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Break"},
                                    {type: "Text", text: "Text after break"},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\
Text after break
`,
                },
                {
                    description: "breaks at start of paragraph",
                    content: {
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
                    expectedMarkdown: `\
\\
\\
\\
Text after break
`,
                },
                {
                    description: "break at end of paragraph",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Text before break"},
                                    {type: "Break"},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Text before break<br />
`,
                },
                {
                    description: "breaks at end of paragraph",
                    content: {
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
                    expectedMarkdown: `\
Text before break<br /><br /><br />
`,
                },
                {
                    description: "adjacent text elements with same marks should stay separate",
                    content: {
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
                    expectedMarkdown: `\
**First bold second bold**
`,
                },
                {
                    description: "empty text elements are handled",
                    content: {
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
                    expectedMarkdown: `\
BeforeAfter
`,
                },
                {
                    description: "text with only marks but no content",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "", marks: [{type: "Bold"}]}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<p></p>
`,
                },
                {
                    description: "multiple consecutive breaks with different marks",
                    content: {
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
                    expectedMarkdown: `\
Start<br />**<br />**_<br />_&#x45;nd
`,
                },
                {
                    description: "dollar signs are not escaped for math",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Price is $100 or $$200"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Price is $100 or \\$$200
`,
                },
                {
                    description: "hash symbols at start of line",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "# Not a heading"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\# Not a heading
`,
                },
                {
                    description: "numbers with dots at start of line",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "1. Not a list item"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
1\\. Not a list item
`,
                },
                {
                    description: "dashes at start of line",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "- Not a list item"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\- Not a list item
`,
                },
                {
                    description: "plus signs at start of line",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "+ Not a list item"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\+ Not a list item
`,
                },
                {
                    description: "greater than at start of line",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "> Not a quote"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\> Not a quote
`,
                },
                {
                    description: "pipes in text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "A | B | C"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
A | B | C
`,
                },
                {
                    description: "exclamation marks before brackets",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "![Not an image]"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
!\\[Not an image]
`,
                },
                {
                    description: "parentheses after brackets",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "[text](not-a-link)"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\[text]\\(not-a-link)
`,
                },
                {
                    description: "triple backticks in plain text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Use ``` for code blocks"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Use \\\`\\\`\\\` for code blocks
`,
                },
                {
                    description: "tilde characters",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "~not struck~ ~~also not struck~~"},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\~not struck\\~ \\~\\~also not struck\\~\\~
`,
                },
                {
                    description: "link with parentheses in URL",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "link",
                                        marks: [
                                            {
                                                type: "Link",
                                                url: "https://example.com/path(with)parens",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[link](https://example.com/path\\(with\\)parens)
`,
                },
                {
                    description: "link with spaces in URL",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: "link",
                                        marks: [
                                            {
                                                type: "Link",
                                                url: "https://example.com/path with spaces",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[link](<https://example.com/path with spaces>)
`,
                },
                {
                    description: "angle brackets in URL",
                    content: {
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
                    expectedMarkdown: `\
[link](https://example.com/\\<path\\>)
`,
                },
                {
                    description: "reference-style link syntax in text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "[link][reference]"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\[link]\\[reference]
`,
                },
                {
                    description: "footnote syntax in text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "Text[^1] with footnote"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Text\\[^1] with footnote
`,
                },
                {
                    description: "horizontal rule characters",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "---"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\---
`,
                },
                {
                    description: "asterisk horizontal rule",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "***"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\*\\*\\*
`,
                },
                {
                    description: "code fence in text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "```javascript"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\\`\\\`\\\`javascript
`,
                },
                {
                    description: "account mention",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId,
                                        },
                                        isAccountShortName: false,
                                        marks: [],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[Unknown](https://alpine.inc/mention/${accountId})
`,
                },
                {
                    description: "task mention with empty title",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Task",
                                            id: taskId,
                                            title: "",
                                        },
                                        isAccountShortName: false,
                                        marks: [],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
[Unknown task](https://alpine.inc/task/${taskId}#mention)
`,
                },
                {
                    description: "unicode multi-code point grapheme after bold",
                    content: {
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
                    expectedMarkdown: `\
**&#x20;**&#x10000;

<p></p>
`,
                },
                {
                    description: "unicode multi-code point grapheme before bold",
                    content: {
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
                    expectedMarkdown: `\
&#x10000;**&#x20;**

<p></p>
`,
                },
                {
                    description: "mention with link mark",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Mention",
                                        reference: {type: "Task", id: taskId},
                                        isAccountShortName: false,
                                        marks: [{type: "Link", url: "http://a.aa"}],
                                    },
                                ],
                            },
                            {type: "Paragraph", elements: []},
                        ],
                    },
                    expectedMarkdown: `\
<a href="http://a.aa">[Unknown task](https://alpine.inc/task/${taskId}#mention)</a>

<p></p>
`,
                },
                {
                    description: "mention with strike mark",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Document",
                                            id: documentId,
                                        },
                                        isAccountShortName: false,
                                        marks: [{type: "Strike"}],
                                    },
                                    {type: "Text", text: "0", marks: []},
                                ],
                            },
                            {type: "Paragraph", elements: []},
                        ],
                    },
                    expectedMarkdown: `\
~~[Unknown document](https://alpine.inc/doc/${documentId}#mention)~~&#x30;

<p></p>
`,
                },
                {
                    description: "space with bold mark in quote block",
                    content: {
                        elements: [
                            {
                                type: "Quote",
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: " ", marks: [{type: "Bold"}]},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
> **&#x20;**
`,
                },
                {
                    description: "character with strike mark in quote block",
                    content: {
                        elements: [
                            {
                                type: "Quote",
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "x", marks: [{type: "Strike"}]},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
> ~~x~~
`,
                },
                {
                    description: "space with strike mark in quote block",
                    content: {
                        elements: [
                            {
                                type: "Quote",
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: " ", marks: [{type: "Strike"}]},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
> ~~&#x20;~~
`,
                },
                {
                    description: "ignores content that looks like inline math",
                    content: {
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
                    expectedMarkdown: `\
$\\[$
`,
                },
                {
                    description: "bold with single space next to italics",
                    content: {
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
                    expectedMarkdown: `\
**&#x20;**_0_
`,
                },
                {
                    description: "italicized escaped space",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "\\ ", marks: [{type: "Italic"}]}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
*\\\\&#x20;*
`,
                },
                {
                    description: "bolded escaped space",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "\\ ", marks: [{type: "Bold"}]}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
**\\\\&#x20;**
`,
                },
                {
                    description: "struck escaped space",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "\\ ", marks: [{type: "Strike"}]}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
~~\\\\&#x20;~~
`,
                },
                {
                    description: "italicized double space",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "  ", marks: [{type: "Italic"}]}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
*&#x20;&#x20;*
`,
                },
                {
                    description: "italic space after bold italic space in quote block",
                    content: {
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
                    expectedMarkdown: `\
> ***&#x20;***_&#x20;_
`,
                },
                {
                    description: "empty text after break",
                    content: {
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
                    expectedMarkdown: `\
<br />
`,
                },
                {
                    description: "escaped character followed by bold space",
                    content: {
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
                    expectedMarkdown: `\
\\\\&#x41;**&#x20;**
`,
                },
                {
                    description: "math like text followed by space",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "$*$ ", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
$\\*$&#x20;
`,
                },
                {
                    description: "mention with link that contains HTML unsafe character",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "TaskCollection",
                                            id: taskCollectionId,
                                            title: "",
                                        },
                                        isAccountShortName: false,
                                        marks: [{type: "Link", url: "http://a.aa/&"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<a href="http://a.aa/&amp;">[Unknown task collection](https://alpine.inc/task-collection/${taskCollectionId}#mention)</a>
`,
                },
                {
                    description: "break followed by mention with link",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Break", marks: []},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId,
                                        },
                                        isAccountShortName: false,
                                        marks: [{type: "Link", url: "http://a.aa"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<br /><a href="http://a.aa">[Unknown](https://alpine.inc/mention/${accountId})</a>
`,
                },
                {
                    description: "marked break followed by mention with link",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Break", marks: [{type: "Bold"}]},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Account",
                                            id: accountId,
                                        },
                                        isAccountShortName: false,
                                        marks: [{type: "Link", url: "http://a.aa"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
**<br />**<a href="http://a.aa">[Unknown](https://alpine.inc/mention/${accountId})</a>
`,
                },
                {
                    description: "mention inside math like text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "$_", marks: []},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Document",
                                            id: documentId,
                                        },
                                        isAccountShortName: false,
                                        marks: [],
                                    },
                                    {type: "Text", text: "$", marks: []},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
$\\_[Unknown document](https://alpine.inc/doc/${documentId}#mention)$
`,
                },
                {
                    description: "escapes dollar sign in text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "a $ b", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
a $ b
`,
                },
                {
                    description: "escapes dollar sign at start of text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "$ b", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
$ b
`,
                },
                {
                    description: "escapes dollar sign at end of text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "a $", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
a $
`,
                },
                {
                    description: "escapes dollar sign at start and end of text",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "$ ab $", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
$ ab $
`,
                },
                {
                    description:
                        "escapes dollar sign at start and end of text when followed by underscores",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "$_ab_$", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
$\\_ab\\_$
`,
                },
                {
                    description:
                        "escapes dollar sign at start and end of text when followed by asterisks",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "$*ab*$", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
$\\*ab\\*$
`,
                },
                {
                    description:
                        "escapes dollar sign at start and end of text when followed by parenthesis",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "$(ab)$", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
$(ab)$
`,
                },
                {
                    description: "italicized unicode code point from multiple utf-16 code units",
                    content: {
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
                    expectedMarkdown: `\
&#x30;_&#x10000;_**&#x20;**
`,
                },
                {
                    description:
                        "unicode code point that looks like punctuation if you just look at the first utf-16 code unit",
                    content: {
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
                    expectedMarkdown: `\
> **&#x20;**&#x11800;
`,
                },
                {
                    description: "separate text elements escaping character that gets encoded",
                    content: {
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
                    expectedMarkdown: `\
\\\\&#x30;*&#x20;*
`,
                },
                {
                    description: "two breaks followed by a mention with a link mark",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Break", marks: []},
                                    {type: "Break", marks: []},
                                    {
                                        type: "Mention",
                                        reference: {
                                            type: "Post",
                                            id: postId,
                                            title: "",
                                        },
                                        isAccountShortName: false,
                                        marks: [{type: "Link", url: "http://a.aa"}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<br /><br /><a href="http://a.aa">[Unknown post](https://alpine.inc/post/${postId}#mention)</a>
`,
                },
                {
                    description:
                        "punctuation unicode code point represented by two utf-16 code units is escaped",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: " ", marks: [{type: "Bold"}]},
                                    {type: "Text", text: "\u{1E95E}", marks: []},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
**&#x20;**&#x1E95E;
`,
                },
                {
                    description:
                        "unicode code point with two utf-16 code units at the end of strike mark",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {
                                        type: "Text",
                                        text: " \uD806\uDC00",
                                        marks: [{type: "Strike"}],
                                    },
                                    {type: "Text", text: "A", marks: []},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
~~&#x20;&#x11800;~~&#x41;
`,
                },
                {
                    description: "doesn\u2019t parse angle brackets with @ content as autolink",
                    content: {
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
                    expectedMarkdown: `\
\\<@0>
`,
                },
                {
                    description:
                        "doesn\u2019t parse angle brackets with number content as autolink",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "<0@0>", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\<0@0>
`,
                },
                {
                    description:
                        "doesn\u2019t parse angle brackets with bracket content as autolink",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "<<@0>", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<\\<@0>
`,
                },
                {
                    description: "doesn\u2019t parse angle brackets with space content as autolink",
                    content: {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [{type: "Text", text: "< @0>", marks: []}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
< @0>
`,
                },
                {
                    description: "uses HTML form of break if followed by italic space",
                    content: {
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
                    expectedMarkdown: `\
<br />*&#x20;*
`,
                },
                {
                    description: "uses HTML form of break if followed by bold space",
                    content: {
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
                    expectedMarkdown: `\
<br />**&#x20;**
`,
                },
                {
                    description: "uses HTML form of break if followed by strike space",
                    content: {
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
                    expectedMarkdown: `\
<br />~~&#x20;~~
`,
                },
                {
                    description: "empty code block",
                    content: {elements: [{type: "Code", language: "erlang", lines: []}]},
                    expectedMarkdown: `\
\`\`\`erlang
\`\`\`
`,
                },
                {
                    description: "empty code block (with empty line)",
                    content: {
                        elements: [{type: "Code", language: "erlang", lines: [{elements: []}]}],
                    },
                    expectedMarkdown: `\
\`\`\`erlang
\`\`\`
`,
                },
                {
                    description: "empty code block (with empty line with no text but marks)",
                    content: {
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
                    expectedMarkdown: `\
\`\`\`lua
\`\`\`
`,
                },
                {
                    description: "code block with empty mark and separate unmarked text elements",
                    content: {
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
                    expectedMarkdown: `\
\`\`\`lua
 <
\`\`\`
`,
                },
                {
                    description: "code block with empty mark and separate marked text elements",
                    content: {
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
                    expectedMarkdown: `\
<pre>
<code class="language-lua">
 <strong>&lt;</strong>
</code>
</pre>
`,
                },
                {
                    description: "backticks at start/end of text in inline code",
                    content: {
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
                    expectedMarkdown: `\
\`\` \`test\` \`\`
`,
                },
                {
                    description:
                        "backticks after/before spaces at start/end of text in inline code",
                    content: {
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
                    expectedMarkdown: `\
\`\`  \`test\`  \`\`
`,
                },
                {
                    description: "text that looks like a definition inside code + link",
                    content: {
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
                    expectedMarkdown: `\
[<code>\\]:</code>](http://a.aa)
`,
                },
                {
                    description:
                        "italic content next to bold content when italic content is merged with previous link",
                    content: {
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
                                        marks: [
                                            {type: "Link", url: "http://a.aa"},
                                            {type: "Italic"},
                                        ],
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
                    expectedMarkdown: `\
***&#x20;***_[ ](http://a.aa)&#x20;_
`,
                },
                {
                    description: "empty table",
                    content: {
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "empty table with header row",
                    content: {
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
                    expectedMarkdown: `\
| | |
| - | - |
`,
                },
                {
                    description: "empty table with header column",
                    content: {
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "empty table with header row and column",
                    content: {
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "adjacent unordered lists",
                    content: {
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
                    expectedMarkdown: `\
- First item

- Second item

- Third item

- Fourth item
`,
                },
                {
                    description: "adjacent ordered lists",
                    content: {
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
                    expectedMarkdown: `\
1. First item

2. Second item

3. Third item

4. Fourth item
`,
                },
                {
                    description: "adjacent unordered lists with empty list in between",
                    content: {
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
                    expectedMarkdown: `\
- First item

- Second item

- Third item

- Fourth item
`,
                },
                {
                    description: "adjacent ordered lists with empty list in between",
                    content: {
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
                    expectedMarkdown: `\
1. First item

2. Second item

3. Third item

4. Fourth item
`,
                },
                {
                    description: "adjacent ordered lists with empty unordered list in between",
                    content: {
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
                    expectedMarkdown: `\
1. First item

2. Second item

3. Third item

4. Fourth item
`,
                },
                {
                    description: "table with one row and three empty cells",
                    content: {
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
                    expectedMarkdown: `\
| | | |
| - | - | - |
`,
                },
                {
                    description: "table with one row and three empty cells without header row",
                    content: {
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
                    expectedMarkdown: `\
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
                },
                {
                    description:
                        "table with two rows and three empty cells without header row (first row has no cells)",
                    content: {
                        elements: [
                            {
                                type: "Table",
                                width: 1,
                                hasHeaderRow: false,
                                hasHeaderColumn: false,
                                columns: [],
                                rows: [
                                    {cells: []},
                                    {cells: [{elements: []}, {elements: []}, {elements: []}]},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
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
                },
                {
                    description: "table with more column widths than columns",
                    content: {
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
                    expectedMarkdown: `\
<table data-column-widths="0.009999999776482582,0.009999999776482582,0.009999999776482582">
<thead>
<tr>
<th>

</th>
<th>

</th>
</tr>
</thead>
</table>
`,
                },
                {
                    description: "paragraph that\u2019s a single space in table cell",
                    content: {
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
                    expectedMarkdown: `\
| &#x20; | |
| - | - |
`,
                },
                {
                    description: "paragraph with trailing spaces in table cell",
                    content: {
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
                                                                text: "foo   ",
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
                    expectedMarkdown: `\
| foo  &#x20; | |
| - | - |
`,
                },
                {
                    description: "paragraph with leading spaces in table cell",
                    content: {
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
                                                                text: "   foo",
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
                    expectedMarkdown: `\
| &#x20;  foo | |
| - | - |
`,
                },
                {
                    description:
                        "paragraph with trailing spaces that\u2019s a single space in table cell",
                    content: {
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
                    expectedMarkdown: `\
| &#x20;&#x20; | |
| - | - |
`,
                },
                {
                    description: "italic before to bolded link which has lifted its mark",
                    content: {
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
                    expectedMarkdown: `\
_-X_**[~~-y/@\\\`/$bz1~~](https://63o.kry)G**
`,
                },
                {
                    description: "simple table with a really long cell",
                    content: {
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
                                                                text: "Title",
                                                                marks: [],
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
                                                            {type: "Text", text: "Body", marks: []},
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
                                                                text: "Lorem Ipsum",
                                                                marks: [],
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
                    expectedMarkdown: `\
| Title | Body |
| - | - |
| Lorem Ipsum | Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer eget tortor libero. Praesent ac tortor vel justo cursus vestibulum. Etiam feugiat dictum ipsum at gravida. Curabitur condimentum libero non arcu vulputate, at commodo arcu ultrices. Ut pellentesque eleifend ante. Nulla fermentum orci eget nulla eleifend gravida in sed purus. Cras mollis dictum augue, at ultrices libero sollicitudin nec. |
`,
                },
                {
                    description: "link that looks like mention",
                    content: {
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
                                                url: `https://alpine.inc/doc/${documentId}#mention`,
                                            },
                                        ],
                                    },
                                    {type: "Text", text: " to visit"},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Click <a href="https://alpine.inc/doc/${documentId}#mention">here</a> to visit
`,
                },
                {
                    description: "link that looks like a short account mention",
                    content: {
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
                                                url: `https://alpine.inc/mention/${accountId}#short`,
                                            },
                                        ],
                                    },
                                    {type: "Text", text: " to visit"},
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
Click <a href="https://alpine.inc/mention/${accountId}#short">here</a> to visit
`,
                },
                {
                    description: "pipe in table cell",
                    content: {
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
                    expectedMarkdown: `\
| \\| | |
| - | - |
`,
                },
                {
                    description: "escaped pipe in table cell",
                    content: {
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
                    expectedMarkdown: `\
| \\\\\\| | |
| - | - |
`,
                },
                {
                    description: "pipe in table cell with code mark",
                    content: {
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
                    expectedMarkdown: `\
| \`\\|\` | |
| - | - |
`,
                },
                {
                    description: "escaped pipe in table cell with code mark",
                    content: {
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
                    expectedMarkdown: `\
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
                },
                {
                    description: "escaped pipe between text in table cell with code mark",
                    content: {
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
                    expectedMarkdown: `\
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
                },
            ],
        },
        {
            contentType: "headings and dividers",
            cases: [
                {
                    description: "heading level 1",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 1,
                                elements: [{type: "Text", text: "Main Title"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
# Main Title
`,
                },
                {
                    description: "heading level 2",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 2,
                                elements: [{type: "Text", text: "Subtitle"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
## Subtitle
`,
                },
                {
                    description: "heading level 3",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 3,
                                elements: [{type: "Text", text: "Section"}],
                            },
                        ],
                    },
                    expectedMarkdown: `\
### Section
`,
                },
                {
                    description: "heading with marks",
                    content: {
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
                    expectedMarkdown: `\
## Bold **and** *italic* heading
`,
                },
                {
                    description: "heading with empty content",
                    content: {
                        elements: [
                            {
                                type: "Heading",
                                level: 1,
                                elements: [],
                            },
                        ],
                    },
                    expectedMarkdown: `\
#
`,
                },
                {
                    description: "heading with break nodes",
                    content: {
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
                    expectedMarkdown: `\
## Multi<br />line heading
`,
                },
                {
                    description: "multiple headings",
                    content: {
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
                    expectedMarkdown: `\
# Chapter 1

Some content here.

## Section A

More content.
`,
                },
                {
                    description: "divider",
                    content: {
                        elements: [
                            {
                                type: "Divider",
                            },
                        ],
                    },
                    expectedMarkdown: `\
<hr />
`,
                },
                {
                    description: "divider between paragraphs",
                    content: {
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
                    expectedMarkdown: `\
Before divider

---

After divider
`,
                },
                {
                    description: "multiple dividers",
                    content: {
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
                    expectedMarkdown: `\
Section 1

---

Section 2

---

Section 3
`,
                },
                {
                    description: "dividers that look like frontmatter",
                    content: {
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
                                    {
                                        type: "Text",
                                        text: "The quick brown fox jumps over the lazy dog.",
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<hr />

title: Hello, world!

---

The quick brown fox jumps over the lazy dog.
`,
                },
                {
                    description: "paragraph that looks like frontmatter",
                    content: {
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
                                    {
                                        type: "Text",
                                        text: "The quick brown fox jumps over the lazy dog.",
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\---\\
title: Hello, world!\\
\\---

The quick brown fox jumps over the lazy dog.
`,
                },
                {
                    description: "paragraphs that look like frontmatter",
                    content: {
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
                                    {
                                        type: "Text",
                                        text: "The quick brown fox jumps over the lazy dog.",
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
\\---

title: Hello, world!

\\---

The quick brown fox jumps over the lazy dog.
`,
                },
                {
                    description: "divider before empty unordered list",
                    content: {
                        elements: [
                            {type: "Divider"},
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [{type: "Paragraph", elements: []}],
                                        nestedListElements: [],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<hr />

- <p></p>
`,
                },
                {
                    description: "leading empty checklist before divider then empty checklist item",
                    content: {
                        elements: [
                            {
                                type: "CheckList",
                                items: [],
                            },
                            {type: "Divider"},
                            {
                                type: "CheckList",
                                items: [
                                    {
                                        checked: false,
                                        elements: [{type: "Paragraph", elements: []}],
                                        nestedListElements: [],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<hr />

- [ ] <span></span>
`,
                },
                {
                    description: "divider after paragraph but before empty unordered list",
                    content: {
                        elements: [
                            {type: "Paragraph", elements: [{type: "Text", text: "a"}]},
                            {type: "Divider"},
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [{type: "Paragraph", elements: []}],
                                        nestedListElements: [],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
a

---

- <p></p>
`,
                },
            ],
        },

        {
            contentType: "files and previews",
            cases: [
                {
                    description: "standalone image file",
                    content: {
                        elements: [{type: "File", file: {id: fileId}}],
                    },
                    expectedMarkdown: `\
![](https://alpine.inc/file/${fileId}/content)
`,
                },
                {
                    description: "standalone image file with explicit content type",

                    content: {
                        elements: [
                            {
                                type: "File",
                                file: {id: fileId, contentType: "image/png"},
                            },
                        ],
                    },
                    expectedMarkdown: `\
![](https://alpine.inc/file/${fileId}/content)
`,
                },
                {
                    description: "standalone video file",

                    content: {
                        elements: [
                            {
                                type: "File",
                                file: {id: fileId, contentType: "video/mp4"},
                            },
                        ],
                    },
                    expectedMarkdown: `\
<video type="video/mp4" src="https://alpine.inc/file/${fileId}/content" controls></video>
`,
                },
                {
                    description: "standalone audio file",

                    content: {
                        elements: [
                            {
                                type: "File",
                                file: {id: fileId, contentType: "audio/mpeg"},
                            },
                        ],
                    },
                    expectedMarkdown: `\
<audio type="audio/mpeg" src="https://alpine.inc/file/${fileId}/content" controls></audio>
`,
                },
                {
                    description: "standalone pdf file",

                    content: {
                        elements: [
                            {
                                type: "File",
                                file: {id: fileId, contentType: "application/pdf"},
                            },
                        ],
                    },
                    expectedMarkdown: `\
<object type="application/pdf" data="https://alpine.inc/file/${fileId}/content"></object>
`,
                },
                {
                    description: "preview with document reference",
                    content: {
                        elements: [
                            {
                                type: "Preview",
                                reference: {
                                    type: "Document",
                                    id: documentId,
                                    title: "My Document",
                                },
                            },
                        ],
                    },
                    expectedMarkdown: `\
![My Document](https://alpine.inc/doc/${documentId}/preview)
`,
                },
                {
                    description: "preview with channel reference",
                    content: {
                        elements: [
                            {
                                type: "Preview",
                                reference: {
                                    type: "Channel",
                                    id: channelId,
                                    title: "General",
                                },
                            },
                        ],
                    },
                    expectedMarkdown: `\
![General](https://alpine.inc/channel/${channelId}/preview)
`,
                },
                {
                    description: "file gallery with two files",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.5,
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId},
                                                },
                                            },
                                            {
                                                width: 0.5,
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId},
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
</div>
`,
                },
                {
                    description: "file gallery with multiple rows, second row is standalone",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.5,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                            {
                                                width: 0.5,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                        ],
                                    },
                                    {
                                        items: [{element: {type: "File", file: {id: fileId}}}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
</div>

![](https://alpine.inc/file/${fileId}/content)
`,
                },
                {
                    description: "file gallery with one row and one item renders as standalone",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [{element: {type: "File", file: {id: fileId}}}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
![](https://alpine.inc/file/${fileId}/content)
`,
                },
                {
                    description: "file float left",
                    content: {
                        elements: [
                            {
                                type: "FileFloat",
                                side: "Left",
                                element: {
                                    type: "File",
                                    file: {id: fileId},
                                },
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="float: left; clear: both">
<img src="https://alpine.inc/file/${fileId}/content" />
</div>
`,
                },
                {
                    description: "file float right",
                    content: {
                        elements: [
                            {
                                type: "FileFloat",
                                side: "Right",
                                element: {
                                    type: "File",
                                    file: {id: fileId},
                                },
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="float: right; clear: both">
<img src="https://alpine.inc/file/${fileId}/content" />
</div>
`,
                },
                {
                    description: "preview inside gallery with one item renders as standalone",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                element: {
                                                    type: "Preview",
                                                    reference: {
                                                        type: "Document",
                                                        id: documentId,
                                                        title: "My Document",
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
![My Document](https://alpine.inc/doc/${documentId}/preview)
`,
                },
                {
                    description: "file gallery with three rows, last row is standalone",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.5,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                            {
                                                width: 0.5,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                        ],
                                    },
                                    {
                                        items: [
                                            {
                                                width: 0.33,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                            {
                                                width: 0.33,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                            {
                                                width: 0.34,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                        ],
                                    },
                                    {
                                        items: [{element: {type: "File", file: {id: fileId}}}],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
</div>

<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 33%" />
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 33%" />
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 34%" />
</div>

![](https://alpine.inc/file/${fileId}/content)
`,
                },
                {
                    description: "file gallery with one row and one preview renders as standalone",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                element: {
                                                    type: "Preview",
                                                    reference: {
                                                        type: "Document",
                                                        id: documentId,
                                                        title: "Design Spec",
                                                    },
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
![Design Spec](https://alpine.inc/doc/${documentId}/preview)
`,
                },
                {
                    description: "file in table cell alone",
                    content: {
                        elements: [
                            {
                                type: "Table",
                                width: 2,
                                columns: [{width: 1}, {width: 1}],
                                rows: [
                                    {
                                        cells: [
                                            {
                                                elements: [{type: "File", file: {id: fileId}}],
                                            },
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "description"},
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
                    expectedMarkdown: `\
<table data-width="2">
<tbody>
<tr>
<td>

![](https://alpine.inc/file/${fileId}/content)

</td>
<td>

description

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description: "multiple files in table cell",
                    content: {
                        elements: [
                            {
                                type: "Table",
                                width: 2,
                                columns: [{width: 1}, {width: 1}],
                                rows: [
                                    {
                                        cells: [
                                            {
                                                elements: [
                                                    {type: "File", file: {id: fileId}},
                                                    {type: "File", file: {id: fileId}},
                                                ],
                                            },
                                            {elements: []},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<table data-width="2">
<tbody>
<tr>
<td>

![](https://alpine.inc/file/${fileId}/content)

![](https://alpine.inc/file/${fileId}/content)

</td>
<td>

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description: "file with text in table cell",
                    content: {
                        elements: [
                            {
                                type: "Table",
                                width: 2,
                                columns: [{width: 1}, {width: 1}],
                                rows: [
                                    {
                                        cells: [
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [{type: "Text", text: "caption"}],
                                                    },
                                                    {type: "File", file: {id: fileId}},
                                                ],
                                            },
                                            {elements: []},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<table data-width="2">
<tbody>
<tr>
<td>

caption

![](https://alpine.inc/file/${fileId}/content)

</td>
<td>

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description: "preview in table cell",
                    content: {
                        elements: [
                            {
                                type: "Table",
                                width: 2,
                                columns: [{width: 1}, {width: 1}],
                                rows: [
                                    {
                                        cells: [
                                            {
                                                elements: [
                                                    {
                                                        type: "Preview",
                                                        reference: {
                                                            type: "Document",
                                                            id: documentId,
                                                            title: "My Document",
                                                        },
                                                    },
                                                ],
                                            },
                                            {elements: []},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<table data-width="2">
<tbody>
<tr>
<td>

![My Document](https://alpine.inc/doc/${documentId}/preview)

</td>
<td>

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description: "preview inside gallery with multiple items",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.5,
                                                element: {
                                                    type: "Preview",
                                                    reference: {
                                                        type: "Document",
                                                        id: documentId,
                                                        title: "My Document",
                                                    },
                                                },
                                            },
                                            {
                                                width: 0.5,
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId},
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<img alt="My Document" src="https://alpine.inc/doc/${documentId}/preview" style="flex: 0 0 50%" />
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
</div>
`,
                },
                {
                    description: "file gallery with widths",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.67,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                            {
                                                width: 0.33,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 67%" />
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 33%" />
</div>
`,
                },
                {
                    description: "file gallery with video file",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.5,
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId, contentType: "video/mp4"},
                                                },
                                            },
                                            {
                                                width: 0.5,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<video type="video/mp4" src="https://alpine.inc/file/${fileId}/content" controls style="flex: 0 0 50%"></video>
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
</div>
`,
                },
                {
                    description: "file gallery with audio file",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.5,
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId, contentType: "audio/mpeg"},
                                                },
                                            },
                                            {
                                                width: 0.5,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<audio type="audio/mpeg" src="https://alpine.inc/file/${fileId}/content" controls style="flex: 0 0 50%"></audio>
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
</div>
`,
                },
                {
                    description: "file gallery with PDF file",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.5,
                                                element: {
                                                    type: "File",
                                                    file: {
                                                        id: fileId,
                                                        contentType: "application/pdf",
                                                    },
                                                },
                                            },
                                            {
                                                width: 0.5,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<object type="application/pdf" data="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%"></object>
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
</div>
`,
                },
                {
                    description: "file gallery with widths and mixed content types",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.4,
                                                element: {
                                                    type: "Preview",
                                                    reference: {
                                                        type: "Document",
                                                        id: documentId,
                                                        title: "My Document",
                                                    },
                                                },
                                            },
                                            {
                                                width: 0.6,
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId, contentType: "video/mp4"},
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<img alt="My Document" src="https://alpine.inc/doc/${documentId}/preview" style="flex: 0 0 40%" />
<video type="video/mp4" src="https://alpine.inc/file/${fileId}/content" controls style="flex: 0 0 60%"></video>
</div>
`,
                },
                {
                    description: "file gallery with images of different widths",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.5,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                            {
                                                width: 0.3,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                            {
                                                width: 0.2,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 50%" />
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 30%" />
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 20%" />
</div>
`,
                },
                {
                    description: "file gallery with mixed audio, video, and image",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                width: 0.33,
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId, contentType: "audio/mpeg"},
                                                },
                                            },
                                            {
                                                width: 0.33,
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId, contentType: "video/mp4"},
                                                },
                                            },
                                            {
                                                width: 0.34,
                                                element: {type: "File", file: {id: fileId}},
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<audio type="audio/mpeg" src="https://alpine.inc/file/${fileId}/content" controls style="flex: 0 0 33%"></audio>
<video type="video/mp4" src="https://alpine.inc/file/${fileId}/content" controls style="flex: 0 0 33%"></video>
<img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 34%" />
</div>
`,
                },
                {
                    description: "file with comment",
                    content: {
                        elements: [
                            {
                                type: "File",
                                file: {id: fileId},
                                marks: [
                                    {
                                        type: "Comment",
                                        thread: {id: threadId},
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<mark data-comment="${threadId}">![](https://alpine.inc/file/${fileId}/content)</mark>
`,
                },
                {
                    description: "preview with comment",
                    content: {
                        elements: [
                            {
                                type: "Preview",
                                reference: {
                                    type: "Document",
                                    id: documentId,
                                    title: "My Document",
                                },
                                marks: [
                                    {
                                        type: "Comment",
                                        thread: {id: threadId},
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<mark data-comment="${threadId}">![My Document](https://alpine.inc/doc/${documentId}/preview)</mark>
`,
                },
                {
                    description: "video file with comment",
                    content: {
                        elements: [
                            {
                                type: "File",
                                file: {id: fileId, contentType: "video/mp4"},
                                marks: [
                                    {
                                        type: "Comment",
                                        thread: {id: threadId},
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<mark data-comment="${threadId}"><video type="video/mp4" src="https://alpine.inc/file/${fileId}/content" controls></video></mark>
`,
                },
                {
                    description: "file with comments",
                    content: {
                        elements: [
                            {
                                type: "File",
                                file: {id: fileId},
                                marks: [
                                    {
                                        type: "Comment",
                                        thread: {id: threadId},
                                    },
                                    {
                                        type: "Comment",
                                        thread: {id: threadId2},
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<mark data-comment="${threadId}"><mark data-comment="${threadId2}">![](https://alpine.inc/file/${fileId}/content)</mark></mark>
`,
                },
                {
                    description: "preview with comments",
                    content: {
                        elements: [
                            {
                                type: "Preview",
                                reference: {
                                    type: "Document",
                                    id: documentId,
                                    title: "My Document",
                                },
                                marks: [
                                    {
                                        type: "Comment",
                                        thread: {id: threadId},
                                    },
                                    {
                                        type: "Comment",
                                        thread: {id: threadId2},
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<mark data-comment="${threadId}"><mark data-comment="${threadId2}">![My Document](https://alpine.inc/doc/${documentId}/preview)</mark></mark>
`,
                },
                {
                    description: "video file with comments",
                    content: {
                        elements: [
                            {
                                type: "File",
                                file: {id: fileId, contentType: "video/mp4"},
                                marks: [
                                    {
                                        type: "Comment",
                                        thread: {id: threadId},
                                    },
                                    {
                                        type: "Comment",
                                        thread: {id: threadId2},
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<mark data-comment="${threadId}"><mark data-comment="${threadId2}"><video type="video/mp4" src="https://alpine.inc/file/${fileId}/content" controls></video></mark></mark>
`,
                },
                {
                    description: "file row with comments",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId},
                                                    marks: [
                                                        {type: "Comment", thread: {id: threadId}},
                                                    ],
                                                },
                                            },
                                            {
                                                element: {
                                                    type: "Preview",
                                                    reference: {
                                                        type: "Document",
                                                        id: documentId,
                                                        title: "My Document",
                                                    },
                                                    marks: [
                                                        {type: "Comment", thread: {id: threadId2}},
                                                    ],
                                                },
                                            },
                                            {
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId2, contentType: "video/mp4"},
                                                    marks: [
                                                        {type: "Comment", thread: {id: threadId3}},
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<mark data-comment="${threadId}"><img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 33%" /></mark>
<mark data-comment="${threadId2}"><img alt="My Document" src="https://alpine.inc/doc/${documentId}/preview" style="flex: 0 0 33%" /></mark>
<mark data-comment="${threadId3}"><video type="video/mp4" src="https://alpine.inc/file/${fileId2}/content" controls style="flex: 0 0 34%"></video></mark>
</div>
`,
                },
                {
                    description: "file row with multiple comments per file",
                    content: {
                        elements: [
                            {
                                type: "FileGallery",
                                rows: [
                                    {
                                        items: [
                                            {
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId},
                                                    marks: [
                                                        {type: "Comment", thread: {id: threadId}},
                                                        {type: "Comment", thread: {id: threadId2}},
                                                    ],
                                                },
                                            },
                                            {
                                                element: {
                                                    type: "Preview",
                                                    reference: {
                                                        type: "Document",
                                                        id: documentId,
                                                        title: "My Document",
                                                    },
                                                    marks: [
                                                        {type: "Comment", thread: {id: threadId}},
                                                        {type: "Comment", thread: {id: threadId2}},
                                                    ],
                                                },
                                            },
                                            {
                                                element: {
                                                    type: "File",
                                                    file: {id: fileId2, contentType: "video/mp4"},
                                                    marks: [
                                                        {type: "Comment", thread: {id: threadId}},
                                                        {type: "Comment", thread: {id: threadId2}},
                                                    ],
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="display: flex; align-items: stretch">
<mark data-comment="${threadId}"><mark data-comment="${threadId2}"><img src="https://alpine.inc/file/${fileId}/content" style="flex: 0 0 33%" /></mark></mark>
<mark data-comment="${threadId}"><mark data-comment="${threadId2}"><img alt="My Document" src="https://alpine.inc/doc/${documentId}/preview" style="flex: 0 0 33%" /></mark></mark>
<mark data-comment="${threadId}"><mark data-comment="${threadId2}"><video type="video/mp4" src="https://alpine.inc/file/${fileId2}/content" controls style="flex: 0 0 34%"></video></mark></mark>
</div>
`,
                },
                {
                    description: "file float with comment",
                    content: {
                        elements: [
                            {
                                type: "FileFloat",
                                side: "Right",
                                element: {
                                    type: "File",
                                    file: {id: fileId},
                                    marks: [
                                        {
                                            type: "Comment",
                                            thread: {id: threadId},
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="float: right; clear: both">
<mark data-comment="${threadId}"><img src="https://alpine.inc/file/${fileId}/content" /></mark>
</div>
`,
                },
                {
                    description: "preview float with comment",
                    content: {
                        elements: [
                            {
                                type: "FileFloat",
                                side: "Right",
                                element: {
                                    type: "Preview",
                                    reference: {
                                        type: "Document",
                                        id: documentId,
                                        title: "My Document",
                                    },
                                    marks: [
                                        {
                                            type: "Comment",
                                            thread: {id: threadId},
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="float: right; clear: both">
<mark data-comment="${threadId}"><img alt="My Document" src="https://alpine.inc/doc/${documentId}/preview" /></mark>
</div>
`,
                },
                {
                    description: "video file float with comment",
                    content: {
                        elements: [
                            {
                                type: "FileFloat",
                                side: "Right",
                                element: {
                                    type: "File",
                                    file: {id: fileId, contentType: "video/mp4"},
                                    marks: [
                                        {
                                            type: "Comment",
                                            thread: {id: threadId},
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="float: right; clear: both">
<mark data-comment="${threadId}"><video type="video/mp4" src="https://alpine.inc/file/${fileId}/content" controls></video></mark>
</div>
`,
                },
                {
                    description: "file float with comments",
                    content: {
                        elements: [
                            {
                                type: "FileFloat",
                                side: "Right",
                                element: {
                                    type: "File",
                                    file: {id: fileId},
                                    marks: [
                                        {
                                            type: "Comment",
                                            thread: {id: threadId},
                                        },
                                        {
                                            type: "Comment",
                                            thread: {id: threadId2},
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                    expectedMarkdown: `\
<div style="float: right; clear: both">
<mark data-comment="${threadId}"><mark data-comment="${threadId2}"><img src="https://alpine.inc/file/${fileId}/content" /></mark></mark>
</div>
`,
                },
            ],
        },

        {
            contentType: "miscellaneous",
            cases: [
                {
                    description: "empty content",
                    content: {
                        elements: [],
                    },
                    expectedMarkdown: ``,
                },
                {
                    description: "code with backticks inside",
                    content: {
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
                    expectedMarkdown: `\
Use \`\` \`backticks\` \`\` for inline code
`,
                },
                {
                    description: "table with empty cell with empty unordered list item",
                    content: {
                        elements: [
                            {
                                type: "Table",
                                width: 1,
                                hasHeaderRow: false,
                                hasHeaderColumn: false,
                                columns: [
                                    {width: 0.009999999776482582},
                                    {width: 0.009999999776482582},
                                ],
                                rows: [
                                    {
                                        cells: [
                                            {
                                                elements: [
                                                    {
                                                        type: "UnorderedList",
                                                        items: [
                                                            {elements: [], nestedListElements: []},
                                                        ],
                                                    },
                                                ],
                                            },
                                            {elements: []},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<table data-column-widths="0.009999999776482582,0.009999999776482582">
<tbody>
<tr>
<td>

-

</td>
<td>

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description: "table with empty cell with empty ordered list item",
                    content: {
                        elements: [
                            {
                                type: "Table",
                                width: 1,
                                hasHeaderRow: false,
                                hasHeaderColumn: false,
                                columns: [
                                    {width: 0.009999999776482582},
                                    {width: 0.009999999776482582},
                                ],
                                rows: [
                                    {
                                        cells: [
                                            {
                                                elements: [
                                                    {
                                                        type: "OrderedList",
                                                        items: [
                                                            {elements: [], nestedListElements: []},
                                                        ],
                                                    },
                                                ],
                                            },
                                            {elements: []},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    expectedMarkdown: `\
<table data-column-widths="0.009999999776482582,0.009999999776482582">
<tbody>
<tr>
<td>

1.

</td>
<td>

</td>
</tr>
</tbody>
</table>
`,
                },
                {
                    description: "nested lists without elements",
                    content: {
                        elements: [
                            {
                                type: "Quote",
                                elements: [
                                    {
                                        type: "CheckList",
                                        items: [
                                            {
                                                checked: false,
                                                elements: [{type: "Paragraph", elements: []}],
                                                nestedListElements: [
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
                                                                nestedListElements: [
                                                                    {
                                                                        type: "OrderedList",
                                                                        items: [
                                                                            {
                                                                                elements: [
                                                                                    {
                                                                                        type: "Paragraph",
                                                                                        elements:
                                                                                            [],
                                                                                    },
                                                                                ],
                                                                                nestedListElements:
                                                                                    [
                                                                                        {
                                                                                            type: "UnorderedList",
                                                                                            items: [
                                                                                                {
                                                                                                    elements:
                                                                                                        [],
                                                                                                    nestedListElements:
                                                                                                        [],
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
                    expectedMarkdown: `\
> - [ ] <span></span>
>
>   - <p></p>
>
>     1. <p></p>
>
>        -
`,
                },
                {
                    description: "possibly phantom list item after actual list item",
                    content: {
                        elements: [
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [{type: "Paragraph", elements: []}],
                                        nestedListElements: [],
                                    },
                                    {
                                        elements: [],
                                        nestedListElements: [
                                            {
                                                type: "UnorderedList",
                                                items: [
                                                    {
                                                        elements: [
                                                            {type: "Paragraph", elements: []},
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
                    expectedMarkdown: `\
- <p></p>

- <p></p>

  - <p></p>
`,
                },
                {
                    description:
                        "phantom list item in possible phantom list item after actual list item",
                    content: {
                        elements: [
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [{type: "Paragraph", elements: []}],
                                        nestedListElements: [],
                                    },
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
                                                                                elements: [],
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
                    expectedMarkdown: `\
- <p></p>

- <p></p>

  - - <p></p>
`,
                },
            ],
        },
    ]),
)("$contentType", ({cases}) => {
    describe.each(cases)("$description", ({only, content, expectedMarkdown}) => {
        const test = only ? globalThis.test.only : globalThis.test;

        test(`has expected markdown`, () => {
            const actualMarkdown = printApiContentToMarkdown(content, {});
            expect(actualMarkdown).toEqual(expectedMarkdown);
        });

        test(`round trips back to normalized ApiContent`, () => {
            const actualMarkdown = printApiContentToMarkdown(content, {});

            expect(
                // The parser is expected to return content in normalized form. Do not wrap
                // `parseApiContentFromMarkdown()` in a call to `normalizeApiContent()`!
                parseApiContentFromMarkdown(actualMarkdown),
            ).toEqual(normalizeApiContent(content));
        });
    });
});

test("code block line with embedded newline fails markdown equality", async () => {
    const content: ApiContent = {
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
    };
    const expectedMarkdown = `\
\`\`\`javascript
const x = 42;
console.log(x);
\`\`\`
`;
    await expect(
        (async () => {
            const actualMarkdown = printApiContentToMarkdown(content, {});
            expect(actualMarkdown).toEqual(expectedMarkdown);
        })(),
    ).rejects.toThrow("Assertion failure");
});
