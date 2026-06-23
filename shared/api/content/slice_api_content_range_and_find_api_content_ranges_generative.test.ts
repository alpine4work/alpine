import fc from "fast-check";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {intoApiContent} from "~/shared/api/content/into_api_content.js";
import {findApiContentRanges} from "~/shared/api/markdown/find_api_content_ranges.js";
import {sliceApiContentRange} from "~/shared/api/markdown/slice_api_content_range.js";
import {ApiContentPosition} from "~/shared/api/specification/types/api_content_position.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {getProsemirrorNodeArbitrary} from "~/shared/prosemirror/test_helpers/get_prosemirror_node_arbitrary.js";

/* NOCOMMIT
import.meta.jest.setTimeout(30 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 20 * 1000});
 */

import.meta.jest.setTimeout(140 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 120 * 1000});

const encoder = new ApiContentKeyEncoder({
    entityId: `Document:${assertId<DocumentId>("021canz18dawsz0xbg032r4f48")}`,
    version: 0,
});

const DocumentContentArbitrary = getProsemirrorNodeArbitrary(
    schema.topNodeType,
    new Set(Object.values(schema.marks)),
);

test("can find sliced content", async () => {
    await fc.assert(
        fc.asyncProperty(
            fc.record({
                content: DocumentContentArbitrary.map(content =>
                    Object.assign(content, {
                        // Will be logged when there's an error. Stringifying as JSON makes it easy to copy
                        // this failed test case into
                        // `shared/api/content/slice_api_content_range_and_find_api_content_ranges.test.ts`.
                        toString: () => JSON.stringify(content.toJSON()),
                    }),
                ),
                range: fc
                    .tuple(
                        fc.float({min: 0, max: 1, noNaN: true}),
                        fc.float({min: 0, max: 1, noNaN: true}),
                    )
                    .map(([from, to]) => (from < to ? {from, to} : {from: to, to: from})),
            }),
            async ({content, range}) => {
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
                    const typeNames = new Set<string>();
                    content.descendants(node => {
                        typeNames.add(node.type.name);
                    });

                    expect(typeNames).not.toContain("text");
                    expect(typeNames).not.toContain("file");
                    expect(typeNames).not.toContain("mention");
                    return;
                }

                const $from = content.resolve(from);
                const $to = content.resolve(to);

                const start: ApiContentPosition =
                    $from.nodeAfter?.type.name === "file"
                        ? {
                              type: "After",
                              key: encoder.encode({pos: from, nodeSize: $from.nodeAfter.nodeSize}),
                          }
                        : {
                              type: "Inline",
                              key: encoder.encode({
                                  pos: $from.start(),
                                  nodeSize: $from.parent.nodeSize,
                              }),
                              index: $from.parentOffset,
                          };

                const end: ApiContentPosition =
                    $to.nodeBefore?.type.name === "file"
                        ? {
                              type: "Before",
                              key: encoder.encode({pos: from, nodeSize: $to.nodeBefore.nodeSize}),
                          }
                        : {
                              type: "Inline",
                              key: encoder.encode({
                                  pos: $to.start(),
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
            },
        ),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
