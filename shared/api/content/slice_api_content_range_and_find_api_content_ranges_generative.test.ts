import fc from "fast-check";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {intoApiContent} from "~/shared/api/content/closed_source/into_api_content.js";
import {findApiContentRanges} from "~/shared/api/content/find_api_content_ranges.js";
import {sliceApiContentRange} from "~/shared/api/content/slice_api_content_range.js";
import {ApiContentPosition} from "~/shared/api/specification/types/api_content_position.js";
import {DocumentWithoutTitleContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {getProsemirrorNodeArbitrary} from "~/shared/prosemirror/test_helpers/get_prosemirror_node_arbitrary.js";

import.meta.jest.setTimeout(30 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 20 * 1000});

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
                relativeRange: fc
                    .tuple(
                        fc.float({min: 0, max: 1, noNaN: true}),
                        fc.float({min: 0, max: 1, noNaN: true}),
                    )
                    .map(([from, to]) => (from < to ? {from, to} : {from: to, to: from})),
            }),
            async ({content, relativeRange}) => {
                /* ========================================================================== *\
                 *                                 Test setup                                 *
                \* ========================================================================== */

                // Test cases come from a generative test which generates ProseMirror content and a
                // range of floats between 0 and 1. But we actually want a range of "commentable
                // content" that is:
                //
                // - A non-empty range that includes at least one character of content that can be
                //   commented on (text, mentions, files, etc.).
                //
                // - A range that starts right before a character of content that can be commented
                //   on and ends right after a character of content that can be commented on. So
                //   the range doesn't include any "boundaries" like the end of a paragraph.
                //
                // So this setup code takes the float range and tries to produce a range in
                // ProseMirror positions that meets our above requirements. It does this by
                // scanning forwards/backwards for both the range start and end until it finds
                // valid positions that produce a non-empty range.

                let from = Math.round(relativeRange.from * content.content.size);
                let to = Math.round(relativeRange.to * content.content.size);

                const isFromValid = (): boolean => {
                    const $from = content.resolve(from);

                    if ($from.nodeAfter?.type.name === "file") {
                        return true;
                    }

                    if (
                        $from.parent.isTextblock &&
                        $from.parentOffset < $from.parent.content.size
                    ) {
                        return true;
                    }

                    return false;
                };

                const isToValid = (): boolean => {
                    const $to = content.resolve(to);

                    if ($to.nodeBefore?.type.name === "file") {
                        return true;
                    }

                    if ($to.parent.isTextblock && $to.parentOffset > 0) {
                        return true;
                    }

                    return false;
                };

                const originalFrom = from;
                const originalTo = to;

                const loopFrom = () => {
                    assert(from <= to);

                    while (true) {
                        if (isFromValid() && from !== to) break;

                        if (from < to && from < content.content.size) {
                            // 1. Try searching forwards for a valid `from` position.
                            from++;
                            continue;
                        } else {
                            // 2. Try searching backwards for a valid `from` position.
                            from = originalFrom;

                            while (true) {
                                if (isFromValid() && from !== to) break;

                                if (from > 0) {
                                    from--;
                                    continue;
                                }

                                from = originalFrom;
                                break;
                            }
                            break;
                        }
                    }
                };

                const loopTo = () => {
                    assert(from <= to);

                    while (true) {
                        if (isToValid() && from !== to) break;

                        if (from < to && to > 0) {
                            // 1. Try searching backwards for a valid `to` position.
                            to--;
                            continue;
                        } else {
                            // 2. Try searching forwards for a valid `to` position.
                            to = originalTo;

                            while (true) {
                                if (isToValid() && from !== to) break;

                                if (to < content.content.size) {
                                    to++;
                                    continue;
                                }

                                to = originalTo;
                                break;
                            }
                            break;
                        }
                    }
                };

                loopFrom();
                loopTo();
                loopFrom();

                let hasCommentableContent = false;

                content.nodesBetween(from, to, (node, pos, parentNode) => {
                    if (!node.isLeaf) return;
                    hasCommentableContent ||= parentNode?.isTextblock || node.type.name === "file";
                });

                // There are no valid ranges in this content for comments. This will only really
                // happen if the content is all dividers.
                if (from === to || !hasCommentableContent) {
                    const typeNames = new Set<string>();
                    content.descendants(node => {
                        typeNames.add(node.type.name);
                    });

                    expect(typeNames).not.toContain("text");
                    expect(typeNames).not.toContain("file");
                    expect(typeNames).not.toContain("mention");
                    return;
                }

                /* ========================================================================== *\
                 *                              The actual test                               *
                \* ========================================================================== */

                // Run the actual logic under test. Specifically, when we use
                // `sliceApiContentRange()` with a position range then `findApiContentRanges()`
                // must be able to find the range we originally sliced.

                const $from = content.resolve(from);
                const $to = content.resolve(to);

                const start: ApiContentPosition =
                    $from.nodeAfter?.type.name === "file"
                        ? {
                              type: "Before",
                              key: encoder.encode({
                                  pos: from,
                                  nodeSize: $from.nodeAfter.nodeSize,
                                  inlineContent: $from.nodeAfter.inlineContent,
                              }),
                          }
                        : {
                              type: "Inline",
                              key: encoder.encode({
                                  pos: $from.before(),
                                  nodeSize: $from.parent.nodeSize,
                                  inlineContent: $from.parent.inlineContent,
                              }),
                              index: $from.parentOffset,
                          };

                const end: ApiContentPosition =
                    $to.nodeBefore?.type.name === "file"
                        ? {
                              type: "After",
                              key: encoder.encode({
                                  pos: to - 1,
                                  nodeSize: $to.nodeBefore.nodeSize,
                                  inlineContent: $to.nodeBefore.inlineContent,
                              }),
                          }
                        : {
                              type: "Inline",
                              key: encoder.encode({
                                  pos: $to.before(),
                                  nodeSize: $to.parent.nodeSize,
                                  inlineContent: $to.parent.inlineContent,
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
                expect(apiContentSlice).toEqual({ok: true, value: expect.anything()});
                assert(apiContentSlice.ok);

                const ranges = Array.from(findApiContentRanges(apiContent, apiContentSlice.value));

                expect(ranges).toEqual(expect.arrayContaining([{start, end}]));
            },
        ),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
