import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {getSearchEntityIndexesForTest} from "~/server/search/data/index/search_entity_index.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {printSearchMentionEntityId} from "~/shared/search/search_entity_id.js";

const {context, services} = createTestServices();

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

/**
 * Repro for: opening a site task collection via the search modal, then opening the
 * site navigate tree from the breadcrumb chip. Search modal peeks sit outside
 * `<PeekStackContextProvider>`, but `SiteSideBarContent` calls
 * `usePeekStackContext()` for the "Open in peek" action.
 */
test("opening site navigate from a search modal collection peek does not throw", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const siteName = "2026 H2 Launch";
    const collectionName = "Cycle Plan UniqueSearchToken";

    const site = await TestSite.create(session, {name: siteName, access: "Public"});
    // Create the collection already in the site so indexing sees the final access
    // policy (`Site`) rather than a transient `Local` public policy.
    const collection = await TestTaskCollection.create(session, {
        name: collectionName,
        access: {
            type: "Site",
            siteId: site.id,
            position: {parentId: site.initialRootContainerId, orderKey: initialOrderKey},
        },
    });

    await ProcessContextModule.waitForTestTasks();

    // Force the collection into the keyword index so search can find it immediately.
    await context.jobs.sendAndWait({
        type: "IndexSearchEntity",
        spaceId: space.id,
        update: {
            type: "TaskCollection",
            collectionId: collection.id,
            updatedTraits: {type: "None"},
        },
    });
    await context.jobs.sendAndWait({
        type: "IndexSearchEntity",
        spaceId: space.id,
        update: {
            type: "Site",
            siteId: site.id,
            updatedTraits: {type: "None"},
        },
    });
    await ProcessContextModule.waitForTestTasks();
    await context.waitForSqsProcessJobs();

    await expect(async () => {
        expect(
            await context.opensearch.getDocWithoutSourceIfExists(
                SearchEntityKeywordIndex,
                space.id,
                printSearchMentionEntityId({
                    type: "TaskCollection",
                    collectionId: collection.id,
                }),
            ),
        ).not.toBeNull();
    }).toPass({timeout: 5000});

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    await services.signIn(browserContext, session);
    await page.goto(`/dev/empty/${space.id}`);
    await page.waitForFunction("dev.ready");

    const pageErrors: Array<string> = [];
    page.on("pageerror", error => {
        pageErrors.push(error.message);
    });

    await page.getByLabel("Search").first().click();
    const modal = page.getByTestId("SearchModal");
    await expect(modal).toBeVisible();

    const input = modal.getByPlaceholder(/^Search/).first();
    await input.fill("UniqueSearchToken");
    // Wait for a result _row_ (not the query text in the input).
    const resultRow = modal.getByTestId("SearchEntityView").filter({hasText: collectionName});
    await expect(resultRow.first()).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Tab through results until the collection row is selected and its peek loads.
    const selectedRow = resultRow.and(modal.locator('[aria-selected="true"]'));
    let selected = false;
    for (let i = 0; i < 12 && !selected; i++) {
        await input.focus();
        await page.keyboard.press("ArrowDown");
        selected = await selectedRow
            .first()
            .waitFor({timeout: 2000})
            .then(() => true)
            .catch(() => false);
    }
    assert(selected, `Never selected the ${collectionName} result while tabbing search results`);

    const peek = page.getByTestId("SearchModalPeek");
    await expect(peek.getByText(collectionName).first()).toBeVisible();

    // The narrow search peek shows the site breadcrumb chip instead of site chrome.
    const chip = peek.getByRole("button", {name: siteName});
    await expect(chip).toBeVisible();

    // Opening navigate mounts `SiteSideBarContent` inside the search modal peek —
    // which historically crashed because search peeks are outside
    // `<PeekStackContext>`.
    await chip.click();

    const navigateView = peek.getByTestId("SiteNavigateView");
    await expect(navigateView).toBeVisible();
    await expect(peek.getByText("Couldn\u2019t open site")).toHaveCount(0);
    await expect(navigateView.getByText(collectionName, {exact: true})).toBeVisible();

    expect(pageErrors.filter(message => message.includes("PeekStackContext"))).toEqual([]);
});
