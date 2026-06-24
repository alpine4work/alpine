import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {intoApiContent} from "~/shared/api/content/into_api_content.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {printApiContentToMarkdown} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {sliceApiContentRange} from "~/shared/api/markdown/slice_api_content_range.js";
import {ApiContentPosition} from "~/shared/api/specification/types/api_content_position.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {generateId} from "~/shared/id/id.js";

const testCases: Array<{
    only?: CommitBlocker;
    name: string;
    content: string;
    from: number;
    to: number;
    slice: string;
}> = [
    {
        name: "slice out text",
        content: "foo bar qux",
        from: 5,
        to: 8,
        slice: "bar",
    },
];

for (const testCase of testCases) {
    const test = testCase.only ? globalThis.test.only : globalThis.test;

    test(`${testCase.name}`, () => {
        const documentId = generateId();

        const encoder = new ApiContentKeyEncoder({
            entityId: `Document:${documentId}`,
            version: 0,
        });

        const contentNode = fromApiContent(
            DocumentContentProsemirrorSchema,
            parseApiContentFromMarkdown(testCase.content),
        );

        const content = intoApiContent(contentNode, {
            encoder,
            getAccountMentionTitleIfExists: () => undefined,
            getSearchEntityMentionTitleIfExists: () => undefined,
            getSearchTaskEntityDisplayStatusIfExists: () => undefined,
            getFileIfExists: () => undefined,
        });

        const $from = contentNode.resolve(testCase.from);
        const $to = contentNode.resolve(testCase.to);

        const start: ApiContentPosition =
            $from.nodeAfter?.type.name === "file"
                ? {
                      type: "Before",
                      key: encoder.encode({pos: testCase.from, nodeSize: $from.nodeAfter.nodeSize}),
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
                      key: encoder.encode({
                          pos: testCase.to - 1,
                          nodeSize: $to.nodeBefore.nodeSize,
                      }),
                  }
                : {
                      type: "Inline",
                      key: encoder.encode({
                          pos: $to.before(),
                          nodeSize: $to.parent.nodeSize,
                      }),
                      index: $to.parentOffset,
                  };

        expect(
            mapResult(sliceApiContentRange(content, {start, end}), slice => {
                const sliceString = printApiContentToMarkdown(slice);
                return sliceString.endsWith("\n") ? sliceString.slice(0, -1) : sliceString;
            }),
        ).toEqual({
            ok: true,
            value: testCase.slice,
        });
    });
}
