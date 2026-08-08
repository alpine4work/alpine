import {Mark, Node} from "prosemirror-model";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

/**
 * A helper for conveniently creating content nodes. Mostly used in tests.
 */
export function createContentBuilder(schema: ContentProsemirrorSchema) {
    const mark = (mark: Mark, node: Node | string) =>
        typeof node === "string" ? schema.text(node, [mark]) : node.mark(mark.addToSet(node.marks));

    return {
        doc: (...content: Array<Node>) => schema.nodes.doc.create(null, content),

        paragraph: (...content: Array<Node | string>) =>
            schema.nodes.paragraph.create(
                null,
                content.map(node => (typeof node === "string" ? schema.text(node) : node)),
            ),

        quoteBlock: (...content: Array<Node>) => schema.nodes.quoteBlock.create(null, content),

        codeBlock: (language: string, ...lines: Array<Node>) =>
            schema.nodes.codeBlock.create({language}, lines),

        codeBlockLine: (...content: Array<Node | string>) =>
            schema.nodes.codeBlockLine.create(
                null,
                content.map(node => (typeof node === "string" ? schema.text(node) : node)),
            ),

        unorderedListItem: (indent: number, ...content: Array<Node>) =>
            schema.nodes.unorderedListItem.create({indent}, content),

        orderedListItem: (
            attrs: number | {indent?: number; orderStart?: number | null},
            ...content: Array<Node>
        ) =>
            schema.nodes.orderedListItem.create(
                typeof attrs === "number" ? {indent: attrs} : attrs,
                content,
            ),

        checkListItem: (indent: number, checked: boolean, ...content: Array<Node>) =>
            assertExists(schema.nodes.checkListItem).create({indent, checked}, content),

        break: () => schema.nodes.break.create(null, null),

        mention: (mention: ContentMention) =>
            assertExists(schema.nodes.mention).create({mention}, null),

        table: (
            attrs: {
                tableWidth?: number;
                columnWidths: Array<number>;
                hasHeaderRow?: boolean;
                hasHeaderColumn?: boolean;
            },
            ...rows: Array<Node>
        ) => schema.nodes.table.create(attrs, rows),

        tableRow: (...cells: Array<Node>) => schema.nodes.tableRow.create(null, cells),

        tableCell: (...content: Array<Node>) => schema.nodes.tableCell.create(null, content),

        heading: (level: number, ...content: Array<Node | string>) =>
            schema.nodes.heading.create(
                {level},
                content.map(node => (typeof node === "string" ? schema.text(node) : node)),
            ),

        divider: () => schema.nodes.divider.create(),

        fileRow: (...content: Array<Node>) =>
            assertExists(schema.nodes.fileRow).create(null, content),

        file: (attrs: {fileId: string | null}) =>
            assertExists(schema.nodes.file).create(attrs, null),

        fileFloat: (attrs: {direction: string}, ...content: Array<Node>) =>
            assertExists(schema.nodes.fileFloat).create(attrs, content),

        fileRowTable: (...content: Array<Node>) =>
            assertExists(schema.nodes.fileRowTable).create(null, content),

        bold: (node: Node | string) => mark(schema.marks.bold.create(), node),

        italic: (node: Node | string) => mark(schema.marks.italic.create(), node),

        code: (node: Node | string) => mark(schema.marks.code.create(), node),

        link: (url: string, node: Node | string) => mark(schema.marks.link.create({url}), node),

        strike: (node: Node | string) => mark(schema.marks.strike.create(), node),

        highlight: (color: HighlightColor, node: Node | string) =>
            mark(assertExists(schema.marks.highlight).create({color}), node),

        comment: (commentThreadId: string, node: Node | string) =>
            mark(assertExists(schema.marks.comment).create({commentThreadId}), node),
    };
}
