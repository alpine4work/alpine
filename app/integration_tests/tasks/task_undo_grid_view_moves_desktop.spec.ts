import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {pageKeyboardShortcut} from "~/app/integration_tests/helpers/page_keyboard_shortcut.js";
import {expectTaskRowViewPriority} from "~/app/integration_tests/tasks/helpers/expect_task_grid_view.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {commitTaskActionTransaction} from "~/server/tasks/data/commit_task_action_transaction.js";
import {testTaskClock} from "~/server/tasks/data/test_helpers/test_task_clock.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";
import {serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";
import {
    createTaskTitleFromText,
    randomlyGenerateTaskTitleClientId,
} from "~/shared/tasks/title/task_title.js";

const {context, services} = createTestServices();

let space: TestSpace;
let session1: TestSpaceSession;
let session2: TestSpaceSession;
let collection: TestTaskCollection;

test.beforeAll(async () => {
    // Give this hook a long timeout...
    test.setTimeout(1000 * 60 * 3);

    space = await TestSpace.create(context);
    session1 = await space.createSession();
    session2 = await space.createSession();

    collection = await TestTaskCollection.create(session1);
    await collection.access.grantDefault(session1);

    // Used to control parallelism. We run 3 action transactions in parallel at once.
    const promiseWaiter = new PromiseWaiter();
    const mutexes = createArrayWithLength(3, () => new Mutex());

    const taskCount = 300;
    let logTaskIndex = 0;

    for (let taskIndex = 0; taskIndex < taskCount; taskIndex++) {
        const taskId = generateId<TaskId>();

        const actions: Array<TaskAction> = [];

        actions.push({
            type: "UpdateTask",
            time: testTaskClock.now(),
            taskId,
            taskAction: {
                type: "Create",
                creator: {accountId: session1.account.id, from: null},
                creatorTimeZone: defaultTimeZone,
            },
        });

        actions.push({
            type: "UpdateTask",
            time: testTaskClock.now(),
            taskId,
            taskAction: {
                type: "UpdateTitle",
                titleUpdate: createTaskTitleFromText(
                    randomlyGenerateTaskTitleClientId(),
                    `Task ${taskIndex + 1}`,
                ),
            },
        });

        actions.push({
            type: "UpdateTask",
            time: testTaskClock.now(),
            taskId,
            taskAction: {
                type: "AddCollection",
                collectionId: collection.id,
                orderKey: initialOrderKey,
            },
        });

        if (taskIndex < 5) {
            actions.push({
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "High",
                },
            });
        } else {
            actions.push({
                type: "UpdateTask",
                time: testTaskClock.now(),
                taskId,
                taskAction: {
                    type: "UpdatePriority",
                    priority: "Medium",
                },
            });
        }

        promiseWaiter.waitUntil(
            mutexes[taskIndex % mutexes.length]!.withLock(async () => {
                await commitTaskActionTransaction(session1.action(), space.id, actions);

                logTaskIndex++;
                // eslint-disable-next-line no-console
                console.log(`Created task ${logTaskIndex}/${taskCount}`);
            }),
        );
    }

    await promiseWaiter.wait();
});

test("undo/redo can move a task between positions", async ({page, context: browserContext}) => {
    const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "Collections",
            operation: {
                type: "IncludesOneOf",
                collectionIds: new Set([collection.id]),
            },
        },
    ]);

    const sortsSearchParam = serializeTaskQuerySortsSearchParam([
        {
            type: "Priority",
            direction: "Descending",
        },
        {
            type: "CreatedTime",
            direction: "Ascending",
        },
    ]);

    await services.signIn(browserContext, session2);
    await page.goto(
        `/task-view/new/${space.id}?filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
    );

    const taskLocator1 = page.getByTestId(/^TaskRowView:/).nth(0);
    const taskLocator2 = page.getByTestId(/^TaskRowView:/).nth(1);
    const taskLocator3 = page.getByTestId(/^TaskRowView:/).nth(2);
    const taskLocator4 = page.getByTestId(/^TaskRowView:/).nth(3);
    const taskLocator5 = page.getByTestId(/^TaskRowView:/).nth(4);
    const taskLocator6 = page.getByTestId(/^TaskRowView:/).nth(5);
    const taskLocator7 = page.getByTestId(/^TaskRowView:/).nth(6);
    const taskLocator8 = page.getByTestId(/^TaskRowView:/).nth(7);
    const taskLocator9 = page.getByTestId(/^TaskRowView:/).nth(8);

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "High");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");

    // Hover over the cell to mount the input. For performance we don't initially mount
    // the input.
    await taskLocator3.getByTestId("TaskRowPriorityCell").hover();

    await taskLocator3.getByLabel("Priority").click();

    await page.getByRole("option", {name: "Medium"}).click();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "Medium");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");

    await expect(taskLocator3.getByTestId("TaskRowPriorityCell")).not.toBeFocused();
    await expect(taskLocator5.getByTestId("TaskRowPriorityCell")).not.toBeFocused();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(taskLocator3.getByTestId("TaskRowPriorityCell")).toBeFocused();
    await expect(taskLocator5.getByTestId("TaskRowPriorityCell")).not.toBeFocused();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "High");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(taskLocator3.getByTestId("TaskRowPriorityCell")).not.toBeFocused();
    await expect(taskLocator5.getByTestId("TaskRowPriorityCell")).toBeFocused();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "Medium");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(taskLocator3.getByTestId("TaskRowPriorityCell")).toBeFocused();
    await expect(taskLocator5.getByTestId("TaskRowPriorityCell")).not.toBeFocused();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "High");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");
});

test("undo/redo can recover a task that leaves the loaded range", async ({
    page,
    context: browserContext,
}) => {
    const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "Collections",
            operation: {
                type: "IncludesOneOf",
                collectionIds: new Set([collection.id]),
            },
        },
    ]);

    const sortsSearchParam = serializeTaskQuerySortsSearchParam([
        {
            type: "Priority",
            direction: "Descending",
        },
        {
            type: "CreatedTime",
            direction: "Ascending",
        },
    ]);

    await services.signIn(browserContext, session2);
    await page.goto(
        `/task-view/new/${space.id}?filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
    );

    const taskLocator1 = page.getByTestId(/^TaskRowView:/).nth(0);
    const taskLocator2 = page.getByTestId(/^TaskRowView:/).nth(1);
    const taskLocator3 = page.getByTestId(/^TaskRowView:/).nth(2);
    const taskLocator4 = page.getByTestId(/^TaskRowView:/).nth(3);
    const taskLocator5 = page.getByTestId(/^TaskRowView:/).nth(4);
    const taskLocator6 = page.getByTestId(/^TaskRowView:/).nth(5);
    const taskLocator7 = page.getByTestId(/^TaskRowView:/).nth(6);
    const taskLocator8 = page.getByTestId(/^TaskRowView:/).nth(7);
    const taskLocator9 = page.getByTestId(/^TaskRowView:/).nth(8);

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "High");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");

    // Hover over the cell to mount the input. For performance we don't initially mount
    // the input.
    await taskLocator3.getByTestId("TaskRowPriorityCell").hover();

    await taskLocator3.getByLabel("Priority").click();

    await page.getByRole("option", {name: "Low"}).click();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "Medium");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 10");

    await expect(taskLocator3.getByTestId("TaskRowPriorityCell")).not.toBeFocused();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(taskLocator3.getByTestId("TaskRowPriorityCell")).toBeFocused();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "High");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(taskLocator3.getByTestId("TaskRowPriorityCell")).not.toBeFocused();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "Medium");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 10");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(taskLocator3.getByTestId("TaskRowPriorityCell")).toBeFocused();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "High");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");
});

test("undo/redo can bring back a task you lost access to with a lease", async ({
    page,
    context: browserContext,
}) => {
    const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
        {
            type: "Collections",
            operation: {
                type: "IncludesOneOf",
                collectionIds: new Set([collection.id]),
            },
        },
    ]);

    const sortsSearchParam = serializeTaskQuerySortsSearchParam([
        {
            type: "Priority",
            direction: "Descending",
        },
        {
            type: "CreatedTime",
            direction: "Ascending",
        },
    ]);

    await services.signIn(browserContext, session2);
    await page.goto(
        `/task-view/new/${space.id}?filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
    );

    const taskLocator1 = page.getByTestId(/^TaskRowView:/).nth(0);
    const taskLocator2 = page.getByTestId(/^TaskRowView:/).nth(1);
    const taskLocator3 = page.getByTestId(/^TaskRowView:/).nth(2);
    const taskLocator4 = page.getByTestId(/^TaskRowView:/).nth(3);
    const taskLocator5 = page.getByTestId(/^TaskRowView:/).nth(4);
    const taskLocator6 = page.getByTestId(/^TaskRowView:/).nth(5);
    const taskLocator7 = page.getByTestId(/^TaskRowView:/).nth(6);
    const taskLocator8 = page.getByTestId(/^TaskRowView:/).nth(7);
    const taskLocator9 = page.getByTestId(/^TaskRowView:/).nth(8);

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "High");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");

    await taskLocator3.getByTestId("TaskRowCollectionsCell").focus();
    await page.getByTestId("TaskRowCollectionsCellOverlay").getByLabel("Remove").click();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "Medium");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 10");

    await expect(taskLocator3.getByTestId("TaskRowCollectionsCell")).not.toBeFocused();

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(taskLocator3.getByTestId("TaskRowCollectionsCell")).toBeFocused();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "High");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expect(taskLocator3.getByTestId("TaskRowCollectionsCell")).not.toBeFocused();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "Medium");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 10");

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expect(taskLocator3.getByTestId("TaskRowCollectionsCell")).toBeFocused();

    await expectTaskRowViewPriority(taskLocator1, "High");
    await expectTaskRowViewPriority(taskLocator2, "High");
    await expectTaskRowViewPriority(taskLocator3, "High");
    await expectTaskRowViewPriority(taskLocator4, "High");
    await expectTaskRowViewPriority(taskLocator5, "High");
    await expectTaskRowViewPriority(taskLocator6, "Medium");
    await expectTaskRowViewPriority(taskLocator7, "Medium");
    await expectTaskRowViewPriority(taskLocator8, "Medium");
    await expectTaskRowViewPriority(taskLocator9, "Medium");

    await expect(taskLocator1.getByRole("textbox", {name: "Title"})).toHaveText("Task 1");
    await expect(taskLocator2.getByRole("textbox", {name: "Title"})).toHaveText("Task 2");
    await expect(taskLocator3.getByRole("textbox", {name: "Title"})).toHaveText("Task 3");
    await expect(taskLocator4.getByRole("textbox", {name: "Title"})).toHaveText("Task 4");
    await expect(taskLocator5.getByRole("textbox", {name: "Title"})).toHaveText("Task 5");
    await expect(taskLocator6.getByRole("textbox", {name: "Title"})).toHaveText("Task 6");
    await expect(taskLocator7.getByRole("textbox", {name: "Title"})).toHaveText("Task 7");
    await expect(taskLocator8.getByRole("textbox", {name: "Title"})).toHaveText("Task 8");
    await expect(taskLocator9.getByRole("textbox", {name: "Title"})).toHaveText("Task 9");
});
