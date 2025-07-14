import {Locator, Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const {context, services} = createTestServices();

const openCoverModal = async (page: Page) => {
    await page.getByRole("button", {name: "More"}).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", {name: "Cover"}).click();
};

const getBlobsData = async (blobsCanvasLocator: Locator) =>
    assertExists(
        await blobsCanvasLocator.elementHandle().then(handle =>
            handle?.evaluate(e => ({
                seed: (e as any)._blobsDrawn.seed as string,
                themeColor: (e as any)._blobsDrawn.themeColor as ThemeColor,
                hueSpread: (e as any)._blobsDrawn.hueSpread as number,
            })),
        ),
    );

test("can add and remove a document cover", async ({page, context: browserContext, isMobile}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test Document"});

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    const editor = page.getByRole("textbox", {name: "Document"});
    await expect(editor).toBeVisible();

    // Wait for React to mount
    await page.waitForFunction("dev.contentEditor");

    await openCoverModal(page);
    const coverOptions = page.getByTestId("DocumentContentCoverBlobsArtOption");
    await expect(coverOptions).toHaveCount(6);

    // Select a cover and save
    const selectedCoverOption = coverOptions.nth(3);
    const selectedCoverOptionBlobs = selectedCoverOption.getByTestId("BlobsArtCanvas");
    const selectedBlobData = await getBlobsData(selectedCoverOptionBlobs);
    await selectedCoverOption.click();

    if (isMobile) {
        await page.getByRole("button", {name: "Save"}).click();
    } else {
        await page.keyboard.press("Escape");
    }

    // Verify the cover was added
    const blobCanvas = page.getByTestId("BlobsArtCanvas").first();
    const blobCanvasData = await getBlobsData(blobCanvas);
    await expect(blobCanvas).toBeVisible();

    // Verify the correct blob was drawn
    expect(blobCanvasData).toEqual(selectedBlobData);

    // Now remove the cover
    await openCoverModal(page);

    await page.getByRole("button", {name: "Remove cover"}).click();

    if (isMobile) {
        await page.getByRole("button", {name: "Save"}).click();
    } else {
        await page.keyboard.press("Escape");
    }

    await expect(blobCanvas).toBeHidden();
});

test("can use randomize button in cover modal", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const expectedCount = 6;
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test Document"});

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    const editor = page.getByRole("textbox", {name: "Document"});
    await expect(editor).toBeVisible();

    // Wait for React to mount
    await page.waitForFunction("dev.contentEditor");

    await openCoverModal(page);
    const coverOptions = page.getByTestId("DocumentContentCoverBlobsArtOption");
    await expect(coverOptions).toHaveCount(expectedCount);
    const randomizeButton = page.getByRole("button", {name: "Randomize"});

    // Get the initial drawn blobs
    // We use nth() instead of all() since all() is not ordered
    let drawnBlobs = Array.from({length: expectedCount}, (_, i) =>
        coverOptions.nth(i).getByTestId("BlobsArtCanvas"),
    );

    const firstDrawnBlobsData = (await Promise.all(drawnBlobs.map(blob => getBlobsData(blob)))).map(
        b => assertExists(b),
    );

    // Randomize and validate they're all different
    await randomizeButton.click();
    drawnBlobs = Array.from({length: expectedCount}, (_, i) =>
        coverOptions.nth(i).getByTestId("BlobsArtCanvas"),
    );
    const secondDrawnBlobsData = (
        await Promise.all(drawnBlobs.map(blob => getBlobsData(blob)))
    ).map(b => assertExists(b));

    for (let i = 0; i < 6; i++) {
        expect(firstDrawnBlobsData[i]).not.toEqual(secondDrawnBlobsData[i]);
    }

    // Select a cover, randomize again, and validate we don't change the one we selected
    const selectedBlob = 3;
    await page.getByTestId("DocumentContentCoverBlobsArtOption").nth(selectedBlob).click();
    await randomizeButton.click();
    drawnBlobs = Array.from({length: expectedCount}, (_, i) =>
        coverOptions.nth(i).getByTestId("BlobsArtCanvas"),
    );
    const thirdDrawnBlobsData = (await Promise.all(drawnBlobs.map(blob => getBlobsData(blob)))).map(
        b => assertExists(b),
    );

    for (let i = 0; i < 6; i++) {
        if (i === selectedBlob) {
            expect(secondDrawnBlobsData[i]).toEqual(thirdDrawnBlobsData[i]);
        } else {
            expect(secondDrawnBlobsData[i]).not.toEqual(thirdDrawnBlobsData[i]);
        }
    }

    // Validate we close the dialog when clicking save
    if (isMobile) {
        await page.getByRole("button", {name: "Save"}).click();
    } else {
        await page.keyboard.press("Escape");
    }

    const blobCanvas = page.getByTestId("BlobsArtCanvas").first();
    await expect(blobCanvas).toBeVisible();
});
