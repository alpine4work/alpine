import {expect, test} from "@playwright/test";
import {writeFileSync} from "fs";
import {join} from "path";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {
    ExportedNotionDocument,
    ExportedNotionFile,
    ExportedNotionTeamspace,
    createTestNotionImportZip,
} from "~/server/importer/notion/test_helpers/create_test_notion_import_zip.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

const {context, services} = createTestServices();

test("can upload a Notion export and see final teamspace stats", async ({
    context: browserContext,
    page,
}) => {
    test.setTimeout(180_000);

    const space = await TestSpace.create(context, {name: "Import Test Space"});
    const session = await space.createSession({role: "Owner"});

    // Create media files
    const screenshot = new ExportedNotionFile("screenshot.png", "image");
    const diagram = new ExportedNotionFile("diagram.png", "image");
    const demoVideo = new ExportedNotionFile("demo.mp4", "video");
    const recording = new ExportedNotionFile("recording.mp3", "audio");

    // Create a test fixture with 2 teamspaces containing documents and files
    const apiDesign = new ExportedNotionDocument(
        "API Design",
        `API design notes\n\n${screenshot.toReference()}`,
    );
    apiDesign.addFiles([screenshot]);

    const architecture = new ExportedNotionDocument(
        "Architecture",
        `System architecture\n\n${diagram.toReference()}\n\n${demoVideo.toReference()}`,
    );
    architecture.addFiles([diagram, demoVideo]);

    const onboarding = new ExportedNotionDocument("Onboarding Guide", "New engineer onboarding");

    const brandGuidelines = new ExportedNotionDocument(
        "Brand Guidelines",
        `Brand style guide\n\n${recording.toReference()}`,
    );
    brandGuidelines.addFiles([recording]);

    const componentLibrary = new ExportedNotionDocument("Component Library", "UI component specs");

    const zip = createTestNotionImportZip(
        [
            new ExportedNotionTeamspace("Engineering", [apiDesign, architecture, onboarding]),
            new ExportedNotionTeamspace("Design", [brandGuidelines, componentLibrary]),
        ],
        {workspaceName: "Acme Corp"},
    );

    // Write the zip to a temp file for Playwright to upload
    const tmpDir = assertExists(process.env.TEST_TMPDIR);
    const zipPath = join(tmpDir, "notion_export.zip");
    writeFileSync(zipPath, zip);

    await services.signIn(browserContext, session);
    await page.goto(`/settings/${space.id}/integrations/notion`);

    // Verify the page loaded
    await expect(page.getByText("Click to upload a Notion export")).toBeVisible({timeout: 15_000});

    // Upload the zip via the hidden file input
    const fileInput = page.getByLabel("Select Notion export file");
    await fileInput.setInputFiles(zipPath);

    // Wait for validation to complete — teamspace options appear with workspace name
    await expect(page.getByText("Acme Corp")).toBeVisible({timeout: 120_000});
    await expect(page.getByText("Engineering")).toBeVisible();
    await expect(page.getByText("Design")).toBeVisible();

    // Start the import
    await page.getByRole("button", {name: "Start import"}).click();

    // Wait for the import card to show success
    await expect(page.getByTestId("NotionImportItemCard:Success")).toBeVisible({timeout: 120_000});

    // Assert the final teamspace stats. Each teamspace gets a root document, so the
    // document count is +1 from the number of exported documents.
    //
    // Engineering: 3 docs + 1 root = 4 documents, 2 images, 1 video Design: 2 docs + 1
    // root = 3 documents, 1 file (audio is "other")
    const summaries = page.getByTestId("NotionImportTeamspaceSummary");
    await expect(summaries).toHaveCount(2);

    const summaryTexts = await summaries.allTextContents();
    expect(summaryTexts.sort()).toEqual(
        [
            "Design: imported 3 documents and 1 file",
            "Engineering: imported 4 documents, 2 images, and 1 video",
        ].sort(),
    );
});
