import fc from "fast-check";
import {produce} from "immer";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {intoApiContent} from "~/shared/api/content/into_api_content.js";
import {ApiContentNormalizer} from "~/shared/api/markdown/normalize_api_content.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {JsonWritableValue} from "~/shared/helpers/types/json_value.js";
import {getProsemirrorNodeArbitrary} from "~/shared/prosemirror/test_helpers/get_prosemirror_node_arbitrary.js";

import.meta.jest.setTimeout(30 * 1000);
fc.configureGlobal({interruptAfterTimeLimit: 20 * 1000});

const DocumentContentArbitrary = getProsemirrorNodeArbitrary(
    DocumentWithoutTitleContentProsemirrorSchema.topNodeType,
    new Set(Object.values(DocumentWithoutTitleContentProsemirrorSchema.marks)),
);

test("can convert ProseMirror content to API content and back", () => {
    fc.assert(
        fc.property(DocumentContentArbitrary, expectedContent => {
            const apiContent = intoApiContent(expectedContent, {
                getAccountMentionTitleIfExists: () => undefined,
                getSearchEntityMentionTitleIfExists: () => undefined,
                getSearchTaskEntityDisplayStatusIfExists: () => undefined,
                getFileIfExists: () => undefined,
            });

            // We expect `intoApiContent()` to return content in normalized form.
            expect(apiContent).toEqual(
                produce(apiContent, apiContent =>
                    ApiContentNormalizer.with(normalizer => normalizer.normalize(apiContent), {
                        isResponse: true,
                        withKeys: true,
                    }),
                ),
            );

            const actualContent = fromApiContent(
                DocumentWithoutTitleContentProsemirrorSchema,
                apiContent,
            );

            function normalize(value: JsonWritableValue) {
                if (isReadonlyArray(value)) {
                    for (const item of value) {
                        normalize(item);
                    }
                }

                if (!isObject(value)) return;

                if (
                    value.type === "table" &&
                    isObject(value.attrs) &&
                    isReadonlyArray(value.attrs.columnWidths)
                ) {
                    // Remove tailing 1s in the `columnWidths` array. Logically `columnWidths` is
                    // filled with 1s up to the table's column width so we may choose to omit the 1s
                    // sometimes. If there's a non-1 then that must survive the API content
                    // transformation and all 1s before it must be preserved.
                    while (
                        value.attrs.columnWidths.length > 0 &&
                        value.attrs.columnWidths[value.attrs.columnWidths.length - 1] === 1
                    ) {
                        value.attrs.columnWidths.pop();
                    }
                }

                for (const keyValue of Object.values(value)) {
                    if (keyValue !== undefined) normalize(keyValue);
                }
            }

            const actualContentJson = actualContent.toJSON();
            const expectedContentJson = expectedContent.toJSON();

            normalize(actualContentJson);
            normalize(expectedContentJson);

            expect(actualContentJson).toEqual(expectedContentJson);
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
