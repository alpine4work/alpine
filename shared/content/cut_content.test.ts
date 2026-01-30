import {Node} from "prosemirror-model";
import {cutContent} from "~/shared/content/cut_content.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";

// Helper functions to create nodes
const doc = (...content: Array<Node>) => schema.nodes.doc.create(null, content);
const p = (...content: Array<Node>) => schema.nodes.paragraph.create(null, content);
const text = (string: string) => schema.text(string);
const ol = (attrs: {indent?: number; orderStart?: number}, ...content: Array<Node>) =>
    schema.nodes.orderedListItem.create(attrs, content);
const quoteBlock = (...content: Array<Node>) => schema.nodes.quoteBlock.create(null, content);
const table = (...rows: Array<Node>) => schema.nodes.table.create(null, rows);
const tableRow = (...cells: Array<Node>) => schema.nodes.tableRow.create(null, cells);
const tableCell = (...content: Array<Node>) => schema.nodes.tableCell.create(null, content);

test("cutting before an `orderedListItem` node preserves the first item\u2019s number", () => {
    const content = doc(
        p(text("Before")),
        ol({}, p(text("First"))),
        ol({}, p(text("Second"))),
        ol({}, p(text("Third"))),
    );

    const cut = cutContent(content, 0, 8);

    expect(cut.toJSON()).toEqual(doc(p(text("Before"))).toJSON());
});

test("cutting starting before first `orderedListItem` in a list sets orderStart to 1", () => {
    const content = doc(
        p(text("Before")),
        ol({}, p(text("First"))),
        ol({}, p(text("Second"))),
        ol({}, p(text("Third"))),
    );

    const cut = cutContent(content, 8);

    expect(cut.toJSON()).toEqual(
        doc(ol({}, p(text("First"))), ol({}, p(text("Second"))), ol({}, p(text("Third")))).toJSON(),
    );
});

test("cutting starting at second `orderedListItem` sets orderStart to 2", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({}, p(text("Second"))),
        ol({}, p(text("Third"))),
    );

    const cut = cutContent(content, 9);

    expect(cut.toJSON()).toEqual(
        doc(ol({orderStart: 2}, p(text("Second"))), ol({}, p(text("Third")))).toJSON(),
    );
});

test("cutting starting at third `orderedListItem` sets orderStart to 3", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({}, p(text("Second"))),
        ol({}, p(text("Third"))),
    );

    const cut = cutContent(content, 19);

    expect(cut.toJSON()).toEqual(doc(ol({orderStart: 3}, p(text("Third")))).toJSON());
});

test("cutting inside an `orderedListItem` node (but outside its paragraph) sets correct orderStart", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({}, p(text("Second item"))),
        ol({}, p(text("Third"))),
    );

    const cut = cutContent(content, 10);

    expect(cut.toJSON()).toEqual(
        doc(ol({orderStart: 2}, p(text("Second item"))), ol({}, p(text("Third")))).toJSON(),
    );
});

test("cutting inside an `orderedListItem`\u2019s paragraph at the start sets correct orderStart", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({}, p(text("Second item"))),
        ol({}, p(text("Third"))),
    );

    const cut = cutContent(content, 11);

    expect(cut.toJSON()).toEqual(
        doc(ol({orderStart: 2}, p(text("Second item"))), ol({}, p(text("Third")))).toJSON(),
    );
});

test("cutting arbitrarily inside an `orderedListItem`\u2019s paragraph sets correct orderStart", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({}, p(text("Second item"))),
        ol({}, p(text("Third"))),
    );

    const cut = cutContent(content, 14);

    expect(cut.toJSON()).toEqual(
        doc(ol({orderStart: 2}, p(text("ond item"))), ol({}, p(text("Third")))).toJSON(),
    );
});

test("cutting `orderedListItem` with custom orderStart preserves that value", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({orderStart: 10}, p(text("Tenth"))),
        ol({}, p(text("Eleventh"))),
    );

    const cut = cutContent(content, 9);

    expect(cut.toJSON()).toEqual(
        doc(ol({orderStart: 10}, p(text("Tenth"))), ol({}, p(text("Eleventh")))).toJSON(),
    );
});

test("cutting nested `orderedListItem` (indented) sets correct orderStart", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({indent: 1}, p(text("Nested first"))),
        ol({indent: 1}, p(text("Nested second"))),
        ol({}, p(text("Second"))),
    );

    const cut = cutContent(content, 9);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 1}, p(text("Nested first"))),
            ol({indent: 1}, p(text("Nested second"))),
            ol({orderStart: 2}, p(text("Second"))),
        ).toJSON(),
    );
});

test("cutting nested `orderedListItem` (indented) sets correct orderStart when last node is cut", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({indent: 1}, p(text("Nested first"))),
        ol({indent: 1}, p(text("Nested second"))),
        ol({}, p(text("Second"))),
    );

    const cut = cutContent(content, 9, 47);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 1}, p(text("Nested first"))),
            ol({indent: 1}, p(text("Nested second"))),
            ol({orderStart: 2}, p(text("Sec"))),
        ).toJSON(),
    );
});

test("cutting second nested `orderedListItem` (indented) sets correct orderStart", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({indent: 1}, p(text("Nested first"))),
        ol({indent: 1}, p(text("Nested second"))),
        ol({}, p(text("Second"))),
    );

    const cut = cutContent(content, 25);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 1, orderStart: 2}, p(text("Nested second"))),
            ol({orderStart: 2}, p(text("Second"))),
        ).toJSON(),
    );
});

test("cutting second nested `orderedListItem` (indented) sets correct orderStart when partially cut", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({indent: 1}, p(text("Nested first"))),
        ol({indent: 1}, p(text("Nested second"))),
        ol({}, p(text("Second"))),
    );

    const cut = cutContent(content, 29);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 1, orderStart: 2}, p(text("sted second"))),
            ol({orderStart: 2}, p(text("Second"))),
        ).toJSON(),
    );
});

test("cutting `orderedListItem` inside a `quoteBlock` sets correct orderStart", () => {
    const content = doc(
        p(text("Before")),
        quoteBlock(
            ol({}, p(text("First in quote"))),
            ol({}, p(text("Second in quote"))),
            ol({}, p(text("Third in quote"))),
        ),
        p(text("After")),
    );

    const cut = cutContent(content, 27);

    expect(cut.toJSON()).toEqual(
        doc(
            quoteBlock(
                ol({orderStart: 2}, p(text("Second in quote"))),
                ol({}, p(text("Third in quote"))),
            ),
            p(text("After")),
        ).toJSON(),
    );
});

test("cutting `orderedListItem` at start of `quoteBlock` sets orderStart to 1", () => {
    const content = doc(
        p(text("Before")),
        quoteBlock(
            ol({}, p(text("First in quote"))),
            ol({}, p(text("Second in quote"))),
            ol({}, p(text("Third in quote"))),
        ),
        p(text("After")),
    );

    const cut = cutContent(content, 9);

    expect(cut.toJSON()).toEqual(
        doc(
            quoteBlock(
                ol({}, p(text("First in quote"))),
                ol({}, p(text("Second in quote"))),
                ol({}, p(text("Third in quote"))),
            ),
            p(text("After")),
        ).toJSON(),
    );
});

test("cutting inside paragraph of `orderedListItem` in `quoteBlock` sets correct orderStart", () => {
    const content = doc(
        quoteBlock(ol({}, p(text("First in quote"))), ol({}, p(text("Second in quote")))),
    );

    const cut = cutContent(content, 24);

    expect(cut.toJSON()).toEqual(
        doc(quoteBlock(ol({orderStart: 2}, p(text("ond in quote"))))).toJSON(),
    );
});

test("cutting `orderedListItem` inside a table cell sets correct orderStart", () => {
    const content = doc(
        table(
            tableRow(
                tableCell(
                    ol({}, p(text("First in cell"))),
                    ol({}, p(text("Second in cell"))),
                    ol({}, p(text("Third in cell"))),
                ),
                tableCell(p(text("Other cell"))),
            ),
        ),
    );

    const cut = cutContent(content, 21);

    expect(cut.toJSON()).toEqual(
        doc(
            table(
                tableRow(
                    tableCell(
                        ol({orderStart: 2}, p(text("Second in cell"))),
                        ol({}, p(text("Third in cell"))),
                    ),
                    tableCell(p(text("Other cell"))),
                ),
            ),
        ).toJSON(),
    );
});

test("cutting at start of `orderedListItem` in table cell sets orderStart to 1", () => {
    const content = doc(
        table(
            tableRow(
                tableCell(ol({}, p(text("First in cell"))), ol({}, p(text("Second in cell")))),
                tableCell(p(text("Other cell"))),
            ),
        ),
    );

    const cut = cutContent(content, 3);

    expect(cut.toJSON()).toEqual(
        doc(
            table(
                tableRow(
                    tableCell(ol({}, p(text("First in cell"))), ol({}, p(text("Second in cell")))),
                    tableCell(p(text("Other cell"))),
                ),
            ),
        ).toJSON(),
    );
});

test("cutting inside paragraph of `orderedListItem` in table cell sets correct orderStart", () => {
    const content = doc(
        table(
            tableRow(
                tableCell(
                    ol({}, p(text("First in cell"))),
                    ol({}, p(text("Second in cell"))),
                    ol({}, p(text("Third in cell"))),
                ),
                tableCell(p(text("Other cell"))),
            ),
        ),
    );

    const cut = cutContent(content, 42);

    expect(cut.toJSON()).toEqual(
        doc(
            table(
                tableRow(
                    tableCell(ol({orderStart: 3}, p(text("ird in cell")))),
                    tableCell(p(text("Other cell"))),
                ),
            ),
        ).toJSON(),
    );
});

test("cutting nested `orderedListItem` in table cell sets correct orderStart", () => {
    const content = doc(
        table(
            tableRow(
                tableCell(
                    ol({}, p(text("First"))),
                    ol({indent: 1}, p(text("Nested first"))),
                    ol({indent: 1}, p(text("Nested second"))),
                ),
                tableCell(p(text("Other"))),
            ),
        ),
    );

    const cut = cutContent(content, 28);

    expect(cut.toJSON()).toEqual(
        doc(
            table(
                tableRow(
                    tableCell(ol({indent: 1, orderStart: 2}, p(text("Nested second")))),
                    tableCell(p(text("Other"))),
                ),
            ),
        ).toJSON(),
    );
});

test("cutting with orderedListItemNumberByNode cache works correctly", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({}, p(text("Second"))),
        ol({}, p(text("Third"))),
    );

    const cache = new Map();
    const cut1 = cutContent(content, 9, undefined, cache);
    const cut2 = cutContent(content, 19, undefined, cache);

    expect(cut1.toJSON()).toEqual(
        doc(ol({orderStart: 2}, p(text("Second"))), ol({}, p(text("Third")))).toJSON(),
    );

    expect(cut2.toJSON()).toEqual(doc(ol({orderStart: 3}, p(text("Third")))).toJSON());

    expect(cache.size).toBeGreaterThan(0);
});

test("cutting range within single `orderedListItem` paragraph preserves orderStart", () => {
    const content = doc(
        ol({}, p(text("First"))),
        ol({}, p(text("Second item with text"))),
        ol({}, p(text("Third"))),
    );

    const cut = cutContent(content, 14, 19);

    expect(cut.toJSON()).toEqual(doc(ol({orderStart: 2}, p(text("ond i")))).toJSON());
});

test("cutting with multiple indentation levels preserves correct numbering", () => {
    const content = doc(
        ol({}, p(text("Level {orderStart: item} 1"))),
        ol({indent: 1}, p(text("Level 1, item 1"))),
        ol({indent: 2}, p(text("Level 2, item 1"))),
        ol({indent: 2}, p(text("Level 2, item 2"))),
        ol({indent: 1}, p(text("Level 1, item 2"))),
        ol({}, p(text("Level {orderStart: item} 2"))),
    );

    const cut = cutContent(content, 68);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 2, orderStart: 2}, p(text("Level 2, item 2"))),
            ol({indent: 1, orderStart: 2}, p(text("Level 1, item 2"))),
            ol({orderStart: 2}, p(text("Level {orderStart: item} 2"))),
        ).toJSON(),
    );
});

test("cutting before `orderedListItem` in deeply nested structure", () => {
    const content = doc(
        quoteBlock(
            p(text("Quote text")),
            table(
                tableRow(
                    tableCell(
                        ol({}, p(text("First in nested table"))),
                        ol({}, p(text("Second in nested table"))),
                    ),
                    tableCell(p(text("Cell 2"))),
                ),
            ),
        ),
    );

    const cut = cutContent(content, 42);

    expect(cut.toJSON()).toEqual(
        doc(
            quoteBlock(
                table(
                    tableRow(
                        tableCell(ol({orderStart: 2}, p(text("Second in nested table")))),
                        tableCell(p(text("Cell 2"))),
                    ),
                ),
            ),
        ).toJSON(),
    );
});

test("cutting with no orderedListItem does not modify content", () => {
    const content = doc(p(text("Just a paragraph")), p(text("Another paragraph")));

    const cut = cutContent(content, 0);

    expect(cut.toJSON()).toEqual(content.cut(0).toJSON());
});

test("cutting from middle of paragraph before orderedListItem does not add orderStart", () => {
    const content = doc(
        p(text("Some text before list")),
        ol({}, p(text("First item"))),
        ol({}, p(text("Second item"))),
    );

    const cut = cutContent(content, 6, 23);

    expect(cut.toJSON()).toEqual(doc(p(text("text before list"))).toJSON());
});

test("cutting nested items at decreasing indentation sets orderStart at each level", () => {
    const content = doc(
        ol({}, p(text("Level 0, item 1"))),
        ol({indent: 1}, p(text("Level 1, item 1"))),
        ol({indent: 2}, p(text("Level 2, item 1"))),
        ol({indent: 2}, p(text("Level 2, item 2"))),
        ol({indent: 1}, p(text("Level 1, item 2"))),
        ol({indent: 1}, p(text("Level 1, item 3"))),
        ol({}, p(text("Level 0, item 2"))),
        ol({}, p(text("Level 0, item 3"))),
    );

    const cut = cutContent(content, 57);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 2, orderStart: 2}, p(text("Level 2, item 2"))),
            ol({indent: 1, orderStart: 2}, p(text("Level 1, item 2"))),
            ol({indent: 1}, p(text("Level 1, item 3"))),
            ol({orderStart: 2}, p(text("Level 0, item 2"))),
            ol({}, p(text("Level 0, item 3"))),
        ).toJSON(),
    );
});

test("cutting from deeply nested to shallow sets orderStart at each decreasing level", () => {
    const content = doc(
        ol({}, p(text("Item 1"))),
        ol({indent: 1}, p(text("Item 1.1"))),
        ol({indent: 2}, p(text("Item 1.1.1"))),
        ol({indent: 3}, p(text("Item 1.1.1.1"))),
        ol({indent: 3}, p(text("Item 1.1.1.2"))),
        ol({indent: 2}, p(text("Item 1.1.2"))),
        ol({indent: 1}, p(text("Item 1.2"))),
        ol({}, p(text("Item 2"))),
    );

    const cut = cutContent(content, 52);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 3, orderStart: 2}, p(text("Item 1.1.1.2"))),
            ol({indent: 2, orderStart: 2}, p(text("Item 1.1.2"))),
            ol({indent: 1, orderStart: 2}, p(text("Item 1.2"))),
            ol({orderStart: 2}, p(text("Item 2"))),
        ).toJSON(),
    );
});

test("cutting items with same indentation after different indentation does not set orderStart", () => {
    const content = doc(
        ol({}, p(text("Item 1"))),
        ol({indent: 1}, p(text("Item 1.1"))),
        ol({indent: 1}, p(text("Item 1.2"))),
        ol({indent: 1}, p(text("Item 1.3"))),
        ol({}, p(text("Item 2"))),
    );

    const cut = cutContent(content, 24);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 1, orderStart: 2}, p(text("Item 1.2"))),
            ol({indent: 1}, p(text("Item 1.3"))),
            ol({orderStart: 2}, p(text("Item 2"))),
        ).toJSON(),
    );
});

test("cutting stops setting orderStart after encountering non-list item", () => {
    const content = doc(
        ol({}, p(text("Item 1"))),
        ol({indent: 1}, p(text("Item 1.1"))),
        ol({indent: 1}, p(text("Item 1.2"))),
        p(text("Regular paragraph")),
        ol({}, p(text("Item 2"))),
        ol({}, p(text("Item 3"))),
    );

    const cut = cutContent(content, 24);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 1, orderStart: 2}, p(text("Item 1.2"))),
            p(text("Regular paragraph")),
            ol({}, p(text("Item 2"))),
            ol({}, p(text("Item 3"))),
        ).toJSON(),
    );
});

test("cutting with increasing indentation only sets orderStart on first item", () => {
    const content = doc(
        ol({}, p(text("Item 1"))),
        ol({}, p(text("Item 2"))),
        ol({indent: 1}, p(text("Item 2.1"))),
        ol({indent: 2}, p(text("Item 2.1.1"))),
        ol({indent: 3}, p(text("Item 2.1.1.1"))),
    );

    const cut = cutContent(content, 10);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({orderStart: 2}, p(text("Item 2"))),
            ol({indent: 1}, p(text("Item 2.1"))),
            ol({indent: 2}, p(text("Item 2.1.1"))),
            ol({indent: 3}, p(text("Item 2.1.1.1"))),
        ).toJSON(),
    );
});

test("cutting mixed indentation with zigzag pattern sets orderStart correctly", () => {
    const content = doc(
        ol({}, p(text("Item 1"))),
        ol({indent: 1}, p(text("Item 1.1"))),
        ol({}, p(text("Item 2"))),
        ol({indent: 1}, p(text("Item 2.1"))),
        ol({indent: 2}, p(text("Item 2.1.1"))),
        ol({indent: 1}, p(text("Item 2.2"))),
        ol({}, p(text("Item 3"))),
    );

    const cut = cutContent(content, 24);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({orderStart: 2}, p(text("Item 2"))),
            ol({indent: 1}, p(text("Item 2.1"))),
            ol({indent: 2}, p(text("Item 2.1.1"))),
            ol({indent: 1}, p(text("Item 2.2"))),
            ol({}, p(text("Item 3"))),
        ).toJSON(),
    );
});

test("cutting from nested context where parent has lower indent sets both orderStart values", () => {
    const content = doc(
        ol({}, p(text("Item 1"))),
        ol({indent: 1}, p(text("Item 1.1"))),
        ol({indent: 2}, p(text("Item 1.1.1"))),
        ol({indent: 2}, p(text("Item 1.1.2"))),
        ol({indent: 1}, p(text("Item 1.2"))),
        ol({}, p(text("Item 2"))),
        ol({}, p(text("Item 3"))),
    );

    const cut = cutContent(content, 38);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 2, orderStart: 2}, p(text("Item 1.1.2"))),
            ol({indent: 1, orderStart: 2}, p(text("Item 1.2"))),
            ol({orderStart: 2}, p(text("Item 2"))),
            ol({}, p(text("Item 3"))),
        ).toJSON(),
    );
});

test("cutting with paragraph between nested items resets orderStart logic", () => {
    const content = doc(
        ol({}, p(text("Item 1"))),
        ol({indent: 1}, p(text("Item 1.1"))),
        p(text("Break")),
        ol({indent: 1}, p(text("Item 1.2"))),
        ol({}, p(text("Item 2"))),
    );

    const cut = cutContent(content, 23);

    expect(cut.toJSON()).toEqual(
        doc(
            p(text("Break")),
            ol({indent: 1}, p(text("Item 1.2"))),
            ol({}, p(text("Item 2"))),
        ).toJSON(),
    );
});

test("cutting single deeply nested item sets orderStart only on that item", () => {
    const content = doc(
        ol({}, p(text("Item 1"))),
        ol({indent: 1}, p(text("Item 1.1"))),
        ol({indent: 2}, p(text("Item 1.1.1"))),
        ol({indent: 3}, p(text("Item 1.1.1.1"))),
        ol({indent: 3}, p(text("Item 1.1.1.2"))),
    );

    const cut = cutContent(content, 52, 67);

    expect(cut.toJSON()).toEqual(
        doc(ol({indent: 3, orderStart: 2}, p(text("Item 1.1.1.2")))).toJSON(),
    );
});

test("cutting range that spans multiple indentation changes sets orderStart appropriately", () => {
    const content = doc(
        ol({}, p(text("Item 1"))),
        ol({indent: 1}, p(text("Item 1.1"))),
        ol({indent: 2}, p(text("Item 1.1.1"))),
        ol({indent: 1}, p(text("Item 1.2"))),
        ol({}, p(text("Item 2"))),
        ol({}, p(text("Item 3"))),
    );

    const cut = cutContent(content, 24, 56);

    expect(cut.toJSON()).toEqual(
        doc(
            ol({indent: 2}, p(text("Item 1.1.1"))),
            ol({indent: 1, orderStart: 2}, p(text("Item 1.2"))),
            ol({orderStart: 2}, p(text("Item 2"))),
        ).toJSON(),
    );
});

test("cutting nested items in quoteBlock sets orderStart at decreasing indentation", () => {
    const content = doc(
        quoteBlock(
            ol({}, p(text("Item 1"))),
            ol({indent: 1}, p(text("Item 1.1"))),
            ol({indent: 2}, p(text("Item 1.1.1"))),
            ol({indent: 1}, p(text("Item 1.2"))),
            ol({}, p(text("Item 2"))),
        ),
    );

    const cut = cutContent(content, 25);

    expect(cut.toJSON()).toEqual(
        doc(
            quoteBlock(
                ol({indent: 2}, p(text("Item 1.1.1"))),
                ol({indent: 1, orderStart: 2}, p(text("Item 1.2"))),
                ol({orderStart: 2}, p(text("Item 2"))),
            ),
        ).toJSON(),
    );
});

test("cutting nested items in table cell sets orderStart at decreasing indentation", () => {
    const content = doc(
        table(
            tableRow(
                tableCell(
                    ol({}, p(text("Item 1"))),
                    ol({indent: 1}, p(text("Item 1.1"))),
                    ol({indent: 2}, p(text("Item 1.1.1"))),
                    ol({indent: 1}, p(text("Item 1.2"))),
                    ol({}, p(text("Item 2"))),
                ),
                tableCell(p(text("Other"))),
            ),
        ),
    );

    const cut = cutContent(content, 27);

    expect(cut.toJSON()).toEqual(
        doc(
            table(
                tableRow(
                    tableCell(
                        ol({indent: 2}, p(text("Item 1.1.1"))),
                        ol({indent: 1, orderStart: 2}, p(text("Item 1.2"))),
                        ol({orderStart: 2}, p(text("Item 2"))),
                    ),
                    tableCell(p(text("Other"))),
                ),
            ),
        ).toJSON(),
    );
});
