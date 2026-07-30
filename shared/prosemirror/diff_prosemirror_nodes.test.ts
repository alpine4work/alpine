// To update generated snapshots run:
//
// ```
// bazel run //shared/prosemirror:diff_prosemirror_nodes_test -- --updateSnapshot
// ```

import * as prettier from "prettier";
import * as babelPrettierPlugin from "prettier/plugins/babel";
import * as estreePrettierPlugin from "prettier/plugins/estree";
import {Fragment, Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {findSpans} from "unicode-default-word-boundary";
import {calebKnownAccountId, rachelKnownAccountId} from "~/shared/accounts/known_account_ids.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {
    DocumentContentProsemirrorSchema,
    DocumentWithoutTitleContentProsemirrorSchema,
} from "~/shared/documents/document_content_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {diff} from "~/shared/helpers/diff/diff.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, FileId} from "~/shared/id/types/id_types.js";
import {diffProsemirrorNodes} from "~/shared/prosemirror/diff_prosemirror_nodes.js";
import {ExhaustiveStep} from "~/shared/prosemirror/exhaustive_step.js";

const schema = DocumentWithoutTitleContentProsemirrorSchema;
const commentThreadId1 = assertId<DocumentCommentThreadId>("346p2absnbj88gcpmf048ff6r1");
const commentThreadId2 = assertId<DocumentCommentThreadId>("346p2absnbj88gcpmf048ff6r2");
const commentThreadId3 = assertId<DocumentCommentThreadId>("346p2absnbj88gcpmf048ff6r3");
const fileId1 = assertId<FileId>("11111111111111111111111111");

type Child = Node | string;
type Children = ReadonlyArray<Child>;

const doc = (...children: Children) => schema.nodes.doc.create({}, fragment(children));
const paragraph = (...children: Children) => schema.nodes.paragraph.create({}, fragment(children));
const quoteBlock = (...children: Children) =>
    schema.nodes.quoteBlock.create({}, fragment(children));
const codeBlock = (...children: Children) => schema.nodes.codeBlock.create({}, fragment(children));
const codeBlockLine = (...children: Children) =>
    schema.nodes.codeBlockLine.create({}, fragment(children));
const break_ = () => schema.nodes.break.create();
const divider = () => schema.nodes.divider.create();
const table = (...children: Children) => schema.nodes.table.create({}, fragment(children));
const tableRow = (...children: Children) => schema.nodes.tableRow.create({}, fragment(children));
const tableCell = (...children: Children) => schema.nodes.tableCell.create({}, fragment(children));
const fileFloat = (...children: Array<Node>) =>
    schema.nodes.fileFloat.create({direction: "left"}, Fragment.fromArray(children));
const fileRow = (...children: Array<Node>) =>
    schema.nodes.fileRow!.create({}, Fragment.fromArray(children));
const file = (fileId: FileId = fileId1) => schema.nodes.file!.create({fileId});
const mention = (mention: ContentMention) => schema.nodes.mention.create({mention});
const comment = (commentThreadId: DocumentCommentThreadId, child: Child) =>
    (child = node(child)).mark(
        schema.marks.comment.create({commentThreadId}).addToSet(child.marks),
    );
const bold = (child: Child) =>
    (child = node(child)).mark(schema.marks.bold.create().addToSet(child.marks));
const italic = (child: Child) =>
    (child = node(child)).mark(schema.marks.italic.create().addToSet(child.marks));
const highlight = (color: HighlightColor = HighlightColor.Orange, child: Child) =>
    (child = node(child)).mark(schema.marks.highlight.create({color}).addToSet(child.marks));

const unorderedListItem = (...children: [attrs: {indent?: number}, ...Children] | Children) =>
    children[0] && isObject(children[0]) && "indent" in children[0]
        ? schema.nodes.unorderedListItem.create(
              children[0] as any,
              fragment(children.slice(1) as any),
          )
        : schema.nodes.unorderedListItem.create(null, fragment(children as Children));

const orderedListItem = (...children: [attrs: {indent: number}, ...Children] | Children) =>
    children[0] && isObject(children[0]) && "indent" in children[0]
        ? schema.nodes.orderedListItem.create(
              children[0] as any,
              fragment(children.slice(1) as any),
          )
        : schema.nodes.orderedListItem.create(null, fragment(children as any));

const checkListItem = (
    ...children: [attrs: {indent?: number; checked?: boolean}, ...Children] | Children
) =>
    children[0] && isObject(children[0]) && "indent" in children[0]
        ? schema.nodes.checkListItem.create(children[0] as any, fragment(children.slice(1) as any))
        : schema.nodes.checkListItem.create(null, fragment(children as any));

const heading = (...children: [attrs: {level?: number}, ...Children] | Children) =>
    children[0] && isObject(children[0]) && "level" in children[0]
        ? schema.nodes.heading.create(children[0] as any, fragment(children.slice(1) as any))
        : schema.nodes.heading.create(null, fragment(children as Children));

const fragment = (children: Children | Child): Fragment =>
    !isReadonlyArray(children) ? fragment([children]) : Fragment.fromArray(children.map(node));

const node = (child: Child): Node => (typeof child === "string" ? schema.text(child) : child);

// The `schema` above (`DocumentWithoutTitleContentProsemirrorSchema`) has no
// `title` node, so these helpers use the full document schema to build documents
// with a `title`. An empty title is a `title` node with no text children (it can't
// hold an empty text node). Text nodes are schema-specific, so build them with
// `titleSchema` too.
const titleSchema = DocumentContentProsemirrorSchema;
const titleDoc = (...children: Array<Node>) =>
    titleSchema.nodes.doc.create({}, Fragment.fromArray(children));
const title = (text?: string) =>
    titleSchema.nodes.title.create({}, text ? titleSchema.text(text) : null);
const titleParagraph = (text?: string) =>
    titleSchema.nodes.paragraph.create({}, text ? titleSchema.text(text) : null);

const testCases: ReadonlyArray<{
    readonly only?: CommitBlocker;
    readonly skip?: CommitBlocker;
    readonly id: string;
    readonly old: Node;
    readonly new: Node;
}> = [
    {
        id: "001",
        old: doc(paragraph("hello world")),
        new: doc(paragraph("goodbye world")),
    },
    {
        id: "002",
        old: doc(paragraph("hello world")),
        new: doc(paragraph("hello moon")),
    },
    {
        id: "003",
        old: doc(paragraph("hello world")),
        new: doc(paragraph("hello"), paragraph("world")),
    },
    {
        id: "004",
        old: doc(paragraph("hello"), paragraph("world")),
        new: doc(paragraph("hello world")),
    },
    {
        id: "005",
        old: doc(paragraph("hello world")),
        new: doc(heading("hello world")),
    },
    {
        id: "006",
        old: doc(paragraph("hello world")),
        new: doc(paragraph("hello"), heading("world")),
    },
    {
        id: "007",
        old: doc(paragraph("hello good world")),
        new: doc(paragraph("hello"), heading("good world")),
    },
    {
        id: "008",
        old: doc(paragraph("hello a b c d e f world")),
        new: doc(paragraph("hello"), heading("a b c d e f world")),
    },
    {
        id: "009",
        old: doc(paragraph("hello world")),
        new: doc(heading("hello"), paragraph("world")),
    },
    {
        id: "010",
        old: doc(paragraph("hello world")),
        new: doc(paragraph("hello"), heading({level: 2}, "world")),
    },
    {
        id: "011",
        old: doc(paragraph("hello world")),
        new: doc(heading({level: 2}, "hello"), paragraph("world")),
    },
    {
        id: "012",
        old: doc(heading("hello world")),
        new: doc(heading("hello"), heading({level: 2}, "world")),
    },
    {
        id: "013",
        old: doc(heading("hello world")),
        new: doc(heading({level: 2}, "hello"), heading("world")),
    },
    {
        id: "014",
        old: doc(paragraph("foo hello world bar")),
        new: doc(paragraph("foo"), paragraph("hello world"), paragraph("bar")),
    },
    {
        id: "015",
        old: doc(paragraph("foo"), paragraph("hello world"), paragraph("bar")),
        new: doc(paragraph("foo hello world bar")),
    },
    {
        id: "016",
        old: doc(quoteBlock(paragraph("hello world"))),
        new: doc(quoteBlock(paragraph("hello")), quoteBlock(paragraph("world"))),
    },
    {
        id: "017",
        old: doc(quoteBlock(paragraph("hello")), quoteBlock(paragraph("world"))),
        new: doc(quoteBlock(paragraph("hello world"))),
    },
    {
        id: "018",
        old: doc(paragraph("hello world")),
        new: doc(quoteBlock(paragraph("hello world"))),
    },
    {
        id: "019",
        old: doc(paragraph("hello foo world")),
        new: doc(quoteBlock(paragraph("hello world"))),
    },
    {
        id: "020",
        old: doc(paragraph("hello world")),
        new: doc(quoteBlock(paragraph("hello foo world"))),
    },
    {
        id: "021",
        old: doc(paragraph("foo hello world")),
        new: doc(quoteBlock(paragraph("hello world"))),
    },
    {
        id: "022",
        old: doc(paragraph("hello world")),
        new: doc(quoteBlock(paragraph("foo hello world"))),
    },
    {
        id: "023",
        old: doc(paragraph("hello world foo")),
        new: doc(quoteBlock(paragraph("hello world"))),
    },
    {
        id: "024",
        old: doc(paragraph("hello world")),
        new: doc(quoteBlock(paragraph("hello world foo"))),
    },
    {
        id: "025",
        old: doc(paragraph("hello world")),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
    },
    {
        id: "026",
        old: doc(paragraph("hello world")),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello")), paragraph("world"))),
    },
    {
        id: "027",
        old: doc(paragraph("hello world")),
        new: doc(quoteBlock(paragraph("hello"), unorderedListItem(paragraph("world")))),
    },
    {
        id: "028",
        old: doc(paragraph("hello world")),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello"), paragraph("world")))),
    },
    {
        id: "029",
        old: doc(paragraph("hello world")),
        new: doc(paragraph("foo"), quoteBlock(paragraph("hello world")), paragraph("bar")),
    },
    {
        id: "030",
        old: doc(paragraph("hello world")),
        new: doc(paragraph("foo"), quoteBlock(paragraph("bar hello world"))),
    },
    {
        id: "031",
        old: doc(paragraph("hello world")),
        new: doc(quoteBlock(paragraph("hello world foo")), paragraph("bar")),
    },
    {
        id: "032",
        old: doc(paragraph("hello world")),
        new: doc(quoteBlock(paragraph("foo hello world bar"))),
    },
    {
        id: "033",
        old: doc(paragraph("foo hello world bar")),
        new: doc(quoteBlock(paragraph("hello world"))),
    },
    {
        id: "034",
        old: doc(paragraph("foo hello world bar")),
        new: doc(paragraph("foo"), quoteBlock(paragraph("hello world")), paragraph("bar")),
    },
    {
        id: "035",
        old: doc(quoteBlock(paragraph("hello world"))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "036",
        old: doc(quoteBlock(paragraph("hello foo world"))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "037",
        old: doc(quoteBlock(paragraph("hello world"))),
        new: doc(paragraph("hello foo world")),
    },
    {
        id: "038",
        old: doc(quoteBlock(paragraph("foo hello world"))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "039",
        old: doc(quoteBlock(paragraph("hello world"))),
        new: doc(paragraph("foo hello world")),
    },
    {
        id: "040",
        old: doc(quoteBlock(paragraph("hello world foo"))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "041",
        old: doc(quoteBlock(paragraph("hello world"))),
        new: doc(paragraph("hello world foo")),
    },
    {
        id: "042",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "043",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello")), paragraph("world"))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "044",
        old: doc(quoteBlock(paragraph("hello"), unorderedListItem(paragraph("world")))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "045",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello"), paragraph("world")))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "046",
        old: doc(
            quoteBlock(
                unorderedListItem(paragraph("hello")),
                unorderedListItem(paragraph("world")),
            ),
        ),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
    },
    {
        id: "047",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
        new: doc(
            quoteBlock(
                unorderedListItem(paragraph("hello")),
                unorderedListItem(paragraph("world")),
            ),
        ),
    },
    {
        id: "048",
        old: doc(quoteBlock(paragraph("hello"), unorderedListItem(paragraph("world")))),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
    },
    {
        id: "049",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
        new: doc(quoteBlock(paragraph("hello"), unorderedListItem(paragraph("world")))),
    },
    {
        id: "050",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello")), paragraph("world"))),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
    },
    {
        id: "051",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello")), paragraph("world"))),
    },
    {
        id: "052",
        old: doc(
            quoteBlock(unorderedListItem(paragraph("hello"))),
            quoteBlock(unorderedListItem(paragraph("world"))),
        ),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
    },
    {
        id: "053",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
        new: doc(
            quoteBlock(unorderedListItem(paragraph("hello"))),
            quoteBlock(unorderedListItem(paragraph("world"))),
        ),
    },
    {
        id: "054",
        old: doc(quoteBlock(paragraph("hello")), quoteBlock(unorderedListItem(paragraph("world")))),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
    },
    {
        id: "055",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
        new: doc(quoteBlock(paragraph("hello")), quoteBlock(unorderedListItem(paragraph("world")))),
    },
    {
        id: "056",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello"))), quoteBlock(paragraph("world"))),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
    },
    {
        id: "057",
        old: doc(quoteBlock(unorderedListItem(paragraph("hello world")))),
        new: doc(quoteBlock(unorderedListItem(paragraph("hello"))), quoteBlock(paragraph("world"))),
    },
    {
        id: "058",
        old: doc(paragraph("foo"), quoteBlock(paragraph("hello world")), paragraph("bar")),
        new: doc(paragraph("hello world")),
    },
    {
        id: "059",
        old: doc(quoteBlock(paragraph("foo hello world bar"))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "060",
        old: doc(paragraph("foo"), quoteBlock(paragraph("bar hello world"))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "061",
        old: doc(quoteBlock(paragraph("hello world foo"), paragraph("bar"))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "062",
        old: doc(quoteBlock(paragraph("hello world"))),
        new: doc(paragraph("foo hello world bar")),
    },
    {
        id: "063",
        old: doc(paragraph("foo"), quoteBlock(paragraph("hello world")), paragraph("bar")),
        new: doc(paragraph("foo hello world bar")),
    },
    {
        id: "064",
        old: doc(quoteBlock(paragraph("hello world"))),
        new: doc(paragraph("hello"), quoteBlock(paragraph("world"))),
    },
    {
        id: "065",
        old: doc(quoteBlock(paragraph("hello world"))),
        new: doc(quoteBlock(paragraph("hello")), paragraph("world")),
    },
    {
        id: "066",
        old: doc(quoteBlock(paragraph("hello good world"))),
        new: doc(quoteBlock(paragraph("hello good")), paragraph("world")),
    },
    {
        id: "067",
        old: doc(quoteBlock(paragraph("hello a b c d e f world"))),
        new: doc(quoteBlock(paragraph("hello a b c d e f")), paragraph("world")),
    },
    {
        id: "068",
        old: doc(quoteBlock(paragraph("hello good world"))),
        new: doc(quoteBlock(paragraph("hello")), paragraph("good world")),
    },
    {
        id: "069",
        old: doc(quoteBlock(paragraph("hello a b c d e f world"))),
        new: doc(quoteBlock(paragraph("hello")), paragraph("a b c d e f world")),
    },
    {
        id: "070",
        old: doc(paragraph("hello"), quoteBlock(paragraph("world"))),
        new: doc(quoteBlock(paragraph("hello world"))),
    },
    {
        id: "071",
        old: doc(paragraph("hello good"), quoteBlock(paragraph("world"))),
        new: doc(quoteBlock(paragraph("hello good world"))),
    },
    {
        id: "072",
        old: doc(paragraph("hello a b c d e f"), quoteBlock(paragraph("world"))),
        new: doc(quoteBlock(paragraph("hello a b c d e f world"))),
    },
    {
        id: "073",
        old: doc(paragraph("hello"), quoteBlock(paragraph("good world"))),
        new: doc(quoteBlock(paragraph("hello good world"))),
    },
    {
        id: "074",
        old: doc(paragraph("hello"), quoteBlock(paragraph("a b c d e f world"))),
        new: doc(quoteBlock(paragraph("hello a b c d e f world"))),
    },
    {
        id: "075",
        old: doc(quoteBlock(paragraph("hello")), paragraph("world")),
        new: doc(quoteBlock(paragraph("hello world"))),
    },
    {
        id: "076",
        old: doc(unorderedListItem(paragraph("hello world"))),
        new: doc(orderedListItem(paragraph("hello world"))),
    },
    {
        id: "077",
        old: doc(unorderedListItem(paragraph("hello world"))),
        new: doc(unorderedListItem({indent: 1}, paragraph("hello world"))),
    },
    {
        id: "078",
        old: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
        new: doc(paragraph("foo")),
    },
    {
        id: "079",
        old: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
        new: doc(paragraph("bar")),
    },
    {
        id: "080",
        old: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
        new: doc(paragraph("foo bar")),
    },
    {
        id: "081",
        old: doc(paragraph("foo")),
        new: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
    },
    {
        id: "082",
        old: doc(paragraph("bar")),
        new: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
    },
    {
        id: "083",
        old: doc(paragraph("foo bar")),
        new: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
    },
    {
        id: "084",
        old: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
        new: doc(codeBlock(codeBlockLine("foo bar"))),
    },
    {
        id: "085",
        old: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
        new: doc(codeBlock(codeBlockLine("foo bar"), codeBlockLine())),
    },
    {
        id: "086",
        old: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
        new: doc(codeBlock(codeBlockLine(), codeBlockLine("foo bar"))),
    },
    {
        id: "087",
        old: doc(codeBlock(codeBlockLine("foo bar"))),
        new: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
    },
    {
        id: "088",
        old: doc(codeBlock(codeBlockLine("foo bar"), codeBlockLine())),
        new: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
    },
    {
        id: "089",
        old: doc(codeBlock(codeBlockLine(), codeBlockLine("foo bar"))),
        new: doc(codeBlock(codeBlockLine("foo"), codeBlockLine("bar"))),
    },
    {
        id: "090",
        old: doc(table(tableRow(tableCell(paragraph("foo")), tableCell(paragraph("bar"))))),
        new: doc(paragraph("foo")),
    },
    {
        id: "091",
        old: doc(table(tableRow(tableCell(paragraph("foo")), tableCell(paragraph("bar"))))),
        new: doc(paragraph("bar")),
    },
    {
        id: "092",
        old: doc(table(tableRow(tableCell(paragraph("foo")), tableCell(paragraph("bar"))))),
        new: doc(paragraph("foo bar")),
    },
    {
        id: "093",
        old: doc(paragraph("foo")),
        new: doc(table(tableRow(tableCell(paragraph("foo")), tableCell(paragraph("bar"))))),
    },
    {
        id: "094",
        old: doc(paragraph("bar")),
        new: doc(table(tableRow(tableCell(paragraph("foo")), tableCell(paragraph("bar"))))),
    },
    {
        id: "095",
        old: doc(paragraph("foo bar")),
        new: doc(table(tableRow(tableCell(paragraph("foo")), tableCell(paragraph("bar"))))),
    },
    {
        id: "096",
        old: doc(table(tableRow(tableCell(paragraph("foo")), tableCell(paragraph("bar"))))),
        new: doc(table(tableRow(tableCell(paragraph("foo bar")), tableCell(paragraph())))),
    },
    {
        id: "097",
        old: doc(table(tableRow(tableCell(paragraph("foo")), tableCell(paragraph("bar"))))),
        new: doc(table(tableRow(tableCell(paragraph()), tableCell(paragraph("foo bar"))))),
    },
    {
        id: "098",
        old: doc(table(tableRow(tableCell(paragraph("foo bar")), tableCell(paragraph())))),
        new: doc(table(tableRow(tableCell(paragraph("foo")), tableCell(paragraph("bar"))))),
    },
    {
        id: "099",
        old: doc(table(tableRow(tableCell(paragraph()), tableCell(paragraph("foo bar"))))),
        new: doc(table(tableRow(tableCell(paragraph("foo")), tableCell(paragraph("bar"))))),
    },
    {
        id: "100",
        old: doc(
            table(
                tableRow(
                    tableCell(paragraph("the quick brown fox jumps over the lazy dog")),
                    tableCell(paragraph("lorem ipsum dolor sit amet consectetur adipiscing elit")),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(
                        paragraph(
                            "the quick brown fox jumps over the lazy dog lorem ipsum dolor sit amet consectetur adipiscing elit",
                        ),
                    ),
                    tableCell(paragraph()),
                ),
            ),
        ),
    },
    {
        id: "101",
        old: doc(
            table(
                tableRow(
                    tableCell(paragraph("the quick brown fox jumps over the lazy dog")),
                    tableCell(paragraph("lorem ipsum dolor sit amet consectetur adipiscing elit")),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(paragraph()),
                    tableCell(
                        paragraph(
                            "the quick brown fox jumps over the lazy dog lorem ipsum dolor sit amet consectetur adipiscing elit",
                        ),
                    ),
                ),
            ),
        ),
    },
    {
        id: "102",
        old: doc(
            table(
                tableRow(
                    tableCell(
                        paragraph(
                            "the quick brown fox jumps over the lazy dog lorem ipsum dolor sit amet consectetur adipiscing elit",
                        ),
                    ),
                    tableCell(paragraph()),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(paragraph("the quick brown fox jumps over the lazy dog")),
                    tableCell(paragraph("lorem ipsum dolor sit amet consectetur adipiscing elit")),
                ),
            ),
        ),
    },
    {
        id: "103",
        old: doc(
            table(
                tableRow(
                    tableCell(paragraph()),
                    tableCell(
                        paragraph(
                            "the quick brown fox jumps over the lazy dog lorem ipsum dolor sit amet consectetur adipiscing elit",
                        ),
                    ),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(paragraph("the quick brown fox jumps over the lazy dog")),
                    tableCell(paragraph("lorem ipsum dolor sit amet consectetur adipiscing elit")),
                ),
            ),
        ),
    },
    {
        id: "104",
        old: doc(
            table(
                tableRow(
                    tableCell(paragraph("the quick brown fox jumps over the lazy dog")),
                    tableCell(paragraph()),
                ),
                tableRow(
                    tableCell(paragraph("lorem ipsum dolor sit amet consectetur adipiscing elit")),
                    tableCell(paragraph()),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(
                        paragraph(
                            "the quick brown fox jumps over the lazy dog lorem ipsum dolor sit amet consectetur adipiscing elit",
                        ),
                    ),
                    tableCell(paragraph()),
                ),
            ),
        ),
    },
    {
        id: "105",
        old: doc(
            table(
                tableRow(
                    tableCell(
                        paragraph(
                            "the quick brown fox jumps over the lazy dog lorem ipsum dolor sit amet consectetur adipiscing elit",
                        ),
                    ),
                    tableCell(paragraph()),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(paragraph("the quick brown fox jumps over the lazy dog")),
                    tableCell(paragraph()),
                ),
                tableRow(
                    tableCell(paragraph("lorem ipsum dolor sit amet consectetur adipiscing elit")),
                    tableCell(paragraph()),
                ),
            ),
        ),
    },
    {
        id: "106",
        old: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
        new: doc(table(tableRow(tableCell(paragraph("foo hello world")), tableCell(paragraph())))),
    },
    {
        id: "107",
        old: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
        new: doc(table(tableRow(tableCell(paragraph("hello foo world")), tableCell(paragraph())))),
    },
    {
        id: "108",
        old: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
        new: doc(table(tableRow(tableCell(paragraph("hello world foo")), tableCell(paragraph())))),
    },
    {
        id: "109",
        old: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
        new: doc(
            table(
                tableRow(tableCell(paragraph("hello"), paragraph("world")), tableCell(paragraph())),
            ),
        ),
    },
    {
        id: "110",
        old: doc(
            table(
                tableRow(tableCell(quoteBlock(paragraph("hello world"))), tableCell(paragraph())),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(quoteBlock(paragraph("hello"), paragraph("world"))),
                    tableCell(paragraph()),
                ),
            ),
        ),
    },
    {
        id: "111",
        old: doc(
            table(
                tableRow(tableCell(quoteBlock(paragraph("hello world"))), tableCell(paragraph())),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(quoteBlock(paragraph("hello")), quoteBlock(paragraph("world"))),
                    tableCell(paragraph()),
                ),
            ),
        ),
    },
    {
        id: "112",
        old: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
        new: doc(
            table(
                tableRow(tableCell(quoteBlock(paragraph("hello world"))), tableCell(paragraph())),
            ),
        ),
    },
    {
        id: "113",
        old: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
        new: doc(
            table(
                tableRow(
                    tableCell(quoteBlock(unorderedListItem(paragraph("hello world")))),
                    tableCell(paragraph()),
                ),
            ),
        ),
    },
    {
        id: "114",
        old: doc(table(tableRow(tableCell(paragraph("foo hello world")), tableCell(paragraph())))),
        new: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
    },
    {
        id: "115",
        old: doc(table(tableRow(tableCell(paragraph("hello foo world")), tableCell(paragraph())))),
        new: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
    },
    {
        id: "116",
        old: doc(table(tableRow(tableCell(paragraph("hello world foo")), tableCell(paragraph())))),
        new: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
    },
    {
        id: "117",
        old: doc(
            table(
                tableRow(tableCell(paragraph("hello"), paragraph("world")), tableCell(paragraph())),
            ),
        ),
        new: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
    },
    {
        id: "118",
        old: doc(
            table(
                tableRow(
                    tableCell(quoteBlock(paragraph("hello"), paragraph("world"))),
                    tableCell(paragraph()),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(tableCell(quoteBlock(paragraph("hello world"))), tableCell(paragraph())),
            ),
        ),
    },
    {
        id: "119",
        old: doc(
            table(
                tableRow(
                    tableCell(quoteBlock(paragraph("hello")), quoteBlock(paragraph("world"))),
                    tableCell(paragraph()),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(tableCell(quoteBlock(paragraph("hello world"))), tableCell(paragraph())),
            ),
        ),
    },
    {
        id: "120",
        old: doc(
            table(
                tableRow(tableCell(quoteBlock(paragraph("hello world"))), tableCell(paragraph())),
            ),
        ),
        new: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
    },
    {
        id: "121",
        old: doc(
            table(
                tableRow(
                    tableCell(quoteBlock(unorderedListItem(paragraph("hello world")))),
                    tableCell(paragraph()),
                ),
            ),
        ),
        new: doc(table(tableRow(tableCell(paragraph("hello world")), tableCell(paragraph())))),
    },
    {
        id: "122",
        old: doc(
            unorderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            unorderedListItem(paragraph()),
        ),
        new: doc(unorderedListItem(paragraph("a"), paragraph("c"))),
    },
    {
        id: "123",
        old: doc(unorderedListItem(paragraph("a"), paragraph("c"))),
        new: doc(
            unorderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            unorderedListItem(paragraph()),
        ),
    },
    {
        id: "124",
        old: doc(
            unorderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            unorderedListItem(paragraph()),
        ),
        new: doc(orderedListItem(paragraph("a"), paragraph("c"))),
    },
    {
        id: "125",
        old: doc(orderedListItem(paragraph("a"), paragraph("c"))),
        new: doc(
            unorderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            unorderedListItem(paragraph()),
        ),
    },
    {
        id: "126",
        old: doc(
            orderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            unorderedListItem(paragraph()),
        ),
        new: doc(unorderedListItem(paragraph("a"), paragraph("c"))),
    },
    {
        id: "127",
        old: doc(unorderedListItem(paragraph("a"), paragraph("c"))),
        new: doc(
            orderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            unorderedListItem(paragraph()),
        ),
    },
    {
        id: "128",
        old: doc(
            unorderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            orderedListItem(paragraph()),
        ),
        new: doc(unorderedListItem(paragraph("a"), paragraph("c"))),
    },
    {
        id: "129",
        old: doc(unorderedListItem(paragraph("a"), paragraph("c"))),
        new: doc(
            unorderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            orderedListItem(paragraph()),
        ),
    },
    {
        id: "130",
        old: doc(
            orderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            unorderedListItem(paragraph()),
        ),
        new: doc(orderedListItem(paragraph("a"), paragraph("c"))),
    },
    {
        id: "131",
        old: doc(orderedListItem(paragraph("a"), paragraph("c"))),
        new: doc(
            orderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            unorderedListItem(paragraph()),
        ),
    },
    {
        id: "132",
        old: doc(
            unorderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            orderedListItem(paragraph()),
        ),
        new: doc(orderedListItem(paragraph("a"), paragraph("c"))),
    },
    {
        id: "133",
        old: doc(orderedListItem(paragraph("a"), paragraph("c"))),
        new: doc(
            unorderedListItem(paragraph("a"), paragraph()),
            paragraph("c"),
            orderedListItem(paragraph()),
        ),
    },
    {
        id: "134",
        old: doc(unorderedListItem(paragraph("a")), paragraph("c"), unorderedListItem(paragraph())),
        new: doc(unorderedListItem(paragraph("a"), paragraph("c"))),
    },
    {
        id: "135",
        old: doc(unorderedListItem(paragraph("a"), paragraph("c"))),
        new: doc(unorderedListItem(paragraph("a")), paragraph("c"), unorderedListItem(paragraph())),
    },
    {
        id: "136",
        old: doc(
            table(
                tableRow(
                    tableCell(unorderedListItem(paragraph("a"), paragraph("b")), paragraph("c")),
                    tableCell(paragraph()),
                ),
                tableRow(tableCell(unorderedListItem(paragraph())), tableCell(paragraph())),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(unorderedListItem(paragraph("a"), paragraph("c"))),
                    tableCell(paragraph()),
                ),
            ),
        ),
    },
    {
        id: "137",
        old: doc(
            table(
                tableRow(
                    tableCell(unorderedListItem(paragraph("a"), paragraph("c"))),
                    tableCell(paragraph()),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(unorderedListItem(paragraph("a"), paragraph("b")), paragraph("c")),
                    tableCell(paragraph()),
                ),
                tableRow(tableCell(unorderedListItem(paragraph())), tableCell(paragraph())),
            ),
        ),
    },
    {
        id: "138",
        old: doc(divider(), unorderedListItem(paragraph(), paragraph(" "))),
        new: doc(divider(), paragraph()),
    },
    {
        id: "139",
        old: doc(
            paragraph(" "),
            quoteBlock(
                paragraph(" "),
                unorderedListItem(paragraph("  "), paragraph(" "), paragraph("!  ")),
                paragraph(" "),
            ),
            paragraph(" "),
        ),
        new: doc(
            orderedListItem(paragraph(" "), paragraph("  "), paragraph(" ")),
            heading("  "),
            paragraph(" "),
        ),
    },
    {
        id: "140",
        old: doc(
            paragraph(" "),
            quoteBlock(
                paragraph(" "),
                orderedListItem(paragraph("*  "), paragraph(" ")),
                paragraph("& "),
                orderedListItem(paragraph(" "), paragraph("  "), paragraph(" ")),
            ),
            divider(),
            orderedListItem(paragraph(), paragraph(" ")),
        ),
        new: doc(heading("*&  !"), paragraph(break_())),
    },
    {
        id: "141",
        old: doc(
            paragraph(),
            orderedListItem(paragraph(" "), paragraph("# "), paragraph(" "), paragraph(" ")),
        ),
        new: doc(
            paragraph(" "),
            orderedListItem(paragraph(" "), paragraph("$")),
            unorderedListItem(paragraph("# "), paragraph(" ")),
            paragraph(),
        ),
    },
    {
        id: "142",
        old: doc(paragraph(" "), paragraph(break_(), " "), paragraph(" ")),
        new: doc(paragraph(" ")),
    },
    {
        id: "143",
        old: doc(
            paragraph(break_()),
            table(
                tableRow(
                    tableCell(paragraph(" ")),
                    tableCell(
                        unorderedListItem(paragraph(" "), paragraph(break_())),
                        paragraph(" "),
                    ),
                    tableCell(paragraph(" ")),
                ),
                tableRow(
                    tableCell(unorderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
                    tableCell(paragraph(), unorderedListItem(paragraph(), paragraph(" "))),
                ),
            ),
        ),
        new: doc(unorderedListItem(paragraph(" "), paragraph(" "))),
    },
    {
        id: "144",
        old: doc(
            paragraph(break_()),
            table(
                tableRow(
                    tableCell(paragraph(" ")),
                    tableCell(
                        unorderedListItem(paragraph(" "), paragraph(break_())),
                        paragraph(" "),
                    ),
                    tableCell(paragraph(" ")),
                ),
                tableRow(
                    tableCell(unorderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
                    tableCell(paragraph(), unorderedListItem(paragraph(), paragraph(" "))),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(unorderedListItem(paragraph(" "), paragraph(" "))),
                    tableCell(paragraph()),
                ),
            ),
        ),
    },
    {
        id: "145",
        old: doc(unorderedListItem(paragraph(" "), paragraph(" "))),
        new: doc(
            paragraph(break_()),
            table(
                tableRow(
                    tableCell(paragraph(" ")),
                    tableCell(
                        unorderedListItem(paragraph(" "), paragraph(break_())),
                        paragraph(" "),
                    ),
                    tableCell(paragraph(" ")),
                ),
                tableRow(
                    tableCell(unorderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
                    tableCell(paragraph(), unorderedListItem(paragraph(), paragraph(" "))),
                ),
            ),
        ),
    },
    {
        id: "146",
        old: doc(
            table(
                tableRow(
                    tableCell(unorderedListItem(paragraph(" "), paragraph(" "))),
                    tableCell(paragraph()),
                ),
            ),
        ),
        new: doc(
            paragraph(break_()),
            table(
                tableRow(
                    tableCell(paragraph(" ")),
                    tableCell(
                        unorderedListItem(paragraph(" "), paragraph(break_())),
                        paragraph(" "),
                    ),
                    tableCell(paragraph(" ")),
                ),
                tableRow(
                    tableCell(unorderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
                    tableCell(paragraph(), unorderedListItem(paragraph(), paragraph(" "))),
                ),
            ),
        ),
    },
    {
        id: "147",
        old: doc(
            orderedListItem(paragraph(" "), paragraph()),
            quoteBlock(paragraph(), paragraph(" ")),
        ),
        new: doc(
            codeBlock(codeBlockLine(" "), codeBlockLine(" ")),
            orderedListItem(paragraph(break_()), paragraph(" ")),
            paragraph(" "),
        ),
    },
    {
        id: "148",
        old: doc(unorderedListItem(paragraph(" "), paragraph(" ")), paragraph(break_())),
        new: doc(
            unorderedListItem(paragraph(" "), paragraph(" ")),
            unorderedListItem(paragraph(" "), paragraph()),
            paragraph(" "),
        ),
    },
    {
        id: "149",
        old: doc(paragraph("#", break_())),
        new: doc(unorderedListItem(paragraph(), paragraph("#  ")), paragraph(" ")),
    },
    {
        id: "150",
        old: doc(paragraph(" "), heading(" ")),
        new: doc(paragraph(" "), quoteBlock(paragraph(), paragraph(" ")), paragraph(" ")),
    },
    {
        id: "151",
        old: doc(paragraph(" "), paragraph("!")),
        new: doc(
            heading(" "),
            quoteBlock(
                orderedListItem(paragraph(" "), paragraph(" ")),
                orderedListItem(paragraph(" "), paragraph("!  "), paragraph(" ")),
            ),
            paragraph(" "),
        ),
    },
    {
        id: "152",
        old: doc(codeBlock(codeBlockLine(" "), codeBlockLine(" "))),
        new: doc(paragraph(break_(), " "), orderedListItem(paragraph(), paragraph(" "))),
    },
    {
        id: "153",
        old: doc(
            quoteBlock(paragraph(" "), unorderedListItem(paragraph(" "))),
            codeBlock(codeBlockLine("x")),
        ),
        new: doc(unorderedListItem(paragraph("x"), paragraph("x"), paragraph("x"))),
    },
    {
        id: "154",
        old: doc(unorderedListItem(paragraph(" "), paragraph(" ")), paragraph(break_())),
        new: doc(
            orderedListItem(paragraph(" "), paragraph(" ")),
            unorderedListItem(
                paragraph(" "),
                paragraph(" "),
                paragraph(break_(), " "),
                paragraph(" "),
            ),
        ),
    },
    {
        id: "155",
        old: doc(paragraph(" "), paragraph("!")),
        new: doc(paragraph(" "), paragraph(" "), paragraph(), paragraph("!  ")),
    },
    {
        id: "156",
        old: doc(paragraph(" "), paragraph(" ")),
        new: doc(
            paragraph(" "),
            paragraph("!"),
            unorderedListItem(paragraph(" "), paragraph(" ")),
            paragraph(" !"),
        ),
    },
    {
        id: "157",
        old: doc(orderedListItem(paragraph(), paragraph(" "), paragraph("A ")), divider()),
        new: doc(
            quoteBlock(paragraph(" "), unorderedListItem(paragraph(), paragraph(" "))),
            orderedListItem(paragraph("!"), paragraph(" ")),
            paragraph(" "),
        ),
    },
    {
        id: "158",
        old: doc(paragraph(" "), paragraph("E")),
        new: doc(paragraph(" "), paragraph(" "), divider(), paragraph("E  "), paragraph(" ")),
    },
    {
        id: "159",
        old: doc(unorderedListItem(paragraph("A "), paragraph("! "), paragraph())),
        new: doc(
            paragraph(" "),
            unorderedListItem(paragraph("!"), paragraph(" ")),
            unorderedListItem(paragraph(" ")),
        ),
    },
    {
        id: "160",
        old: doc(paragraph("0 ")),
        new: doc(orderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
    },
    {
        id: "161",
        old: doc(paragraph(" "), paragraph("< 0 "), paragraph()),
        new: doc(
            orderedListItem(paragraph(" "), paragraph(" ")),
            paragraph("<0 ", break_()),
            orderedListItem(paragraph(" "), paragraph(" ")),
        ),
    },
    {
        id: "162",
        old: doc(unorderedListItem(paragraph(" "), paragraph(" ")), paragraph("A ")),
        new: doc(
            paragraph(break_()),
            unorderedListItem(paragraph(" "), paragraph(" ")),
            unorderedListItem(paragraph(" "), paragraph("!")),
            paragraph(" !"),
        ),
    },
    {
        id: "163",
        old: doc(unorderedListItem(paragraph(" "), paragraph("0"))),
        new: doc(
            paragraph(" "),
            quoteBlock(
                orderedListItem(paragraph(" "), paragraph(" ")),
                unorderedListItem(paragraph(), paragraph(" ")),
            ),
            unorderedListItem(paragraph(" "), paragraph(" ")),
            orderedListItem(paragraph(" "), paragraph(" ")),
        ),
    },
    {
        id: "164",
        old: doc(
            paragraph(" "),
            unorderedListItem(paragraph(" "), paragraph("2"), paragraph(" ")),
            orderedListItem(paragraph(" "), paragraph(" ")),
        ),
        new: doc(
            unorderedListItem(paragraph(" "), paragraph(" ")),
            paragraph("2", break_()),
            unorderedListItem(paragraph(), paragraph()),
        ),
    },
    {
        id: "165",
        old: doc(
            paragraph(),
            quoteBlock(
                paragraph(" "),
                orderedListItem(paragraph(), paragraph(" ")),
                paragraph(" "),
            ),
            paragraph(),
        ),
        new: doc(
            quoteBlock(unorderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
            orderedListItem(paragraph(), paragraph()),
        ),
    },
    {
        id: "166",
        old: doc(
            paragraph(" "),
            unorderedListItem(paragraph(" "), paragraph(" ", break_(), " "), paragraph()),
        ),
        new: doc(paragraph(" "), paragraph(" "), paragraph(break_(), " ")),
    },
    {
        id: "167",
        old: doc(
            paragraph(" "),
            quoteBlock(
                orderedListItem(paragraph(), paragraph(" ")),
                orderedListItem(paragraph(" "), paragraph(" ")),
                paragraph(" "),
            ),
            paragraph(" "),
        ),
        new: doc(
            unorderedListItem(paragraph(), paragraph(" ")),
            orderedListItem(paragraph(" "), paragraph(" ")),
        ),
    },
    {
        id: "168",
        old: doc(
            paragraph(" "),
            quoteBlock(orderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
        ),
        new: doc(
            paragraph(" "),
            quoteBlock(
                orderedListItem(paragraph(" "), paragraph("!")),
                unorderedListItem(paragraph(" "), paragraph(" ")),
                orderedListItem(paragraph(" "), paragraph(" ")),
                orderedListItem(paragraph(" "), paragraph(" ")),
            ),
        ),
    },
    {
        id: "169",
        old: doc(
            orderedListItem(paragraph(" "), paragraph(" ")),
            quoteBlock(
                paragraph(" "),
                paragraph(" "),
                paragraph(" "),
                unorderedListItem(paragraph(break_(), " "), paragraph(" ")),
                paragraph(" "),
            ),
        ),
        new: doc(paragraph(" ! ! !"), paragraph(break_())),
    },
    {
        id: "170",
        old: doc(paragraph(" "), paragraph("P "), orderedListItem(paragraph(" "), paragraph())),
        new: doc(
            paragraph(" "),
            quoteBlock(paragraph(" "), paragraph("P "), paragraph(" ")),
            codeBlock(codeBlockLine(" "), codeBlockLine(" ")),
            paragraph(" "),
            orderedListItem(paragraph(" "), paragraph(" ")),
        ),
    },
    {
        id: "171",
        old: doc(
            paragraph(" "),
            quoteBlock(
                paragraph(" "),
                orderedListItem(paragraph(" "), paragraph(break_(), " "), paragraph(" ")),
            ),
            orderedListItem(paragraph(" "), paragraph(" ")),
        ),
        new: doc(
            paragraph(" "),
            paragraph(break_(), " "),
            codeBlock(codeBlockLine(" "), codeBlockLine(" ")),
        ),
    },
    {
        id: "172",
        old: doc(paragraph(" "), orderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
        new: doc(
            paragraph(" "),
            quoteBlock(
                paragraph(" "),
                orderedListItem(paragraph(" "), paragraph(" ")),
                paragraph(" "),
            ),
            paragraph(" "),
            divider(),
        ),
    },
    {
        id: "173",
        old: doc(
            quoteBlock(
                unorderedListItem(paragraph(" "), paragraph(break_(), " ")),
                paragraph(break_(), " "),
            ),
            paragraph(" "),
        ),
        new: doc(
            paragraph(" "),
            orderedListItem(
                paragraph(),
                paragraph(break_(), " "),
                paragraph(break_()),
                paragraph(" "),
            ),
            paragraph(" "),
        ),
    },
    {
        id: "174",
        old: doc(paragraph("6 "), paragraph(break_()), paragraph(" ")),
        new: doc(orderedListItem(paragraph("6"), paragraph(break_(), " "), paragraph(" "))),
    },
    {
        id: "175",
        old: doc(
            paragraph(" "),
            unorderedListItem(paragraph(" "), paragraph("$"), paragraph("# ) ")),
        ),
        new: doc(
            unorderedListItem(paragraph(" "), paragraph("#! "), paragraph(")  "), paragraph(" ")),
            codeBlock(codeBlockLine(" ")),
        ),
    },
    {
        id: "176",
        old: doc(
            codeBlock(codeBlockLine(" ")),
            paragraph(" "),
            paragraph(),
            orderedListItem(paragraph(" G "), paragraph(" ")),
        ),
        new: doc(
            unorderedListItem(paragraph(" "), paragraph(" ")),
            paragraph(" "),
            paragraph(" "),
            divider(),
            paragraph("G  "),
            unorderedListItem(paragraph(" "), paragraph(" ")),
        ),
    },
    {
        id: "177",
        old: doc(
            paragraph(" "),
            orderedListItem(paragraph(" "), paragraph("| ")),
            paragraph(" "),
            paragraph("|  "),
        ),
        new: doc(
            orderedListItem(paragraph(" "), paragraph(" ")),
            orderedListItem(paragraph(" "), paragraph("|!!"), paragraph(" "), paragraph()),
            paragraph("|!!"),
        ),
    },
    {
        id: "178",
        old: doc(codeBlock(codeBlockLine(" ")), paragraph("C"), paragraph(" ")),
        new: doc(
            unorderedListItem(paragraph(" "), paragraph(" ")),
            orderedListItem(paragraph("C  "), paragraph("!")),
        ),
    },
    {
        id: "179",
        old: doc(
            quoteBlock(
                paragraph(" "),
                orderedListItem(paragraph(), paragraph(" ")),
                paragraph(" "),
            ),
            codeBlock(codeBlockLine(" "), codeBlockLine(" ")),
        ),
        new: doc(
            orderedListItem(paragraph(" "), paragraph("!")),
            orderedListItem(paragraph(" "), paragraph(" ")),
            paragraph(" "),
        ),
    },
    {
        id: "180",
        old: doc(
            paragraph(),
            table(
                tableRow(
                    tableCell(paragraph(" "), orderedListItem(paragraph(" "), paragraph(" "))),
                    tableCell(paragraph(" "), paragraph(" ")),
                    tableCell(paragraph(" "), unorderedListItem(paragraph(" "), paragraph(" "))),
                ),
                tableRow(
                    tableCell(orderedListItem(paragraph(), paragraph(" ")), paragraph(" ")),
                    tableCell(paragraph(" ")),
                    tableCell(
                        paragraph(" "),
                        quoteBlock(
                            paragraph(" "),
                            unorderedListItem(paragraph(" "), paragraph(break_())),
                            paragraph(" "),
                        ),
                        paragraph(" "),
                    ),
                    tableCell(paragraph(" "), paragraph(" ")),
                ),
            ),
            paragraph(" "),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(paragraph(" "), paragraph(" ")),
                    tableCell(unorderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
                ),
            ),
        ),
    },
    {
        id: "181",
        old: doc(
            table(
                tableRow(
                    tableCell(paragraph(" "), quoteBlock(paragraph(" "), paragraph(" "))),
                    tableCell(paragraph(" ")),
                    tableCell(paragraph(), paragraph(" ")),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(unorderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
                    tableCell(
                        quoteBlock(
                            unorderedListItem(paragraph(" "), paragraph(" ")),
                            paragraph(" "),
                        ),
                        paragraph(" "),
                    ),
                    tableCell(paragraph(" "), codeBlock(codeBlockLine(" "))),
                ),
            ),
        ),
    },
    {
        id: "182",
        old: doc(heading(" "), orderedListItem(paragraph(" "), paragraph("| ")), paragraph(" ")),
        new: doc(
            quoteBlock(
                paragraph(" "),
                unorderedListItem(paragraph(" "), paragraph(" ")),
                unorderedListItem(paragraph(" "), paragraph("|!!")),
            ),
            paragraph(" !"),
            orderedListItem(paragraph(" "), paragraph("!")),
            paragraph(" !"),
        ),
    },
    {
        id: "183",
        old: doc(unorderedListItem(paragraph(" "), paragraph(" "))),
        new: doc(
            paragraph(" "),
            table(
                tableRow(
                    tableCell(paragraph(" "), paragraph(" ")),
                    tableCell(paragraph(), paragraph(" ")),
                    tableCell(paragraph(" "), paragraph(" ")),
                ),
                tableRow(
                    tableCell(orderedListItem(paragraph(" "))),
                    tableCell(orderedListItem(paragraph(" "), paragraph(" ")), paragraph(" ")),
                    tableCell(paragraph()),
                ),
            ),
            quoteBlock(
                orderedListItem(paragraph(" "), paragraph(" ")),
                orderedListItem(paragraph(" "), paragraph(" ")),
            ),
        ),
    },
    {
        id: "184",
        old: doc(
            unorderedListItem(paragraph(" "), paragraph(" ")),
            unorderedListItem(paragraph(break_()), paragraph(" ")),
        ),
        new: doc(
            paragraph(" "),
            quoteBlock(
                paragraph(break_()),
                unorderedListItem(paragraph(), paragraph(" ")),
                unorderedListItem(paragraph(" "), paragraph()),
            ),
        ),
    },
    {
        id: "185",
        old: doc(
            quoteBlock(
                paragraph(" "),
                unorderedListItem(paragraph(" "), paragraph()),
                paragraph(" "),
            ),
            paragraph(break_()),
        ),
        new: doc(
            unorderedListItem(paragraph(" "), paragraph(" ")),
            unorderedListItem(paragraph(" "), paragraph(break_())),
            paragraph(" "),
        ),
    },
    {
        id: "186",
        old: doc(
            paragraph("#"),
            paragraph("<!", break_()),
            paragraph(" "),
            table(
                tableRow(
                    tableCell(orderedListItem(paragraph("a")), paragraph("b")),
                    tableCell(paragraph("x")),
                ),
            ),
            paragraph("tail"),
            paragraph("more"),
            paragraph("end"),
        ),
        new: doc(
            orderedListItem(paragraph("#"), paragraph("<!", break_()), paragraph(" ")),
            paragraph("tail"),
            unorderedListItem(paragraph("more"), paragraph("end")),
        ),
    },
    {
        id: "187",
        old: doc(
            quoteBlock(
                paragraph("4"),
                orderedListItem(paragraph("y a"), paragraph("r")),
                orderedListItem(paragraph("f"), paragraph("g")),
            ),
            paragraph("w"),
        ),
        new: doc(orderedListItem(paragraph("f"), paragraph("c 7"), paragraph("5"), paragraph("o"))),
    },
    {
        id: "188",
        old: doc(
            orderedListItem(paragraph("d"), paragraph("a")),
            quoteBlock(
                paragraph("o"),
                paragraph("s"),
                paragraph("a"),
                orderedListItem(paragraph("m"), paragraph("e")),
                paragraph("z"),
            ),
        ),
        new: doc(
            heading("v"),
            quoteBlock(unorderedListItem(paragraph("x"), paragraph("g")), paragraph("1")),
            paragraph(),
            unorderedListItem(paragraph("m f"), paragraph("0")),
        ),
    },
    {
        id: "189",
        old: doc(
            paragraph(),
            quoteBlock(
                paragraph("m"),
                paragraph("n"),
                unorderedListItem(paragraph("5"), paragraph("g")),
                paragraph("f"),
                unorderedListItem(paragraph("2"), paragraph("0")),
            ),
            paragraph("o"),
        ),
        new: doc(
            paragraph("7"),
            orderedListItem(paragraph("v"), paragraph("5 f 8"), paragraph("g"), paragraph("t")),
            paragraph("6"),
        ),
    },
    {
        id: "190",
        old: doc(
            table(
                tableRow(tableCell(paragraph()), tableCell(paragraph())),
                tableRow(tableCell(paragraph("1"), paragraph()), tableCell(paragraph("a"))),
            ),
        ),
        new: doc(
            table(
                tableRow(
                    tableCell(orderedListItem(paragraph(), paragraph())),
                    tableCell(paragraph()),
                ),
                tableRow(tableCell(paragraph("2")), tableCell(paragraph("b"))),
            ),
        ),
    },
    {
        id: "191",
        old: doc(
            table(
                tableRow(tableCell(paragraph("t")), tableCell(paragraph())),
                tableRow(
                    tableCell(paragraph("i"), unorderedListItem(paragraph(), paragraph("n"))),
                    tableCell(paragraph("4")),
                ),
            ),
        ),
        new: doc(
            table(
                tableRow(tableCell(orderedListItem(paragraph("5"))), tableCell(paragraph())),
                tableRow(
                    tableCell(paragraph("1")),
                    tableCell(
                        orderedListItem(paragraph("c"), paragraph("e")),
                        orderedListItem(paragraph("1"), paragraph("t")),
                    ),
                ),
            ),
        ),
    },
    {
        id: "192",
        old: doc(
            paragraph("g"),
            unorderedListItem(
                {indent: 1},
                paragraph(
                    mention({type: "Account", accountId: calebKnownAccountId, isShort: true}),
                ),
                paragraph("h"),
            ),
            paragraph("i"),
        ),
        new: doc(
            paragraph(),
            unorderedListItem(
                {indent: 1},
                paragraph(
                    mention({type: "Account", accountId: rachelKnownAccountId, isShort: true}),
                    "q",
                ),
                paragraph("e"),
            ),
        ),
    },
    {
        id: "193",
        old: doc(paragraph("hello world")),
        new: doc(paragraph("hello ", bold("world"))),
    },
    {
        id: "194",
        old: doc(paragraph("hello world")),
        new: doc(paragraph(bold("hello"), " world")),
    },
    {
        id: "195",
        old: doc(paragraph("hello ", bold("world"))),
        new: doc(paragraph("hello world")),
    },
    {
        id: "196",
        old: doc(paragraph(bold("hello"), " world")),
        new: doc(paragraph("hello world")),
    },
    {
        id: "197",
        old: doc(paragraph("hello ", bold("world"))),
        new: doc(paragraph("hello ", italic("world"))),
    },
    {
        id: "198",
        old: doc(paragraph(bold("hello"), " world")),
        new: doc(paragraph(italic("hello"), " world")),
    },
    {
        id: "199",
        old: doc(paragraph("hello ", bold(italic("world")))),
        new: doc(paragraph("hello ", italic("world"))),
    },
    {
        id: "200",
        old: doc(paragraph(bold(italic("hello")), " world")),
        new: doc(paragraph(italic("hello"), " world")),
    },
    {
        id: "201",
        old: doc(paragraph("hello ", bold("world"))),
        new: doc(paragraph("hello ", bold(italic("world")))),
    },
    {
        id: "202",
        old: doc(paragraph(bold("hello"), " world")),
        new: doc(paragraph(bold(italic("hello")), " world")),
    },
    {
        id: "203",
        old: doc(paragraph(bold("hello"), " world")),
        new: doc(paragraph("hello ", italic("world"))),
    },
    {
        id: "204",
        old: doc(paragraph("hello ", bold("world"))),
        new: doc(paragraph(italic("hello"), " world")),
    },
    {
        id: "205",
        old: doc(paragraph("hello ", highlight(HighlightColor.Blue, "world"))),
        new: doc(paragraph("hello ", highlight(HighlightColor.Red, "world"))),
    },
    {
        id: "206",
        old: doc(paragraph(highlight(HighlightColor.Blue, "hello"), " world")),
        new: doc(paragraph(highlight(HighlightColor.Red, "hello"), " world")),
    },
    {
        id: "207",
        old: doc(paragraph("hello good world")),
        new: doc(paragraph("hello ", bold("good world"))),
    },
    {
        id: "208",
        old: doc(paragraph("hello good world")),
        new: doc(paragraph(bold("hello good"), " world")),
    },
    {
        id: "209",
        old: doc(paragraph("hello ", bold("good world"))),
        new: doc(paragraph("hello good world")),
    },
    {
        id: "210",
        old: doc(paragraph(bold("hello good"), " world")),
        new: doc(paragraph("hello good world")),
    },
    {
        id: "211",
        old: doc(paragraph(bold("a b c "), italic("d e f"))),
        new: doc(paragraph(bold("a b c d "), italic("e f"))),
    },
    {
        id: "212",
        old: doc(paragraph(bold("a b c d "), italic("e f"))),
        new: doc(paragraph(bold("a b c "), italic("d e f"))),
    },
    {
        id: "213",
        old: doc(
            paragraph(
                mention({type: "Account", accountId: calebKnownAccountId, isShort: true}),
                " hello",
            ),
        ),
        new: doc(
            paragraph(
                comment(
                    commentThreadId1,
                    mention({type: "Account", accountId: calebKnownAccountId, isShort: true}),
                ),
                " hello",
            ),
        ),
    },
    {
        id: "214",
        old: doc(
            paragraph(
                comment(
                    commentThreadId1,
                    mention({type: "Account", accountId: calebKnownAccountId, isShort: true}),
                ),
                " hello",
            ),
        ),
        new: doc(
            paragraph(
                comment(
                    commentThreadId2,
                    mention({type: "Account", accountId: calebKnownAccountId, isShort: true}),
                ),
                " hello",
            ),
        ),
    },
    {
        id: "215",
        old: doc(fileRow(file())),
        new: doc(fileRow(comment(commentThreadId1, file()))),
    },
    {
        id: "216",
        old: doc(fileRow(comment(commentThreadId1, file()))),
        new: doc(fileRow(comment(commentThreadId2, file()))),
    },
    {
        id: "217",
        old: doc(
            paragraph(
                "w",
                mention({type: "Account", accountId: calebKnownAccountId, isShort: true}),
                "x e",
            ),
        ),
        new: doc(
            paragraph(
                "c",
                bold(mention({type: "Account", accountId: calebKnownAccountId, isShort: true})),
                "z 9",
            ),
        ),
    },
    {
        id: "218",
        old: doc(
            paragraph(
                italic(mention({type: "Account", accountId: calebKnownAccountId, isShort: true})),
                "2",
            ),
        ),
        new: doc(
            paragraph(
                "k",
                mention({type: "Account", accountId: calebKnownAccountId, isShort: true}),
                "g",
            ),
        ),
    },
    {
        id: "219",
        old: doc(fileRow(comment(commentThreadId2, file()))),
        new: doc(fileRow(comment(commentThreadId2, comment(commentThreadId1, file())))),
    },
    {
        id: "220",
        old: doc(fileRow(comment(commentThreadId2, file()))),
        new: doc(fileRow(comment(commentThreadId1, comment(commentThreadId2, file())))),
    },
    {
        id: "221",
        old: doc(
            paragraph(
                "a b ",
                mention({type: "Account", accountId: calebKnownAccountId, isShort: true}),
                " c d",
            ),
        ),
        new: doc(
            paragraph(
                "a ",
                bold("b "),
                bold(mention({type: "Account", accountId: calebKnownAccountId, isShort: true})),
                bold(" c"),
                " d",
            ),
        ),
    },
    {
        id: "222",
        old: doc(
            paragraph(
                "a ",
                bold("b "),
                bold(mention({type: "Account", accountId: calebKnownAccountId, isShort: true})),
                bold(" c"),
                " d",
            ),
        ),
        new: doc(
            paragraph(
                "a b ",
                mention({type: "Account", accountId: calebKnownAccountId, isShort: true}),
                " c d",
            ),
        ),
    },
    {
        id: "223",
        old: doc(paragraph("hello ", bold("world"))),
        new: doc(paragraph("hello ", italic(bold("world")))),
    },
    {
        id: "224",
        old: doc(paragraph(bold("hello"), " world")),
        new: doc(paragraph(italic(bold("hello")), " world")),
    },
    {
        id: "225",
        old: doc(paragraph(comment(commentThreadId2, "foo bar"))),
        new: doc(paragraph(comment(commentThreadId2, comment(commentThreadId1, "foo bar")))),
    },
    {
        id: "226",
        old: doc(paragraph(comment(commentThreadId2, "foo bar"))),
        new: doc(paragraph(comment(commentThreadId1, comment(commentThreadId2, "foo bar")))),
    },
    {
        id: "227",
        old: doc(fileRow(comment(commentThreadId1, file()))),
        new: doc(
            fileRow(
                comment(
                    commentThreadId1,
                    comment(commentThreadId2, comment(commentThreadId3, file())),
                ),
            ),
        ),
    },
    {
        id: "228",
        old: doc(fileRow(comment(commentThreadId1, file()))),
        new: doc(
            fileRow(
                comment(
                    commentThreadId2,
                    comment(commentThreadId1, comment(commentThreadId3, file())),
                ),
            ),
        ),
    },
    {
        id: "229",
        old: doc(fileRow(comment(commentThreadId1, file()))),
        new: doc(
            fileRow(
                comment(
                    commentThreadId2,
                    comment(commentThreadId3, comment(commentThreadId1, file())),
                ),
            ),
        ),
    },
    {
        id: "230",
        old: doc(fileRow(comment(commentThreadId1, file()))),
        new: doc(
            fileRow(
                comment(
                    commentThreadId1,
                    comment(commentThreadId3, comment(commentThreadId2, file())),
                ),
            ),
        ),
    },
    {
        id: "231",
        old: doc(fileRow(comment(commentThreadId1, file()))),
        new: doc(
            fileRow(
                comment(
                    commentThreadId3,
                    comment(commentThreadId1, comment(commentThreadId2, file())),
                ),
            ),
        ),
    },
    {
        id: "232",
        old: doc(fileRow(comment(commentThreadId1, file()))),
        new: doc(
            fileRow(
                comment(
                    commentThreadId3,
                    comment(commentThreadId2, comment(commentThreadId1, file())),
                ),
            ),
        ),
    },
    {
        id: "233",
        old: doc(
            quoteBlock(
                orderedListItem({indent: 1}, paragraph(break_()), paragraph("k")),
                paragraph(),
                orderedListItem({indent: 1}, paragraph("4"), paragraph("8")),
            ),
        ),
        new: doc(
            unorderedListItem({indent: 1}, paragraph("8"), paragraph("w")),
            orderedListItem({indent: 1}, paragraph("9"), paragraph("o")),
        ),
    },
    {
        id: "234",
        old: doc(paragraph("4"), paragraph(break_())),
        new: doc(
            paragraph("u", break_(), break_()),
            paragraph(
                mention({type: "Account", accountId: calebKnownAccountId, isShort: true}),
                "r",
            ),
        ),
    },
    {
        id: "235",
        old: doc(
            paragraph(
                italic(mention({type: "Account", accountId: calebKnownAccountId, isShort: true})),
                "r",
            ),
            paragraph("o"),
        ),
        new: doc(orderedListItem({indent: 1}, paragraph()), paragraph("a")),
    },
    {
        id: "236",
        old: doc(paragraph("1")),
        new: doc(paragraph(), checkListItem({indent: 1}, paragraph("w"))),
    },
    {
        id: "237",
        old: doc(paragraph("2 m")),
        new: doc(paragraph(), orderedListItem({indent: 1}, paragraph("y"))),
    },
    {
        id: "238",
        old: doc(paragraph("1 d")),
        new: doc(paragraph(), quoteBlock(paragraph("f"))),
    },
    {
        id: "239",
        old: doc(
            unorderedListItem({indent: 1}, paragraph(break_()), paragraph("z")),
            paragraph("3"),
        ),
        new: doc(quoteBlock(checkListItem({indent: 1}, paragraph("h"))), heading("h")),
    },
    {
        id: "240",
        old: doc(
            unorderedListItem(
                {indent: 1},
                paragraph("y"),
                paragraph("8"),
                paragraph("n 6 m o p", break_(), "u w i"),
            ),
        ),
        new: doc(
            unorderedListItem(
                {indent: 1},
                paragraph("4"),
                paragraph("r"),
                paragraph("4 5 n d s", break_()),
                paragraph("y 5 p i e 3"),
            ),
            paragraph("l"),
        ),
    },
    {
        id: "241",
        old: doc(divider(), paragraph("h"), orderedListItem({indent: 1}, paragraph("7"))),
        new: doc(paragraph("0"), paragraph("y")),
    },
    {
        id: "242",
        old: doc(
            paragraph("k"),
            orderedListItem({indent: 1}, paragraph("6"), paragraph("7")),
            paragraph("g"),
        ),
        new: doc(
            orderedListItem({indent: 1}, paragraph("a")),
            orderedListItem({indent: 1}, paragraph("o 6"), paragraph("r")),
        ),
    },
    {
        id: "243",
        old: doc(
            quoteBlock(
                unorderedListItem({indent: 1}, paragraph("1"), paragraph("j")),
                paragraph("0"),
            ),
            paragraph("t"),
            unorderedListItem({indent: 1}, paragraph("v")),
            heading("6"),
            unorderedListItem({indent: 1}, paragraph("h"), paragraph("d")),
        ),
        new: doc(paragraph("b"), checkListItem({indent: 1}, paragraph("1"))),
    },
    {
        id: "244",
        old: doc(codeBlock(codeBlockLine("8"))),
        new: doc(fileRow(file()), heading()),
    },
    {
        id: "245",
        old: doc(fileFloat(file()), paragraph("m")),
        new: doc(paragraph("5")),
    },
    {
        id: "246",
        old: doc(paragraph("m")),
        new: doc(codeBlock(codeBlockLine("f"))),
    },
    {
        id: "247",
        old: doc(paragraph(), paragraph()),
        new: doc(unorderedListItem({indent: 1}, paragraph("7"))),
    },
    {
        id: "248",
        old: doc(codeBlock(codeBlockLine("j"))),
        new: doc(paragraph("r")),
    },
    {
        id: "249",
        old: doc(
            orderedListItem({indent: 1}, paragraph("u")),
            quoteBlock(paragraph("a"), paragraph("t")),
        ),
        new: doc(paragraph("g"), orderedListItem({indent: 1}, paragraph("8"), paragraph("e"))),
    },
    {
        id: "250",
        old: doc(unorderedListItem({indent: 1}, paragraph("z"))),
        new: doc(paragraph("x"), codeBlock(codeBlockLine())),
    },
    {
        id: "251",
        old: doc(paragraph(), paragraph("k"), paragraph()),
        new: doc(unorderedListItem({indent: 1}, paragraph("q"))),
    },
    {
        id: "252",
        old: doc(paragraph("e"), paragraph("5")),
        new: doc(quoteBlock(paragraph(break_(), "q"))),
    },
    // Regression test: A document `title` going from empty to non-empty. The
    // non-empty, unchanged body paragraph would make the diff misalign the title
    // against the body (producing an invalid document with two titles) without a
    // title-specific compatibility key.
    {
        id: "253",
        old: titleDoc(title(), titleParagraph("body")),
        new: titleDoc(title("Hello"), titleParagraph("body")),
    },
    // A document `title` going from non-empty to empty.
    {
        id: "254",
        old: titleDoc(title("Hello"), titleParagraph("body")),
        new: titleDoc(title(), titleParagraph("body")),
    },
];

let nextExpectedId = 1;

for (const testCase of testCases) {
    const describe = testCase.skip
        ? globalThis.describe.skip
        : testCase.only
          ? globalThis.describe.only
          : globalThis.describe;

    const actualId = testCase.id;
    const expectedId = nextExpectedId.toString().padStart(3, "0");
    // eslint-disable-next-line cyberworlds/string-quotes
    assert(actualId === expectedId, `"${actualId}" !== "${expectedId}"`);
    nextExpectedId++;

    // eslint-disable-next-line cyberworlds/string-quotes
    describe(`id: "${testCase.id}" | diff ${testCase.old.toString()} with ${testCase.new.toString()}`, () => {
        test("returns the expected steps", async () => {
            testCase.old.check();
            testCase.new.check();

            const steps = diffProsemirrorNodes(testCase.old, testCase.new);

            let deletedSize = 0;
            for (const step of steps) {
                deletedSize += calculateStepDeletedSize(step);
            }

            const theoreticallyOptimalDeletedSize = calculateTheoreticallyOptimalDeletedSize(
                testCase.old,
                testCase.new,
            );

            let string = "";
            let doc: Node | null = testCase.old;

            string += `deletedSize: ${deletedSize}\ntheoreticallyOptimalDeletedSize: ${theoreticallyOptimalDeletedSize}\n\n`;

            for (const step of steps) {
                const stepString = await prettier.format(JSON.stringify(step.toJSON()), {
                    parser: "json",
                    printWidth: 100,
                    tabWidth: 4,
                    bracketSpacing: false,
                    plugins: [estreePrettierPlugin, babelPrettierPlugin],
                });

                string += doc ? doc.toString() : "doc(error)";
                string += "\n\n";
                string += `step(${stepString.trim()})`;
                string += "\n\n";

                try {
                    doc = doc ? step.apply(doc).doc : null;
                } catch {
                    // Ignore errors. Errors are reported by our second test.
                    doc = null;
                }
            }

            string += doc ? doc.toString() : "doc(error)";

            expect(string).toMatchSnapshot();
        });

        test("applying the steps to old node produces new node", () => {
            testCase.old.check();
            testCase.new.check();

            const steps = diffProsemirrorNodes(testCase.old, testCase.new);

            const doc = steps.reduce((doc, step, index) => {
                const stepResult = step.apply(doc);

                if (!stepResult.doc) {
                    throw new InternalError(
                        `Step failed: ${stepResult.failed!}\n\nStep index: ${index}\nStart doc: ${doc.toString()}`,
                    );
                }

                return stepResult.doc;
            }, testCase.old);

            expect(doc.toJSON()).toEqual(testCase.new.toJSON());
        });
    });
}

function calculateStepDeletedSize(actualStep: Step): number {
    const step = actualStep as ExhaustiveStep;

    switch (step.jsonID) {
        case "replace":
            return step.to - step.from;
        case "replaceAround":
            return step.gapFrom - step.from + (step.to - step.gapTo);
        case "attr":
        case "docAttr":
        case "addMark":
        case "removeMark":
        case "addNodeMark":
        case "removeNodeMark":
        case "removeAllMarks":
        case "addMarksAfterRemoveAll":
            return 0;
        default:
            throw exhaustive(step);
    }
}

/**
 * Calculates the minimum amount of content that a theoretically optimal differ
 * would need to delete to produce `newNode` from `oldNode`.
 *
 * I (@calebmer) spent a lot of time trying to implement this theoretically optimal
 * differ but I just couldn't figure it out. So instead I went with a naive
 * approach that doesn't generate optimal steps for many kinds of structural
 * updates. My theoretical approach was to tokenize the nodes and perform a Myers
 * diff on the tokens. Then to turn that diff into a set of steps (each that
 * preserved the document structure along the way). This function takes the core
 * diffing logic of one of my implementation branches (that failed because I
 * couldn't address every edge case) and uses it to calculate an optimal deleted
 * size that an implementation based on this method should reach in most cases.
 */
function calculateTheoreticallyOptimalDeletedSize(oldNode: Node, newNode: Node): number {
    const oldTokens = Array.from(tokenizeFragment([], oldNode.content));
    const newTokens = Array.from(tokenizeFragment([], newNode.content));

    const changes = diff(oldTokens, newTokens, {equals: areTokensCompatible});

    let deletedSize = 0;

    for (const change of changes) {
        if (change.type === "Removed") {
            switch (change.oldToken.type) {
                case "OpenNode":
                    deletedSize += 1;
                    break;
                case "CloseNode":
                    deletedSize += 1;
                    break;
                case "LeafNode":
                    deletedSize += change.oldToken.node.nodeSize;
                    break;
                case "Text":
                    deletedSize += change.oldToken.text.length;
                    break;
                default:
                    throw exhaustive(change.oldToken);
            }
        }
    }

    return deletedSize;
}

type TokenParent = {
    readonly node: Node;
};

type Token = OpenNodeToken | CloseNodeToken | LeafNodeToken | TextToken;

type OpenNodeToken = {
    readonly type: "OpenNode";
    readonly parents: ReadonlyArray<TokenParent>;
    readonly node: Node;
};

type CloseNodeToken = {
    readonly type: "CloseNode";
    readonly parents: ReadonlyArray<TokenParent>;
    readonly node: Node;
};

type LeafNodeToken = {
    readonly type: "LeafNode";
    readonly parents: ReadonlyArray<TokenParent>;
    readonly node: Node;
};

type TextToken = {
    readonly type: "Text";
    readonly parents: ReadonlyArray<TokenParent>;
    readonly text: string;
};

function* tokenizeFragment(
    parents: ReadonlyArray<TokenParent>,
    fragment: Fragment,
): IterableIterator<Token> {
    for (const node of fragment.content) {
        yield* tokenizeNode(parents, node);
    }
}

function* tokenizeNode(parents: ReadonlyArray<TokenParent>, node: Node): IterableIterator<Token> {
    if (node.isText) {
        for (const {text} of findSpans(node.text!)) {
            yield {type: "Text", parents, text};
        }
        return;
    }

    if (node.isLeaf) {
        yield {type: "LeafNode", parents, node};
        return;
    }

    yield {type: "OpenNode", parents, node};
    yield* tokenizeFragment([...parents, {node}], node.content);
    yield {type: "CloseNode", parents, node};
}

function areTokensCompatible(token1: Token, token2: Token): boolean {
    switch (token1.type) {
        case "OpenNode":
        case "CloseNode":
        case "LeafNode": {
            if (token1.type !== token2.type) return false;
            if (token1.node.type !== token2.node.type) return false;
            if (!isDeepEqual(token1.node.attrs, token2.node.attrs)) return false;
            return areTokenParentsCompatible(token1.parents, token2.parents);
        }
        case "Text": {
            if (token2.type !== "Text") return false;
            if (token1.text !== token2.text) return false;
            return areTokenParentsCompatible(token1.parents, token2.parents);
        }
        default:
            throw exhaustive(token1);
    }
}

function areTokenParentsCompatible(
    token1Parents: ReadonlyArray<TokenParent>,
    token2Parents: ReadonlyArray<TokenParent>,
): boolean {
    const minTokenParentsLength = Math.min(token1Parents.length, token2Parents.length);
    let lastCommonTokenParentIndex = -1;

    for (let index = 0; index < minTokenParentsLength; index++) {
        const token1Parent = token1Parents[index]!;
        const token2Parent = token2Parents[index]!;

        // Compatible if the types are the same.
        if (token1Parent.node.type === token2Parent.node.type) {
            lastCommonTokenParentIndex = index;
            continue;
        }

        // Compatible if both nodes are textblocks. This means we can freely join/split
        // between the two node types. For example: true when comparing `paragraph()` and
        // `heading()`.
        if (token1Parent.node.type.isTextblock && token2Parent.node.type.isTextblock) {
            lastCommonTokenParentIndex = index;
            continue;
        }

        // Compatible if the two types have similar content. This means we can freely
        // join/split between the two node types. For example: true when comparing
        // `unorderedListItem()` and `orderedListItem()`.
        if (token1Parent.node.type.compatibleContent(token2Parent.node.type)) {
            lastCommonTokenParentIndex = index;
            continue;
        }

        break;
    }

    // Compatible if we can use wrap/unwrap to move our token from one parent to
    // another. For example: false when comparing `paragraph()` and
    // `table(tableRow(tableCell(paragraph())))` but true when comparing `paragraph()`
    // and `quoteBlock(paragraph())`.
    if (!canWrapOrUnwrapTokenParents(token1Parents, lastCommonTokenParentIndex + 1)) {
        return false;
    }

    // Compatible if we can use wrap/unwrap to move our token from one parent to
    // another. For example: false when comparing `paragraph()` and
    // `table(tableRow(tableCell(paragraph())))` but true when comparing `paragraph()`
    // and `quoteBlock(paragraph())`.
    if (!canWrapOrUnwrapTokenParents(token2Parents, lastCommonTokenParentIndex + 1)) {
        return false;
    }

    return true;
}

function canWrapOrUnwrapTokenParents(
    tokenParents: ReadonlyArray<TokenParent>,
    startIndex: number,
): boolean {
    for (let index = startIndex; index < tokenParents.length - 1; index++) {
        const tokenParent2NodeType = tokenParents[index + 1]!.node.type;

        const tokenParent1NodeType =
            index > 0
                ? tokenParents[index - 1]!.node.type
                : tokenParent2NodeType.schema.topNodeType;

        // Check that the parent chain allows wrapping/unwrapping each individual parent
        // node. If we can wrap/unwrap then our diff algorithm will be able to produce
        // steps to update the old node to the new node.
        if (tokenParent1NodeType.contentMatch.matchType(tokenParent2NodeType)) continue;

        return false;
    }

    return true;
}
