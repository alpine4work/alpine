import {Mark, Node} from "prosemirror-model";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * A helper for conveniently creating content nodes. Mostly used in tests.
 */
export function createContentBuilder(schema: ContentProsemirrorSchema) {
    return {
        doc: (...content: Array<Node>) => schema.nodes.doc.create(null, content),

        paragraph: (...content: Array<Node>) => schema.nodes.paragraph.create(null, content),

        text: (string: string, marks?: Array<Mark>) => schema.text(string, marks),

        quoteBlock: (...content: Array<Node>) => schema.nodes.quoteBlock.create(null, content),

        codeBlock: (language: string, ...lines: Array<Node>) =>
            schema.nodes.codeBlock.create({language}, lines),

        codeBlockLine: (...content: Array<Node>) =>
            schema.nodes.codeBlockLine.create(null, content),

        unorderedListItem: (indent: number, ...content: Array<Node>) =>
            schema.nodes.unorderedListItem.create({indent}, content),

        orderedListItem: (indent: number, ...content: Array<Node>) =>
            schema.nodes.orderedListItem.create({indent}, content),

        checkListItem: (indent: number, checked: boolean, ...content: Array<Node>) =>
            assertExists(schema.nodes.checkListItem).create({indent, checked}, content),

        break: (marks?: Array<Mark>) => schema.nodes.break.create(null, null, marks),

        mention: (mention: ContentMention, marks?: Array<Mark>) =>
            assertExists(schema.nodes.mention).create({mention}, null, marks),

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

        heading: (level: number, ...content: Array<Node>) =>
            schema.nodes.heading.create({level}, content),

        divider: () => schema.nodes.divider.create(),

        fileRow: (...content: Array<Node>) =>
            assertExists(schema.nodes.fileRow).create(null, content),

        file: (attrs: {fileId: string | null}, marks?: ReadonlyArray<Mark>) =>
            assertExists(schema.nodes.file).create(attrs, null, marks),

        fileFloat: (attrs: {direction: string}, ...content: Array<Node>) =>
            assertExists(schema.nodes.fileFloat).create(attrs, content),

        fileRowTable: (...content: Array<Node>) =>
            assertExists(schema.nodes.fileRowTable).create(null, content),

        bold: () => schema.marks.bold.create(),

        italic: () => schema.marks.italic.create(),

        code: () => schema.marks.code.create(),

        link: (url: string) => schema.marks.link.create({url}),

        strike: () => schema.marks.strike.create(),

        highlight: (color: HighlightColor) => assertExists(schema.marks.highlight).create({color}),

        comment: (commentThreadId: string) =>
            assertExists(schema.marks.comment).create({commentThreadId}),
    };
}
