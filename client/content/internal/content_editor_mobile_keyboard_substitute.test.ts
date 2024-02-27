import {TextSelection} from "prosemirror-state";
import {
    expandEmptySelectionAroundWord,
    expandSelectionAroundLinkMark,
} from "~/client/content/internal/content_editor_mobile_keyboard_substitute.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

function json(value: unknown) {
    return JSON.parse(JSON.stringify(value));
}

test("expands selection around word when words are delimited by spaces", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [schema.text("foo bar qux")]),
    ]);

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(1)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(2)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(3)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(4)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(5)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 5,
        head: 8,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(6)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 5,
        head: 8,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(7)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 5,
        head: 8,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(8)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 5,
        head: 8,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(9)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 9,
        head: 12,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(10)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 9,
        head: 12,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(11)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 9,
        head: 12,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(12)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 9,
        head: 12,
    });
});

test("expands selection around word when words are delimited by dashes", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [schema.text("foo-bar-qux")]),
    ]);

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(1)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(2)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(3)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(4)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(5)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 5,
        head: 8,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(6)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 5,
        head: 8,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(7)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 5,
        head: 8,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(8)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 5,
        head: 8,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(9)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 9,
        head: 12,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(10)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 9,
        head: 12,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(11)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 9,
        head: 12,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(12)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 9,
        head: 12,
    });
});

test("doesn't expand selection around single letter word", () => {
    const doc = schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("foo b qux")])]);

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(1)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(2)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(3)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(4)))?.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(5)))?.toJSON(),
    ).toEqual(undefined);

    expect(
        expandEmptySelectionAroundWord(doc, new TextSelection(doc.resolve(6)))?.toJSON(),
    ).toEqual(undefined);
});

test("expands selection around link", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("bar", [schema.marks.link.create({url: "https://alpine.inc"})]),
        ]),
    ]);

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(1)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(2)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(4)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1), doc.resolve(2)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2), doc.resolve(3)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(3), doc.resolve(4)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1), doc.resolve(4)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });
});

test("expands selection around link with text around it", () => {
    const offset = 4;

    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("foo "),
            schema.text("bar", [schema.marks.link.create({url: "https://alpine.inc"})]),
            schema.text(" qux"),
        ]),
    ]);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(offset)),
        )?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset), doc.resolve(2 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2 + offset), doc.resolve(3 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(3 + offset), doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset), doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(5 + offset)),
        )?.selection.toJSON(),
    ).toEqual(undefined);
});

test("expands selection around link in list item", () => {
    const offset = 1;

    const doc = schema.node("doc", {}, [
        schema.node("unorderedListItem", {}, [
            schema.node("paragraph", {}, [
                schema.text("bar", [schema.marks.link.create({url: "https://alpine.inc"})]),
            ]),
        ]),
    ]);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(offset)),
        )?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset), doc.resolve(2 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2 + offset), doc.resolve(3 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(3 + offset), doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset), doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(5 + offset)),
        )?.selection.toJSON(),
    ).toEqual(undefined);
});

test("expands selection around link in list item with text around", () => {
    const offset = 5;

    const doc = schema.node("doc", {}, [
        schema.node("unorderedListItem", {}, [
            schema.node("paragraph", {}, [
                schema.text("foo "),
                schema.text("bar", [schema.marks.link.create({url: "https://alpine.inc"})]),
                schema.text(" qux"),
            ]),
        ]),
    ]);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(offset)),
        )?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset), doc.resolve(2 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2 + offset), doc.resolve(3 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(3 + offset), doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset), doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(5 + offset)),
        )?.selection.toJSON(),
    ).toEqual(undefined);
});

test("expands selection around link with just text before it", () => {
    const offset = 4;

    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("foo "),
            schema.text("bar", [schema.marks.link.create({url: "https://alpine.inc"})]),
        ]),
    ]);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(offset)),
        )?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset), doc.resolve(2 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2 + offset), doc.resolve(3 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(3 + offset), doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset), doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(5 + offset)),
        )?.selection.toJSON(),
    ).toEqual(undefined);
});

test("expands selection around link with just text after it", () => {
    const offset = 0;

    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("bar", [schema.marks.link.create({url: "https://alpine.inc"})]),
            schema.text(" qux"),
        ]),
    ]);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(offset)),
        )?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset), doc.resolve(2 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2 + offset), doc.resolve(3 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(3 + offset), doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(1 + offset), doc.resolve(4 + offset)),
        )?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1 + offset,
        head: 4 + offset,
    });

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(5 + offset)),
        )?.selection.toJSON(),
    ).toEqual(undefined);
});

test("expands selection around link with formatting", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("foo", [schema.marks.link.create({url: "https://alpine.inc"})]),
            schema.text("bar", [
                schema.marks.link.create({url: "https://alpine.inc"}),
                schema.marks.bold.create(),
            ]),
            schema.text("qux", [schema.marks.link.create({url: "https://alpine.inc"})]),
        ]),
    ]);

    for (let j = 0; j <= 10; j++) {
        for (let i = 1; i <= 10 - j; i++) {
            expect(
                expandSelectionAroundLinkMark(
                    doc,
                    new TextSelection(doc.resolve(i), doc.resolve(i + j)),
                )?.selection.toJSON(),
            ).toEqual({
                type: "text",
                anchor: 1,
                head: 10,
            });
        }
    }
});

test("expands selection around link with formatting and text around it", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("test "),
            schema.text("foo", [schema.marks.link.create({url: "https://alpine.inc"})]),
            schema.text("bar", [
                schema.marks.link.create({url: "https://alpine.inc"}),
                schema.marks.bold.create(),
            ]),
            schema.text("qux", [schema.marks.link.create({url: "https://alpine.inc"})]),
            schema.text(" test"),
        ]),
    ]);

    for (let j = 0; j < 10; j++) {
        for (let i = 1; i <= 10 - j; i++) {
            expect(
                expandSelectionAroundLinkMark(
                    doc,
                    new TextSelection(doc.resolve(i + 5), doc.resolve(i + j + 5)),
                )?.selection.toJSON(),
            ).toEqual({
                type: "text",
                anchor: 6,
                head: 15,
            });
        }
    }
});

test("selection doesn't expand to link if some text is not formatted with link", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("foo", [schema.marks.link.create({url: "https://alpine.inc"})]),
            schema.text("bar", []),
            schema.text("qux", [schema.marks.link.create({url: "https://alpine.inc"})]),
        ]),
    ]);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2), doc.resolve(8)),
        )?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(2)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(8)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 7,
        head: 10,
    });
});

test("selection doesn't contract to link if some text in the middle is formatted with link", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("foo", []),
            schema.text("bar", [schema.marks.link.create({url: "https://alpine.inc"})]),
            schema.text("qux", []),
        ]),
    ]);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2), doc.resolve(8)),
        )?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(3)))?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(4)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 4,
        head: 7,
    });

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(5)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 4,
        head: 7,
    });

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(6)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 4,
        head: 7,
    });

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(7)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 4,
        head: 7,
    });

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(8)))?.selection.toJSON(),
    ).toEqual(undefined);
});

test("selection doesn't choose to expand to link when ambiguous", () => {
    const doc = schema.node("doc", {}, [
        schema.node("paragraph", {}, [
            schema.text("foo", [schema.marks.link.create({url: "https://alpine.inc/a"})]),
            schema.text("bar", [schema.marks.link.create({url: "https://alpine.inc/b"})]),
            schema.text("qux", [schema.marks.link.create({url: "https://alpine.inc/c"})]),
        ]),
    ]);

    expect(
        expandSelectionAroundLinkMark(
            doc,
            new TextSelection(doc.resolve(2), doc.resolve(8)),
        )?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(3)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 1,
        head: 4,
    });

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(4)))?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(5)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 4,
        head: 7,
    });

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(6)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 4,
        head: 7,
    });

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(7)))?.selection.toJSON(),
    ).toEqual(undefined);

    expect(
        expandSelectionAroundLinkMark(doc, new TextSelection(doc.resolve(8)))?.selection.toJSON(),
    ).toEqual({
        type: "text",
        anchor: 7,
        head: 10,
    });
});
