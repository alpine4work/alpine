import {today} from "@internationalized/date";
import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {pageKeyboardShortcut} from "~/app/integration_tests/helpers/page_keyboard_shortcut.js";
import {expectTaskGridView} from "~/app/integration_tests/tasks/helpers/expect_task_grid_view.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";

const {context, services} = createTestServices();

test("sections in personal view: 1, 2, 3, 4", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [activeTask, overdueTask, dueTodayTask, dueSoonTask, remainingTask] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
        ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        activeTask.updateAssignee(session, session),
        activeTask.updateAssigneeStatus(session, "Active"),
        activeTask.typeTitle(session, "Test task 1"),

        overdueTask.updateAssignee(session, session),
        overdueTask.updateDueDate(session, currentDate.subtract({days: 1})),
        overdueTask.typeTitle(session, "Test task 2"),

        dueTodayTask.updateAssignee(session, session),
        dueTodayTask.updateDueDate(session, currentDate),
        dueTodayTask.typeTitle(session, "Test task 3"),

        dueSoonTask.updateAssignee(session, session),
        dueSoonTask.updateDueDate(session, currentDate.add({days: 1})),
        dueSoonTask.typeTitle(session, "Test task 4"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(4)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(5)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(5)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(4)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 1, 2, 3", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [activeTask, overdueTask, dueTodayTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        activeTask.updateAssignee(session, session),
        activeTask.updateAssigneeStatus(session, "Active"),
        activeTask.typeTitle(session, "Test task 1"),

        overdueTask.updateAssignee(session, session),
        overdueTask.updateDueDate(session, currentDate.subtract({days: 1})),
        overdueTask.typeTitle(session, "Test task 2"),

        dueTodayTask.updateAssignee(session, session),
        dueTodayTask.updateDueDate(session, currentDate),
        dueTodayTask.typeTitle(session, "Test task 3"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(4)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(4)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 1, 2, 4", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [activeTask, overdueTask, dueSoonTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        activeTask.updateAssignee(session, session),
        activeTask.updateAssigneeStatus(session, "Active"),
        activeTask.typeTitle(session, "Test task 1"),

        overdueTask.updateAssignee(session, session),
        overdueTask.updateDueDate(session, currentDate.subtract({days: 1})),
        overdueTask.typeTitle(session, "Test task 2"),

        dueSoonTask.updateAssignee(session, session),
        dueSoonTask.updateDueDate(session, currentDate.add({days: 1})),
        dueSoonTask.typeTitle(session, "Test task 4"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            [true, "Test task 2"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(4)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(4)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 1, 3, 4", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [activeTask, dueTodayTask, dueSoonTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        activeTask.updateAssignee(session, session),
        activeTask.updateAssigneeStatus(session, "Active"),
        activeTask.typeTitle(session, "Test task 1"),

        dueTodayTask.updateAssignee(session, session),
        dueTodayTask.updateDueDate(session, currentDate),
        dueTodayTask.typeTitle(session, "Test task 3"),

        dueSoonTask.updateAssignee(session, session),
        dueSoonTask.updateDueDate(session, currentDate.add({days: 1})),
        dueSoonTask.typeTitle(session, "Test task 4"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(4)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(4)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 2, 3, 4", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [overdueTask, dueTodayTask, dueSoonTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        overdueTask.updateAssignee(session, session),
        overdueTask.updateDueDate(session, currentDate.subtract({days: 1})),
        overdueTask.typeTitle(session, "Test task 2"),

        dueTodayTask.updateAssignee(session, session),
        dueTodayTask.updateDueDate(session, currentDate),
        dueTodayTask.typeTitle(session, "Test task 3"),

        dueSoonTask.updateAssignee(session, session),
        dueSoonTask.updateDueDate(session, currentDate.add({days: 1})),
        dueSoonTask.typeTitle(session, "Test task 4"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(4)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(4)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 1, 2", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [activeTask, overdueTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        activeTask.updateAssignee(session, session),
        activeTask.updateAssigneeStatus(session, "Active"),
        activeTask.typeTitle(session, "Test task 1"),

        overdueTask.updateAssignee(session, session),
        overdueTask.updateDueDate(session, currentDate.subtract({days: 1})),
        overdueTask.typeTitle(session, "Test task 2"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            [true, "Test task 2"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 1, 3", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [activeTask, dueTodayTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        activeTask.updateAssignee(session, session),
        activeTask.updateAssigneeStatus(session, "Active"),
        activeTask.typeTitle(session, "Test task 1"),

        dueTodayTask.updateAssignee(session, session),
        dueTodayTask.updateDueDate(session, currentDate),
        dueTodayTask.typeTitle(session, "Test task 3"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            [true, "Test task 3"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 1, 4", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [activeTask, dueSoonTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        activeTask.updateAssignee(session, session),
        activeTask.updateAssigneeStatus(session, "Active"),
        activeTask.typeTitle(session, "Test task 1"),

        dueSoonTask.updateAssignee(session, session),
        dueSoonTask.updateDueDate(session, currentDate.add({days: 1})),
        dueSoonTask.typeTitle(session, "Test task 4"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 2, 3", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [overdueTask, dueTodayTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        overdueTask.updateAssignee(session, session),
        overdueTask.updateDueDate(session, currentDate.subtract({days: 1})),
        overdueTask.typeTitle(session, "Test task 2"),

        dueTodayTask.updateAssignee(session, session),
        dueTodayTask.updateDueDate(session, currentDate),
        dueTodayTask.typeTitle(session, "Test task 3"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 2, 4", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [overdueTask, dueSoonTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        overdueTask.updateAssignee(session, session),
        overdueTask.updateDueDate(session, currentDate.subtract({days: 1})),
        overdueTask.typeTitle(session, "Test task 2"),

        dueSoonTask.updateAssignee(session, session),
        dueSoonTask.updateDueDate(session, currentDate.add({days: 1})),
        dueSoonTask.typeTitle(session, "Test task 4"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            [true, "Test task 2"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 3, 4", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [dueTodayTask, dueSoonTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        dueTodayTask.updateAssignee(session, session),
        dueTodayTask.updateDueDate(session, currentDate),
        dueTodayTask.typeTitle(session, "Test task 3"),

        dueSoonTask.updateAssignee(session, session),
        dueSoonTask.updateDueDate(session, currentDate.add({days: 1})),
        dueSoonTask.typeTitle(session, "Test task 4"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(3)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 1", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [activeTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    await runAllPromises([
        activeTask.updateAssignee(session, session),
        activeTask.updateAssigneeStatus(session, "Active"),
        activeTask.typeTitle(session, "Test task 1"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 2", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [overdueTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        overdueTask.updateAssignee(session, session),
        overdueTask.updateDueDate(session, currentDate.subtract({days: 1})),
        overdueTask.typeTitle(session, "Test task 2"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            [true, "Test task 2"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 3", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [dueTodayTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        dueTodayTask.updateAssignee(session, session),
        dueTodayTask.updateDueDate(session, currentDate),
        dueTodayTask.typeTitle(session, "Test task 3"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            [true, "Test task 3"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("sections in personal view: 4", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [dueSoonTask, remainingTask] = await runAllPromises([
        TestTask.create(session),
        TestTask.create(session),
    ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        dueSoonTask.updateAssignee(session, session),
        dueSoonTask.updateDueDate(session, currentDate.add({days: 1})),
        dueSoonTask.typeTitle(session, "Test task 4"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(2)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("no sections in personal view", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [remainingTask] = await runAllPromises([TestTask.create(session)]);

    await runAllPromises([
        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeHidden();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeHidden();

    await expectTaskGridView(
        page,
        [
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rowTitleLocator(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rowTitleLocator(0)).toBeFocused();
});

test("interactions across all sections", async ({page, context: browserContext}) => {
    // Give this test a long timeout, it does a lot of stuff...
    test.setTimeout(1000 * 60 * 3);

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const [activeTask, overdueTask, dueTodayTask, dueSoonTask, remainingTask] =
        await runAllPromises([
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
            TestTask.create(session),
        ]);

    const currentDate = today(defaultTimeZone);

    await runAllPromises([
        activeTask.updateAssignee(session, session),
        activeTask.updateAssigneeStatus(session, "Active"),
        activeTask.typeTitle(session, "Test task 1"),

        overdueTask.updateAssignee(session, session),
        overdueTask.updateDueDate(session, currentDate.subtract({days: 1})),
        overdueTask.typeTitle(session, "Test task 2"),

        dueTodayTask.updateAssignee(session, session),
        dueTodayTask.updateDueDate(session, currentDate),
        dueTodayTask.typeTitle(session, "Test task 3"),

        dueSoonTask.updateAssignee(session, session),
        dueSoonTask.updateDueDate(session, currentDate.add({days: 1})),
        dueSoonTask.typeTitle(session, "Test task 4"),

        remainingTask.updateAssignee(session, session),
        remainingTask.typeTitle(session, "Test task 5"),
    ]);

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);
    await page.goto(`/my-tasks/${space.id}`);

    await expect(page.getByRole("heading", {name: "My tasks"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Active"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Overdue"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due today"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Due soon"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Tasks", exact: true})).toBeVisible();

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    const rowTitleLocator = (nth: number) =>
        page
            .getByTestId(/^TaskRowView:/)
            .nth(nth)
            .getByLabel("Title");

    await rowTitleLocator(0).click();
    await expect(rowTitleLocator(0)).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("t1a");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("Tab");

    await expectTaskGridView(
        page,
        [
            [["OpenActive", "Test task 1"], [[true, "t1a"]]],
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("Shift+Tab");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("t2a");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("Tab");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [[true, "Test task 2"], [[true, "t2a"]]],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("Shift+Tab");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("t3a");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("Tab");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [[true, "Test task 3"], [[true, "t3a"]]],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("Shift+Tab");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("t4a");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "t4a"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("Tab");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [[true, "Test task 4"], [[true, "t4a"]]],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("Shift+Tab");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "t4a"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("t5a");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "t4a"],
            [true, "Test task 5"],
            [true, "t5a"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("Tab");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "t4a"],
            [[true, "Test task 5"], [[true, "t5a"]]],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("Shift+Tab");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "t4a"],
            [true, "Test task 5"],
            [true, "t5a"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("t5b");

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "t4a"],
            [true, "Test task 5"],
            [true, "t5a"],
            [true, "t5b"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "t4a"],
            [true, "Test task 5"],
            [true, "t5a"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "t4a"],
            [[true, "Test task 5"], [[true, "t5a"]]],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "t4a"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [[true, "Test task 4"], [[true, "t4a"]]],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [[true, "Test task 3"], [[true, "t3a"]]],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [[true, "Test task 2"], [[true, "t2a"]]],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            [["OpenActive", "Test task 1"], [[true, "t1a"]]],
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            [true, "Test task 2"],
            [true, "Test task 3"],
            [true, "Test task 4"],
            [true, "Test task 5"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );

    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));
    await page.keyboard.press(await pageKeyboardShortcut(page, "mod", "shift", "z"));

    await expectTaskGridView(
        page,
        [
            ["OpenActive", "Test task 1"],
            ["OpenActive", "t1a"],
            [true, "Test task 2"],
            [true, "t2a"],
            [true, "Test task 3"],
            [true, "t3a"],
            [true, "Test task 4"],
            [true, "t4a"],
            [true, "Test task 5"],
            [true, "t5a"],
            [true, "t5b"],
            [null, ""],
        ],
        {hasGhostTaskRow: false, withoutColumns: true},
    );
});
