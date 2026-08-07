import {computeNotionImportExpectedStatistics} from "~/server/importer/notion/internal/compute_notion_import_expected_statistics.js";
import {getNotionImportMetadata} from "~/server/importer/notion/internal/get_notion_import_metadata.js";
import {
    ExportedNotionDatabase,
    ExportedNotionDocument,
    ExportedNotionFile,
    ExportedNotionTeamspace,
    createTestNotionImportZip,
} from "~/server/importer/notion/test_helpers/create_test_notion_import_zip.js";
import {
    createDiskReadFile,
    extractTestNotionImportToDisk,
    readTestNotionImportIndexHtml,
} from "~/server/importer/notion/test_helpers/extract_test_notion_import_to_disk.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

/**
 * Helper that creates a zip, extracts it to disk, gets metadata, and calls
 * `computeNotionImportExpectedStatistics`.
 */
async function computeStats(
    items: Array<ExportedNotionDocument> | Array<ExportedNotionTeamspace>,
    options?: {createFoldersForSubpages?: boolean; workspaceName?: string},
) {
    const zip = createTestNotionImportZip(items, options);
    const {diskPath, filePaths} = await extractTestNotionImportToDisk(zip);
    const indexHtmlContent = assertExists(await readTestNotionImportIndexHtml(diskPath, filePaths));

    const metadata = assertExists(getNotionImportMetadata(indexHtmlContent));

    const teamspaceNameById =
        metadata.teamspaceNameById.size > 0
            ? metadata.teamspaceNameById
            : new Map([["default", metadata.workspaceName]]);

    return computeNotionImportExpectedStatistics({
        readFile: createDiskReadFile(diskPath),
        diskPathToUnzippedFiles: diskPath,
        filePaths,
        indexHtmlContent,
        teamspaceNameById,
        workspaceId: metadata.workspaceId,
    });
}

describe("computeNotionImportExpectedStatistics", () => {
    for (const createFoldersForSubpages of [true, false]) {
        describe(`createFoldersForSubpages=${createFoldersForSubpages}`, () => {
            test("counts a single document", async () => {
                const doc = new ExportedNotionDocument("Hello", "World");
                const result = await computeStats([doc], {createFoldersForSubpages});

                expect(result.teamspaces.size).toBe(1);
                const stats = [...result.teamspaces.values()][0]!;
                expect(stats.documents.expectedCount).toBe(1);
                expect(stats.documents.imported).toBe(0);
            });

            test("counts multiple documents", async () => {
                const docs = [
                    new ExportedNotionDocument("Doc A", "Content A"),
                    new ExportedNotionDocument("Doc B", "Content B"),
                    new ExportedNotionDocument("Doc C", "Content C"),
                ];
                const result = await computeStats(docs, {createFoldersForSubpages});

                const stats = [...result.teamspaces.values()][0]!;
                expect(stats.documents.expectedCount).toBe(3);
            });

            test("counts nested documents", async () => {
                const child = new ExportedNotionDocument("Child", "child content");
                const parent = new ExportedNotionDocument("Parent", "parent content", [child]);
                const result = await computeStats([parent], {createFoldersForSubpages});

                const stats = [...result.teamspaces.values()][0]!;
                expect(stats.documents.expectedCount).toBe(2);
            });

            test("counts image files", async () => {
                const image = new ExportedNotionFile("photo.png", "image");
                const doc = new ExportedNotionDocument(
                    "With Image",
                    `Look: ${image.toReference()}`,
                );
                doc.files.push(image);
                const result = await computeStats([doc], {createFoldersForSubpages});

                const stats = [...result.teamspaces.values()][0]!;
                expect(stats.documents.expectedCount).toBe(1);
                expect(stats.files.get("image/png")?.expectedCount).toBe(1);
                expect(stats.files.get("image/png")?.size).toBeGreaterThan(0);
            });

            test("counts video files", async () => {
                const video = new ExportedNotionFile("clip.mp4", "video");
                const doc = new ExportedNotionDocument(
                    "With Video",
                    `Watch: ${video.toReference()}`,
                );
                doc.files.push(video);
                const result = await computeStats([doc], {createFoldersForSubpages});

                const stats = [...result.teamspaces.values()][0]!;
                expect(stats.files.get("video/mp4")?.expectedCount).toBe(1);
                expect(stats.files.get("video/mp4")?.size).toBeGreaterThan(0);
            });

            test("counts audio files", async () => {
                const audio = new ExportedNotionFile("song.mp3", "audio");
                const doc = new ExportedNotionDocument(
                    "With Audio",
                    `Listen: ${audio.toReference()}`,
                );
                doc.files.push(audio);
                const result = await computeStats([doc], {createFoldersForSubpages});

                const stats = [...result.teamspaces.values()][0]!;
                expect(stats.files.get("audio/mpeg")?.expectedCount).toBe(1);
                expect(stats.files.get("audio/mpeg")?.size).toBeGreaterThan(0);
            });

            test("pre-populates all known teamspaces even if empty", async () => {
                const ts1 = new ExportedNotionTeamspace("Engineering", [
                    new ExportedNotionDocument("Doc", "content"),
                ]);
                const ts2 = new ExportedNotionTeamspace("Design", []);
                const result = await computeStats([ts1, ts2], {createFoldersForSubpages});

                expect(result.teamspaces.size).toBe(2);
                const designStats = result.teamspaces.get(ts2.notionId);
                expect(designStats).toBeDefined();
                expect(designStats!.documents.expectedCount).toBe(0);
            });

            test("assigns documents to correct teamspaces", async () => {
                const ts1 = new ExportedNotionTeamspace("Engineering", [
                    new ExportedNotionDocument("API Design", "content"),
                    new ExportedNotionDocument("Architecture", "content"),
                ]);
                const ts2 = new ExportedNotionTeamspace("Marketing", [
                    new ExportedNotionDocument("Campaign", "content"),
                ]);
                const result = await computeStats([ts1, ts2], {createFoldersForSubpages});

                expect(result.teamspaces.get(ts1.notionId)!.documents.expectedCount).toBe(2);
                expect(result.teamspaces.get(ts2.notionId)!.documents.expectedCount).toBe(1);
            });

            test("all imported counters are zero", async () => {
                const image = new ExportedNotionFile("photo.png", "image");
                const video = new ExportedNotionFile("clip.mp4", "video");
                const audio = new ExportedNotionFile("song.mp3", "audio");
                const doc = new ExportedNotionDocument(
                    "Media",
                    `${image.toReference()} ${video.toReference()} ${audio.toReference()}`,
                );
                doc.files.push(image, video, audio);
                const result = await computeStats([doc], {createFoldersForSubpages});

                const stats = [...result.teamspaces.values()][0]!;
                expect(stats.documents.imported).toBe(0);
                for (const fileStats of stats.files.values()) {
                    expect(fileStats.imported).toBe(0);
                }
            });

            test("counts binary files in multi-teamspace exports", async () => {
                const image1 = new ExportedNotionFile("logo.png", "image");
                const image2 = new ExportedNotionFile("banner.png", "image");
                const video = new ExportedNotionFile("demo.mp4", "video");

                const docWithMedia = new ExportedNotionDocument(
                    "Brand Assets",
                    `${image1.toReference()} ${image2.toReference()} ${video.toReference()}`,
                );
                docWithMedia.files.push(image1, image2, video);

                const docPlain = new ExportedNotionDocument("Guidelines", "Just text");

                const ts1 = new ExportedNotionTeamspace("Design", [docWithMedia]);
                const ts2 = new ExportedNotionTeamspace("Sales", [docPlain]);
                const result = await computeStats([ts1, ts2], {createFoldersForSubpages});

                const designStats = result.teamspaces.get(ts1.notionId)!;
                expect(designStats.documents.expectedCount).toBe(1);
                expect(designStats.files.get("image/png")?.expectedCount).toBe(2);
                expect(designStats.files.get("image/png")?.size).toBeGreaterThan(0);
                expect(designStats.files.get("video/mp4")?.expectedCount).toBe(1);
                expect(designStats.files.get("video/mp4")?.size).toBeGreaterThan(0);

                const salesStats = result.teamspaces.get(ts2.notionId)!;
                expect(salesStats.documents.expectedCount).toBe(1);
                expect(salesStats.files.get("image/png")).toBeUndefined();
                expect(salesStats.files.get("video/mp4")).toBeUndefined();
            });

            test("attributes binary files to correct teamspace when second teamspace has files", async () => {
                const image = new ExportedNotionFile("photo.png", "image");
                const video = new ExportedNotionFile("clip.mp4", "video");

                const docPlain = new ExportedNotionDocument("Overview", "Just text");
                const docWithMedia = new ExportedNotionDocument(
                    "Media Page",
                    `${image.toReference()} ${video.toReference()}`,
                );
                docWithMedia.files.push(image, video);

                const ts1 = new ExportedNotionTeamspace("First", [docPlain]);
                const ts2 = new ExportedNotionTeamspace("Second", [docWithMedia]);
                const result = await computeStats([ts1, ts2], {createFoldersForSubpages});

                const firstStats = result.teamspaces.get(ts1.notionId)!;
                expect(firstStats.documents.expectedCount).toBe(1);
                expect(firstStats.files.get("image/png")).toBeUndefined();
                expect(firstStats.files.get("video/mp4")).toBeUndefined();

                const secondStats = result.teamspaces.get(ts2.notionId)!;
                expect(secondStats.documents.expectedCount).toBe(1);
                expect(secondStats.files.get("image/png")?.expectedCount).toBe(1);
                expect(secondStats.files.get("image/png")?.size).toBeGreaterThan(0);
                expect(secondStats.files.get("video/mp4")?.expectedCount).toBe(1);
                expect(secondStats.files.get("video/mp4")?.size).toBeGreaterThan(0);
            });

            test("distributes binary files across multiple teamspaces", async () => {
                const image1 = new ExportedNotionFile("logo.png", "image");
                const image2 = new ExportedNotionFile("banner.jpg", "image");
                const video = new ExportedNotionFile("demo.mp4", "video");
                const audio = new ExportedNotionFile("podcast.mp3", "audio");

                const doc1 = new ExportedNotionDocument(
                    "Design Assets",
                    `${image1.toReference()} ${video.toReference()}`,
                );
                doc1.files.push(image1, video);

                const doc2 = new ExportedNotionDocument(
                    "Marketing Kit",
                    `${image2.toReference()} ${audio.toReference()}`,
                );
                doc2.files.push(image2, audio);

                const ts1 = new ExportedNotionTeamspace("Design", [doc1]);
                const ts2 = new ExportedNotionTeamspace("Marketing", [doc2]);
                const result = await computeStats([ts1, ts2], {createFoldersForSubpages});

                const designStats = result.teamspaces.get(ts1.notionId)!;
                expect(designStats.files.get("image/png")?.expectedCount).toBe(1);
                expect(designStats.files.get("video/mp4")?.expectedCount).toBe(1);
                expect(designStats.files.get("audio/mpeg")).toBeUndefined();

                const marketingStats = result.teamspaces.get(ts2.notionId)!;
                expect(marketingStats.files.get("image/jpeg")?.expectedCount).toBe(1);
                expect(marketingStats.files.get("video/mp4")).toBeUndefined();
                expect(marketingStats.files.get("audio/mpeg")?.expectedCount).toBe(1);
            });

            test("does not cross-contaminate counts between teamspaces", async () => {
                const ts1 = new ExportedNotionTeamspace("Engineering", [
                    new ExportedNotionDocument("Doc 1", "content"),
                    new ExportedNotionDocument("Doc 2", "content"),
                    new ExportedNotionDocument("Doc 3", "content"),
                ]);
                const ts2 = new ExportedNotionTeamspace("Marketing", [
                    new ExportedNotionDocument("Campaign", "content"),
                ]);
                const ts3 = new ExportedNotionTeamspace("Empty Team", []);
                const result = await computeStats([ts1, ts2, ts3], {createFoldersForSubpages});

                expect(result.teamspaces.size).toBe(3);
                expect(result.teamspaces.get(ts1.notionId)!.documents.expectedCount).toBe(3);
                expect(result.teamspaces.get(ts2.notionId)!.documents.expectedCount).toBe(1);
                expect(result.teamspaces.get(ts3.notionId)!.documents.expectedCount).toBe(0);
            });

            test("counts full-page database as a document", async () => {
                const db = new ExportedNotionDatabase("Task Tracker", [
                    ["Name", "Status"],
                    ["Task 1", "Done"],
                ]);
                const parent = new ExportedNotionDocument("Project", `Tasks: ${db.toReference()}`, [
                    db,
                ]);
                const result = await computeStats([parent], {createFoldersForSubpages});

                const stats = [...result.teamspaces.values()][0]!;
                // parent .md + full-page database .md = 2
                expect(stats.documents.expectedCount).toBe(2);
            });

            test("does not count inline database as a document", async () => {
                const inlineDb = new ExportedNotionDatabase(
                    "Team Members",
                    [
                        ["Name", "Role"],
                        ["Alice", "Engineer"],
                    ],
                    [],
                    {inline: true},
                );
                const parent = new ExportedNotionDocument(
                    "Overview",
                    `Team: ${inlineDb.toCsvReference()}`,
                    [inlineDb],
                );
                const result = await computeStats([parent], {createFoldersForSubpages});

                const stats = [...result.teamspaces.values()][0]!;
                // Only the parent .md — inline database has no .md file
                expect(stats.documents.expectedCount).toBe(1);
            });

            test("counts full-page but not inline databases across teamspaces", async () => {
                const fullPageDb = new ExportedNotionDatabase("Roadmap", [
                    ["Feature", "Quarter"],
                    ["Search", "Q1"],
                ]);
                const docWithFullPage = new ExportedNotionDocument(
                    "Planning",
                    `See: ${fullPageDb.toReference()}`,
                    [fullPageDb],
                );

                const inlineDb = new ExportedNotionDatabase(
                    "Metrics",
                    [
                        ["KPI", "Value"],
                        ["Revenue", "100"],
                    ],
                    [],
                    {inline: true},
                );
                const docWithInline = new ExportedNotionDocument(
                    "Dashboard",
                    `Data: ${inlineDb.toCsvReference()}`,
                    [inlineDb],
                );

                const ts1 = new ExportedNotionTeamspace("Product", [docWithFullPage]);
                const ts2 = new ExportedNotionTeamspace("Analytics", [docWithInline]);
                const result = await computeStats([ts1, ts2], {createFoldersForSubpages});

                // Product: Planning .md + Roadmap .md = 2
                expect(result.teamspaces.get(ts1.notionId)!.documents.expectedCount).toBe(2);
                // Analytics: Dashboard .md only — inline db has no .md
                expect(result.teamspaces.get(ts2.notionId)!.documents.expectedCount).toBe(1);
            });
        });
    }
});
