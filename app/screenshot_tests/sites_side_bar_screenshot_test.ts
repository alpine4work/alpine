import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {clearAccountInbox} from "~/app/screenshot_tests/helpers/clear_account_inbox.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    getSearchEntityIndexesForTest,
    searchByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {
    OrderKey,
    assertOrderKey,
    generateOrderKeyBetween,
} from "~/shared/helpers/sort/order_key.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {ChatId, PostId} from "~/shared/id/types/id_types.js";
import {SiteContainerId, printSiteContainerId} from "~/shared/sites/site_entry_id.js";

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {accounts} = await runner.createDemoSpace(context);

    await runSetupFlowScenario(accounts.cassCade, runner);

    const showcase = await createShowcaseSite({accounts, runner});

    await clearAccountInbox(accounts.cassCade, runner);
    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    await runShowcaseSiteScreenshot(accounts.cassCade, runner, showcase);
    await runScrollToActiveEntityScenario(accounts.cassCade, runner, showcase);
    await runSiteMenuScenario(accounts.cassCade, runner, showcase);
    await runEntityContextMenuScenario(accounts.cassCade, runner, showcase);
    await runSectionContextMenuScenario(accounts.cassCade, runner, showcase);
    await runSearchModalScenario(context, accounts.cassCade, runner, showcase);
    await runShareScenario(accounts.cassCade, runner, showcase);
    await runChromeAroundEntityScenarios(accounts.cassCade, runner, showcase);
    await runDragOverlayCollapsedSectionScenario(accounts.cassCade, runner, showcase);
    await runExpandedSectionsScenario(accounts.cassCade, runner, showcase);
    await runShimmerWithSiteChromeScenario(accounts.cassCade, runner, showcase);
}

/**
 * With the network paused, navigating to another entity in the site leaves the
 * destination route's loader pending, so the route shimmer takes over the content
 * area. Because `<SiteChromeContainer>` renders the sidebar _outside_ the
 * `<Outlet>` (and the shimmer), the chrome stays mounted around the shimmer with
 * the destination row highlighted — it doesn't tear down and remount on
 * navigation. That stability is what preserves sidebar state (like scroll
 * position) across navigations; pin it here.
 */
async function runShimmerWithSiteChromeScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    // Land on a site entity (network still live) so the chrome is mounted.
    // `allowPauseNetwork: true` is required before calling `pauseNetwork()` below.
    await runner.goto(session, `/doc/${showcase.betsDocument.id}`);
    await runner
        .getByText(showcase.expectedTexts.betsDocumentTitle, {exact: true})
        .first()
        .waitFor();
    await runner.getByText("Tables GA Project", {exact: true}).first().waitFor();

    await runner.evaluate("dev.shimmer.debug()");
    // Click a different entity in the sidebar. The navigation starts but its loader
    // hangs, so after the loading-indicator delay the route shimmer takes over the
    // outlet — while the sidebar stays put around it, now highlighting the
    // destination.
    await runner.getByText("Tables GA Project", {exact: true}).first().click();
    await runner.getByTestId("RouteShimmer").first().waitFor();
    await runner.mouse.move(0, 0);

    await runner.screenshot("aq", "shimmer-with-site-chrome");
    await runner.evaluate("dev.shimmer.debug()");
}

type ShowcaseSite = {
    readonly site: TestSite;
    readonly betsDocument: TestDocument;
    readonly scrollTargetTask: TestTask;
    readonly scrollTargetTaskTitle: string;
    readonly searchModalEntities: {
        readonly tablesProjectTask: TestTask;
        readonly tablesCollection: TestTaskCollection;
        readonly tablesGAChatRoom: TestChat;
    };
    readonly sectionLabels: {
        readonly engineering: string;
        readonly tables: string;
        readonly editorPolish: string;
        readonly realtime: string;
        readonly operations: string;
        readonly longCustomerFeedback: string;
    };
    readonly expectedTexts: {
        readonly deepestEditorTask: string;
        readonly tablesExpandedTask: string;
        readonly realtimeExpandedTask: string;
        readonly operationsChild: string;
        readonly betsDocumentTitle: string;
    };
};

async function createShowcaseSite({
    accounts,
    runner,
}: {
    accounts: DemoSpaceAccounts;
    runner: ScreenshotTestRunner;
}): Promise<ShowcaseSite> {
    const site = await TestSite.create(accounts.cassCade, {
        name: "FY2026 Q4 launch readiness and reliability",
        access: "Public",
    });

    await runViewerAccessScenario(accounts, runner, site, {
        expectedSiteName: "FY2026 Q4 launch readiness and reliability",
    });

    const rootContainerId = site.initialRootContainerId;

    const engineeringLabel = "Engineering";
    const tablesLabel = "Tables GA";
    const editorPolishLabel = "Editor polish";
    const realtimeLabel = "Realtime Reliability";
    const operationsLabel = "Operations";
    const longCustomerFeedbackLabel = "Customer feedback and launch readiness follow-ups";

    const betsDocumentTitle = "Q4 Bets and Owners";

    const engineeringSectionId = await site.addSection(accounts.cassCade, {
        label: engineeringLabel,
        orderKey: assertOrderKey("a0"),
        parent: site.initialSideBarRoot,
    });

    const longCustomerFeedbackSectionId = await site.addSection(accounts.cassCade, {
        label: longCustomerFeedbackLabel,
        orderKey: assertOrderKey("a1"),
        parent: site.initialSideBarRoot,
    });
    const longCustomerFeedbackSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: longCustomerFeedbackSectionId,
    });

    const goToMarketSectionId = await site.addSection(accounts.cassCade, {
        label: "Go-to-market",
        orderKey: assertOrderKey("a2"),
        parent: site.initialSideBarRoot,
    });

    const operationsSectionId = await site.addSection(accounts.cassCade, {
        label: operationsLabel,
        orderKey: assertOrderKey("a3"),
        parent: site.initialSideBarRoot,
    });
    const operationsSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: operationsSectionId,
    });

    const okrsTask = await TestTask.create(accounts.cassCade, {
        title: "Lock Q4 plan with Rose",
        assignee: accounts.cassCade,
        priority: "High",
        notes: markdown`
Get the Q4 plan locked before Rose reviews the investor update. Pull in the customer survey, Tables
launch timing, realtime reliability rollout, and the hiring offer stage.
        `,
    });
    await okrsTask.createComment(
        accounts.cassCade,
        markdown`
Draft is ready for comments. I want the owner map to be boringly clear before the all-hands.
        `,
        {overrideCreatedTime: new Date("2025-10-15T15:14:00-04:00")},
    );
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${okrsTask.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a4"),
    });

    const betsDocument = await TestDocument.create(accounts.cassCade, {
        title: betsDocumentTitle,
        access: {type: "Site", siteId: site.id},
        body: markdown`
Author: Cass Cade

Draft of the Q4 portfolio. Inputs from each owner are due by Friday. Rose and I will finalize the
readout on Monday morning.

## Priorities

- **P0**: Tables GA plus follow-on editor polish (Mason Clay)
- **P0**: Realtime reliability phase 3 (Elle Kappa-Tan)
- **P1**: Enterprise SSO design partner build (Elle Kappa-Tan + Cliff Weathers)
- **P2**: Customer case studies and sales enablement (Holly Evergreen)
        `,
        sitePosition: {
            siteId: site.id,
            parentId: rootContainerId,
            orderKey: assertOrderKey("a5"),
        },
    });

    const tablesProjectTask = await TestTask.create(accounts.cassCade, {
        title: "Tables GA Project",
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        layout: "Project",
        priority: "High",
        notes: markdown`
Tables in the rich text editor. Insert, edit, navigate, resize, and paste in from a spreadsheet. The
last open design question is how column resizing should feel.
        `,
    });
    for (const [index, [title, status, assignee]] of [
        ["Bets list reviewed with Rose", "Closed", accounts.cassCade],
        ["Engineering breakdown with Elle and Mason", "Closed", accounts.cassCade],
        ["Design throughput model with Matt", "Open", accounts.mattRHorn],
        ["GTM section with Cliff + Holly", "Open", accounts.hollyEvergreen],
    ].entries()) {
        await TestTask.create(accounts.cassCade, {
            title: title as string,
            parent: tablesProjectTask,
            assignee: assignee as TestSpaceSession,
            assigneeStatus: status === "Open" ? "Active" : undefined,
            status: status as "Open" | "Closed",
            priority: index === 3 ? "Medium" : undefined,
        });
    }
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${tablesProjectTask.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a6"),
    });

    const tablesCollection = await TestTaskCollection.create(accounts.cassCade, {
        name: "Tables crew",
        access: "Public",
        color: "blue",
    });
    for (const [title, assignee] of [
        ["Realtime reliability phase 3 rollout", accounts.elleKappaTan],
        ["Enterprise SSO design partner pilot", accounts.elleKappaTan],
        ["Third customer case study (drafted in H1, ship in H2)", accounts.hollyEvergreen],
    ]) {
        await TestTask.create(accounts.cassCade, {
            title: title as string,
            assignee: assignee as TestSpaceSession,
            assigneeStatus: "Active",
            collections: tablesCollection,
            priority: "High",
        });
    }
    await site.addEntity(accounts.cassCade, {
        entityId: `TaskCollection:${tablesCollection.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a7"),
    });

    const tablesGAChatRoom = await createTablesGAChatRoom({
        site,
        rootContainerId,
        accounts,
        runner,
    });

    const tablesSectionId = await site.addSection(accounts.cassCade, {
        label: tablesLabel,
        orderKey: assertOrderKey("a0"),
        parent: {type: "SideBarSection", id: engineeringSectionId},
    });
    const tablesSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: tablesSectionId,
    });

    const realtimeSectionId = await site.addSection(accounts.cassCade, {
        label: realtimeLabel,
        orderKey: assertOrderKey("a1"),
        parent: {type: "SideBarSection", id: engineeringSectionId},
    });
    const realtimeSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: realtimeSectionId,
    });

    const editorPolishSectionId = await site.addSection(accounts.cassCade, {
        label: editorPolishLabel,
        orderKey: assertOrderKey("a0"),
        parent: {type: "SideBarSection", id: tablesSectionId},
    });
    const editorPolishSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: editorPolishSectionId,
    });

    const deepestEditorTaskTitle =
        "Column resizing snap-by-default with Alt smooth override across every table surface";
    const deepestEditorTask = await TestTask.create(accounts.cassCade, {
        title: deepestEditorTaskTitle,
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        priority: "High",
    });
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${deepestEditorTask.id}`,
        parentId: editorPolishSectionContainerId,
        orderKey: assertOrderKey("a0"),
    });

    await TestDocument.create(accounts.cassCade, {
        title: "Editor interaction audit and toolbar state inventory before Tables ships",
        access: {type: "Site", siteId: site.id},
        body: markdown`
Matt\u2019s audit notes for the final tables pass. The big thing: keep resizing, selection, and
toolbar placement aligned with the rest of the editor so the feature feels native on day one.
        `,
        sitePosition: {
            siteId: site.id,
            parentId: editorPolishSectionContainerId,
            orderKey: assertOrderKey("a1"),
        },
    });

    const tablesExpandedTaskTitle = "Paste from Sheets dogfood report";
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: tablesSectionContainerId,
        orderKey: assertOrderKey("a1"),
        title: tablesExpandedTaskTitle,
        assignee: accounts.masonClay,
        priority: "High",
    });
    await addDocumentToSite({
        site,
        session: accounts.cassCade,
        parentId: tablesSectionContainerId,
        orderKey: assertOrderKey("a2"),
        title: "Tables launch checklist",
        body: markdown`
## Launch checklist

- Update the help center examples with real table-heavy docs
- Confirm paste from Sheets and CSV import behavior with support
- Keep the snap-by-default note in the launch post
- Add a short clip to the demo workspace
        `,
    });
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: tablesSectionContainerId,
        orderKey: assertOrderKey("a3"),
        title: "Header row freeze exploration",
        assignee: accounts.mattRHorn,
    });
    const tablesUpdatesChannel = await addChannelToSite({
        site,
        session: accounts.cassCade,
        parentId: tablesSectionContainerId,
        orderKey: assertOrderKey("a4"),
        name: "Tables updates",
        description: markdown`
Short customer-facing launch updates for everyone dogfooding tables.
        `,
    });
    await tablesUpdatesChannel.createPost(
        accounts.masonClay,
        markdown`
Paste from Sheets is passing the normal cases now. The only remaining edge case is merged cells, and
we are going to document that as unsupported for GA.
        `,
        {overrideCreatedTime: new Date("2025-10-10T15:12:00-04:00")},
    );
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: tablesSectionContainerId,
        orderKey: assertOrderKey("a5"),
        title: "Toolbar placement regression pass",
        assignee: accounts.masonClay,
    });
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: tablesSectionContainerId,
        orderKey: assertOrderKey("a6"),
        title: "Table keyboard navigation acceptance checklist",
        assignee: accounts.masonClay,
    });
    await addDocumentToSite({
        site,
        session: accounts.cassCade,
        parentId: tablesSectionContainerId,
        orderKey: assertOrderKey("a7"),
        title: "Help doc examples",
        body: markdown`
Examples to include in the public help doc: roadmap tables, launch checklists, and simple customer
research matrices. Keep the screenshots in the same demo workspace so sales can reuse them.
        `,
    });
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: tablesSectionContainerId,
        orderKey: assertOrderKey("a8"),
        title: "Launch announcement screenshots ready",
        assignee: accounts.hollyEvergreen,
    });

    const realtimeExpandedTaskTitle = "Jittered reconnection backoff rollout";
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: realtimeSectionContainerId,
        orderKey: assertOrderKey("a0"),
        title: realtimeExpandedTaskTitle,
        assignee: accounts.elleKappaTan,
        priority: "High",
    });
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: realtimeSectionContainerId,
        orderKey: assertOrderKey("a1"),
        title: "Deploy health check alert polish",
        assignee: accounts.elleKappaTan,
    });
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: realtimeSectionContainerId,
        orderKey: assertOrderKey("a2"),
        title: "On-call handoff notes after phase 3 rollout",
        assignee: accounts.elleKappaTan,
    });

    const launchCollateralSectionId = await site.addSection(accounts.cassCade, {
        label: "Launch collateral",
        orderKey: assertOrderKey("a0"),
        parent: {type: "SideBarSection", id: goToMarketSectionId},
    });
    const launchCollateralSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: launchCollateralSectionId,
    });
    await addDocumentToSite({
        site,
        session: accounts.cassCade,
        parentId: launchCollateralSectionContainerId,
        orderKey: assertOrderKey("a0"),
        title: "Tables GA launch narrative",
        body: markdown`
## Draft narrative

Tables make docs a better home for structured work. The customer story is not \u201Cspreadsheet in a
doc\u201D; it is project plans, launch trackers, and research synthesis living next to the
discussion and tasks that move them forward.
        `,
    });
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: launchCollateralSectionContainerId,
        orderKey: assertOrderKey("a1"),
        title: "Rewrite enablement one-pager after Cliff demo feedback",
        assignee: accounts.hollyEvergreen,
    });
    const salesQuestionsChannel = await addChannelToSite({
        site,
        session: accounts.cassCade,
        parentId: launchCollateralSectionContainerId,
        orderKey: assertOrderKey("a2"),
        name: "Sales questions",
        description: markdown`
Questions from late-stage deals that need a crisp answer before the launch webinar.
        `,
    });
    await salesQuestionsChannel.createPost(
        accounts.cliffWeathers,
        markdown`
Two prospects asked the same thing: can tables replace the project tracker they keep in Sheets? My
answer is \u201Cfor operating docs, yes; for analysis work, not yet.\u201D
        `,
        {overrideCreatedTime: new Date("2025-10-14T12:20:00-04:00")},
    );
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: launchCollateralSectionContainerId,
        orderKey: assertOrderKey("a3"),
        title: "Customer case study pull quote approvals",
        assignee: accounts.cliffWeathers,
    });

    let scrollTargetTask: TestTask | null = null;
    const scrollTargetTaskTitle = "Q4 customer council agenda";
    let lastCustomerFeedbackKey: OrderKey | null = null;
    function nextCustomerFeedbackOrderKey(): OrderKey {
        lastCustomerFeedbackKey = generateOrderKeyBetween(lastCustomerFeedbackKey, null);
        return lastCustomerFeedbackKey;
    }

    async function addCustomerFeedbackTask({
        title,
        assignee,
        priority,
    }: {
        title: string;
        assignee: TestSpaceSession;
        priority?: "High" | "Medium" | "Low";
    }) {
        return await addTaskToSite({
            site,
            session: accounts.cassCade,
            parentId: longCustomerFeedbackSectionContainerId,
            orderKey: nextCustomerFeedbackOrderKey(),
            title,
            assignee,
            priority,
        });
    }

    await addDocumentToSite({
        site,
        session: accounts.cassCade,
        parentId: longCustomerFeedbackSectionContainerId,
        orderKey: nextCustomerFeedbackOrderKey(),
        title: "Customer survey readout",
        body: markdown`
## Themes

Customers want structured project plans in docs, quieter notifications around active launches, and
faster search in larger workspaces. Tables shows up in the same sentence as planning, not
spreadsheets.

## Watchlist

Acme and Globex both asked whether launch docs can become the source of truth for status, tasks, and
discussion. That is the story to tell in the webinar.
        `,
    });
    const customerVoiceChannel = await addChannelToSite({
        site,
        session: accounts.cassCade,
        parentId: longCustomerFeedbackSectionContainerId,
        orderKey: nextCustomerFeedbackOrderKey(),
        name: "Customer voice",
        description: markdown`
Fresh feedback from design partners, support, sales, and onboarding.
        `,
    });
    await customerVoiceChannel.createPost(
        accounts.hollyEvergreen,
        markdown`
Acme is using one launch doc for status, risks, and decisions. They asked for better table examples
and a shorter path from a customer quote to a task.
        `,
        {overrideCreatedTime: new Date("2025-10-16T14:44:00-04:00")},
    );
    await addCustomerFeedbackTask({
        title: "Acme admin pilot search-latency readout",
        assignee: accounts.cliffWeathers,
        priority: "High",
    });
    await addDocumentToSite({
        site,
        session: accounts.cassCade,
        parentId: longCustomerFeedbackSectionContainerId,
        orderKey: nextCustomerFeedbackOrderKey(),
        title: "Launch FAQ",
        body: markdown`
Questions we expect during the webinar:

- Can tables be mentioned in comments and tasks?
- Do table-heavy docs work in mobile review flows?
- What should teams keep in Sheets instead?
- How does this change the team wiki story?
        `,
    });
    await createSiteChatRoom({
        site,
        parentId: longCustomerFeedbackSectionContainerId,
        orderKey: nextCustomerFeedbackOrderKey(),
        accounts,
        runner,
        stableIdKey: "customerLaunchRoom",
        name: "Customer launch room",
        messages: [
            {
                sender: accounts.hollyEvergreen,
                body: markdown`
Cliff, I pulled the Acme quote into the survey readout. Can you sanity-check the wording before the
case study draft goes to Rose?
                `,
                overrideCreatedTime: new Date("2025-10-16T16:04:00-04:00"),
            },
            {
                sender: accounts.cliffWeathers,
                body: markdown`
Yes. Also adding Globex because their feedback is the clearest \u201Cwiki plus work\u201D example we
have.
                `,
                overrideCreatedTime: new Date("2025-10-16T16:08:00-04:00"),
            },
            {
                sender: accounts.cassCade,
                body: markdown`
Great. Keep the customer names in docs, not tasks, until approvals are done.
                `,
                overrideCreatedTime: new Date("2025-10-16T16:11:00-04:00"),
            },
        ],
    });
    await addCustomerFeedbackTask({
        title: "Globex onboarding notes",
        assignee: accounts.hollyEvergreen,
    });
    await addDocumentToSite({
        site,
        session: accounts.cassCade,
        parentId: longCustomerFeedbackSectionContainerId,
        orderKey: nextCustomerFeedbackOrderKey(),
        title: "Case study pipeline",
        body: markdown`
Acme is approved for a short anonymous quote. Globex wants one more week of product usage before
being named. Initech is useful for internal objections but not ready for public copy.
        `,
    });
    await addCustomerFeedbackTask({
        title: "Support article gap: paste from Sheets",
        assignee: accounts.hollyEvergreen,
        priority: "High",
    });
    const launchQuestionsChannel = await addChannelToSite({
        site,
        session: accounts.cassCade,
        parentId: longCustomerFeedbackSectionContainerId,
        orderKey: nextCustomerFeedbackOrderKey(),
        name: "Launch questions",
        description: markdown`
Questions from active deals and support that need a product answer.
        `,
    });
    await launchQuestionsChannel.createPost(
        accounts.cliffWeathers,
        markdown`
Prospects keep asking whether project tasks can sit next to launch docs. The short answer is yes,
and it is landing better than a separate tracker.
        `,
        {overrideCreatedTime: new Date("2025-10-17T09:18:00-04:00")},
    );

    const customerFeedbackTasks = [
        ["Customer education snippet for Alt smooth resize", accounts.hollyEvergreen, undefined],
        ["Sales demo script section on unified inbox", accounts.cliffWeathers, undefined],
        ["Design partner notes for Enterprise SSO pilot", accounts.cliffWeathers, "High"],
        ["Pricing page feedback sweep", accounts.hollyEvergreen, undefined],
        ["Renewal risk notes after admin permissions review", accounts.cliffWeathers, "Medium"],
        ["Onboarding checklist language pass", accounts.hollyEvergreen, undefined],
        ["Launch metrics dashboard ownership", accounts.cliffWeathers, undefined],
        ["Customer quote approval", accounts.hollyEvergreen, "High"],
        ["Support macro for table resizing", accounts.hollyEvergreen, undefined],
        ["Survey follow-up thread for notification batching", accounts.cliffWeathers, undefined],
        ["CS handoff notes for search affinity tuning", accounts.hollyEvergreen, undefined],
        ["Enablement FAQ after Holly and Cliff review", accounts.cliffWeathers, undefined],
        ["Demos needing the new Tables path", accounts.hollyEvergreen, undefined],
        ["Accounts to invite to launch webinar", accounts.cliffWeathers, undefined],
    ] as const;
    for (const [title, assignee, priority] of customerFeedbackTasks) {
        await addCustomerFeedbackTask({title, assignee, priority});
    }

    await addDocumentToSite({
        site,
        session: accounts.cassCade,
        parentId: longCustomerFeedbackSectionContainerId,
        orderKey: nextCustomerFeedbackOrderKey(),
        title: "Post-launch survey draft",
        body: markdown`
Three-question version for the week after GA: what made tables useful, what still forced a context
switch, and what documentation example should we write next?
        `,
    });
    await addCustomerFeedbackTask({
        title: "Customer-facing release note polish",
        assignee: accounts.hollyEvergreen,
    });
    await addDocumentToSite({
        site,
        session: accounts.cassCade,
        parentId: longCustomerFeedbackSectionContainerId,
        orderKey: nextCustomerFeedbackOrderKey(),
        title: "Forum announcement response plan",
        body: markdown`
Draft responses for expected comments: mobile tables, CSV import, table mentions, and the difference
between table docs and task collections.
        `,
    });
    for (const [title, assignee] of [
        ["October active-deal blocker sweep", accounts.cliffWeathers],
        ["Renewal one-pager appendix", accounts.hollyEvergreen],
        ["Support queue triage for Tables week", accounts.hollyEvergreen],
        ["Demo workspace cleanup before launch", accounts.cliffWeathers],
        ["Case study edits from Rose", accounts.hollyEvergreen],
    ] as const) {
        await addCustomerFeedbackTask({title, assignee});
    }
    scrollTargetTask = await addCustomerFeedbackTask({
        title: scrollTargetTaskTitle,
        assignee: accounts.cliffWeathers,
        priority: "Medium",
    });
    await addDocumentToSite({
        site,
        session: accounts.cassCade,
        parentId: longCustomerFeedbackSectionContainerId,
        orderKey: nextCustomerFeedbackOrderKey(),
        title: "Search performance anecdotes",
        body: markdown`
Collect customer language around \u201CI know the answer exists somewhere\u201D searches. Pull
examples from support, design partner interviews, and the customer launch room.
        `,
    });
    await addCustomerFeedbackTask({
        title: "Late-stage prospect follow-up sequence",
        assignee: accounts.cliffWeathers,
    });
    await addCustomerFeedbackTask({
        title: "Field feedback retro agenda",
        assignee: accounts.hollyEvergreen,
    });

    const operationsChildTitle = "Senior backend offer checklist";
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: operationsSectionContainerId,
        orderKey: assertOrderKey("a0"),
        title: operationsChildTitle,
        assignee: accounts.cassCade,
    });
    await addTaskToSite({
        site,
        session: accounts.cassCade,
        parentId: operationsSectionContainerId,
        orderKey: assertOrderKey("a1"),
        title: "Q4 planning readout for Rose",
        assignee: accounts.cassCade,
    });

    await createStatusChannel({
        site,
        parentContainerId: rootContainerId,
        accounts,
        runner,
    });

    return {
        site,
        betsDocument,
        scrollTargetTask,
        scrollTargetTaskTitle,
        searchModalEntities: {
            tablesProjectTask,
            tablesCollection,
            tablesGAChatRoom,
        },
        sectionLabels: {
            engineering: engineeringLabel,
            tables: tablesLabel,
            editorPolish: editorPolishLabel,
            realtime: realtimeLabel,
            operations: operationsLabel,
            longCustomerFeedback: longCustomerFeedbackLabel,
        },
        expectedTexts: {
            deepestEditorTask: deepestEditorTaskTitle,
            tablesExpandedTask: tablesExpandedTaskTitle,
            realtimeExpandedTask: realtimeExpandedTaskTitle,
            operationsChild: operationsChildTitle,
            betsDocumentTitle: betsDocumentTitle,
        },
    };
}

async function addTaskToSite({
    site,
    session,
    parentId,
    orderKey,
    title,
    assignee,
    priority,
}: {
    site: TestSite;
    session: TestSpaceSession;
    parentId: SiteContainerId;
    orderKey: OrderKey;
    title: string;
    assignee: TestSpaceSession;
    priority?: "High" | "Medium" | "Low";
}) {
    const task = await TestTask.create(session, {
        title,
        assignee,
        assigneeStatus: "Active",
        priority,
    });
    await site.addEntity(session, {
        entityId: `Task:${task.id}`,
        parentId,
        orderKey,
    });
    return task;
}

async function addDocumentToSite({
    site,
    session,
    parentId,
    orderKey,
    title,
    body,
}: {
    site: TestSite;
    session: TestSpaceSession;
    parentId: SiteContainerId;
    orderKey: OrderKey;
    title: string;
    body: string;
}) {
    return await TestDocument.create(session, {
        title,
        access: {type: "Site", siteId: site.id},
        body,
        sitePosition: {
            siteId: site.id,
            parentId,
            orderKey,
        },
    });
}

async function addChannelToSite({
    site,
    session,
    parentId,
    orderKey,
    name,
    description,
}: {
    site: TestSite;
    session: TestSpaceSession;
    parentId: SiteContainerId;
    orderKey: OrderKey;
    name: string;
    description: string;
}) {
    const channel = await TestChannel.create(session, {name, description});
    await channel.subscribe(session);
    await site.addEntity(session, {
        entityId: `Channel:${channel.id}`,
        parentId,
        orderKey,
    });
    return channel;
}

async function createSiteChatRoom({
    site,
    parentId,
    orderKey,
    accounts,
    runner,
    stableIdKey,
    name,
    messages,
}: {
    site: TestSite;
    parentId: SiteContainerId;
    orderKey: OrderKey;
    accounts: DemoSpaceAccounts;
    runner: ScreenshotTestRunner;
    stableIdKey: string;
    name: string;
    messages: ReadonlyArray<{
        readonly sender: TestSpaceSession;
        readonly body: string;
        readonly overrideCreatedTime: Date;
    }>;
}) {
    const chat = await TestChat.createRoom(accounts.cassCade, {
        id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, stableIdKey),
        name,
        access: {
            type: "Site",
            siteId: site.id,
            position: {parentId, orderKey},
        },
    });

    for (const message of messages) {
        await chat.sendMessage(message.sender, message.body, {
            overrideCreatedTime: message.overrideCreatedTime,
        });
    }

    await runner.services.waitForSqsProcessJobs();
    return chat;
}

// Chat room with a back-and-forth conversation so the chat-room chrome screenshot
// shows real messages.
async function createTablesGAChatRoom({
    site,
    rootContainerId,
    accounts,
    runner,
}: {
    site: TestSite;
    rootContainerId: SiteContainerId;
    accounts: DemoSpaceAccounts;
    runner: ScreenshotTestRunner;
}) {
    const {cassCade, elleKappaTan, masonClay, mattRHorn} = accounts;

    const tablesGAChatRoom = await TestChat.createRoom(accounts.cassCade, {
        // Pin the chat ID so the account-pile preview (seeded by `Chat:${chatId}`) is
        // identical across runs. Without this the facepile members/order shuffle each run,
        // making the screenshot flaky.
        id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "tablesGAChatRoom"),
        name: "Tables GA launch room",
        access: {
            type: "Site",
            siteId: site.id,
            position: {parentId: rootContainerId, orderKey: assertOrderKey("a8")},
        },
    });

    const sendMessage = async (...args: Parameters<TestChat["sendMessage"]>) => {
        const message = await tablesGAChatRoom.sendMessage(...args);
        await runner.services.waitForSqsProcessJobs();
        return message;
    };

    const latestTablesBuildMessage = await sendMessage(
        masonClay,
        markdown`
latest tables build is on staging if anyone wants to poke at it
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:14:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
the thing i want eyes on is column resize. drag the border and width tracks your cursor. so the
smooth option, not snapping
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:14:01-04:00")},
    );

    const nestedListsMessage = await sendMessage(
        masonClay,
        markdown`
also: nested lists inside cells work now, copy/paste from sheets does something reasonable in 4 out
of 5 cases
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:15:00-04:00")},
    );

    await sendMessage(
        mattRHorn,
        markdown`
I\u2019ll dig in this afternoon. Quick reaction from what you posted in the design review: I\u2019m
still not sold on smooth resize.
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:32:00-04:00")},
    );

    const proportionalSpacingMessage = await sendMessage(
        mattRHorn,
        markdown`
When typewriters moved from monospaced to proportional spacing, an entire craft of layout had to be
relearned, and most early proportional documents looked terrible because people kept reaching for
the freedom they\u2019d just been given. The freedom to put a column at any pixel width is the same
kind of trap. Most users don\u2019t actually want pixel-precise control—they want columns that look
right next to each other, and a free drag makes that harder, not easier.
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:34:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
idk feels heavy
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:35:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
every other table tool i\u2019ve used lets you drag freely. lowkey think users will be annoyed if it
snaps when they\u2019re trying to hit a specific width
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:35:01-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
doesnt matter to me as long as the width is just a number on the cell node. snap or no snap is a
client decision, the backend doesnt care
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:41:00-04:00")},
    );

    const decisionDocMessage = await sendMessage(
        cassCade,
        markdown`
Ok let\u2019s not relitigate this in chat. Matt, put the snap argument in the design doc with
examples. Mason, same for smooth. I\u2019ll read both and call it Monday.
        `,
        {overrideCreatedTime: new Date("2025-09-30T11:02:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
Also tbf the every-other-tool-does-it thing isn\u2019t a strong argument by itself, you both know
that.
        `,
        {overrideCreatedTime: new Date("2025-09-30T11:03:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
fair
        `,
        {overrideCreatedTime: new Date("2025-09-30T11:04:00-04:00")},
    );

    await sendMessage(
        mattRHorn,
        markdown`
Added to the doc. New section: \u201CColumn resizing—why snap\u201D Three examples, including the
1984 Mac printer driver bit if anyone has the patience.
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:18:00-04:00")},
    );

    const auditNotesMessage = await sendMessage(
        mattRHorn,
        markdown`
Also linked it to the audit notes from week 2. Image resizing in our editor already snaps to a
12-column grid. If we go smooth on tables we\u2019ll have two interaction models for resizable
things in the same surface, which is exactly the kind of inconsistency the audit was supposed to
head off.
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:19:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
hm
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:21:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
ok that\u2019s a real point. didn\u2019t have the image grid in my head
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:21:01-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
will write mine up tonight. probably won\u2019t change my mind but i want the case in the doc
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:22:00-04:00")},
    );

    const imageGridMessage = await sendMessage(
        elleKappaTan,
        markdown`
fwiw the image grid was only added bc continuous was producing genuinely bad layouts in shared docs.
people would resize on a wide monitor and it would look broken on everyone elses screen
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:24:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
not arguing for either, just data
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:25:00-04:00")},
    );

    await sendMessage(
        mattRHorn,
        markdown`
That\u2019s exactly the argument.
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:31:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
ok
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:34:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
Read both sections. Talking to Rose at 11. Will land somewhere by EOD.
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:08:00-04:00")},
    );

    const modifierKeyMessage = await sendMessage(
        mattRHorn,
        markdown`
A possibility worth considering: modifier key for the override. Snap by default, hold a key for
smooth. We get the consistent-by-default behavior and the power user escape hatch at the same time.
I\u2019d argue for Alt; Shift is already overloaded for multi-select.
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:33:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
wait i actually like that
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:34:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
alt makes sense. shift is taken in like 4 places already
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:35:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
yeah alt is fine. shift+drag does range select in the cell selection model so dont put it on shift
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:38:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
Ok hold that thought, let me talk to Rose first before we lock anything in.
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:39:00-04:00")},
    );

    const roseDecisionMessage = await sendMessage(
        cassCade,
        markdown`
Talked to Rose. She\u2019s good with snap-by-default + alt-for-smooth.
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:47:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
Mason: can you spec out the modifier behavior in your task? Matt: please update the design doc to
reflect the decision and drop the back-and-forth sections so it reads as the final answer.
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:47:01-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
on it
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:48:00-04:00")},
    );

    await sendMessage(
        mattRHorn,
        markdown`
Will do.
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:49:00-04:00")},
    );

    const percentSnapMessage = await sendMessage(
        mattRHorn,
        markdown`
We should pick the snap intervals carefully. My instinct is percentages of the document width (10%,
12.5%, 16.66%, 20%, 25%, 33%, 50%), not pixels. Pixels are meaningless when documents reflow.
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:51:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
agreed on percentages. think 8 stops is too many tho if we\u2019re trying to be opinionated. 5 is
probably the sweet spot
        `,
        {
            parent: {
                type: "MessagesRange",
                startIndex: percentSnapMessage.index,
                endIndex: percentSnapMessage.index,
                startContentVersion: 0,
                endContentVersion: 0,
                startPos: 46,
                endPos: 94,
            },
            overrideCreatedTime: new Date("2025-10-01T12:53:00-04:00"),
        },
    );

    const snapIntervalsMessage = await sendMessage(
        mattRHorn,
        markdown`
Let\u2019s try 5 and tune.
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:54:00-04:00")},
    );

    const finalThanksMessage = await sendMessage(
        cassCade,
        markdown`
Love it. Thanks all!
        `,
        {overrideCreatedTime: new Date("2025-10-02T11:27:00-04:00")},
    );

    await latestTablesBuildMessage.setReaction(cassCade, "Celebrate");
    await nestedListsMessage.setReaction(cassCade, "Celebrate");
    await proportionalSpacingMessage.setReaction(masonClay, "No");
    await decisionDocMessage.setReaction(masonClay, "Yes");
    await decisionDocMessage.setReaction(mattRHorn, "Yes");
    await auditNotesMessage.setReaction(cassCade, "Yes");
    await imageGridMessage.setReaction(mattRHorn, "ThankYou");
    await modifierKeyMessage.setReaction(cassCade, "Yes");
    await modifierKeyMessage.setReaction(masonClay, "Heart");
    await roseDecisionMessage.setReaction(masonClay, "Celebrate");
    await roseDecisionMessage.setReaction(mattRHorn, "Yes");
    await snapIntervalsMessage.setReaction(cassCade, "Yes");
    await finalThanksMessage.setReaction(masonClay, "Celebrate");

    await runner.services.waitForSqsProcessJobs();

    return tablesGAChatRoom;
}

async function createStatusChannel({
    site,
    parentContainerId,
    accounts,
    runner,
}: {
    site: TestSite;
    parentContainerId: SiteContainerId;
    accounts: DemoSpaceAccounts;
    runner: ScreenshotTestRunner;
}) {
    const statusChannel = await TestChannel.create(accounts.cassCade, {
        name: "Status",
        description: markdown`
Weekly status sync for the planning cycle. Post wins, blockers, and asks here every Friday.
        `,
    });
    await statusChannel.subscribe(accounts.cassCade);
    const tablesWeeklyPost = await statusChannel.createPost(
        accounts.masonClay,
        markdown`
Tables status week of Oct 13. Editor polish landed Friday: column resize snap-to-grid by default
with Alt for smooth. Paste-from-Sheets behind a flag for one more week of dogfooding. Bigger Q4
question coming next week on header row freeze.
        `,
        {
            // Pin the post ID. This post gets multiple reactions, so it renders a
            // `ReactionParty` whose icon offsets are seeded by `ReactionParty:${post.id}` (see
            // `post_content_view.tsx`). With a random post ID those offsets shift each run,
            // making the channel-chrome screenshot flake.
            id: unsafelyGenerateStableId<PostId>(runner.stableRandom, "tablesWeeklyPost"),
            overrideCreatedTime: new Date("2025-10-17T09:14:00.000Z"),
        },
    );
    await tablesWeeklyPost.sendMessage(
        accounts.cassCade,
        markdown`
Nice. The Alt-for-smooth call reads right to me. Keep the surface tidy by default, give the power
move to people who know what they want.
        `,
        {overrideCreatedTime: new Date("2025-10-17T09:42:00.000Z")},
    );
    await tablesWeeklyPost.sendMessage(
        accounts.elleKappaTan,
        markdown`
+1. Realtime phase 3 progress on my end: alerting wired, paging policy reviewed with oncall. On
track for Friday afternoon.
        `,
        {overrideCreatedTime: new Date("2025-10-17T10:08:00.000Z")},
    );
    await tablesWeeklyPost.setReaction(accounts.cassCade, "Celebrate");
    await tablesWeeklyPost.setReaction(accounts.elleKappaTan, "Yes");
    await site.addEntity(accounts.cassCade, {
        entityId: `Channel:${statusChannel.id}`,
        parentId: parentContainerId,
        orderKey: assertOrderKey("a9"),
    });

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    return statusChannel;
}

async function runSetupFlowScenario(session: TestSpaceSession, runner: ScreenshotTestRunner) {
    await runner.goto(session, `/home/${session.space.id}/`);
    await runner.getByLabel("Create", {exact: true}).first().click();
    await runner
        .getByRole("menuitem", {name: "Site"})
        .first()
        .evaluate(element => {
            (element as HTMLElement & {press(): void}).press();
        });

    await runner.getByText("Start building New site").first().waitFor();
    await runner.getByPlaceholder("New site").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a0", "create-flow-editor-open");

    await runner.page.keyboard.type("Q4 launch readiness");
    await runner.page.keyboard.press("Enter");
    await runner.getByText("Start building Q4 launch readiness").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a1", "create-flow-renamed-site");

    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    await runner.getByLabel("More").first().click();
    await runner.getByText("Favorite").first().waitFor();
    await runner.getByText("Copy link").first().waitFor();
    await runner.screenshot("a2", "navigation-bar-menu-not-favorited");

    await runner.getByText("Favorite").first().click();
    await ProcessContextModule.waitForTestTasks();
    await runner.screenshot("a3", "navigation-bar-menu-favorited");

    await runner.getByText("Favorite").first().click();
    await ProcessContextModule.waitForTestTasks();
    await runner.page.keyboard.press("Escape");

    await pressShareSwitch(runner);
    await runner
        .getByLabel("Icon indicating the site is shared with everyone", {exact: false})
        .first()
        .waitFor();
    await pressShareSwitch(runner);
    await runner.getByText("Make this site private?").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a4", "make-site-private-modal");
    await runner
        .getByText("Shared the site with everyone", {exact: false})
        .first()
        .waitFor({state: "hidden"});

    await runner.getByRole("button", {name: "Confirm"}).first().click();
    await runner
        .getByLabel("Icon indicating the site is private", {exact: false})
        .first()
        .waitFor();
    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    const dismissAlertButton = runner.getByRole("button", {name: "Dismiss alert"}).first();
    if ((await dismissAlertButton.count()) > 0) await dismissAlertButton.click();

    await runner.getByText("Add", {exact: true}).first().waitFor();
    await runner.getByText("Add", {exact: true}).first().click();
    await runner.getByText("Document", {exact: true}).first().waitFor();
    await runner.getByText("Search for existing", {exact: false}).first().waitFor();
    await runner.screenshot("a5", "ghost-row-menu");
}

async function runShowcaseSiteScreenshot(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    await openShowcaseSite(session, runner, showcase);
    await expandSectionIfNeeded(
        runner,
        showcase.sectionLabels.tables,
        showcase.expectedTexts.tablesExpandedTask,
    );
    await expandSectionIfNeeded(
        runner,
        showcase.sectionLabels.editorPolish,
        showcase.expectedTexts.deepestEditorTask,
    );
    await runner
        .getByText(showcase.sectionLabels.engineering, {exact: true})
        .first()
        .scrollIntoViewIfNeeded();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a6", "site");
}

async function runScrollToActiveEntityScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    await runner.goto(session, `/task/${showcase.scrollTargetTask.id}`);
    await runner.getByText(showcase.scrollTargetTaskTitle, {exact: true}).first().waitFor();
    await runner
        .getByText(showcase.sectionLabels.longCustomerFeedback, {exact: true})
        .first()
        .waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a6a", "route-scrolls-active-entity");
}

async function runSiteMenuScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    await openShowcaseSite(session, runner, showcase);
    await runner.getByLabel("More").first().click();
    await runner.getByText("Favorite").first().waitFor();
    await runner.getByText("Copy link").first().waitFor();
    await runner.screenshot("a7", "site-menu-not-favorited");

    await runner.getByText("Favorite").first().click();
    await ProcessContextModule.waitForTestTasks();
    await runner.screenshot("a8", "site-menu-favorited");

    await runner.getByText("Favorite").first().click();
    await ProcessContextModule.waitForTestTasks();
    await runner.page.keyboard.press("Escape");
}

async function runEntityContextMenuScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    await openShowcaseSite(session, runner, showcase);
    await rightClickRow(runner, "Lock Q4 plan with Rose", {exact: true});
    await runner.getByText("Insert above").first().waitFor();
    await runner.getByText("Copy link").first().waitFor();
    await runner.getByText("Remove task from site").first().waitFor();
    await runner.screenshot("a9", "entity-context-menu");
}

async function runSectionContextMenuScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    await openShowcaseSite(session, runner, showcase);
    await rightClickRow(runner, showcase.sectionLabels.tables, {exact: true});
    await runner.getByText("Rename").first().waitFor();
    await runner.getByText("Delete section").first().waitFor();
    await runner.screenshot("aa", "section-context-menu");
}

async function runSearchModalScenario(
    context: TestActualContext,
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    async function index(
        update: Extract<
            Parameters<typeof context.jobs.sendAndWait>[0],
            {readonly type: "IndexSearchEntity"}
        >["update"],
    ) {
        await context.jobs.sendAndWait({
            type: "IndexSearchEntity",
            spaceId: session.space.id,
            update,
        });
    }

    await index({
        type: "Task",
        taskId: showcase.searchModalEntities.tablesProjectTask.id,
        updatedTraits: {type: "None"},
    });
    await index({
        type: "TaskCollection",
        collectionId: showcase.searchModalEntities.tablesCollection.id,
        updatedTraits: {type: "None"},
    });
    await index({
        type: "Chat",
        chatId: showcase.searchModalEntities.tablesGAChatRoom.id,
        updatedTraits: {type: "None"},
    });
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const searchResultIds = new Set<string>(
        (
            await searchByKeywords(session.action(), {
                spaceId: session.space.id,
                queryText: "tables",
                limit: 30,
                timeZone: defaultTimeZone,
                currentTime: new Date("2025-10-20T12:00:00-04:00"),
            })
        ).map(result => result.id),
    );
    for (const expectedId of [
        `Task:${showcase.searchModalEntities.tablesProjectTask.id}`,
        `TaskCollection:${showcase.searchModalEntities.tablesCollection.id}`,
        `Chat:${showcase.searchModalEntities.tablesGAChatRoom.id}`,
    ]) {
        if (!searchResultIds.has(expectedId)) {
            throw new InternalError(
                `Search modal setup did not index ${expectedId}. Results: ${Array.from(
                    searchResultIds,
                ).join(", ")}`,
            );
        }
    }

    await openShowcaseSite(session, runner, showcase);
    await runner.getByText("Add", {exact: true}).first().click();
    await runner.getByText("Search for existing", {exact: false}).first().click();
    const searchInput = runner.getByPlaceholder("Search for a document", {exact: false}).first();
    await searchInput.waitFor();
    await searchInput.click();
    await runner.page.keyboard.type("tables");
    const projectTaskOption = runner.page.getByRole("option", {name: /Tables GA Project/}).first();
    const collectionOption = runner.page.getByRole("option", {name: /Tables crew/}).first();
    const chatOption = runner.page.getByRole("option", {name: /Tables GA launch room/}).first();
    await projectTaskOption.waitFor();
    await collectionOption.waitFor();
    await chatOption.waitFor();

    await projectTaskOption.click();
    await runner.page.keyboard.press("Space");
    await runner.getByText("Add 1", {exact: true}).first().waitFor();
    await collectionOption.click();
    await runner.page.keyboard.press("Space");
    await runner.getByText("Add 2", {exact: true}).first().waitFor();
    await chatOption.click();
    await runner.page.keyboard.press("Space");
    await runner.getByText("Add 3", {exact: true}).first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("ab", "search-modal");
}

async function runShareScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    await runner.goto(session, `/doc/${showcase.betsDocument.id}`);
    await runner.getByText("Q4 Bets and Owners").first().waitFor();
    await runner.getByRole("button", {name: "Share"}).first().click();
    await runner.getByText("Copy link").first().waitFor();
    await runner.screenshot("ac", "share-menu");

    await pressShareSwitch(runner);
    await runner.getByText("Make the entire site private?").first().waitFor();
    await runner.screenshot("ad", "share-switch-toggling-off");

    await runner.getByRole("button", {name: "Confirm"}).first().click();
    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    const sharingSwitch = runner.getByLabel("Toggle sharing with everyone", {exact: false});
    if ((await sharingSwitch.count()) === 0) {
        await runner.getByRole("button", {name: "Share"}).first().click();
        await runner.getByText("Copy link").first().waitFor();
    }
    await pressShareSwitch(runner);
    await runner.getByText("Share the entire site?").first().waitFor();
    await runner.screenshot("ae", "share-switch-toggling-on");
    await runner.page.keyboard.press("Escape");
}

async function runChromeAroundEntityScenarios(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    await clickEntityFromShowcaseChrome({
        session,
        runner,
        showcase,
        rowText: "Q4 Bets and Owners",
        waitText: "Q4 Bets and Owners",
        screenshotKey: "af",
        screenshotName: "chrome-around-document",
    });
    await clickEntityFromShowcaseChrome({
        session,
        runner,
        showcase,
        rowText: "Lock Q4 plan with Rose",
        waitText: "Lock Q4 plan with Rose",
        screenshotKey: "ag",
        screenshotName: "chrome-around-task",
    });
    await clickEntityFromShowcaseChrome({
        session,
        runner,
        showcase,
        rowText: "Tables GA Project",
        waitText: "GTM section with Cliff + Holly",
        screenshotKey: "ah",
        screenshotName: "chrome-around-project-task",
    });
    await clickEntityFromShowcaseChrome({
        session,
        runner,
        showcase,
        rowText: "Tables crew",
        waitText: "Enterprise SSO design partner pilot",
        screenshotKey: "ai",
        screenshotName: "chrome-around-task-collection",
    });
    await clickEntityFromShowcaseChrome({
        session,
        runner,
        showcase,
        rowText: "Status",
        waitText: "Tables status",
        screenshotKey: "aj",
        screenshotName: "chrome-around-channel",
    });
    await clickEntityFromShowcaseChrome({
        session,
        runner,
        showcase,
        rowText: "Tables GA launch room",
        waitText: "latest tables build",
        screenshotKey: "ak",
        screenshotName: "chrome-around-chat-room",
    });
}

async function runDragOverlayCollapsedSectionScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    await openShowcaseSite(session, runner, showcase);
    await collapseSectionIfNeeded(
        runner,
        showcase.sectionLabels.operations,
        showcase.expectedTexts.operationsChild,
    );
    await beginDragOnRow(runner, showcase.sectionLabels.operations, {exact: true});
    await runner.screenshot("al", "drag-overlay-collapsed-section");
    await runner.mouse.up();
}

async function runExpandedSectionsScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    await openShowcaseSite(session, runner, showcase);
    await expandSectionIfNeeded(
        runner,
        showcase.sectionLabels.tables,
        showcase.expectedTexts.tablesExpandedTask,
    );
    await expandSectionIfNeeded(
        runner,
        showcase.sectionLabels.realtime,
        showcase.expectedTexts.realtimeExpandedTask,
    );

    await beginDragOnRow(runner, showcase.sectionLabels.tables, {exact: true});
    await runner.screenshot("an", "drag-overlay-expanded-section-with-more");
    await runner.mouse.up();
}

async function openShowcaseSite(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    showcase: ShowcaseSite,
) {
    await runner.goto(session, `/site/${showcase.site.id}`);
    await runner.getByText(showcase.sectionLabels.engineering, {exact: true}).first().waitFor();
    await runner
        .getByText(showcase.sectionLabels.longCustomerFeedback, {exact: true})
        .first()
        .waitFor();
}

async function expandSectionIfNeeded(
    runner: ScreenshotTestRunner,
    sectionLabel: string,
    expectedVisibleText: string,
) {
    const expected = runner.getByText(expectedVisibleText, {exact: true}).first();
    if (await expected.isVisible()) return;

    const section = runner.getByText(sectionLabel, {exact: true}).first();
    await section.scrollIntoViewIfNeeded();
    await section.click();
    await expected.waitFor();
}

async function collapseSectionIfNeeded(
    runner: ScreenshotTestRunner,
    sectionLabel: string,
    expectedHiddenText: string,
) {
    const expected = runner.getByText(expectedHiddenText, {exact: true}).first();
    if (!(await expected.isVisible())) return;

    const section = runner.getByText(sectionLabel, {exact: true}).first();
    await section.scrollIntoViewIfNeeded();
    await section.click();
    await expected.waitFor({state: "hidden"});
}

async function rightClickRow(
    runner: ScreenshotTestRunner,
    rowText: string,
    options: {exact?: boolean} = {},
) {
    const row = runner.getByText(rowText, options).first();
    await row.scrollIntoViewIfNeeded();
    await row.click({button: "right"});
}

async function pressShareSwitch(runner: ScreenshotTestRunner) {
    await runner
        .getByLabel("Toggle sharing with everyone", {exact: false})
        .first()
        .evaluate(element => {
            (element as HTMLElement).click();
        });
}

async function clickEntityFromShowcaseChrome({
    session,
    runner,
    showcase,
    rowText,
    waitText,
    screenshotKey,
    screenshotName,
}: {
    session: TestSpaceSession;
    runner: ScreenshotTestRunner;
    showcase: ShowcaseSite;
    rowText: string;
    waitText: string;
    screenshotKey: string;
    screenshotName: string;
}) {
    await openShowcaseSite(session, runner, showcase);
    const row = runner.getByText(rowText, {exact: true}).first();
    await row.click();
    await runner.getByText(waitText, {exact: false}).first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot(screenshotKey, screenshotName);
}

async function beginDragOnRow(
    runner: ScreenshotTestRunner,
    rowText: string,
    options: {exact?: boolean} = {},
) {
    const row = runner.getByText(rowText, options).first();
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    if (!box) throw new InternalError(`Could not locate the bounding box of ${rowText}`);

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await runner.mouse.move(startX, startY);
    await runner.mouse.down();
    await runner.mouse.move(startX, startY + 12);
    await runner.page.waitForTimeout(100);
}

/**
 * Sidebar as seen by an actor with only `View` access on the site. Cass manages a
 * company handbook site shared with the whole space at the `View` level
 * (`defaultGrant`), and Holly views it. A viewer still gets the sidebar column
 * with the site-name navigation bar, but none of the manage affordances — no ghost
 * "+ Add" row, no "Edit name" gesture, no drag activation, and no root context
 * menu. `SiteSideBarContent` renders non-managers through a separate early-return
 * path (it skips the `DndContext`), so this pins that path's rendering: once on
 * the site URL (which lands on the first entity) and once on a document nested in
 * a section.
 */
async function runViewerAccessScenario(
    accounts: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
    site: TestSite,
    {expectedSiteName}: {expectedSiteName: string},
) {
    const oldAccess = await site.access.get();
    await site.access.set(accounts.cassCade, {
        type: "Local",
        accountGrantById: new Map([
            [accounts.cassCade.account.id, {level: "Manage", generation: 0}],
        ]),
        defaultGrant: {level: "View"},
        urlGrant: null,
    });

    await clearAccountInbox(accounts.hollyEvergreen, runner);
    await runner.drainBackgroundWork();

    await runner.goto(accounts.hollyEvergreen, `/site/${site.id}`);
    await runner.getByText(expectedSiteName, {exact: true}).first().waitFor();
    await runner.mouse.move(0, 0);

    await runner.screenshot("a5A", "view-access-sidebar");

    assert(oldAccess.type === "Local");
    await site.access.set(accounts.cassCade, oldAccess);
}
