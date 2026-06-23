import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {intoApiContent} from "~/shared/api/content/into_api_content.js";
import {findApiContentRanges} from "~/shared/api/markdown/find_api_content_ranges.js";
import {sliceApiContentRange} from "~/shared/api/markdown/slice_api_content_range.js";
import {ApiContentPosition} from "~/shared/api/specification/types/api_content_position.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {JsonValue} from "~/shared/helpers/types/json_value.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const testCases: Array<{
    only?: CommitBlocker;
    name: string;
    content: JsonValue;
    range: {from: number; to: number};
}> = [
    {
        name: "single character",
        content: {
            type: "doc",
            content: [{type: "paragraph", content: [{type: "text", text: "a"}]}],
        },
        range: {from: 0, to: 0},
    },
    {
        name: "multiple characters",
        content: {
            type: "doc",
            content: [{type: "paragraph", content: [{type: "text", text: "abc"}]}],
        },
        range: {from: 0, to: 1},
    },
    {
        name: "range selects single file row",
        content: {
            type: "doc",
            content: [
                {
                    type: "fileRow",
                    content: [{type: "file", attrs: {fileId: "06ffbh5yh19cp84gjjhmazeypm"}}],
                },
            ],
        },
        range: {from: 0, to: 0},
    },
    {
        name: "range ends at empty paragraph boundary",
        content: {
            type: "doc",
            content: [
                {type: "paragraph", content: [{type: "text", text: "l"}]},
                {type: "paragraph"},
            ],
        },
        range: {from: 0, to: 0.7000000476837158},
    },
    {
        name: "range ends at nested list paragraph boundary",
        content: {
            type: "doc",
            content: [
                {
                    type: "orderedListItem",
                    attrs: {indent: 1, orderStart: null},
                    content: [
                        {type: "paragraph", content: [{type: "text", text: "k"}]},
                        {type: "paragraph", content: [{type: "text", text: "2"}]},
                    ],
                },
                {type: "paragraph"},
            ],
        },
        range: {from: 0, to: 0.45000001788139343},
    },
    {
        name: "range ends at floating ordered list paragraph boundary",
        content: {
            type: "doc",
            content: [
                {type: "paragraph", content: [{type: "text", text: "j"}]},
                {
                    type: "orderedListItem",
                    attrs: {indent: 1, orderStart: null},
                    content: [{type: "paragraph"}],
                },
            ],
        },
        range: {from: 0, to: 0.6428571939468384},
    },
    {
        name: "range starts at file boundary and ends in table",
        content: {
            type: "doc",
            content: [
                {
                    type: "fileRow",
                    content: [
                        {type: "file", attrs: {fileId: "06ffa46za1s8z2jwj61a4cbr7c"}},
                        {type: "file", attrs: {fileId: "06ffa46za1s8z2jwj61a4cbr7c"}},
                    ],
                },
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
                                        {
                                            type: "paragraph",
                                            content: [{type: "text", text: "0"}],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "checkListItem",
                                            attrs: {indent: 1, checked: false},
                                            content: [
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "i"}],
                                                },
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "d"}],
                                                },
                                            ],
                                        },
                                        {
                                            type: "paragraph",
                                            content: [{type: "text", text: "h"}],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "orderedListItem",
                                            attrs: {indent: 1, orderStart: null},
                                            content: [
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "0"}],
                                                },
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "break"}],
                                                },
                                            ],
                                        },
                                        {
                                            type: "codeBlock",
                                            attrs: {language: "text"},
                                            content: [
                                                {
                                                    type: "codeBlockLine",
                                                    content: [{type: "text", text: "u"}],
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
        range: {from: 0, to: 0.18292683362960815},
    },
    {
        name: "empty range before nested list text",
        content: {
            type: "doc",
            content: [
                {
                    type: "orderedListItem",
                    attrs: {indent: 1, orderStart: null},
                    content: [
                        {type: "paragraph"},
                        {type: "paragraph", content: [{type: "text", text: "p"}]},
                    ],
                },
                {type: "paragraph", content: [{type: "text", text: "f"}]},
            ],
        },
        range: {from: 0, to: 0},
    },
    {
        name: "single repeated character slice",
        content: {
            type: "doc",
            content: [{type: "paragraph", content: [{type: "text", text: "7 7"}]}],
        },
        range: {from: 0.30000001192092896, to: 0.30000001192092896},
    },
    {
        name: "range ends before file row item",
        content: {
            type: "doc",
            content: [
                {type: "paragraph", content: [{type: "text", text: "4"}]},
                {
                    type: "fileRow",
                    content: [
                        {type: "file", attrs: {fileId: "06ffa4v2xca222ykdqeaf0pazw"}},
                        {type: "file", attrs: {fileId: "06ffa4v2xca222ykdqeaf0p9zw"}},
                    ],
                },
            ],
        },
        range: {from: 0, to: 0.6428571939468384},
    },
    {
        name: "range ends at second code line boundary",
        content: {
            type: "doc",
            content: [
                {
                    type: "codeBlock",
                    attrs: {language: "text"},
                    content: [
                        {type: "codeBlockLine", content: [{type: "text", text: "l"}]},
                        {type: "codeBlockLine", content: [{type: "text", text: "m"}]},
                    ],
                },
                {type: "paragraph"},
            ],
        },
        range: {from: 0, to: 0.45000001788139343},
    },
    {
        name: "range includes second code line after empty first code line",
        content: {
            type: "doc",
            content: [
                {type: "paragraph", content: [{type: "text", text: "b"}]},
                {
                    type: "codeBlock",
                    attrs: {language: "text"},
                    content: [
                        {type: "codeBlockLine"},
                        {type: "codeBlockLine", content: [{type: "text", text: "e"}]},
                    ],
                },
            ],
        },
        range: {from: 0, to: 0.75},
    },
    {
        name: "range starts at empty paragraph before code block and checklist",
        content: {
            type: "doc",
            content: [
                {type: "paragraph"},
                {
                    type: "codeBlock",
                    attrs: {language: "javascript"},
                    content: [
                        {type: "codeBlockLine"},
                        {type: "codeBlockLine", content: [{type: "text", text: "z"}]},
                    ],
                },
                {
                    type: "checkListItem",
                    attrs: {indent: 1, checked: false},
                    content: [
                        {type: "paragraph", content: [{type: "text", text: "c"}]},
                        {type: "paragraph", content: [{type: "text", text: "2"}]},
                    ],
                },
            ],
        },
        range: {from: 0, to: 0},
    },
    {
        name: "range ends at empty paragraph after marked file gallery",
        content: {
            type: "doc",
            content: [
                {
                    type: "fileRow",
                    content: [
                        {type: "file", attrs: {fileId: "06ffbj84h5dg6t4c2z1dz4g59w"}},
                        {
                            type: "file",
                            attrs: {fileId: "06ffbj84h5dg6t4c2z1dz4g59w"},
                            marks: [
                                {
                                    type: "comment",
                                    attrs: {commentThreadId: "19v1d7bw30wcs4thyg6w0vwk6c"},
                                },
                                {
                                    type: "comment",
                                    attrs: {commentThreadId: "wv97856w4aa630cqxh53vwzw74"},
                                },
                            ],
                        },
                    ],
                },
                {type: "paragraph", content: [{type: "text", text: "j 3 k t l 0 7 f"}]},
                {type: "paragraph"},
            ],
        },
        range: {from: 0.10869565606117249, to: 0.10869565606117249},
    },
    {
        name: "large range through quote and table",
        content: {
            type: "doc",
            content: [
                {
                    type: "quoteBlock",
                    content: [
                        {
                            type: "paragraph",
                            content: [
                                {
                                    type: "mention",
                                    attrs: {
                                        mention: {
                                            type: "SearchEntity",
                                            entityId: "Document:56epdg8zva5kt3gwks9tgky8f4",
                                        },
                                    },
                                },
                            ],
                        },
                        {
                            type: "unorderedListItem",
                            attrs: {indent: 1},
                            content: [
                                {
                                    type: "paragraph",
                                    content: [
                                        {
                                            type: "mention",
                                            attrs: {
                                                mention: {
                                                    type: "SearchEntity",
                                                    entityId: "Document:e45gh6dhyrtbepdczshbgq71zr",
                                                },
                                            },
                                        },
                                    ],
                                },
                                {type: "paragraph", content: [{type: "text", text: "u"}]},
                            ],
                        },
                    ],
                },
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
                                        {
                                            type: "orderedListItem",
                                            attrs: {indent: 1, orderStart: null},
                                            content: [
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "f"}],
                                                },
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "g"}],
                                                },
                                            ],
                                        },
                                        {
                                            type: "orderedListItem",
                                            attrs: {indent: 1, orderStart: null},
                                            content: [
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "u"}],
                                                },
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "o"}],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "orderedListItem",
                                            attrs: {indent: 1, orderStart: null},
                                            content: [
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "e"}],
                                                },
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "s"}],
                                                },
                                            ],
                                        },
                                        {
                                            type: "paragraph",
                                            content: [{type: "text", text: "j"}],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [{type: "text", text: "v"}],
                                        },
                                        {
                                            type: "paragraph",
                                            content: [{type: "text", text: "b"}],
                                        },
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
                                        {
                                            type: "paragraph",
                                            content: [{type: "text", text: "w"}],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "checkListItem",
                                            attrs: {indent: 1, checked: false},
                                            content: [
                                                {type: "paragraph", content: [{type: "break"}]},
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "a"}],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "orderedListItem",
                                            attrs: {indent: 1, orderStart: null},
                                            content: [
                                                {type: "paragraph", content: [{type: "break"}]},
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "p"}],
                                                },
                                            ],
                                        },
                                        {
                                            type: "codeBlock",
                                            attrs: {language: "text"},
                                            content: [
                                                {
                                                    type: "codeBlockLine",
                                                    content: [{type: "text", text: "h"}],
                                                },
                                                {type: "codeBlockLine"},
                                            ],
                                        },
                                        {
                                            type: "checkListItem",
                                            attrs: {indent: 1, checked: false},
                                            content: [
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "k"}],
                                                },
                                                {type: "paragraph", content: [{type: "break"}]},
                                            ],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "checkListItem",
                                            attrs: {indent: 1, checked: false},
                                            content: [
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "u"}],
                                                },
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "5"}],
                                                },
                                            ],
                                        },
                                        {
                                            type: "unorderedListItem",
                                            attrs: {indent: 1},
                                            content: [
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "0"}],
                                                },
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "w"}],
                                                },
                                            ],
                                        },
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
                                        {
                                            type: "fileRowTable",
                                            content: [
                                                {
                                                    type: "file",
                                                    attrs: {
                                                        fileId: "06ffa59by3v83ggxeerrw13d70",
                                                    },
                                                },
                                            ],
                                        },
                                        {type: "paragraph", content: [{type: "break"}]},
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {
                                            type: "paragraph",
                                            content: [{type: "text", text: "4"}],
                                        },
                                        {
                                            type: "paragraph",
                                            content: [{type: "text", text: "7"}],
                                        },
                                    ],
                                },
                                {
                                    type: "tableCell",
                                    content: [
                                        {type: "paragraph"},
                                        {
                                            type: "orderedListItem",
                                            attrs: {indent: 1, orderStart: null},
                                            content: [
                                                {type: "paragraph"},
                                                {
                                                    type: "paragraph",
                                                    content: [{type: "text", text: "y"}],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {type: "paragraph", content: [{type: "text", text: "0 h"}]},
            ],
        },
        range: {from: 0, to: 0.9833333492279053},
    },
    {
        name: "range ends before file float",
        content: {
            type: "doc",
            content: [
                {type: "divider"},
                {
                    type: "unorderedListItem",
                    attrs: {indent: 1},
                    content: [
                        {type: "paragraph", content: [{type: "text", text: "8"}]},
                        {type: "paragraph", content: [{type: "text", text: "x"}]},
                    ],
                },
                {
                    type: "fileFloat",
                    attrs: {direction: "left"},
                    content: [{type: "file", attrs: {fileId: "06ffa5jm3wzjta2qng3e1g33z0"}}],
                },
            ],
        },
        range: {from: 0, to: 0.875},
    },
    {
        name: "empty range between code block and paragraph",
        content: {
            type: "doc",
            content: [
                {
                    type: "codeBlock",
                    attrs: {language: "javascript"},
                    content: [{type: "codeBlockLine", content: [{type: "text", text: "b"}]}],
                },
                {type: "paragraph"},
            ],
        },
        range: {from: 0.3571428656578064, to: 0.3571428656578064},
    },
    {
        name: "range ends before second code line content",
        content: {
            type: "doc",
            content: [
                {
                    type: "codeBlock",
                    attrs: {language: "javascript"},
                    content: [
                        {type: "codeBlockLine", content: [{type: "text", text: "m"}]},
                        {type: "codeBlockLine", content: [{type: "text", text: "s"}]},
                    ],
                },
                {
                    type: "orderedListItem",
                    attrs: {indent: 1, orderStart: null},
                    content: [
                        {type: "paragraph", content: [{type: "text", text: "w"}]},
                        {type: "paragraph"},
                    ],
                },
            ],
        },
        range: {from: 0, to: 0.30000001192092896},
    },
    {
        name: "range selects break paragraph in nested list",
        content: {
            type: "doc",
            content: [
                {
                    type: "unorderedListItem",
                    attrs: {indent: 1},
                    content: [
                        {type: "paragraph"},
                        {type: "paragraph", content: [{type: "text", text: "a"}]},
                    ],
                },
                {
                    type: "unorderedListItem",
                    attrs: {indent: 1},
                    content: [
                        {type: "paragraph", content: [{type: "break"}]},
                        {type: "paragraph", content: [{type: "text", text: "i"}]},
                    ],
                },
            ],
        },
        range: {from: 0.1666666716337204, to: 0.23333333432674408},
    },
    {
        name: "range includes second code line text",
        content: {
            type: "doc",
            content: [
                {
                    type: "codeBlock",
                    attrs: {language: "javascript"},
                    content: [
                        {type: "codeBlockLine", content: [{type: "text", text: "1"}]},
                        {type: "codeBlockLine", content: [{type: "text", text: "n"}]},
                    ],
                },
                {
                    type: "checkListItem",
                    attrs: {indent: 1, checked: false},
                    content: [
                        {type: "paragraph", content: [{type: "text", text: "f"}]},
                        {type: "paragraph", content: [{type: "text", text: "m"}]},
                    ],
                },
            ],
        },
        range: {from: 0, to: 0.34375},
    },
    {
        name: "repeated text inside checklist paragraph",
        content: {
            type: "doc",
            content: [
                {type: "paragraph"},
                {
                    type: "checkListItem",
                    attrs: {indent: 1, checked: false},
                    content: [
                        {type: "paragraph", content: [{type: "text", text: "1 1 3"}]},
                        {
                            type: "paragraph",
                            content: [
                                {
                                    type: "mention",
                                    attrs: {
                                        mention: {
                                            type: "SearchEntity",
                                            entityId: "Document:vgw6gdzxtndcge8we5a0r47t1g",
                                        },
                                    },
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "quoteBlock",
                    content: [
                        {
                            type: "orderedListItem",
                            attrs: {indent: 1, orderStart: null},
                            content: [
                                {type: "paragraph", content: [{type: "text", text: "e"}]},
                                {type: "paragraph", content: [{type: "text", text: "e"}]},
                            ],
                        },
                        {type: "paragraph", content: [{type: "text", text: "s u c a g v b 7 j"}]},
                        {
                            type: "paragraph",
                            content: [{type: "text", text: "1 y g d 2 v y e d 5 c p y"}],
                        },
                        {type: "paragraph", content: [{type: "text", text: "f e v u 8 m k 4"}]},
                    ],
                },
            ],
        },
        range: {from: 0.06321839243173599, to: 0.09770115464925766},
    },
    {
        name: "range starts after file float and ends before next paragraph",
        content: {
            type: "doc",
            content: [
                {type: "paragraph", content: [{type: "text", text: "p"}]},
                {
                    type: "fileFloat",
                    attrs: {direction: "right"},
                    content: [{type: "file", attrs: {fileId: "06ffa88c744z81sbmz9a501qar"}}],
                },
                {type: "paragraph", content: [{type: "text", text: "w"}]},
            ],
        },
        range: {from: 0.2777777910232544, to: 0.7222222685813904},
    },
    {
        name: "empty range between file float and paragraph",
        content: {
            type: "doc",
            content: [
                {
                    type: "fileFloat",
                    attrs: {direction: "right"},
                    content: [{type: "file", attrs: {fileId: "06ffa8y15q621ett9ehsf51j5w"}}],
                },
                {type: "paragraph", content: [{type: "text", text: "x"}]},
            ],
        },
        range: {from: 0.25, to: 0.25},
    },
];

const encoder = new ApiContentKeyEncoder({
    entityId: `Document:${assertId<DocumentId>("021canz18dawsz0xbg032r4f48")}`,
    version: 0,
});

for (const {only, name, content: contentJson, range} of testCases) {
    const test = only ? globalThis.test.only : globalThis.test;

    const content = schema.nodeFromJSON(contentJson);

    test(`${name}`, async () => {
        let from = Math.round(range.from * content.content.size);
        let to = Math.round(range.to * content.content.size);

        while (true) {
            if (from > content.content.size) break;

            const $from = content.resolve(from);
            if ($from.nodeAfter?.type.name === "file") break;
            if ($from.parent.isTextblock) break;
            from++;
        }

        while (true) {
            if (to < 0) break;

            const $to = content.resolve(to);
            if ($to.nodeBefore?.type.name === "file") break;
            if ($to.parent.isTextblock) break;
            to--;
        }

        if ((from > to && to >= 0) || from > content.content.size) from = to;
        if ((to < from && from <= content.content.size) || to < 0) to = from;

        const originalFrom = from;
        const originalTo = to;

        const hasCommentableContent = () => {
            let hasCommentableContent = false;

            content.slice(from, to).content.descendants(node => {
                if (!node.isLeaf) return;
                hasCommentableContent ||=
                    node.isText || node.type.allowsMarkType(schema.marks.comment);
            });

            return hasCommentableContent;
        };

        if (from === to || !hasCommentableContent()) {
            while (true) {
                if (to >= content.content.size - 1) {
                    to = originalTo;
                    break;
                }

                to++;
                const $to = content.resolve(to);
                if ($to.nodeBefore?.type.name === "file" && hasCommentableContent()) break;
                if ($to.parent.isTextblock && hasCommentableContent()) break;
            }
        }

        if (from === to || !hasCommentableContent()) {
            while (true) {
                if (from <= 0) {
                    from = originalFrom;
                    break;
                }

                from--;
                const $from = content.resolve(from);
                if ($from.nodeAfter?.type.name === "file" && hasCommentableContent()) break;
                if ($from.parent.isTextblock && hasCommentableContent()) break;
            }
        }

        // There are no valid ranges in this content for comments. This will basically only
        // really happen if the content is all dividers.
        if (to < 0 || from === to || !hasCommentableContent()) {
            throw new InternalError("Invalid range, range must contain some commentable content");
        }

        const $from = content.resolve(from);
        const $to = content.resolve(to);

        const start: ApiContentPosition =
            $from.nodeAfter?.type.name === "file"
                ? {
                      type: "Before",
                      key: encoder.encode({pos: from, nodeSize: $from.nodeAfter.nodeSize}),
                  }
                : {
                      type: "Inline",
                      key: encoder.encode({
                          pos: $from.before(),
                          nodeSize: $from.parent.nodeSize,
                      }),
                      index: $from.parentOffset,
                  };

        const end: ApiContentPosition =
            $to.nodeBefore?.type.name === "file"
                ? {
                      type: "After",
                      key: encoder.encode({pos: to, nodeSize: $to.nodeBefore.nodeSize}),
                  }
                : {
                      type: "Inline",
                      key: encoder.encode({
                          pos: $to.before(),
                          nodeSize: $to.parent.nodeSize,
                      }),
                      index: $to.parentOffset,
                  };

        const apiContent = intoApiContent(content, {
            encoder,
            getAccountMentionTitleIfExists: () => undefined,
            getSearchEntityMentionTitleIfExists: () => undefined,
            getSearchTaskEntityDisplayStatusIfExists: () => undefined,
            getFileIfExists: () => undefined,
        });

        const apiContentSlice = sliceApiContentRange(apiContent, {start, end});

        const ranges = findApiContentRanges(apiContent, apiContentSlice);

        expect(ranges).toEqual(expect.arrayContaining([{start, end}]));
    });
}
