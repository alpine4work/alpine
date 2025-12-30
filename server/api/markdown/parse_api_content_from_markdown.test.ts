/* eslint-disable string-quotes */

import {
    parseApiContentFromMarkdown,
    parseMarkdownTree,
} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();

// Inline HTML elements tests
test("inline HTML <strong> tag", () => {
    expect(parseApiContentFromMarkdown("<strong>bold text</strong>", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "bold text",
                        marks: [{type: "Bold"}],
                    },
                ],
            },
        ],
    });
});

test("inline HTML <b> tag", () => {
    expect(parseApiContentFromMarkdown("<b>bold text</b>", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "bold text",
                        marks: [{type: "Bold"}],
                    },
                ],
            },
        ],
    });
});

test("inline HTML <em> tag", () => {
    expect(parseApiContentFromMarkdown("<em>italic text</em>", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "italic text",
                        marks: [{type: "Italic"}],
                    },
                ],
            },
        ],
    });
});

test("inline HTML <i> tag", () => {
    expect(parseApiContentFromMarkdown("<i>italic text</i>", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "italic text",
                        marks: [{type: "Italic"}],
                    },
                ],
            },
        ],
    });
});

test("inline HTML <del> tag", () => {
    expect(parseApiContentFromMarkdown("<del>strikethrough text</del>", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "strikethrough text",
                        marks: [{type: "Strike"}],
                    },
                ],
            },
        ],
    });
});

test("inline HTML <code> tag", () => {
    expect(
        parseApiContentFromMarkdown("Text with <code>inline code</code> in it", {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Text with "},
                    {
                        type: "Text",
                        text: "inline code",
                        marks: [{type: "Code"}],
                    },
                    {type: "Text", text: " in it"},
                ],
            },
        ],
    });
});

test("nested inline HTML tags", () => {
    expect(
        parseApiContentFromMarkdown("<strong><em>bold and italic</em></strong>", {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "bold and italic",
                        marks: [{type: "Bold"}, {type: "Italic"}],
                    },
                ],
            },
        ],
    });
});

test("mixed inline HTML and markdown", () => {
    expect(
        parseApiContentFromMarkdown("**Bold** and <strong>also bold</strong>", {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "Bold",
                        marks: [{type: "Bold"}],
                    },
                    {type: "Text", text: " and "},
                    {
                        type: "Text",
                        text: "also bold",
                        marks: [{type: "Bold"}],
                    },
                ],
            },
        ],
    });
});

test("inline HTML <a> tag with href", () => {
    expect(
        parseApiContentFromMarkdown('<a href="https://example.com">link text</a>', {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "link text",
                        marks: [{type: "Link", url: "https://example.com"}],
                    },
                ],
            },
        ],
    });
});

test("inline HTML <a> tag without href", () => {
    expect(parseApiContentFromMarkdown("<a>link text</a>", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "link text",
                        marks: [{type: "Link", url: ""}],
                    },
                ],
            },
        ],
    });
});

test("HTML entity in text", () => {
    expect(parseApiContentFromMarkdown("Text with &amp; entity", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Text with & entity"}],
            },
        ],
    });
});

test("HTML entity in attribute", () => {
    expect(
        parseApiContentFromMarkdown('<a href="https://example.com?a=1&amp;b=2">link</a>', {
            spaceId,
        }),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://example.com?a=1&b=2"}],
                    },
                ],
            },
        ],
    });
});

// Block HTML tests
test("HTML <p> tag", () => {
    expect(parseApiContentFromMarkdown("<p>Paragraph text</p>", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Paragraph text"}],
            },
        ],
    });
});

test("empty HTML <p> tag", () => {
    expect(parseApiContentFromMarkdown("<p></p>", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [],
            },
        ],
    });
});

test("HTML <br> tag", () => {
    expect(parseApiContentFromMarkdown("Line 1<br>Line 2", {spaceId})).toEqual({
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
    });
});

test("HTML <br/> self-closing tag", () => {
    expect(parseApiContentFromMarkdown("Line 1<br/>Line 2", {spaceId})).toEqual({
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
    });
});

test("HTML marks in <p> tag", () => {
    expect(
        parseApiContentFromMarkdown("<p><strong>Bold</strong> and <em>italic</em></p>", {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "Bold",
                        marks: [{type: "Bold"}],
                    },
                    {type: "Text", text: " and "},
                    {
                        type: "Text",
                        text: "italic",
                        marks: [{type: "Italic"}],
                    },
                ],
            },
        ],
    });
});

// Code block HTML tests
test("HTML <pre><code> block", () => {
    expect(parseApiContentFromMarkdown("<pre><code>const x = 1;</code></pre>", {spaceId})).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [{elements: [{type: "Text", text: "const x = 1;"}]}],
            },
        ],
    });
});

test("HTML <pre><code> block with language class", () => {
    expect(
        parseApiContentFromMarkdown(
            '<pre><code class="language-javascript">const x = 1;</code></pre>',
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "javascript",
                lines: [{elements: [{type: "Text", text: "const x = 1;"}]}],
            },
        ],
    });
});

test("HTML <pre><code> block with marks", () => {
    expect(
        parseApiContentFromMarkdown("<pre><code><strong>bold</strong> code</code></pre>", {
            spaceId,
        }),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [
                    {
                        elements: [
                            {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                            {type: "Text", text: " code"},
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML <pre><code> block with marks (classic tag names)", () => {
    expect(
        parseApiContentFromMarkdown("<pre><code><b>bold</b> <i>code</i></code></pre>", {
            spaceId,
        }),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [
                    {
                        elements: [
                            {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                            {type: "Text", text: " "},
                            {type: "Text", text: "code", marks: [{type: "Italic"}]},
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML <pre><code> block with leading/trailing newlines", () => {
    expect(
        parseApiContentFromMarkdown("<pre><code>\nconst x = 1;\n</code></pre>", {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [{elements: [{type: "Text", text: "const x = 1;"}]}],
            },
        ],
    });
});

test("HTML <pre><code> block with multiple lines", () => {
    expect(
        parseApiContentFromMarkdown("<pre><code>line1\nline2\nline3</code></pre>", {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [
                    {elements: [{type: "Text", text: "line1"}]},
                    {elements: [{type: "Text", text: "line2"}]},
                    {elements: [{type: "Text", text: "line3"}]},
                ],
            },
        ],
    });
});

test("HTML <pre><code> block with empty lines", () => {
    expect(
        parseApiContentFromMarkdown("<pre><code>line1\n\nline3</code></pre>", {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [
                    {elements: [{type: "Text", text: "line1"}]},
                    {elements: []},
                    {elements: [{type: "Text", text: "line3"}]},
                ],
            },
        ],
    });
});

test("HTML <pre><code> block with link marks", () => {
    expect(
        parseApiContentFromMarkdown(
            '<pre><code>Visit <a href="https://example.com">example.com</a></code></pre>',
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [
                    {
                        elements: [
                            {type: "Text", text: "Visit "},
                            {
                                type: "Text",
                                text: "example.com",
                                marks: [{type: "Link", url: "https://example.com"}],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

// Table HTML tests
test("simple HTML table", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<td>Cell 1</td>
<td>Cell 2</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Cell 1"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Cell 2"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table without tbody", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<td>A</td>
<td>B</td>
</tr>
<tr>
<td>C</td>
<td>D</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "A"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "B"}]},
                                ],
                            },
                        ],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "C"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "D"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table with tbody", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<tbody>
<tr>
<td>Cell 1</td>
<td>Cell 2</td>
</tr>
</tbody>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Cell 1"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Cell 2"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table with thead and tbody", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<thead>
<tr>
<th>Header 1</th>
<th>Header 2</th>
</tr>
</thead>
<tbody>
<tr>
<td>Cell 1</td>
<td>Cell 2</td>
</tr>
</tbody>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}],
                hasHeaderRow: true,
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Header 1"}],
                                    },
                                ],
                            },
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Header 2"}],
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Cell 1"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Cell 2"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table with th elements", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<th>Header</th>
<td>Data</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}],
                hasHeaderColumn: true,
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Header"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Data"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table with scope attributes", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<thead>
<tr>
<th scope="col">Col Header 1</th>
<th scope="col">Col Header 2</th>
</tr>
</thead>
<tbody>
<tr>
<th scope="row">Row Header</th>
<td>Data</td>
</tr>
</tbody>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}],
                hasHeaderRow: true,
                hasHeaderColumn: true,
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Col Header 1"}],
                                    },
                                ],
                            },
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Col Header 2"}],
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
                                        elements: [{type: "Text", text: "Row Header"}],
                                    },
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Data"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table with data-width attribute", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table data-width="2.5">
<tr>
<td>Cell 1</td>
<td>Cell 2</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 2.5,
                columns: [{width: 1}, {width: 1}],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Cell 1"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Cell 2"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table with data-column-widths attribute", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table data-column-widths="2,3,1.5">
<tr>
<td>A</td>
<td>B</td>
<td>C</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 2}, {width: 3}, {width: 1.5}],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "A"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "B"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "C"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table with invalid data attributes", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table data-width="invalid" data-column-widths="not,valid">
<tr>
<td>Cell</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Cell"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table with empty cells", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<td></td>
<td>Not empty</td>
<td></td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}, {width: 1}],
                rows: [
                    {
                        cells: [
                            {elements: []},
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Not empty"}],
                                    },
                                ],
                            },
                            {elements: []},
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table with irregular rows", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<td>A</td>
<td>B</td>
</tr>
<tr>
<td>C</td>
</tr>
<tr>
<td>D</td>
<td>E</td>
<td>F</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}, {width: 1}],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "A"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "B"}]},
                                ],
                            },
                            {elements: []},
                        ],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "C"}]},
                                ],
                            },
                            {elements: []},
                            {elements: []},
                        ],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "D"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "E"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "F"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("HTML table with complex cell content", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<td>
<p>Paragraph 1</p>
<p>Paragraph 2</p>
</td>
<td>

- List item 1
- List item 2

</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: " "}],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Paragraph 1"}],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: " "}],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "Paragraph 2"}],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: " "}],
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
                                                            {type: "Text", text: "List item 1"},
                                                        ],
                                                    },
                                                ],
                                            },
                                            {
                                                elements: [
                                                    {
                                                        type: "Paragraph",
                                                        elements: [
                                                            {type: "Text", text: "List item 2"},
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
    });
});

test("HTML table with heading in cell", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<td>
# Heading in cell
Regular text
</td>
<td>## Another heading</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}],
                hasHeaderColumn: undefined,
                hasHeaderRow: undefined,
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
                                                text: " # Heading in cell Regular text ",
                                                marks: undefined,
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
                                                text: "## Another heading",
                                                marks: undefined,
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
    });
});

test("HTML table with divider in cell", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<td>

Before divider

---

After divider

</td>
<td>Regular content</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}, {width: 1}],
                hasHeaderColumn: undefined,
                hasHeaderRow: undefined,
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
                                                text: "Before divider",
                                                marks: undefined,
                                            },
                                        ],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [{type: "Text", text: "---"}],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "After divider", marks: undefined},
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
                                                text: "Regular content",
                                                marks: undefined,
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
    });
});

test("HTML table with both heading and divider in cell", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<td>

# Section Title

Some content

---

## Subsection

More content

</td>
</tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}],
                hasHeaderColumn: undefined,
                hasHeaderRow: undefined,
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
                                                text: "Section Title",
                                                marks: [{type: "Bold"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "Some content", marks: undefined},
                                        ],
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
                                                text: "Subsection",
                                                marks: [{type: "Bold"}],
                                            },
                                        ],
                                    },
                                    {
                                        type: "Paragraph",
                                        elements: [
                                            {type: "Text", text: "More content", marks: undefined},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("table HTML in list throws error", () => {
    expect(() =>
        parseApiContentFromMarkdown(
            `\
- List item
  <table><tr><td>Table in list</td></tr></table>`,
            {spaceId},
        ),
    ).toThrow("Table HTML isn’t supported in this Markdown block content parent");
});

test("table HTML in blockquote throws error", () => {
    expect(() =>
        parseApiContentFromMarkdown(
            `\
> Quote
> <table><tr><td>Table in quote</td></tr></table>`,
            {spaceId},
        ),
    ).toThrow("Table HTML isn’t supported in this Markdown block content parent");
});

test("table HTML in inline content throws error", () => {
    expect(() =>
        parseApiContentFromMarkdown(
            "Text with <table><tr><td>inline table</td></tr></table> in it",
            {spaceId},
        ),
    ).toThrow("Table HTML isn’t supported in Markdown phrasing content");
});

// Markdown break edge cases
test("bold formatted break with adjacent content", () => {
    expect(parseApiContentFromMarkdown("text**<br/>**more text", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "text"},
                    {type: "Break", marks: [{type: "Bold"}]},
                    {type: "Text", text: "more text"},
                ],
            },
        ],
    });
});

test("italic formatted break with asterisk", () => {
    expect(parseApiContentFromMarkdown("text*<br/>*more text", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "text"},
                    {type: "Break", marks: [{type: "Italic"}]},
                    {type: "Text", text: "more text"},
                ],
            },
        ],
    });
});

test("italic formatted break with underscore", () => {
    expect(parseApiContentFromMarkdown("text_<br/>_more text", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "text"},
                    {type: "Break", marks: [{type: "Italic"}]},
                    {type: "Text", text: "more text"},
                ],
            },
        ],
    });
});

test("strikethrough link", () => {
    expect(
        parseApiContentFromMarkdown("text~~[link](https://example.com)~~more", {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "text"},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://example.com"}, {type: "Strike"}],
                    },
                    {type: "Text", text: "more"},
                ],
            },
        ],
    });
});

// List with mixed content
test("list item with paragraphs then nested list then more paragraphs", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
- First paragraph

  Second paragraph

  - Nested item 1
  - Nested item 2

  Third paragraph`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "UnorderedList",
                items: [
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
                        nestedListElements: [
                            {
                                type: "UnorderedList",
                                items: [
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Nested item 1"}],
                                            },
                                        ],
                                    },
                                    {
                                        elements: [
                                            {
                                                type: "Paragraph",
                                                elements: [{type: "Text", text: "Nested item 2"}],
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
                                elements: [{type: "Text", text: "Third paragraph"}],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

describe("checklist", () => {
    test("checklist closing bracket followed by EOF renders unordered list", () => {
        expect(parseApiContentFromMarkdown(`\n- [ ]`, {spaceId})).toEqual({
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "[ ]"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });
    test("checklist closing bracket followed by EOL renders unordered list", () => {
        expect(parseApiContentFromMarkdown(`\n- [ ]\n\n`, {spaceId})).toEqual({
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "[ ]"}],
                                },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    test("nested checklist closing brackets followed by EOL renders nested unordered lists", () => {
        expect(
            parseApiContentFromMarkdown(
                `
- [x]

   - unordered item

      - [ ]
`,
                {spaceId},
            ),
        ).toEqual({
            elements: [
                {
                    type: "UnorderedList",
                    items: [
                        {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [{type: "Text", text: "[x]"}],
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
                                                        {type: "Text", text: "unordered item"},
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
                                                                        {type: "Text", text: "[ ]"},
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
        });
    });
});

// Mention parsing edge cases
test("mention with short name format", () => {
    const accountId = "n93hre935d0yd7akahtrwcvv30";
    expect(
        parseApiContentFromMarkdown(
            `[@alice](https://alpine.inc/s/${spaceId}/accounts/${accountId}?mention=short)`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        target: {path: `/accounts/${accountId}`},
                        isAccountShortName: true,
                    },
                ],
            },
        ],
    });
});

test("channel mention", () => {
    const channelId = "c93hre935d0yd7akahtrwcvv30";
    expect(
        parseApiContentFromMarkdown(
            `[#general](https://alpine.inc/s/${spaceId}/channels/${channelId}?mention)`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        target: {path: `/channels/${channelId}`},
                    },
                ],
            },
        ],
    });
});

test("document mention", () => {
    const documentId = "d93hre935d0yd7akahtrwcvv30";
    expect(
        parseApiContentFromMarkdown(
            `[Doc](https://alpine.inc/s/${spaceId}/documents/${documentId}?mention)`,
            {
                spaceId,
            },
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        target: {path: `/documents/${documentId}`},
                    },
                ],
            },
        ],
    });
});

test("post mention", () => {
    const postId = "p93hre935d0yd7akahtrwcvv30";
    expect(
        parseApiContentFromMarkdown(
            `[Post](https://alpine.inc/s/${spaceId}/posts/${postId}?mention)`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        target: {path: `/posts/${postId}`},
                    },
                ],
            },
        ],
    });
});

test("task mention", () => {
    const taskId = "t93hre935d0yd7akahtrwcvv30";
    expect(
        parseApiContentFromMarkdown(
            `[Task](https://alpine.inc/s/${spaceId}/tasks/${taskId}?mention)`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        target: {path: `/tasks/${taskId}`},
                    },
                ],
            },
        ],
    });
});

test("task collection mention", () => {
    const collectionId = "tc3hre935d0yd7akahtrwcvv30";
    expect(
        parseApiContentFromMarkdown(
            `[Collection](https://alpine.inc/s/${spaceId}/tasks/collections/${collectionId}?mention)`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Mention",
                        target: {path: `/task-collections/${collectionId}`},
                    },
                ],
            },
        ],
    });
});

test("link that looks like mention but isn't", () => {
    expect(
        parseApiContentFromMarkdown(
            `[Not a mention](https://alpine.inc/s/different-space/accounts/123?mention)`,
            {
                spaceId,
            },
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "Not a mention",
                        marks: [
                            {
                                type: "Link",
                                url: "https://alpine.inc/s/different-space/accounts/123?mention",
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("link with invalid mention ID", () => {
    expect(
        parseApiContentFromMarkdown(
            `[Invalid](https://alpine.inc/s/${spaceId}/accounts/not-a-valid-id?mention)`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "Invalid",
                        marks: [
                            {
                                type: "Link",
                                url: `https://alpine.inc/s/${spaceId}/accounts/not-a-valid-id?mention`,
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

// GFM table with span attributes
test("GFM table with span data-width", () => {
    expect(
        parseApiContentFromMarkdown(
            `| Col 1 | Col 2 |
| --- | --- |
| A | B<span hidden data-width="2.5"/> |`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 2.5,
                columns: [{width: 1}, {width: 1}],
                hasHeaderRow: true,
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Col 1"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Col 2"}]},
                                ],
                            },
                        ],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "A"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "B"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("GFM table with span data-column-widths", () => {
    expect(
        parseApiContentFromMarkdown(
            `| A | B | C |
| --- | --- | --- |
| 1 | 2 | 3<span hidden data-column-widths="2,1,3"/> |`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 2}, {width: 1}, {width: 3}],
                hasHeaderRow: true,
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "A"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "B"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "C"}]},
                                ],
                            },
                        ],
                    },
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "1"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "2"}]},
                                ],
                            },
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "3"}]},
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

// Edge cases for code blocks
test("code block with invalid language", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
\`\`\`not-a-real-language
code here
\`\`\``,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [{elements: [{type: "Text", text: "code here"}]}],
            },
        ],
    });
});

test("empty code block", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
\`\`\`
\`\`\``,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [{elements: []}],
            },
        ],
    });
});

// Quote transformations
test("nested quotes are flattened", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
> Outer quote
>
> > Inner quote`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Quote",
                elements: [
                    {type: "Paragraph", elements: [{type: "Text", text: "Outer quote"}]},
                    {type: "Paragraph", elements: [{type: "Text", text: "Inner quote"}]},
                ],
            },
        ],
    });
});

test("code block in quote becomes paragraphs with code marks", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
> Quote text
>
> \`\`\`
> code line 1
> code line 2
> \`\`\``,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Quote",
                elements: [
                    {type: "Paragraph", elements: [{type: "Text", text: "Quote text"}]},
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "code line 1", marks: [{type: "Code"}]}],
                    },
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "code line 2", marks: [{type: "Code"}]}],
                    },
                ],
            },
        ],
    });
});

test("table in quote cell is flattened", () => {
    // Tables inside quote cells get flattened into paragraphs
    expect(
        parseApiContentFromMarkdown(
            `\
> | A | B |
> | --- | --- |
> | Nested | Table |`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Quote",
                elements: [
                    {type: "Paragraph", elements: [{type: "Text", text: "A"}]},
                    {type: "Paragraph", elements: [{type: "Text", text: "B"}]},
                    {type: "Paragraph", elements: [{type: "Text", text: "Nested"}]},
                    {type: "Paragraph", elements: [{type: "Text", text: "Table"}]},
                ],
            },
        ],
    });
});

test("heading in quote becomes paragraph with bold", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
> # Quoted heading
> Regular quoted text`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Quote",
                elements: [
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "Quoted heading", marks: [{type: "Bold"}]}],
                    },
                    {type: "Paragraph", elements: [{type: "Text", text: "Regular quoted text"}]},
                ],
            },
        ],
    });
});

test("divider in quote becomes paragraph with dashes", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
> Before divider
>
> ---
>
> After divider`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Quote",
                elements: [
                    {type: "Paragraph", elements: [{type: "Text", text: "Before divider"}]},
                    {type: "Paragraph", elements: [{type: "Text", text: "---"}]},
                    {type: "Paragraph", elements: [{type: "Text", text: "After divider"}]},
                ],
            },
        ],
    });
});

// Tests for headings
test("heading level 1", () => {
    expect(parseApiContentFromMarkdown("# Heading 1", {spaceId})).toEqual({
        elements: [
            {
                type: "Heading",
                level: 1,
                elements: [{type: "Text", text: "Heading 1"}],
            },
        ],
    });
});

test("heading level 2", () => {
    expect(parseApiContentFromMarkdown("## Heading 2", {spaceId})).toEqual({
        elements: [
            {
                type: "Heading",
                level: 2,
                elements: [{type: "Text", text: "Heading 2"}],
            },
        ],
    });
});

test("heading level 3", () => {
    expect(parseApiContentFromMarkdown("### Heading 3", {spaceId})).toEqual({
        elements: [
            {
                type: "Heading",
                level: 3,
                elements: [{type: "Text", text: "Heading 3"}],
            },
        ],
    });
});

test("heading with marks", () => {
    expect(parseApiContentFromMarkdown("## **Bold** and *italic* heading", {spaceId})).toEqual({
        elements: [
            {
                type: "Heading",
                level: 2,
                elements: [
                    {type: "Text", text: "Bold", marks: [{type: "Bold"}]},
                    {type: "Text", text: " and "},
                    {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                    {type: "Text", text: " heading"},
                ],
            },
        ],
    });
});

test("multiple heading levels", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
# Level 1
## Level 2
### Level 3`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Heading",
                level: 1,
                elements: [{type: "Text", text: "Level 1"}],
            },
            {
                type: "Heading",
                level: 2,
                elements: [{type: "Text", text: "Level 2"}],
            },
            {
                type: "Heading",
                level: 3,
                elements: [{type: "Text", text: "Level 3"}],
            },
        ],
    });
});

test("heading with empty content", () => {
    expect(parseApiContentFromMarkdown("# ", {spaceId})).toEqual({
        elements: [
            {
                type: "Heading",
                level: 1,
                elements: [],
            },
        ],
    });
});

// Tests for thematic breaks (dividers)
test("thematic break becomes divider", () => {
    expect(parseApiContentFromMarkdown("---", {spaceId})).toEqual({
        elements: [
            {
                type: "Divider",
            },
        ],
    });
});

test("thematic break between paragraphs", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
First paragraph

---

Second paragraph`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "First paragraph"}],
            },
            {
                type: "Divider",
            },
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Second paragraph"}],
            },
        ],
    });
});

test("thematic break with asterisks", () => {
    expect(parseApiContentFromMarkdown("***", {spaceId})).toEqual({
        elements: [
            {
                type: "Divider",
            },
        ],
    });
});

test("thematic break with underscores", () => {
    expect(parseApiContentFromMarkdown("___", {spaceId})).toEqual({
        elements: [
            {
                type: "Divider",
            },
        ],
    });
});

// Tests for block math
test("block math becomes paragraph with breaks", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
$$
x^2 + y^2 = z^2
$$`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "$$"},
                    {type: "Break"},
                    {type: "Text", text: "x^2 + y^2 = z^2"},
                    {type: "Break"},
                    {type: "Text", text: "$$"},
                ],
            },
        ],
    });
});

test("block math with complex formula", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "$$"},
                    {type: "Break"},
                    {type: "Text", text: "\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}"},
                    {type: "Break"},
                    {type: "Text", text: "$$"},
                ],
            },
        ],
    });
});

// Tests for inline math
test("inline math becomes text", () => {
    expect(parseApiContentFromMarkdown("The formula $x^2 + y^2$ is important.", {spaceId})).toEqual(
        {
            elements: [
                {
                    type: "Paragraph",
                    elements: [{type: "Text", text: "The formula $x^2 + y^2$ is important."}],
                },
            ],
        },
    );
});

test("inline math with marks", () => {
    expect(parseApiContentFromMarkdown("**Bold $E = mc^2$ equation**", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Bold $E = mc^2$ equation", marks: [{type: "Bold"}]},
                ],
            },
        ],
    });
});

// Tests for images (ignored)
test("image is ignored", () => {
    expect(parseApiContentFromMarkdown("![alt text](image.png)", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [],
            },
        ],
    });
});

test("image in paragraph is ignored", () => {
    expect(
        parseApiContentFromMarkdown("Text before ![alt](img.png) text after", {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Text before  text after"}],
            },
        ],
    });
});

test("image reference is ignored", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
Text ![alt][img] here.

[img]: image.png`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Text  here."}],
            },
        ],
    });
});

// Tests for footnotes (treated as plain text)
test("footnote reference is ignored", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
Text with footnote[^1] here.

[^1]: This is the footnote.`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Text with footnote[^1] here."}],
            },
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "[^1]: This is the footnote."}],
            },
        ],
    });
});

test("footnote definition in markdown", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
Paragraph text.

[^1]: This is a footnote definition.

Another paragraph.`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Paragraph text."}],
            },
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "[^1]: This is a footnote definition."}],
            },
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Another paragraph."}],
            },
        ],
    });
});

// Tests for edge cases in merging
test("adjacent text elements with same marks are merged", () => {
    expect(parseApiContentFromMarkdown("**Bold** **text**", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Bold", marks: [{type: "Bold"}]},
                    {type: "Text", text: " "},
                    {type: "Text", text: "text", marks: [{type: "Bold"}]},
                ],
            },
        ],
    });
});

test("adjacent text elements with different marks are not merged", () => {
    expect(parseApiContentFromMarkdown("**Bold** *italic*", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Bold", marks: [{type: "Bold"}]},
                    {type: "Text", text: " "},
                    {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                ],
            },
        ],
    });
});

// Empty table edge case
test("completely empty HTML table", () => {
    expect(parseApiContentFromMarkdown("<table></table>", {spaceId})).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [],
                rows: [],
            },
        ],
    });
});

test("HTML table with empty row", () => {
    expect(
        parseApiContentFromMarkdown(
            `<table>
<tr></tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [],
                rows: [{cells: []}],
            },
        ],
    });
});

// Test HTML entities in code blocks
test("HTML entities in code block", () => {
    expect(
        parseApiContentFromMarkdown("<pre><code>if (a &lt; b) &amp;&amp; (c &gt; d)</code></pre>", {
            spaceId,
        }),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [{elements: [{type: "Text", text: "if (a < b) && (c > d)"}]}],
            },
        ],
    });
});

// Test complex nesting
test("marks in HTML paragraph", () => {
    expect(
        parseApiContentFromMarkdown(
            "<p>Text with <strong>bold</strong>, <em>italic</em>, and <code>code</code></p>",
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Text with "},
                    {type: "Text", text: "bold", marks: [{type: "Bold"}]},
                    {type: "Text", text: ", "},
                    {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                    {type: "Text", text: ", and "},
                    {type: "Text", text: "code", marks: [{type: "Code"}]},
                ],
            },
        ],
    });
});

test("overlapped marks", () => {
    expect(
        parseApiContentFromMarkdown(
            "Text with <strong>bold and <em>italic</em> isn't that neat</strong>",
            {
                spaceId,
            },
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Text with "},
                    {type: "Text", text: "bold and ", marks: [{type: "Bold"}]},
                    {type: "Text", text: "italic", marks: [{type: "Bold"}, {type: "Italic"}]},
                    {type: "Text", text: " isn't that neat", marks: [{type: "Bold"}]},
                ],
            },
        ],
    });
});

test("overlapped marks that end oddly", () => {
    expect(
        parseApiContentFromMarkdown(
            "Text with <strong>bold and <em>italic</strong> isn't that neat</em>",
            {
                spaceId,
            },
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Text with "},
                    {type: "Text", text: "bold and ", marks: [{type: "Bold"}]},
                    {type: "Text", text: "italic", marks: [{type: "Bold"}, {type: "Italic"}]},
                    {type: "Text", text: " isn't that neat", marks: [{type: "Italic"}]},
                ],
            },
        ],
    });
});

test("overlapped marks (classic tag names)", () => {
    expect(
        parseApiContentFromMarkdown("Text with <b>bold and <i>italic</i> isn't that neat</b>", {
            spaceId,
        }),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Text with "},
                    {type: "Text", text: "bold and ", marks: [{type: "Bold"}]},
                    {type: "Text", text: "italic", marks: [{type: "Bold"}, {type: "Italic"}]},
                    {type: "Text", text: " isn't that neat", marks: [{type: "Bold"}]},
                ],
            },
        ],
    });
});

test("overlapped marks that end oddly (classic tag names)", () => {
    expect(
        parseApiContentFromMarkdown("Text with <b>bold and <i>italic</b> isn't that neat</i>", {
            spaceId,
        }),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Text with "},
                    {type: "Text", text: "bold and ", marks: [{type: "Bold"}]},
                    {type: "Text", text: "italic", marks: [{type: "Bold"}, {type: "Italic"}]},
                    {type: "Text", text: " isn't that neat", marks: [{type: "Italic"}]},
                ],
            },
        ],
    });
});

test("marks that aren’t closed don’t bleed to next paragraph", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
Text with <strong>bold and

_italic_ isn't that neat`,
            {
                spaceId,
            },
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Text with "},
                    {type: "Text", text: "bold and", marks: [{type: "Bold"}]},
                ],
            },
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "italic", marks: [{type: "Italic"}]},
                    {type: "Text", text: " isn't that neat"},
                ],
            },
        ],
    });
});

test("multiple nested marks in HTML", () => {
    expect(
        parseApiContentFromMarkdown(
            '<strong><em><del><a href="https://example.com">all marks</a></del></em></strong>',
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "all marks",
                        marks: [
                            {type: "Link", url: "https://example.com"},
                            {type: "Bold"},
                            {type: "Italic"},
                            {type: "Strike"},
                        ],
                    },
                ],
            },
        ],
    });
});

// Test whitespace handling
test("whitespace between table cells is ignored", () => {
    expect(
        parseApiContentFromMarkdown(
            `<table>
  <tr>
    <td>Cell 1</td>


    <td>Cell 2</td>
  </tr>
</table>`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Table",
                width: 1,
                columns: [{width: 1}],
                rows: [
                    {
                        cells: [
                            {
                                elements: [
                                    {type: "Paragraph", elements: [{type: "Text", text: "Cell 1"}]},
                                    {
                                        type: "Code",
                                        language: "text",
                                        lines: [
                                            {elements: [{type: "Text", text: "<td>Cell 2</td>"}]},
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

// Test unclosed tags
test("unclosed HTML tags are handled gracefully", () => {
    expect(parseApiContentFromMarkdown("<strong>Bold text", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "Bold text", marks: [{type: "Bold"}]}],
            },
        ],
    });
});

test("mismatched HTML tags", () => {
    expect(
        parseApiContentFromMarkdown("<strong>Bold <em>italic</strong> text</em>", {spaceId}),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Bold ", marks: [{type: "Bold"}]},
                    {type: "Text", text: "italic", marks: [{type: "Bold"}, {type: "Italic"}]},
                    {type: "Text", text: " text", marks: [{type: "Italic"}]},
                ],
            },
        ],
    });
});

test("HTML table ended inside text", () => {
    expect(() =>
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<td>

Cell 1

</td>
<td>

Cell 2

</td>
<td>

foo</td>bar

</tr>
</table>`,
            {spaceId},
        ),
    ).toThrow("Table HTML isn’t supported in Markdown phrasing content");
});

test("HTML table ended inside block quote", () => {
    expect(() =>
        parseApiContentFromMarkdown(
            `\
<table>
<tr>
<td>

Cell 1

</td>
<td>

Cell 2

</td>
<td>

> foo
>
> </td>
>
> bar

</tr>
</table>`,
            {spaceId},
        ),
    ).toThrow("Table HTML isn’t supported in this Markdown block content parent");
});

// Tests for link references
test("link reference with definition later", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
My [link][example].

[example]: https://example.com`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "My "},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://example.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("link reference with no definitions", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
My [link][example] has no definition.`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "My [link][example] has no definition."}],
            },
        ],
    });
});

test("link reference with definition earlier", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
[example]: https://example.com

My [link][example].`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "My "},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://example.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("link reference with multiple definitions later (uses first)", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
My [link][example].

[example]: https://first.com
[example]: https://second.com
[example]: https://third.com`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "My "},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://first.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("link reference with multiple definitions earlier (uses first)", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
[example]: https://first.com
[example]: https://second.com
[example]: https://third.com

My [link][example].`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "My "},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://first.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("link reference with definitions both earlier and later (prefers later)", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
[example]: https://earlier1.com
[example]: https://earlier2.com

My [link][example].

[example]: https://later1.com
[example]: https://later2.com`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "My "},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://later1.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("link reference with definition in quote block", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
> My [link][example].
>
> [example]: https://quoted.com

Regular [text][example].`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Quote",
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "My "},
                            {
                                type: "Text",
                                text: "link",
                                marks: [{type: "Link", url: "https://quoted.com"}],
                            },
                            {type: "Text", text: "."},
                        ],
                    },
                ],
            },
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Regular "},
                    {
                        type: "Text",
                        text: "text",
                        marks: [{type: "Link", url: "https://quoted.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("multiple link references with same identifier", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
First [link][example] and second [link][example].

[example]: https://example.com`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "First "},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://example.com"}],
                    },
                    {type: "Text", text: " and second "},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://example.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("link reference with different identifiers", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
[First][one] and [second][two].

[one]: https://one.com
[two]: https://two.com`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "First",
                        marks: [{type: "Link", url: "https://one.com"}],
                    },
                    {type: "Text", text: " and "},
                    {
                        type: "Text",
                        text: "second",
                        marks: [{type: "Link", url: "https://two.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("link reference with marks", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
**Bold [link][example]** and *italic [link][example]*.

[example]: https://example.com`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Bold ", marks: [{type: "Bold"}]},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://example.com"}, {type: "Bold"}],
                    },
                    {type: "Text", text: " and "},
                    {type: "Text", text: "italic ", marks: [{type: "Italic"}]},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://example.com"}, {type: "Italic"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("link reference case insensitive matching", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
[Link][Example] and [another][EXAMPLE].

[example]: https://example.com`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "Link",
                        marks: [{type: "Link", url: "https://example.com"}],
                    },
                    {type: "Text", text: " and "},
                    {
                        type: "Text",
                        text: "another",
                        marks: [{type: "Link", url: "https://example.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("link reference in list", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
- First [item][example]
- Second [item][example]

[example]: https://example.com`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "UnorderedList",
                items: [
                    {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "First "},
                                    {
                                        type: "Text",
                                        text: "item",
                                        marks: [{type: "Link", url: "https://example.com"}],
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
                                    {type: "Text", text: "Second "},
                                    {
                                        type: "Text",
                                        text: "item",
                                        marks: [{type: "Link", url: "https://example.com"}],
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("link reference definition between paragraphs", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
First paragraph with [link][example].

[example]: https://example.com

Second paragraph with [link][example].`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "First paragraph with "},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://example.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Second paragraph with "},
                    {
                        type: "Text",
                        text: "link",
                        marks: [{type: "Link", url: "https://example.com"}],
                    },
                    {type: "Text", text: "."},
                ],
            },
        ],
    });
});

test("link reference with invalid definition (no URL)", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
My [link][example].

[example]:`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "My [link][example]."}],
            },
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "[example]:"}],
            },
        ],
    });
});

test("frontmatter is ignored", () => {
    expect(
        parseApiContentFromMarkdown(
            `\
---
title: Hello, world!
---

The quick brown fox jumps over the lazy dog.
`,
            {spaceId},
        ),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "The quick brown fox jumps over the lazy dog."}],
            },
        ],
    });
});

test("inline HTML <mark> tag without attributes defaults to orange highlight", () => {
    expect(parseApiContentFromMarkdown("<mark>highlighted text</mark>", {spaceId})).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "highlighted text",
                        marks: [{type: "Highlight", color: "Orange"}],
                    },
                ],
            },
        ],
    });
});

test("inline HTML <mark> tag in code block without attributes defaults to orange highlight", () => {
    expect(
        parseApiContentFromMarkdown("<pre><code><mark>highlighted text</mark></code></pre>", {
            spaceId,
        }),
    ).toEqual({
        elements: [
            {
                type: "Code",
                language: "text",
                lines: [
                    {
                        elements: [
                            {
                                type: "Text",
                                text: "highlighted text",
                                marks: [{type: "Highlight", color: "Orange"}],
                            },
                        ],
                    },
                ],
            },
        ],
    });
});

test("`parseMarkdownTree()` parses link reference without valid definition when `allowUndefinedLinkReferenceIdentifiers` is true", () => {
    expect(
        parseMarkdownTree("This is my [Dinosaur][] document", {
            allowUndefinedLinkReferenceIdentifiers: true,
        }),
    ).toEqual({
        type: "root",
        position: expect.any(Object),
        children: [
            {
                type: "paragraph",
                position: expect.any(Object),
                children: [
                    {
                        type: "text",
                        position: expect.any(Object),
                        value: "This is my ",
                    },
                    {
                        type: "linkReference",
                        position: expect.any(Object),
                        referenceType: "collapsed",
                        identifier: "dinosaur",
                        label: "Dinosaur",
                        children: [
                            {
                                type: "text",
                                position: expect.any(Object),
                                value: "Dinosaur",
                            },
                        ],
                    },
                    {
                        type: "text",
                        position: expect.any(Object),
                        value: " document",
                    },
                ],
            },
        ],
    });
});

test("`parseMarkdownTree()` doesn’t parse link reference without valid definition when `allowUndefinedLinkReferenceIdentifiers` is false (the default)", () => {
    expect(parseMarkdownTree("This is my [Dinosaur][] document")).toEqual({
        type: "root",
        position: expect.any(Object),
        children: [
            {
                type: "paragraph",
                position: expect.any(Object),
                children: [
                    {
                        type: "text",
                        position: expect.any(Object),
                        value: "This is my [Dinosaur][] document",
                    },
                ],
            },
        ],
    });
});

test("`parseMarkdownTree()` parses link reference in quotes without valid definition when `allowUndefinedLinkReferenceIdentifiers` is true", () => {
    expect(
        parseMarkdownTree('This is my "[Dinosaur][]" document', {
            allowUndefinedLinkReferenceIdentifiers: true,
        }),
    ).toEqual({
        type: "root",
        position: expect.any(Object),
        children: [
            {
                type: "paragraph",
                position: expect.any(Object),
                children: [
                    {
                        type: "text",
                        position: expect.any(Object),
                        value: 'This is my "',
                    },
                    {
                        type: "linkReference",
                        position: expect.any(Object),
                        referenceType: "collapsed",
                        identifier: "dinosaur",
                        label: "Dinosaur",
                        children: [
                            {
                                type: "text",
                                position: expect.any(Object),
                                value: "Dinosaur",
                            },
                        ],
                    },
                    {
                        type: "text",
                        position: expect.any(Object),
                        value: '" document',
                    },
                ],
            },
        ],
    });
});

test("`parseMarkdownTree()` parses link reference in curly quotes without valid definition when `allowUndefinedLinkReferenceIdentifiers` is true", () => {
    expect(
        parseMarkdownTree("This is my “[Dinosaur][]” document", {
            allowUndefinedLinkReferenceIdentifiers: true,
        }),
    ).toEqual({
        type: "root",
        position: expect.any(Object),
        children: [
            {
                type: "paragraph",
                position: expect.any(Object),
                children: [
                    {
                        type: "text",
                        position: expect.any(Object),
                        value: "This is my “",
                    },
                    {
                        type: "linkReference",
                        position: expect.any(Object),
                        referenceType: "collapsed",
                        identifier: "dinosaur",
                        label: "Dinosaur",
                        children: [
                            {
                                type: "text",
                                position: expect.any(Object),
                                value: "Dinosaur",
                            },
                        ],
                    },
                    {
                        type: "text",
                        position: expect.any(Object),
                        value: "” document",
                    },
                ],
            },
        ],
    });
});

test("single newlines are turned into spaces", () => {
    expect(
        parseApiContentFromMarkdown("This is\na test\ncool.", {
            spaceId: generateId(),
        }),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "This is a test cool."}],
            },
        ],
    });
});

test("double newlines create new paragraphs", () => {
    expect(
        parseApiContentFromMarkdown("This is\n\na test\n\ncool.", {
            spaceId: generateId(),
        }),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "This is"}],
            },
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "a test"}],
            },
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "cool."}],
            },
        ],
    });
});

test("triple newlines create new paragraphs", () => {
    expect(
        parseApiContentFromMarkdown("This is\n\n\na test\n\n\ncool.", {
            spaceId: generateId(),
        }),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "This is"}],
            },
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "a test"}],
            },
            {
                type: "Paragraph",
                elements: [{type: "Text", text: "cool."}],
            },
        ],
    });
});

test("escaped newlines are turned into a break", () => {
    expect(
        parseApiContentFromMarkdown("A paragraph\\\nwith a break!", {
            spaceId: generateId(),
        }),
    ).toEqual({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "A paragraph"},
                    {type: "Break"},
                    {type: "Text", text: "with a break!"},
                ],
            },
        ],
    });
});
