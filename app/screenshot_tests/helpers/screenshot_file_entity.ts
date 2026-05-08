import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateOrderKeysBetween, isOrderKey} from "~/shared/helpers/sort/order_key.js";
import {convertPascalCaseToKebabCase} from "~/shared/helpers/string/convert_pascal_case_to_kebab_case.js";

const schema = DocumentContentProsemirrorSchema;

export async function screenshotFileEntity(
    runner: ScreenshotTestRunner,
    session: TestSpaceSession,
    beforeOrderKey: string,
    afterOrderKey: string,
    fileEntityId: FileEntityId,
    options?: {fixedTime?: Date},
) {
    assert(isOrderKey(beforeOrderKey));
    assert(isOrderKey(afterOrderKey));

    const fileEntityType = fileEntityId.split(":", 1)[0]!;

    let screenshotNamePrefix = `${convertPascalCaseToKebabCase(fileEntityType)}-file-entity`;
    if (
        screenshotNamePrefix === `${runner.testName}-file-entity` ||
        (runner.testName.endsWith("s") &&
            screenshotNamePrefix === `${runner.testName.slice(0, -1)}-file-entity`)
    ) {
        screenshotNamePrefix = "file-entity";
    }

    const orderKeys = generateOrderKeysBetween(beforeOrderKey, afterOrderKey, 3);

    for (const count of [1, 2, 3]) {
        const document = await TestDocument.create(session, {
            content: [
                schema.node("title"),
                schema.node(
                    "fileRow",
                    {},
                    createArrayWithLength(count, () => schema.node("file", {fileId: fileEntityId})),
                ),
            ],
        });

        await runner.goto(session, `/s/${session.space.id}/documents/${document.id}`, options);

        await runner.page
            .getByTestId(`ContentFileEntityPreview:${fileEntityType}`)
            .nth(count - 1)
            .waitFor();

        await runner.screenshot(orderKeys[count - 1]!, `${screenshotNamePrefix}-${count}`);
    }
}
