import {TextSelection} from "prosemirror-state";
import {expandEmptySelectionAroundWord} from "~/client/web/content/internal/helpers/expand_empty_selection_around_word.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;

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

test("doesn\u2019t expand selection around single letter word", () => {
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
