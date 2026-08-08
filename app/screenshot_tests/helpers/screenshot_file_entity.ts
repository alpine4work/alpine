import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {
    assertOrderKey,
    generateOrderKeysBetween,
    initialOrderKey,
    isOrderKey,
} from "~/shared/helpers/sort/order_key.open_source.js";
import {convertPascalCaseToKebabCase} from "~/shared/helpers/string/convert_pascal_case_to_kebab_case.js";
import {assertSiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";

const schema = DocumentContentProsemirrorSchema;

export async function screenshotFileEntity(
    runner: ScreenshotTestRunner,
    session: TestSpaceSession,
    beforeOrderKey: string,
    afterOrderKey: string,
    fileEntityId: FileEntityId,
    options: {
        fixedTime?: Date;
        /**
         * Override the auto-derived screenshot name prefix (which is normally
         * `${entity-type}-file-entity`, collapsed to `file-entity` for tests whose name
         * matches the entity type). Use this when the same test makes multiple
         * `screenshotFileEntity` calls for the same entity type — e.g. a tasks test that
         * screenshots both root tasks and subtasks — so the name groups stay distinct.
         */
        namePrefix?: string;
        /**
         * When provided, the entity is also screenshotted _inside_ this site (showing the
         * site breadcrumb in the preview) right after the out-of-site screenshots. The
         * entity is added to the site, screenshotted, then removed — so passing the same
         * entity used elsewhere in the test is safe as long as nothing afterward depends
         * on its original access policy (`removeEntityFromSite` leaves it with the site's
         * local policy, not its original one).
         *
         * Pass this for every site-capable entity so the in-site treatment is exercised
         * alongside the out-of-site one in a single call.
         */
        siteOptions: {
            site: TestSite;
            // NOTE(ifitzsimmons, 2026-05-26): The access policy is mutated by the helper's
            // add/remove cycle, so in order to avoid side effects, we need to revert it to its
            // original state after the screenshots are taken.
            revertAccessPolicy: () => Promise<void>;
        } | null;
    },
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

    if (options?.namePrefix) {
        screenshotNamePrefix += `-${options.namePrefix}`;
    }

    // Three screenshots out of a site, then (when `site` is set) three more inside it.
    const orderKeys = generateOrderKeysBetween(beforeOrderKey, afterOrderKey, 3);

    async function screenshotInHostDocument(orderKey: string, name: string, fileCount: number) {
        const document = await TestDocument.create(session, {
            content: [
                schema.node("title"),
                schema.node(
                    "fileRow",
                    {},
                    createArrayWithLength(fileCount, () =>
                        schema.node("file", {fileId: fileEntityId}),
                    ),
                ),
            ],
        });

        await runner.goto(session, `/doc/${document.id}`, {
            fixedTime: options?.fixedTime,
        });

        await runner.page
            .getByTestId(`ContentFileEntityPreview:${fileEntityType}`)
            .nth(fileCount - 1)
            .waitFor();

        await runner.screenshot(orderKey, name);
    }

    for (const count of [1, 2, 3]) {
        await screenshotInHostDocument(
            orderKeys[count - 1]!,
            `${screenshotNamePrefix}-${count}`,
            count,
        );
    }

    if (options?.siteOptions) {
        // Site-capable entities are exactly `SiteItemSearchEntityId`s. Documents are
        // excluded above; posts and sites are never passed a `site`.
        const siteEntityId = assertSiteItemSearchEntityId(fileEntityId);

        await options.siteOptions.site.addEntity(session, {
            entityId: siteEntityId,
            parentId: options.siteOptions.site.initialRootContainerId,
            orderKey: initialOrderKey,
        });

        const [, , lastOrderKey] = orderKeys;

        const siteOrderKeys = generateOrderKeysBetween(
            assertOrderKey(lastOrderKey!),
            afterOrderKey,
            3,
        );

        for (const count of [1, 2, 3]) {
            await screenshotInHostDocument(
                siteOrderKeys[count - 1]!,
                `${screenshotNamePrefix}-in-site-${count}`,
                count,
            );
        }

        await options.siteOptions.site.removeEntity(session, siteEntityId);
        await options.siteOptions.revertAccessPolicy();
    }
}
