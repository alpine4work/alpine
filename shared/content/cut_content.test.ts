import {createContentBuilder} from "~/shared/content/create_content_builder.js";
import {cutContent} from "~/shared/content/cut_content.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";

const {doc, paragraph, text, orderedListItem, quoteBlock, table, tableRow, tableCell} =
    createContentBuilder(schema);

test("cutting before an `orderedListItem` node preserves the first item\u2019s number", () => {
    const content = doc(
        paragraph(text("Before")),
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(0, paragraph(text("Second"))),
        orderedListItem(0, paragraph(text("Third"))),
    );

    const cut = cutContent(content, 0, 8);

    expect(cut.toJSON()).toEqual(doc(paragraph(text("Before"))).toJSON());
});

test("cutting starting before first `orderedListItem` in a list sets orderStart to 1", () => {
    const content = doc(
        paragraph(text("Before")),
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(0, paragraph(text("Second"))),
        orderedListItem(0, paragraph(text("Third"))),
    );

    const cut = cutContent(content, 8);

    expect(cut.toJSON()).toEqual(
        doc(orderedListItem(0, paragraph(text("First"))), orderedListItem(0, paragraph(text("Second"))), orderedListItem(0, paragraph(text("Third")))).toJSON(),
    );
});

test("cutting starting at second `orderedListItem` sets orderStart to 2", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(0, paragraph(text("Second"))),
        orderedListItem(0, paragraph(text("Third"))),
    );

    const cut = cutContent(content, 9);

    expect(cut.toJSON()).toEqual(
        doc(orderedListItem({orderStart: 2}, paragraph(text("Second"))), orderedListItem(0, paragraph(text("Third")))).toJSON(),
    );
});

test("cutting starting at third `orderedListItem` sets orderStart to 3", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(0, paragraph(text("Second"))),
        orderedListItem(0, paragraph(text("Third"))),
    );

    const cut = cutContent(content, 19);

    expect(cut.toJSON()).toEqual(doc(orderedListItem({orderStart: 3}, paragraph(text("Third")))).toJSON());
});

test("cutting inside an `orderedListItem` node (but outside its paragraph) sets correct orderStart", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(0, paragraph(text("Second item"))),
        orderedListItem(0, paragraph(text("Third"))),
    );

    const cut = cutContent(content, 10);

    expect(cut.toJSON()).toEqual(
        doc(orderedListItem({orderStart: 2}, paragraph(text("Second item"))), orderedListItem(0, paragraph(text("Third")))).toJSON(),
    );
});

test("cutting inside an `orderedListItem`\u2019s paragraph at the start sets correct orderStart", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(0, paragraph(text("Second item"))),
        orderedListItem(0, paragraph(text("Third"))),
    );

    const cut = cutContent(content, 11);

    expect(cut.toJSON()).toEqual(
        doc(orderedListItem({orderStart: 2}, paragraph(text("Second item"))), orderedListItem(0, paragraph(text("Third")))).toJSON(),
    );
});

test("cutting arbitrarily inside an `orderedListItem`\u2019s paragraph sets correct orderStart", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(0, paragraph(text("Second item"))),
        orderedListItem(0, paragraph(text("Third"))),
    );

    const cut = cutContent(content, 14);

    expect(cut.toJSON()).toEqual(
        doc(orderedListItem({orderStart: 2}, paragraph(text("ond item"))), orderedListItem(0, paragraph(text("Third")))).toJSON(),
    );
});

test("cutting `orderedListItem` with custom orderStart preserves that value", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem({orderStart: 10}, paragraph(text("Tenth"))),
        orderedListItem(0, paragraph(text("Eleventh"))),
    );

    const cut = cutContent(content, 9);

    expect(cut.toJSON()).toEqual(
        doc(orderedListItem({orderStart: 10}, paragraph(text("Tenth"))), orderedListItem(0, paragraph(text("Eleventh")))).toJSON(),
    );
});

test("cutting nested `orderedListItem` (indented) sets correct orderStart", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(1, paragraph(text("Nested first"))),
        orderedListItem(1, paragraph(text("Nested second"))),
        orderedListItem(0, paragraph(text("Second"))),
    );

    const cut = cutContent(content, 9);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem(1, paragraph(text("Nested first"))),
            orderedListItem(1, paragraph(text("Nested second"))),
            orderedListItem({orderStart: 2}, paragraph(text("Second"))),
        ).toJSON(),
    );
});

test("cutting nested `orderedListItem` (indented) sets correct orderStart when last node is cut", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(1, paragraph(text("Nested first"))),
        orderedListItem(1, paragraph(text("Nested second"))),
        orderedListItem(0, paragraph(text("Second"))),
    );

    const cut = cutContent(content, 9, 47);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem(1, paragraph(text("Nested first"))),
            orderedListItem(1, paragraph(text("Nested second"))),
            orderedListItem({orderStart: 2}, paragraph(text("Sec"))),
        ).toJSON(),
    );
});

test("cutting second nested `orderedListItem` (indented) sets correct orderStart", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(1, paragraph(text("Nested first"))),
        orderedListItem(1, paragraph(text("Nested second"))),
        orderedListItem(0, paragraph(text("Second"))),
    );

    const cut = cutContent(content, 25);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Nested second"))),
            orderedListItem({orderStart: 2}, paragraph(text("Second"))),
        ).toJSON(),
    );
});

test("cutting second nested `orderedListItem` (indented) sets correct orderStart when partially cut", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(1, paragraph(text("Nested first"))),
        orderedListItem(1, paragraph(text("Nested second"))),
        orderedListItem(0, paragraph(text("Second"))),
    );

    const cut = cutContent(content, 29);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem({indent: 1, orderStart: 2}, paragraph(text("sted second"))),
            orderedListItem({orderStart: 2}, paragraph(text("Second"))),
        ).toJSON(),
    );
});

test("cutting `orderedListItem` inside a `quoteBlock` sets correct orderStart", () => {
    const content = doc(
        paragraph(text("Before")),
        quoteBlock(
            orderedListItem(0, paragraph(text("First in quote"))),
            orderedListItem(0, paragraph(text("Second in quote"))),
            orderedListItem(0, paragraph(text("Third in quote"))),
        ),
        paragraph(text("After")),
    );

    const cut = cutContent(content, 27);

    expect(cut.toJSON()).toEqual(
        doc(
            quoteBlock(
                orderedListItem({orderStart: 2}, paragraph(text("Second in quote"))),
                orderedListItem(0, paragraph(text("Third in quote"))),
            ),
            paragraph(text("After")),
        ).toJSON(),
    );
});

test("cutting `orderedListItem` at start of `quoteBlock` sets orderStart to 1", () => {
    const content = doc(
        paragraph(text("Before")),
        quoteBlock(
            orderedListItem(0, paragraph(text("First in quote"))),
            orderedListItem(0, paragraph(text("Second in quote"))),
            orderedListItem(0, paragraph(text("Third in quote"))),
        ),
        paragraph(text("After")),
    );

    const cut = cutContent(content, 9);

    expect(cut.toJSON()).toEqual(
        doc(
            quoteBlock(
                orderedListItem(0, paragraph(text("First in quote"))),
                orderedListItem(0, paragraph(text("Second in quote"))),
                orderedListItem(0, paragraph(text("Third in quote"))),
            ),
            paragraph(text("After")),
        ).toJSON(),
    );
});

test("cutting inside paragraph of `orderedListItem` in `quoteBlock` sets correct orderStart", () => {
    const content = doc(
        quoteBlock(orderedListItem(0, paragraph(text("First in quote"))), orderedListItem(0, paragraph(text("Second in quote")))),
    );

    const cut = cutContent(content, 24);

    expect(cut.toJSON()).toEqual(
        doc(quoteBlock(orderedListItem({orderStart: 2}, paragraph(text("ond in quote"))))).toJSON(),
    );
});

test("cutting `orderedListItem` inside a table cell sets correct orderStart", () => {
    const content = doc(
        table(
            {columnWidths: []},
            tableRow(
                tableCell(
                    orderedListItem(0, paragraph(text("First in cell"))),
                    orderedListItem(0, paragraph(text("Second in cell"))),
                    orderedListItem(0, paragraph(text("Third in cell"))),
                ),
                tableCell(paragraph(text("Other cell"))),
            ),
        ),
    );

    const cut = cutContent(content, 21);

    expect(cut.toJSON()).toEqual(
        doc(
            table(
                {columnWidths: []},
                tableRow(
                    tableCell(
                        orderedListItem({orderStart: 2}, paragraph(text("Second in cell"))),
                        orderedListItem(0, paragraph(text("Third in cell"))),
                    ),
                    tableCell(paragraph(text("Other cell"))),
                ),
            ),
        ).toJSON(),
    );
});

test("cutting at start of `orderedListItem` in table cell sets orderStart to 1", () => {
    const content = doc(
        table(
            {columnWidths: []},
            tableRow(
                tableCell(orderedListItem(0, paragraph(text("First in cell"))), orderedListItem(0, paragraph(text("Second in cell")))),
                tableCell(paragraph(text("Other cell"))),
            ),
        ),
    );

    const cut = cutContent(content, 3);

    expect(cut.toJSON()).toEqual(
        doc(
            table(
                {columnWidths: []},
                tableRow(
                    tableCell(orderedListItem(0, paragraph(text("First in cell"))), orderedListItem(0, paragraph(text("Second in cell")))),
                    tableCell(paragraph(text("Other cell"))),
                ),
            ),
        ).toJSON(),
    );
});

test("cutting inside paragraph of `orderedListItem` in table cell sets correct orderStart", () => {
    const content = doc(
        table(
            {columnWidths: []},
            tableRow(
                tableCell(
                    orderedListItem(0, paragraph(text("First in cell"))),
                    orderedListItem(0, paragraph(text("Second in cell"))),
                    orderedListItem(0, paragraph(text("Third in cell"))),
                ),
                tableCell(paragraph(text("Other cell"))),
            ),
        ),
    );

    const cut = cutContent(content, 42);

    expect(cut.toJSON()).toEqual(
        doc(
            table(
                {columnWidths: []},
                tableRow(
                    tableCell(orderedListItem({orderStart: 3}, paragraph(text("ird in cell")))),
                    tableCell(paragraph(text("Other cell"))),
                ),
            ),
        ).toJSON(),
    );
});

test("cutting nested `orderedListItem` in table cell sets correct orderStart", () => {
    const content = doc(
        table(
            {columnWidths: []},
            tableRow(
                tableCell(
                    orderedListItem(0, paragraph(text("First"))),
                    orderedListItem(1, paragraph(text("Nested first"))),
                    orderedListItem(1, paragraph(text("Nested second"))),
                ),
                tableCell(paragraph(text("Other"))),
            ),
        ),
    );

    const cut = cutContent(content, 28);

    expect(cut.toJSON()).toEqual(
        doc(
            table(
                {columnWidths: []},
                tableRow(
                    tableCell(orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Nested second")))),
                    tableCell(paragraph(text("Other"))),
                ),
            ),
        ).toJSON(),
    );
});

test("cutting with orderedListItemNumberByNode cache works correctly", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(0, paragraph(text("Second"))),
        orderedListItem(0, paragraph(text("Third"))),
    );

    const cache = new Map();
    const cut1 = cutContent(content, 9, undefined, cache);
    const cut2 = cutContent(content, 19, undefined, cache);

    expect(cut1.toJSON()).toEqual(
        doc(orderedListItem({orderStart: 2}, paragraph(text("Second"))), orderedListItem(0, paragraph(text("Third")))).toJSON(),
    );

    expect(cut2.toJSON()).toEqual(doc(orderedListItem({orderStart: 3}, paragraph(text("Third")))).toJSON());

    expect(cache.size).toBeGreaterThan(0);
});

test("cutting range within single `orderedListItem` paragraph preserves orderStart", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("First"))),
        orderedListItem(0, paragraph(text("Second item with text"))),
        orderedListItem(0, paragraph(text("Third"))),
    );

    const cut = cutContent(content, 14, 19);

    expect(cut.toJSON()).toEqual(doc(orderedListItem({orderStart: 2}, paragraph(text("ond i")))).toJSON());
});

test("cutting with multiple indentation levels preserves correct numbering", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Level {orderStart: item} 1"))),
        orderedListItem(1, paragraph(text("Level 1, item 1"))),
        orderedListItem(2, paragraph(text("Level 2, item 1"))),
        orderedListItem(2, paragraph(text("Level 2, item 2"))),
        orderedListItem(1, paragraph(text("Level 1, item 2"))),
        orderedListItem(0, paragraph(text("Level {orderStart: item} 2"))),
    );

    const cut = cutContent(content, 68);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem({indent: 2, orderStart: 2}, paragraph(text("Level 2, item 2"))),
            orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Level 1, item 2"))),
            orderedListItem({orderStart: 2}, paragraph(text("Level {orderStart: item} 2"))),
        ).toJSON(),
    );
});

test("cutting before `orderedListItem` in deeply nested structure", () => {
    const content = doc(
        quoteBlock(
            paragraph(text("Quote text")),
            table(
                {columnWidths: []},
                tableRow(
                    tableCell(
                        orderedListItem(0, paragraph(text("First in nested table"))),
                        orderedListItem(0, paragraph(text("Second in nested table"))),
                    ),
                    tableCell(paragraph(text("Cell 2"))),
                ),
            ),
        ),
    );

    const cut = cutContent(content, 42);

    expect(cut.toJSON()).toEqual(
        doc(
            quoteBlock(
                table(
                    {columnWidths: []},
                    tableRow(
                        tableCell(orderedListItem({orderStart: 2}, paragraph(text("Second in nested table")))),
                        tableCell(paragraph(text("Cell 2"))),
                    ),
                ),
            ),
        ).toJSON(),
    );
});

test("cutting with no orderedListItem does not modify content", () => {
    const content = doc(paragraph(text("Just a paragraph")), paragraph(text("Another paragraph")));

    const cut = cutContent(content, 0);

    expect(cut.toJSON()).toEqual(content.cut(0).toJSON());
});

test("cutting from middle of paragraph before orderedListItem does not add orderStart", () => {
    const content = doc(
        paragraph(text("Some text before list")),
        orderedListItem(0, paragraph(text("First item"))),
        orderedListItem(0, paragraph(text("Second item"))),
    );

    const cut = cutContent(content, 6, 23);

    expect(cut.toJSON()).toEqual(doc(paragraph(text("text before list"))).toJSON());
});

test("cutting nested items at decreasing indentation sets orderStart at each level", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Level 0, item 1"))),
        orderedListItem(1, paragraph(text("Level 1, item 1"))),
        orderedListItem(2, paragraph(text("Level 2, item 1"))),
        orderedListItem(2, paragraph(text("Level 2, item 2"))),
        orderedListItem(1, paragraph(text("Level 1, item 2"))),
        orderedListItem(1, paragraph(text("Level 1, item 3"))),
        orderedListItem(0, paragraph(text("Level 0, item 2"))),
        orderedListItem(0, paragraph(text("Level 0, item 3"))),
    );

    const cut = cutContent(content, 57);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem({indent: 2, orderStart: 2}, paragraph(text("Level 2, item 2"))),
            orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Level 1, item 2"))),
            orderedListItem(1, paragraph(text("Level 1, item 3"))),
            orderedListItem({orderStart: 2}, paragraph(text("Level 0, item 2"))),
            orderedListItem(0, paragraph(text("Level 0, item 3"))),
        ).toJSON(),
    );
});

test("cutting from deeply nested to shallow sets orderStart at each decreasing level", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Item 1"))),
        orderedListItem(1, paragraph(text("Item 1.1"))),
        orderedListItem(2, paragraph(text("Item 1.1.1"))),
        orderedListItem(3, paragraph(text("Item 1.1.1.1"))),
        orderedListItem(3, paragraph(text("Item 1.1.1.2"))),
        orderedListItem(2, paragraph(text("Item 1.1.2"))),
        orderedListItem(1, paragraph(text("Item 1.2"))),
        orderedListItem(0, paragraph(text("Item 2"))),
    );

    const cut = cutContent(content, 52);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem({indent: 3, orderStart: 2}, paragraph(text("Item 1.1.1.2"))),
            orderedListItem({indent: 2, orderStart: 2}, paragraph(text("Item 1.1.2"))),
            orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Item 1.2"))),
            orderedListItem({orderStart: 2}, paragraph(text("Item 2"))),
        ).toJSON(),
    );
});

test("cutting items with same indentation after different indentation does not set orderStart", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Item 1"))),
        orderedListItem(1, paragraph(text("Item 1.1"))),
        orderedListItem(1, paragraph(text("Item 1.2"))),
        orderedListItem(1, paragraph(text("Item 1.3"))),
        orderedListItem(0, paragraph(text("Item 2"))),
    );

    const cut = cutContent(content, 24);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Item 1.2"))),
            orderedListItem(1, paragraph(text("Item 1.3"))),
            orderedListItem({orderStart: 2}, paragraph(text("Item 2"))),
        ).toJSON(),
    );
});

test("cutting stops setting orderStart after encountering non-list item", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Item 1"))),
        orderedListItem(1, paragraph(text("Item 1.1"))),
        orderedListItem(1, paragraph(text("Item 1.2"))),
        paragraph(text("Regular paragraph")),
        orderedListItem(0, paragraph(text("Item 2"))),
        orderedListItem(0, paragraph(text("Item 3"))),
    );

    const cut = cutContent(content, 24);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Item 1.2"))),
            paragraph(text("Regular paragraph")),
            orderedListItem(0, paragraph(text("Item 2"))),
            orderedListItem(0, paragraph(text("Item 3"))),
        ).toJSON(),
    );
});

test("cutting with increasing indentation only sets orderStart on first item", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Item 1"))),
        orderedListItem(0, paragraph(text("Item 2"))),
        orderedListItem(1, paragraph(text("Item 2.1"))),
        orderedListItem(2, paragraph(text("Item 2.1.1"))),
        orderedListItem(3, paragraph(text("Item 2.1.1.1"))),
    );

    const cut = cutContent(content, 10);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem({orderStart: 2}, paragraph(text("Item 2"))),
            orderedListItem(1, paragraph(text("Item 2.1"))),
            orderedListItem(2, paragraph(text("Item 2.1.1"))),
            orderedListItem(3, paragraph(text("Item 2.1.1.1"))),
        ).toJSON(),
    );
});

test("cutting mixed indentation with zigzag pattern sets orderStart correctly", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Item 1"))),
        orderedListItem(1, paragraph(text("Item 1.1"))),
        orderedListItem(0, paragraph(text("Item 2"))),
        orderedListItem(1, paragraph(text("Item 2.1"))),
        orderedListItem(2, paragraph(text("Item 2.1.1"))),
        orderedListItem(1, paragraph(text("Item 2.2"))),
        orderedListItem(0, paragraph(text("Item 3"))),
    );

    const cut = cutContent(content, 24);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem({orderStart: 2}, paragraph(text("Item 2"))),
            orderedListItem(1, paragraph(text("Item 2.1"))),
            orderedListItem(2, paragraph(text("Item 2.1.1"))),
            orderedListItem(1, paragraph(text("Item 2.2"))),
            orderedListItem(0, paragraph(text("Item 3"))),
        ).toJSON(),
    );
});

test("cutting from nested context where parent has lower indent sets both orderStart values", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Item 1"))),
        orderedListItem(1, paragraph(text("Item 1.1"))),
        orderedListItem(2, paragraph(text("Item 1.1.1"))),
        orderedListItem(2, paragraph(text("Item 1.1.2"))),
        orderedListItem(1, paragraph(text("Item 1.2"))),
        orderedListItem(0, paragraph(text("Item 2"))),
        orderedListItem(0, paragraph(text("Item 3"))),
    );

    const cut = cutContent(content, 38);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem({indent: 2, orderStart: 2}, paragraph(text("Item 1.1.2"))),
            orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Item 1.2"))),
            orderedListItem({orderStart: 2}, paragraph(text("Item 2"))),
            orderedListItem(0, paragraph(text("Item 3"))),
        ).toJSON(),
    );
});

test("cutting with paragraph between nested items resets orderStart logic", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Item 1"))),
        orderedListItem(1, paragraph(text("Item 1.1"))),
        paragraph(text("Break")),
        orderedListItem(1, paragraph(text("Item 1.2"))),
        orderedListItem(0, paragraph(text("Item 2"))),
    );

    const cut = cutContent(content, 23);

    expect(cut.toJSON()).toEqual(
        doc(
            paragraph(text("Break")),
            orderedListItem(1, paragraph(text("Item 1.2"))),
            orderedListItem(0, paragraph(text("Item 2"))),
        ).toJSON(),
    );
});

test("cutting single deeply nested item sets orderStart only on that item", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Item 1"))),
        orderedListItem(1, paragraph(text("Item 1.1"))),
        orderedListItem(2, paragraph(text("Item 1.1.1"))),
        orderedListItem(3, paragraph(text("Item 1.1.1.1"))),
        orderedListItem(3, paragraph(text("Item 1.1.1.2"))),
    );

    const cut = cutContent(content, 52, 67);

    expect(cut.toJSON()).toEqual(
        doc(orderedListItem({indent: 3, orderStart: 2}, paragraph(text("Item 1.1.1.2")))).toJSON(),
    );
});

test("cutting range that spans multiple indentation changes sets orderStart appropriately", () => {
    const content = doc(
        orderedListItem(0, paragraph(text("Item 1"))),
        orderedListItem(1, paragraph(text("Item 1.1"))),
        orderedListItem(2, paragraph(text("Item 1.1.1"))),
        orderedListItem(1, paragraph(text("Item 1.2"))),
        orderedListItem(0, paragraph(text("Item 2"))),
        orderedListItem(0, paragraph(text("Item 3"))),
    );

    const cut = cutContent(content, 24, 56);

    expect(cut.toJSON()).toEqual(
        doc(
            orderedListItem(2, paragraph(text("Item 1.1.1"))),
            orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Item 1.2"))),
            orderedListItem({orderStart: 2}, paragraph(text("Item 2"))),
        ).toJSON(),
    );
});

test("cutting nested items in quoteBlock sets orderStart at decreasing indentation", () => {
    const content = doc(
        quoteBlock(
            orderedListItem(0, paragraph(text("Item 1"))),
            orderedListItem(1, paragraph(text("Item 1.1"))),
            orderedListItem(2, paragraph(text("Item 1.1.1"))),
            orderedListItem(1, paragraph(text("Item 1.2"))),
            orderedListItem(0, paragraph(text("Item 2"))),
        ),
    );

    const cut = cutContent(content, 25);

    expect(cut.toJSON()).toEqual(
        doc(
            quoteBlock(
                orderedListItem(2, paragraph(text("Item 1.1.1"))),
                orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Item 1.2"))),
                orderedListItem({orderStart: 2}, paragraph(text("Item 2"))),
            ),
        ).toJSON(),
    );
});

test("cutting nested items in table cell sets orderStart at decreasing indentation", () => {
    const content = doc(
        table(
            {columnWidths: []},
            tableRow(
                tableCell(
                    orderedListItem(0, paragraph(text("Item 1"))),
                    orderedListItem(1, paragraph(text("Item 1.1"))),
                    orderedListItem(2, paragraph(text("Item 1.1.1"))),
                    orderedListItem(1, paragraph(text("Item 1.2"))),
                    orderedListItem(0, paragraph(text("Item 2"))),
                ),
                tableCell(paragraph(text("Other"))),
            ),
        ),
    );

    const cut = cutContent(content, 27);

    expect(cut.toJSON()).toEqual(
        doc(
            table(
                {columnWidths: []},
                tableRow(
                    tableCell(
                        orderedListItem(2, paragraph(text("Item 1.1.1"))),
                        orderedListItem({indent: 1, orderStart: 2}, paragraph(text("Item 1.2"))),
                        orderedListItem({orderStart: 2}, paragraph(text("Item 2"))),
                    ),
                    tableCell(paragraph(text("Other"))),
                ),
            ),
        ).toJSON(),
    );
});
