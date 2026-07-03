import {type Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {
    type ExpectTaskGridViewTaskDefinition,
    expectTaskGridView,
} from "~/app/integration_tests/tasks/helpers/expect_task_grid_view.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    TaskQueryFilter,
    serializeTaskQueryFiltersSearchParam,
} from "~/shared/tasks/task_query_filter.js";
import {serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";

const {context, services} = createTestServices();

const closedOnlyFilters: ReadonlyArray<TaskQueryFilter> = [
    {
        type: "DisplayStatus",
        operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
    },
];

const collectionDefaultsFiltersHelpText = "The current filters are only visible to you.";
const collectionDefaultsFiltersAndSortsHelpText =
    "The current filters/sorts are only visible to you.";
const saveAsDefaultFiltersAndSortsLabel = "Save as default filters/sorts";
const saveAsDefaultFiltersLabel = "Save as default filters";
const resetToDefaultFiltersLabel = "Reset to default filters";

async function openCollectionMoreMenu(page: Page, {isMobile}: {isMobile: boolean}) {
    if (isMobile) {
        await page.getByTestId("NavigationBar").getByRole("button", {name: "More"}).click();
    } else {
        await page.getByRole("button", {name: "More"}).last().click();
    }
}

async function expectCollectionTaskGridView(
    page: Page,
    taskDefinitions: Array<ExpectTaskGridViewTaskDefinition>,
    {
        isMobile,
        hasGhostTaskRow = true,
    }: {
        isMobile: boolean;
        hasGhostTaskRow?: boolean;
    },
) {
    await expectTaskGridView(page, taskDefinitions, {
        hasGhostTaskRow,
        withoutColumns: isMobile,
    });
}

async function removeSort(page: Page, {isMobile}: {isMobile: boolean}) {
    if (!isMobile) {
        await page.getByRole("button", {name: "Sort: 1"}).click();
    }

    await page.getByRole("button", {name: "Delete", exact: true}).click();
}

test("collection manager can save filters and sorts as the collection default", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const collection = await TestTaskCollection.create(session);
    await TestTask.create(session, {title: "Open task", collections: collection});
    await TestTask.create(session, {
        title: "Closed task",
        collections: collection,
        status: "Closed",
    });

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);

    // Without filters or sorts (and no defaults) the collection hides closed tasks.
    await page.goto(`/task-collection/${collection.id}`);
    await expectCollectionTaskGridView(page, [[true, "Open task"]], {isMobile});
    await openCollectionMoreMenu(page, {isMobile});
    await expect(page.getByRole("menuitem", {name: saveAsDefaultFiltersLabel})).toBeVisible();
    await expect(page.getByText(collectionDefaultsFiltersHelpText)).toBeHidden();
    await page.keyboard.press("Escape");

    // With a closed-only filter and a sort in the URL only the closed task shows.
    const filtersSearchParam = serializeTaskQueryFiltersSearchParam(closedOnlyFilters);
    const sortsSearchParam = serializeTaskQuerySortsSearchParam([
        {type: "Priority", direction: "Descending"},
    ]);
    await page.goto(
        `/task-collection/${collection.id}?filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
    );
    await expectCollectionTaskGridView(page, [[false, "Closed task"]], {
        isMobile,
        hasGhostTaskRow: false,
    });

    // Save the filters and sorts as the collection default through the more menu.
    await openCollectionMoreMenu(page, {isMobile});
    await expect(page.getByText(collectionDefaultsFiltersAndSortsHelpText)).toBeVisible();
    await page.getByRole("menuitem", {name: saveAsDefaultFiltersAndSortsLabel}).click();

    // Once the current filters/sorts are the default the more menu no longer warns
    // that they are only visible to you.
    await openCollectionMoreMenu(page, {isMobile});
    await expect(
        page.getByRole("menuitem", {name: saveAsDefaultFiltersAndSortsLabel}),
    ).toBeVisible();
    await expect(page.getByText(collectionDefaultsFiltersAndSortsHelpText)).toBeHidden();
    await page.keyboard.press("Escape");

    // Wait until the default filters/sorts are persisted on the server before
    // reloading.
    await expect(async () => {
        const collectionItem = await collection.getItem();
        expect(collectionItem.defaults.value.filters.length).toBeGreaterThan(0);
        expect(collectionItem.defaults.value.sorts.length).toBeGreaterThan(0);
    }).toPass();

    // Opening the collection without any filters/sorts in the URL applies the saved
    // defaults.
    await page.goto(`/task-collection/${collection.id}`);
    await expectCollectionTaskGridView(page, [[false, "Closed task"]], {
        isMobile,
        hasGhostTaskRow: false,
    });
    await openCollectionMoreMenu(page, {isMobile});
    await expect(
        page.getByRole("menuitem", {name: saveAsDefaultFiltersAndSortsLabel}),
    ).toBeVisible();
    await expect(page.getByText(collectionDefaultsFiltersAndSortsHelpText)).toBeHidden();
});

test("default filters apply to collection members who can\u2019t manage the collection", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const space = await TestSpace.create(context);
    const [manager, member] = await runAllPromises([space.createSession(), space.createSession()]);

    const collection = await TestTaskCollection.create(manager);
    await collection.access.grantDefault(manager, "Edit");
    await collection.updateDefaults(manager, {filters: closedOnlyFilters, sorts: []});

    await TestTask.create(manager, {title: "Open task", collections: collection});
    await TestTask.create(manager, {
        title: "Closed task",
        collections: collection,
        status: "Closed",
    });

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, member);

    // The member sees the default closed-only filter applied.
    await page.goto(`/task-collection/${collection.id}`);
    await expectCollectionTaskGridView(page, [[false, "Closed task"]], {
        isMobile,
        hasGhostTaskRow: false,
    });

    // The member can't save defaults so the more menu doesn't have a save option.
    await openCollectionMoreMenu(page, {isMobile});
    await expect(page.getByRole("menuitem", {name: resetToDefaultFiltersLabel})).toBeVisible();
    await expect(page.getByRole("menuitem", {name: saveAsDefaultFiltersLabel})).toBeHidden();
    await page.keyboard.press("Escape");

    // Removing the default filter only changes the view for the member.
    await page.getByRole("button", {name: "Remove"}).click();
    await expectCollectionTaskGridView(page, [[true, "Open task"]], {isMobile});

    await openCollectionMoreMenu(page, {isMobile});
    await expect(page.getByText(collectionDefaultsFiltersHelpText)).toBeVisible();
    await expect(page.getByRole("menuitem", {name: saveAsDefaultFiltersLabel})).toBeHidden();

    // The member can reset back to the collection's default filters.
    await page.getByRole("menuitem", {name: resetToDefaultFiltersLabel}).click();
    await expectCollectionTaskGridView(page, [[false, "Closed task"]], {
        isMobile,
        hasGhostTaskRow: false,
    });

    // The member's removal is kept in the URL so reloading doesn't re-apply the
    // default filters they just removed.
    await page.getByRole("button", {name: "Remove"}).click();
    await expectCollectionTaskGridView(page, [[true, "Open task"]], {isMobile});
    await page.reload();
    await expectCollectionTaskGridView(page, [[true, "Open task"]], {isMobile});
});

test("removing the default filters and sorts keeps explicitly empty filters and sorts in the URL", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const collection = await TestTaskCollection.create(session);
    await collection.updateDefaults(session, {
        filters: closedOnlyFilters,
        sorts: [{type: "Priority", direction: "Descending"}],
    });

    await TestTask.create(session, {title: "Open task", collections: collection});
    await TestTask.create(session, {
        title: "Closed task",
        collections: collection,
        status: "Closed",
    });

    await ProcessContextModule.waitForTestTasks();

    await services.signIn(browserContext, session);

    // The default filters/sorts are applied.
    await page.goto(`/task-collection/${collection.id}`);
    await expectCollectionTaskGridView(page, [[false, "Closed task"]], {
        isMobile,
        hasGhostTaskRow: false,
    });

    // Remove the default filter. The default priority sort is still applied so the
    // query stays auto-sorted (no ghost task row).
    await page.getByRole("button", {name: "Remove"}).click();
    await expectCollectionTaskGridView(page, [[true, "Open task"]], {
        isMobile,
        hasGhostTaskRow: false,
    });

    // Remove the default sort.
    await removeSort(page, {isMobile});
    await page.keyboard.press("Escape");
    await expectCollectionTaskGridView(page, [[true, "Open task"]], {isMobile});

    // The removals are kept in the URL as explicitly empty filters/sorts which
    // override the collection defaults...
    await expect(() => {
        const url = new URL(page.url());
        expect(url.searchParams.get("filter")).toBe(serializeTaskQueryFiltersSearchParam([]));
        expect(url.searchParams.get("sort")).toBe(serializeTaskQuerySortsSearchParam([]));
    }).toPass();

    // ...so reloading doesn't re-apply the defaults.
    await page.reload();
    await expectCollectionTaskGridView(page, [[true, "Open task"]], {isMobile});

    const url = new URL(page.url());
    expect({
        filter: url.searchParams.get("filter"),
        sort: url.searchParams.get("sort"),
    }).toEqual({
        filter: serializeTaskQueryFiltersSearchParam([]),
        sort: serializeTaskQuerySortsSearchParam([]),
    });
});
