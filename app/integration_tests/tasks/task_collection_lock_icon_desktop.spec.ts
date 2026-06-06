import {expect, test} from "@playwright/test";
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";

const {context, services} = createTestServices();

async function createTaskWithPrivateAndPublicCollections(
    session: TestSpaceSession,
    taskTitle: string,
) {
    // TODO(#sites): Once we've built out sites, extend these tests to exercise
    // collections in private sites. To make sure the `siteRegistry` logic is all wired
    // properly.
    const privateCollection = await TestTaskCollection.create(session, {name: "Private"});
    const publicCollection = await TestTaskCollection.create(session, {
        name: "Public",
        access: "Public",
    });
    const task = await TestTask.create(session, {
        title: taskTitle,
        collections: [privateCollection, publicCollection],
    });

    return {task, privateCollection, publicCollection};
}

test("shows lock icon for private collection chips in task detail view", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {task, privateCollection, publicCollection} =
        await createTaskWithPrivateAndPublicCollections(session, "Task detail lock test");

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    const privateChip = page
        .getByTestId("TaskCollectionsInput")
        .getByTestId("TaskCollectionChip")
        .filter({hasText: privateCollection.initialName});
    await expect(privateChip).toBeVisible();
    await expect(privateChip.getByRole("img", {name: "Private lock icon"})).toBeVisible();

    const publicChip = page
        .getByTestId("TaskCollectionsInput")
        .getByTestId("TaskCollectionChip")
        .filter({hasText: publicCollection.initialName});
    await expect(publicChip).toBeVisible();
    await expect(publicChip.getByRole("img", {name: "Private lock icon"})).toHaveCount(0);
});

test("shows lock icon for private collection chips in task query view", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {task, privateCollection, publicCollection} =
        await createTaskWithPrivateAndPublicCollections(session, "Task query lock test");

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "Collections",
            operation: {
                type: "IncludesOneOf",
                collectionIds: new Set([privateCollection.id]),
            },
        },
    ]);
    await page.goto(`/task-view/new/${space.id}?filter=${filtersSearchParam}`);

    const queryCell = page
        .getByTestId(`TaskRowView:${task.id}`)
        .getByTestId("TaskRowCollectionsCell");

    const chips = queryCell.getByTestId("TaskCollectionChip");
    await expect(chips).toHaveCount(2);

    const chipsWithPrivateLockIcon = chips.filter({
        has: page.getByRole("img", {name: "Private lock icon"}),
    });
    await expect(chipsWithPrivateLockIcon).toHaveCount(1);

    const publicChip = chips.filter({hasText: publicCollection.initialName});
    await expect(publicChip).toBeVisible();
    await expect(publicChip.getByRole("img", {name: "Private lock icon"})).toHaveCount(0);
});

test("shows lock icon for private collection options in collections dropdown", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const privateCollectionOption = await TestTaskCollection.create(session, {
        name: "Private dropdown option",
    });

    const task = await TestTask.create(session, {title: "Task dropdown lock test"});

    // Ensure this collection appears in search results.
    await TestTask.create(session, {
        title: "Task in private option collection",
        collections: privateCollectionOption,
    });

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    await page.goto(`/task/${task.id}`);

    const collectionsCombobox = page.getByRole("combobox", {name: "Collections"});
    await collectionsCombobox.click();
    await expect(page.getByRole("option", {name: "Create collection"})).toBeVisible();

    const privateOption = page
        .getByRole("option")
        .filter({has: page.getByText(privateCollectionOption.initialName, {exact: true})});
    await collectionsCombobox.fill(privateCollectionOption.initialName);
    await expect(privateOption).toHaveCount(1, {timeout: 15_000});
    await expect(privateOption).toBeVisible();
    await expect(privateOption.getByRole("img", {name: "Private lock icon"})).toBeVisible();
});

test("shows lock icon for private collection chips in task file entity previews", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const {task, privateCollection, publicCollection} =
        await createTaskWithPrivateAndPublicCollections(session, "Task preview lock test");

    const documentTitle = "Task lock icon document";
    const document = await TestDocument.create(session, {title: documentTitle});

    const replaceStart = documentTitle.length + 2;
    const replaceEnd = replaceStart + 2;
    await document.update(session, [
        new ReplaceStep(
            replaceStart,
            replaceEnd,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Task:${task.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await ProcessContextModule.waitForTestTasks();
    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    const taskPreview = page.getByTestId("ContentFileEntityPreview:Task");
    await expect(taskPreview).toHaveCount(1);

    const privateChip = taskPreview
        .getByTestId("TaskCollectionChip")
        .filter({hasText: privateCollection.initialName});
    await expect(privateChip).toBeVisible();
    await expect(privateChip.getByRole("img", {name: "Private lock icon"})).toBeVisible();

    const publicChip = taskPreview
        .getByTestId("TaskCollectionChip")
        .filter({hasText: publicCollection.initialName});
    await expect(publicChip).toBeVisible();
    await expect(publicChip.getByRole("img", {name: "Private lock icon"})).toHaveCount(0);
});
