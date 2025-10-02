// To update generated snapshots run:
//
// ```
// bazel run //client/content:file_entity/internal/content_file_task_collection_entity_preview_test -- --updateSnapshot
// ```

import {renderContentFileTaskCollectionEntityPreview} from "~/client/content/file_entity/internal/content_file_task_collection_entity_preview.js";
import {normalizeHtmlClassNameHashesForTest} from "~/client/content/file_entity/internal/test_helpers/normalize_html_class_name_hashes_for_test.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {FileTaskCollectionEntityModelSchema} from "~/shared/tasks/file_task_collection_entity_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    createTestTaskWithTitle,
    updateTestTaskWithStatus,
} from "~/shared/tasks/test_helpers/task_model_test_helpers.js";

function createMockTaskCollectionModel(name: string, color: string): TaskCollectionModel {
    return {
        getName: () => name,
        getColor: () => color,
    } as TaskCollectionModel;
}

function createMockTaskModelWithStatus(
    title: string,
    status: "Open" | "Closed" = "Open",
): TaskModel {
    // Create a test task with the given title
    const task = createTestTaskWithTitle({
        title,
        taskId: assertId<TaskId>("ynfzf5f2djp2yq7gv7bde2zqy8"),
        creatorId: assertId<AccountId>("ne9xp93dwgcwccj661x3ntdb9w"),
        spaceId: assertId<SpaceId>("4ch98kddfs9vhz3qhdh4k7j5tc"),
        createdTime: [new Date("2025-01-01").getTime(), 0],
    });

    return updateTestTaskWithStatus({
        task,
        displayStatus: status,
    });
}

function createTaskCollectionEntityModel(
    collectionName: string,
    collectionColor: string,
    tasks: Array<{title: string; status?: "Open" | "Closed"}> = [],
): FileEntityModel {
    const baseModel = {
        type: "TaskCollection" as const,
        versions: zeroHybridLogicalTime,
        collection: createMockTaskCollectionModel(collectionName, collectionColor),
        previewTasks: tasks.map(task => createMockTaskModelWithStatus(task.title, task.status)),
    };

    return new FileEntityModel(FileTaskCollectionEntityModelSchema, baseModel);
}

describe("renderContentFileTaskCollectionEntityPreview - Snapshots", () => {
    const spacingScales = ["small", "medium", "large"] as const;
    const layouts = [
        {width: 100, name: "fourth-width", height: 200}, // < 1/4 block max
        {width: 200, name: "third-width", height: 300}, // < 1/3 block max
        {width: 300, name: "half-width", height: 400}, // < 1/2 block max
        {width: 800, name: "full-width", height: 500}, // >= 1/2 block max
    ] as const;
    const platforms = ["desktop", "mobile"] as const;

    // Test basic rendering with different tasks
    const testCases = [
        {
            name: "with-multiple-tasks",
            tasks: [
                {title: "Active Task", status: "Open" as const},
                {title: "Second Active Task", status: "Open" as const},
                {title: "Closed Task", status: "Closed" as const},
            ],
        },
        {
            name: "with-no-tasks",
            tasks: [],
        },
        {
            name: "with-single-task",
            tasks: [{title: "Only Task"}],
        },
        {
            name: "with-long-title",
            tasks: [
                {
                    title: "This is a very long task title that should be truncated properly",
                },
            ],
        },
    ];

    spacingScales.forEach(spacingScale => {
        describe(`spacingScale: ${spacingScale}`, () => {
            layouts.forEach(layout => {
                platforms.forEach(platform => {
                    testCases.forEach(testCase => {
                        test(`${layout.name} ${platform} ${testCase.name}`, () => {
                            const fileEntity = createTaskCollectionEntityModel(
                                "Test Collection",
                                "blue",
                                testCase.tasks,
                            );
                            const html = new HtmlElementGenerator("div");

                            renderContentFileTaskCollectionEntityPreview(
                                store => store.getSnapshot(),
                                html,
                                {
                                    fileEntity,
                                    layout: {
                                        width: layout.width,
                                        widthFr: 1,
                                        height: layout.height,
                                    },
                                    platform,
                                    spacingScale,
                                },
                            );

                            expect(
                                normalizeHtmlClassNameHashesForTest(html.generateHtml()),
                            ).toMatchSnapshot();
                        });
                    });
                });
            });
        });
    });

    // Test different collection colors
    const colors = [
        "blue",
        "red",
        "green",
        "purple",
        "orange",
        "cyan",
        "yellow",
        "pink",
        "indigo",
    ] as const;

    describe("colors", () => {
        colors.forEach(color => {
            test(`${color} collection`, () => {
                const fileEntity = createTaskCollectionEntityModel("Color Test Collection", color, [
                    {title: "Color Task"},
                ]);
                const html = new HtmlElementGenerator("div");

                renderContentFileTaskCollectionEntityPreview(store => store.getSnapshot(), html, {
                    fileEntity,
                    layout: {width: 400, widthFr: 1, height: 300},
                    platform: "desktop",
                    spacingScale: "medium",
                });

                expect(normalizeHtmlClassNameHashesForTest(html.generateHtml())).toMatchSnapshot();
            });
        });
    });
});
