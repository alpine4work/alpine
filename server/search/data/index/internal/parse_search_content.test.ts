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
