import fc from "fast-check";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {intoApiContent} from "~/shared/api/content/into_api_content.js";
import {findApiContentRanges} from "~/shared/api/markdown/find_api_content_ranges.js";
import {sliceApiContentRange} from "~/shared/api/markdown/slice_api_content_range.js";
import {ApiContentPosition} from "~/shared/api/specification/types/api_content_position.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {getProsemirrorNodeArbitrary} from "~/shared/prosemirror/test_helpers/get_prosemirror_node_arbitrary.js";

const encoder = new ApiContentKeyEncoder({
    entityId: `Document:${assertId<DocumentId>("021canz18dawsz0xbg032r4f48")}`,
    version: 0,
});

const DocumentContentArbitrary = getProsemirrorNodeArbitrary(
    DocumentWithoutTitleContentProsemirrorSchema.topNodeType,
    new Set(Object.values(DocumentWithoutTitleContentProsemirrorSchema.marks)),
);

test("can zip/unzip keys from parsed/printed API content", async () => {
    await fc.assert(
        fc.asyncProperty(
            fc.record({
                content: DocumentContentArbitrary,
                range: fc
                    .tuple(fc.float({min: 0, max: 1}), fc.float({min: 0, max: 1}))
                    .map(([from, to]) => (from < to ? {from, to} : {from: to, to: from})),
            }),
            async ({content, range}) => {
                let from = Math.round(range.from * content.nodeSize);
                let to = Math.round(range.to * content.nodeSize);

                while (true) {
                    if (from > content.nodeSize) break;

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

                if (from > to || from > content.nodeSize) from = to;
                if (to < from || to < 0) to = from;

                // There are no valid ranges in this content for comments. This will basically only
                // really happen if the content is all dividers.
                if (to < 0) {
                    const typeNames = content.content.content.map(node => node.type.name);
                    expect(typeNames).not.toContain("paragraph");
                    expect(typeNames).not.toContain("file");
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
