import {parseSearchContent} from "~/server/search/data/index/internal/parse_search_content.js";

// NOTE(calebmer): Most of the test coverage for `parseSearchContent()` is in
// `chunk_search_content.test.ts` since we check that search content
// parsing/printing is symmetrical.

test("properly highlights content with `<em>` HTML tags", () => {
    expect(
        parseSearchContent(
            `The <em>word</em> <em>hella</em> was a slang term used mostly in the San Francisco Bay Area and other parts of California to mean “very”. Having toured in the Bay Area, Stefani borrowed the term to describe her mood. Stefani wanted to use the <em>word</em> dance in a chorus, so she decided to end each line of “<em>Hella</em> Good”’s chorus with the phrase “keep on dancing”.`,
            {shouldParseEmphasisHtmlTagAsHighlight: true},
        ).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "The "},
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "word",
                    },
                    {type: "text", text: " "},
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "hella",
                    },
                    {
                        type: "text",
                        text: " was a slang term used mostly in the San Francisco Bay Area and other parts of California to mean “very”. Having toured in the Bay Area, Stefani borrowed the term to describe her mood. Stefani wanted to use the ",
                    },
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "word",
                    },
                    {
                        type: "text",
                        text: " dance in a chorus, so she decided to end each line of “",
                    },
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Hella",
                    },
                    {type: "text", text: " Good”’s chorus with the phrase “keep on dancing”."},
                ],
            },
        ],
    });

    expect(
        parseSearchContent(
            `This (<em>Supercalifragilisticexpialidocious</em>) document has \\<strong>html\\</strong> characters in it to test the highlight renderer. It has a unique word like <em>Supercalifragilisticexpialidocious</em> to make it easier to find when searching.`,
            {shouldParseEmphasisHtmlTagAsHighlight: true},
        ).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "This ("},
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Supercalifragilisticexpialidocious",
                    },
                    {
                        type: "text",
                        text: ") document has <strong>html</strong> characters in it to test the highlight renderer. It has a unique word like ",
                    },
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Supercalifragilisticexpialidocious",
                    },
                    {type: "text", text: " to make it easier to find when searching."},
                ],
            },
        ],
    });

    expect(
        parseSearchContent(
            `This (<em>Supercalifragilisticexpialidocious</em>) document has <strong>html</strong> characters in it to test the highlight renderer. It has a unique word like <em>Supercalifragilisticexpialidocious</em> to make it easier to find when searching.`,
            {shouldParseEmphasisHtmlTagAsHighlight: true},
        ).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "This ("},
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Supercalifragilisticexpialidocious",
                    },
                    {
                        type: "text",
                        text: ") document has <strong>html</strong> characters in it to test the highlight renderer. It has a unique word like ",
                    },
                    {
                        type: "text",
                        marks: [{type: "highlight", attrs: {color: "orange"}}],
                        text: "Supercalifragilisticexpialidocious",
                    },
                    {type: "text", text: " to make it easier to find when searching."},
                ],
            },
        ],
    });
});

test("properly highlights content with `<em>` HTML tags in inline code", () => {
    expect(
        parseSearchContent(
            "test `<em>content</em>_view.tsx` test `content_<em>view.tsx</em>` test `</em>content<em>_view.tsx` test `content_</em>view.tsx<em>` test `\\<em>content</em>_view.tsx` test `<em>content\\</em>_view.tsx` test `<em>co<em>nte</em>nt</em>_view.tsx`",
            {shouldParseEmphasisHtmlTagAsHighlight: true},
        ).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "test "},
                    {
                        type: "text",
                        marks: [{type: "code"}, {type: "highlight", attrs: {color: "orange"}}],
                        text: "content",
                    },
                    {type: "text", marks: [{type: "code"}], text: "_view.tsx"},
                    {type: "text", text: " test "},
                    {type: "text", marks: [{type: "code"}], text: "content_"},
                    {
                        type: "text",
                        marks: [{type: "code"}, {type: "highlight", attrs: {color: "orange"}}],
                        text: "view.tsx",
                    },
                    {type: "text", text: " test "},
                    {type: "text", marks: [{type: "code"}], text: "content"},
                    {
                        type: "text",
                        marks: [{type: "code"}, {type: "highlight", attrs: {color: "orange"}}],
                        text: "_view.tsx",
                    },
                    {type: "text", text: " test "},
                    {type: "text", marks: [{type: "code"}], text: "content_view.tsx"},
                    {type: "text", text: " test "},
                    {type: "text", marks: [{type: "code"}], text: "<em>content_view.tsx"},
                    {type: "text", text: " test "},
                    {
                        type: "text",
                        marks: [{type: "code"}, {type: "highlight", attrs: {color: "orange"}}],
                        text: "content</em>_view.tsx",
                    },
                    {type: "text", text: " test "},
                    {
                        type: "text",
                        marks: [{type: "code"}, {type: "highlight", attrs: {color: "orange"}}],
                        text: "content",
                    },
                    {type: "text", marks: [{type: "code"}], text: "_view.tsx"},
                ],
            },
        ],
    });
});

// Covers our parsing of escaped spaces (&#x0020;) at the start of lines to avoid
// CommonMark treating them as code blocks.
test("parses 4 spaces with one escaped space at the beginning of a line as plain text", () => {
    expect(
        parseSearchContent("&#x0020;   test", {
            shouldParseEmphasisHtmlTagAsHighlight: true,
        }).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{type: "text", text: "    test"}],
            },
        ],
    });
});

// Covers our parsing of escaped spaces (&#x0020;) at the start of lines to avoid
// CommonMark treating them as code blocks.
const markdownPrefixTests = [
    {
        character: ">",
        type: "quoteBlock",
    },
    {
        character: "-",
        type: "unorderedListItem",
        attrs: {
            indent: 0,
        },
    },
    {
        character: "1.",
        type: "orderedListItem",
        attrs: {
            indent: 0,
            orderStart: null,
        },
    },
];

for (const {character, type, attrs} of markdownPrefixTests) {
    test(`parses 4 spaces in a ${type} with one escaped space as plain text`, () => {
        expect(
            parseSearchContent(`${character} &#x0020;   test`, {
                shouldParseEmphasisHtmlTagAsHighlight: true,
            }).toJSON(),
        ).toEqual({
            type: "doc",
            content: [
                {
                    type,
                    ...(attrs ? {attrs} : {}),
                    content: [
                        {
                            type: "paragraph",
                            content: [{type: "text", text: "    test"}],
                        },
                    ],
                },
            ],
        });
    });

    test(`parses 4 spaces in a ${type} with one escaped space as plain text and starts with user typed html space`, () => {
        expect(
            parseSearchContent(`${character} &#x0020;   \\&#x0020;test`, {
                shouldParseEmphasisHtmlTagAsHighlight: true,
            }).toJSON(),
        ).toEqual({
            type: "doc",
            content: [
                {
                    type,
                    ...(attrs ? {attrs} : {}),
                    content: [
                        {
                            type: "paragraph",
                            content: [{type: "text", text: "    &#x0020;test"}],
                        },
                    ],
                },
            ],
        });
    });
}

// NOTE(calebmer): Reproduces an error I saw in development with a Wikipedia
// dataset I downloaded to my computer.
//
// Dataset: https://huggingface.co/datasets/euirim/goodwiki
// Source Wikipedia article: https://en.wikipedia.org/wiki/Matrix_(mathematics)
test("parses math-like content with highlights", () => {
    expect(
        parseSearchContent(
            `\
For example, the <em>underlined</em> entry 2340 in the product is calculated as (2 × 1000) + (3 × 100) + (4 × 10) = 2340:

\\<math>

\\\\begin{align} \\\\begin{bmatrix} \\\\<em>underline</em>{2} & \\\\<em>underline</em> 3 & \\\\<em>underline</em> 4 \\\\\\\\ 1 & 0 & 0 \\\\\\\\ \\\\end{bmatrix}

\\\\begin{bmatrix} 0 & \\\\<em>underline</em>{1000} \\\\\\\\ 1 & \\\\<em>underline</em>{100} \\\\\\\\ 0 & \\\\<em>underline</em>{10} \\\\\\\\ \\\\end{bmatrix} &= \\\\begin{bmatrix} 3 & \\\\\\<em>underline</em>{2340} \\\\\\\\ 0 & 1000 \\\\\\\\ \\\\end{bmatrix}.`,
            {shouldParseEmphasisHtmlTagAsHighlight: true},
        ).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "For example, the "},
                    {
                        type: "text",
                        marks: [
                            {
                                type: "highlight",
                                attrs: {color: "orange"},
                            },
                        ],
                        text: "underlined",
                    },
                    {
                        type: "text",
                        text: " entry 2340 in the product is calculated as (2 × 1000) + (3 × 100) + (4 × 10) = 2340:",
                    },
                ],
            },
            {
                type: "paragraph",
                content: [{type: "text", text: "<math>"}],
            },
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "\\begin{align} \\begin{bmatrix} \\"},
                    {
                        type: "text",
                        marks: [
                            {
                                type: "highlight",
                                attrs: {color: "orange"},
                            },
                        ],
                        text: "underline",
                    },
                    {type: "text", text: "{2} & \\"},
                    {
                        type: "text",
                        marks: [
                            {
                                type: "highlight",
                                attrs: {color: "orange"},
                            },
                        ],
                        text: "underline",
                    },
                    {type: "text", text: " 3 & \\"},
                    {
                        type: "text",
                        marks: [
                            {
                                type: "highlight",
                                attrs: {color: "orange"},
                            },
                        ],
                        text: "underline",
                    },
                    {type: "text", text: " 4 \\\\ 1 & 0 & 0 \\\\ \\end{bmatrix}"},
                ],
            },
            {
                type: "paragraph",
                content: [
                    {type: "text", text: "\\begin{bmatrix} 0 & \\"},
                    {
                        type: "text",
                        marks: [
                            {
                                type: "highlight",
                                attrs: {color: "orange"},
                            },
                        ],
                        text: "underline",
                    },
                    {type: "text", text: "{1000} \\\\ 1 & \\"},
                    {
                        type: "text",
                        marks: [
                            {
                                type: "highlight",
                                attrs: {color: "orange"},
                            },
                        ],
                        text: "underline",
                    },
                    {type: "text", text: "{100} \\\\ 0 & \\"},
                    {
                        type: "text",
                        marks: [
                            {
                                type: "highlight",
                                attrs: {color: "orange"},
                            },
                        ],
                        text: "underline",
                    },
                    {
                        type: "text",
                        text: "{10} \\\\ \\end{bmatrix} &= \\begin{bmatrix} 3 & \\<em>underline{2340} \\\\ 0 & 1000 \\\\ \\end{bmatrix}.",
                    },
                ],
            },
        ],
    });
});

test("works when certain nodes have empty text", () => {
    expect(parseSearchContent("This has some empty `` code").toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{type: "text", text: "This has some empty `` code"}],
            },
        ],
    });

    expect(parseSearchContent("This has some empty\n```\n```\nmultiline code").toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{type: "text", text: "This has some empty"}],
            },
            {type: "codeBlock", attrs: {language: "text"}, content: [{type: "codeBlockLine"}]},
            {
                type: "paragraph",
                content: [{type: "text", text: "multiline code"}],
            },
        ],
    });

    expect(parseSearchContent("This has an empty [](https://google.com) link").toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{type: "text", text: "This has an empty  link"}],
            },
        ],
    });
});

test("doesn’t parse marks in a code block", () => {
    expect(parseSearchContent("This is a\n```\nfoo**bar**\n```\ncode block").toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{type: "text", text: "This is a"}],
            },
            {
                type: "codeBlock",
                attrs: {language: "text"},
                content: [
                    {
                        type: "codeBlockLine",
                        content: [{type: "text", text: "foo**bar**"}],
                    },
                ],
            },
            {
                type: "paragraph",
                content: [{type: "text", text: "code block"}],
            },
        ],
    });
});

test("parses an `<em>` tag in a code block", () => {
    expect(
        parseSearchContent("This is a\n```\nfoo<em>bar</em>\n```\ncode block", {
            shouldParseEmphasisHtmlTagAsHighlight: true,
        }).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{type: "text", text: "This is a"}],
            },
            {
                type: "codeBlock",
                attrs: {language: "text"},
                content: [
                    {
                        type: "codeBlockLine",
                        content: [
                            {type: "text", text: "foo"},
                            {
                                type: "text",
                                text: "bar",
                                marks: [{type: "highlight", attrs: {color: "orange"}}],
                            },
                        ],
                    },
                ],
            },
            {
                type: "paragraph",
                content: [{type: "text", text: "code block"}],
            },
        ],
    });
});

test("parses an `<em>` tag spanning multiple lines in a code block", () => {
    expect(
        parseSearchContent("This is a\n```\ntest1 <em>test2\ntest3</em> test4\n```\ncode block", {
            shouldParseEmphasisHtmlTagAsHighlight: true,
        }).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{type: "text", text: "This is a"}],
            },
            {
                type: "codeBlock",
                attrs: {language: "text"},
                content: [
                    {
                        type: "codeBlockLine",
                        content: [
                            {type: "text", text: "test1 "},
                            {
                                type: "text",
                                text: "test2",
                                marks: [{type: "highlight", attrs: {color: "orange"}}],
                            },
                        ],
                    },
                    {
                        type: "codeBlockLine",
                        content: [
                            {
                                type: "text",
                                text: "test3",
                                marks: [{type: "highlight", attrs: {color: "orange"}}],
                            },
                            {type: "text", text: " test4"},
                        ],
                    },
                ],
            },
            {
                type: "paragraph",
                content: [{type: "text", text: "code block"}],
            },
        ],
    });
});

test("can parse a table", () => {
    expect(
        parseSearchContent(`\
<table><tbody><tr><td>

a1

</td><td>

a2

</td></tr><tr><td>

b1

</td><td>

b2

</td></tr></tbody></table>
`).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "table",
                attrs: {
                    columnWidths: [],
                    tableWidth: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a2"}]},
                                ],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b2"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("can parse a table with a missing cell", () => {
    expect(
        parseSearchContent(`\
<table><tbody><tr><td>

a1

</td></tr><tr><td>

b1

</td><td>

b2

</td></tr></tbody></table>
`).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "table",
                attrs: {
                    columnWidths: [],
                    tableWidth: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b2"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    expect(
        parseSearchContent(`\
<table><tbody><tr><td>

a1

</td><td>

a2

</td></tr><tr><td>

b1

</td><td>

b2

</td><td>

b3

</td></tr></tbody></table>
`).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "table",
                attrs: {
                    columnWidths: [],
                    tableWidth: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a2"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b2"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b3"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("can parse a table that hasn’t been closed", () => {
    expect(
        parseSearchContent(`\
<table><tbody><tr><td>

a1

</td><td>

a2

</td></tr><tr><td>

b1

</td><td>

b2
`).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "table",
                attrs: {
                    columnWidths: [],
                    tableWidth: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a2"}]},
                                ],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b2"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    expect(
        parseSearchContent(`\
<table><tbody><tr><td>

a1

</td><td>

a2

</td></tr><tr><td>

b1
`).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "table",
                attrs: {
                    columnWidths: [],
                    tableWidth: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a2"}]},
                                ],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("can parse a table starting at table cell close/open", () => {
    expect(
        parseSearchContent(`\
a1

</td><td>

a2

</td></tr><tr><td>

b1

</td><td>

b2

</td></tr></tbody></table>
`).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {type: "paragraph", content: [{type: "text", text: "a1"}]},
            {
                type: "table",
                attrs: {
                    columnWidths: [],
                    tableWidth: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a2"}]},
                                ],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b2"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    expect(
        parseSearchContent(`\
a1

</td><td>

a2

</td></tr><tr><td>

b1

</td><td>

b2

</td><td>

b3

</td></tr></tbody></table>
`).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {type: "paragraph", content: [{type: "text", text: "a1"}]},
            {
                type: "table",
                attrs: {
                    columnWidths: [],
                    tableWidth: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a2"}]},
                                ],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b2"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b3"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    expect(
        parseSearchContent(`\
a1

</td><td>

a2

</td></tr><tr><td>

b1

</td><td>

b2
`).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {type: "paragraph", content: [{type: "text", text: "a1"}]},
            {
                type: "table",
                attrs: {
                    columnWidths: [],
                    tableWidth: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [{type: "paragraph"}],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "a2"}]},
                                ],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b2"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("can parse a table starting at table row close/open", () => {
    expect(
        parseSearchContent(`\
a2

</td></tr><tr><td>

b1

</td><td>

b2

</td></tr><tr><td>

c1

</td><td>

c2

</td></tr></tbody></table>
`).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {type: "paragraph", content: [{type: "text", text: "a2"}]},
            {
                type: "table",
                attrs: {
                    columnWidths: [],
                    tableWidth: 1,
                    hasHeaderRow: false,
                    hasHeaderColumn: false,
                },
                content: [
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "b2"}]},
                                ],
                            },
                        ],
                    },
                    {
                        type: "tableRow",
                        content: [
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "c1"}]},
                                ],
                            },
                            {
                                type: "tableCell",
                                content: [
                                    {type: "paragraph", content: [{type: "text", text: "c2"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

// Test that 4+ spaces followed by list markers in blockquotes are preprocessed
// to escape the first space, preventing CommonMark from interpreting them as code blocks.
test("preprocesses blockquotes with 4+ spaces before list markers", () => {
    // 5 spaces before `-` is preprocessed to escape first space, resulting in paragraph
    // with text "    - text" (4 spaces preserved as text, not as code block indentation)
    expect(
        parseSearchContent(
            `>     - this looks like a list item but has 4+ spaces before it`,
        ).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: " - this looks like a list item but has 4+ spaces before it",
                            },
                        ],
                    },
                ],
            },
        ],
    });

    // Test with highlights enabled (the original failing case)
    expect(
        parseSearchContent(
            `>     - \`state.blockConcurrencyWhile\` can appear to “complete” from user <em>code’s</em> perspective`,
            {shouldParseEmphasisHtmlTagAsHighlight: true},
        ).toJSON(),
    ).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "paragraph",
                        content: [
                            {type: "text", text: " - "},
                            {
                                type: "text",
                                text: "state.blockConcurrencyWhile",
                                marks: [{type: "code"}],
                            },
                            {type: "text", text: " can appear to “complete” from user "},
                            {
                                type: "text",
                                text: "code’s",
                                marks: [{type: "highlight", attrs: {color: "orange"}}],
                            },
                            {type: "text", text: " perspective"},
                        ],
                    },
                ],
            },
        ],
    });

    // 4+ spaces before ordered list marker is also preprocessed
    expect(parseSearchContent(`>     1. ordered with 4+ spaces`).toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: " 1. ordered with 4+ spaces"}],
                    },
                ],
            },
        ],
    });
});

// Test that code blocks inside blockquotes (not followed by list markers) are
// gracefully converted to paragraphs as a fallback.
test("gracefully handles code blocks inside blockquotes without list markers", () => {
    // 5 spaces before text (no list marker) creates a code block, which is converted to paragraph
    expect(parseSearchContent(`>     line1`).toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: " line1"}],
                    },
                ],
            },
        ],
    });
});

// Test list items inside blockquotes at different indentation levels parse correctly.
// The preprocessing escapes 4+ spaces before list markers, converting them to paragraphs
// with the spaces preserved as literal text.
test("parses list items inside blockquotes at different indentation levels", () => {
    // indent 0: no preprocessing needed, parses as list item
    expect(parseSearchContent(`> - unordered indent 0`).toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "unorderedListItem",
                        attrs: {indent: 0},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "unordered indent 0"}],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    // indent 1: 4 spaces before `-`, preprocessed to paragraph with "    - text"
    expect(parseSearchContent(`>     - unordered indent 1`).toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: " - unordered indent 1"}],
                    },
                ],
            },
        ],
    });

    // indent 2: 8 spaces before `-`, preprocessed to paragraph with "        - text"
    expect(parseSearchContent(`>         - unordered indent 2`).toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: " - unordered indent 2"}],
                    },
                ],
            },
        ],
    });

    // Ordered list items - indent 0 parses as list
    expect(parseSearchContent(`> 1. ordered indent 0`).toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "orderedListItem",
                        attrs: {indent: 0, orderStart: null},
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: "ordered indent 0"}],
                            },
                        ],
                    },
                ],
            },
        ],
    });

    // indent 1: preprocessed to paragraph
    expect(parseSearchContent(`>     1. ordered indent 1`).toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: " 1. ordered indent 1"}],
                    },
                ],
            },
        ],
    });

    // indent 2: preprocessed to paragraph
    expect(parseSearchContent(`>         1. ordered indent 2`).toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: " 1. ordered indent 2"}],
                    },
                ],
            },
        ],
    });

    // Also test pre-escaped content (from chunker) still works
    expect(parseSearchContent(`> &#x0020;   - pre-escaped unordered`).toJSON()).toEqual({
        type: "doc",
        content: [
            {
                type: "quoteBlock",
                content: [
                    {
                        type: "paragraph",
                        content: [{type: "text", text: "    - pre-escaped unordered"}],
                    },
                ],
            },
        ],
    });
});
