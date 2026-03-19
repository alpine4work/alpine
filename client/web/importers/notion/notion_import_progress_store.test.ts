import {NotionImportProgressStore} from "~/client/web/importers/notion/notion_import_progress_store.js";
import {LocalNotionImportItem} from "~/client/web/importers/notion/notion_import_types.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {NotionImportProcessingOrDoneResult} from "~/shared/importer/notion/notion_import_item.js";

const mb = 1024 * 1024;

function makeTeamspaceStats(overrides?: {
    documents?: {imported?: number; expectedCount?: number};
    files?: Map<string, {imported: number; expectedCount: number; size: number}>;
}) {
    return {
        documents: {imported: 0, expectedCount: 0, ...overrides?.documents},
        files: overrides?.files ?? new Map(),
    };
}

function makeResult(
    ...teamspaces: Array<[string, ReturnType<typeof makeTeamspaceStats>]>
): NotionImportProcessingOrDoneResult {
    if (teamspaces.length === 0) {
        teamspaces = [["ts1", makeTeamspaceStats()]];
    }
    return {
        teamspaces: new Map(teamspaces),
    };
}

function makeProcessingItem(
    result: NotionImportProcessingOrDoneResult,
    options?: {elapsedMs?: number},
): LocalNotionImportItem {
    const now = new Date();
    const startedProcessingTime = options?.elapsedMs
        ? new Date(now.getTime() - options.elapsedMs)
        : now;

    return {
        notionImportId: "import1" as any,
        spaceId: "space1" as any,
        workspaceName: "Test Workspace",
        startedByAccountId: "account1" as any,
        createdTime: startedProcessingTime,
        updatedTime: now,
        startedProcessingTime,
        teamspaceImportOptions: null,
        status: {type: "Processing", result},
    };
}

describe("NotionImportProgressStore", () => {
    test("estimate is null before first update", () => {
        const store = new NotionImportProgressStore(defaultLocale);
        expect(store.estimate.getSnapshot()).toBeNull();
    });

    test("estimate is null for statuses without progress data", () => {
        const store = new NotionImportProgressStore(defaultLocale);
        const item = makeProcessingItem(makeResult(["ts1", makeTeamspaceStats()]));
        store.update({
            ...item,
            status: {type: "UploadPending"},
        });
        expect(store.estimate.getSnapshot()).toBeNull();
    });

    test("produces percent complete from processing item", () => {
        const store = new NotionImportProgressStore(defaultLocale);
        const result = makeResult([
            "ts1",
            makeTeamspaceStats({
                files: new Map([["image/png", {imported: 5, expectedCount: 10, size: 30 * mb}]]),
            }),
        ]);
        store.update(makeProcessingItem(result));
        expect(store.estimate.getSnapshot()?.percentComplete).toBe(50);
    });

    test("success sets percent to 100", () => {
        const store = new NotionImportProgressStore(defaultLocale);
        const result = makeResult([
            "ts1",
            makeTeamspaceStats({
                files: new Map([["image/png", {imported: 10, expectedCount: 10, size: 30 * mb}]]),
            }),
        ]);
        const item: LocalNotionImportItem = {
            ...makeProcessingItem(result),
            status: {type: "Success", result},
        };
        store.update(item);
        expect(store.estimate.getSnapshot()?.percentComplete).toBe(100);
    });

    test("terminal state clears time remaining", () => {
        const store = new NotionImportProgressStore(defaultLocale);
        const result = makeResult([
            "ts1",
            makeTeamspaceStats({
                files: new Map([["image/png", {imported: 10, expectedCount: 10, size: 30 * mb}]]),
            }),
        ]);
        const start = new Date("2024-01-01T00:00:00Z");
        const end = new Date("2024-01-01T00:05:00Z");
        const item: LocalNotionImportItem = {
            notionImportId: "import1" as any,
            spaceId: "space1" as any,
            workspaceName: "Test",
            startedByAccountId: "account1" as any,
            createdTime: start,
            updatedTime: end,
            startedProcessingTime: start,
            teamspaceImportOptions: null,
            status: {type: "Success", result},
        };
        store.update(item);
        const snapshot = store.estimate.getSnapshot();
        expect(snapshot?.timeRemainingDisplay).toBeNull();
        expect(snapshot?.timeElapsedDisplay).toBe("5 minutes");
    });

    test("processing state shows time remaining", () => {
        const store = new NotionImportProgressStore(defaultLocale);
        const result = makeResult([
            "ts1",
            makeTeamspaceStats({
                files: new Map([["video/mp4", {imported: 0, expectedCount: 10, size: 500 * mb}]]),
            }),
        ]);
        store.update(makeProcessingItem(result));
        expect(store.estimate.getSnapshot()?.timeRemainingDisplay).not.toBeNull();
    });

    test("subsequent updates increase percent", () => {
        const store = new NotionImportProgressStore(defaultLocale);
        const result1 = makeResult([
            "ts1",
            makeTeamspaceStats({
                files: new Map([["image/png", {imported: 2, expectedCount: 10, size: 30 * mb}]]),
            }),
        ]);
        store.update(makeProcessingItem(result1));
        const first = store.estimate.getSnapshot()!.percentComplete;

        const result2 = makeResult([
            "ts1",
            makeTeamspaceStats({
                files: new Map([["image/png", {imported: 8, expectedCount: 10, size: 30 * mb}]]),
            }),
        ]);
        store.update(makeProcessingItem(result2));
        const second = store.estimate.getSnapshot()!.percentComplete;

        expect(second).toBeGreaterThan(first);
    });

    test("real import with many videos shows significant time remaining", () => {
        const store = new NotionImportProgressStore(defaultLocale);
        const result = makeResult(
            [
                "Private&Shared",
                makeTeamspaceStats({
                    documents: {imported: 0, expectedCount: 15},
                    files: new Map([
                        ["text/markdown", {imported: 0, expectedCount: 1, size: 10}],
                        ["image/png", {imported: 7, expectedCount: 117, size: 80033500}],
                        ["image/gif", {imported: 0, expectedCount: 13, size: 1607762}],
                        ["video/mp4", {imported: 0, expectedCount: 79, size: 101796886}],
                        ["image/jpeg", {imported: 0, expectedCount: 65, size: 62175741}],
                        ["image/webp", {imported: 0, expectedCount: 19, size: 6073692}],
                    ]),
                }),
            ],
            [
                "2f178915cb0e81b2b9c90042322642ab",
                makeTeamspaceStats({
                    documents: {imported: 0, expectedCount: 1217},
                    files: new Map([
                        ["image/jpeg", {imported: 81, expectedCount: 16, size: 17731021}],
                        ["application/pdf", {imported: 22, expectedCount: 22, size: 1159062}],
                        ["video/mp4", {imported: 1, expectedCount: 38, size: 46257014}],
                        ["audio/mpeg", {imported: 9, expectedCount: 9, size: 25718553}],
                        ["image/png", {imported: 141, expectedCount: 31, size: 14717664}],
                        ["image/gif", {imported: 17, expectedCount: 4, size: 494696}],
                        ["image/webp", {imported: 21, expectedCount: 2, size: 639336}],
                    ]),
                }),
            ],
        );
        store.update(makeProcessingItem(result));
        const snapshot = store.estimate.getSnapshot()!;
        expect(snapshot.timeRemainingDisplay).toBe("About 3 minutes remaining");
    });
});
