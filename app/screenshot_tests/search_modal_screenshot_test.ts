import {CalendarDate} from "@internationalized/date";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {clearAccountInbox} from "~/app/screenshot_tests/helpers/clear_account_inbox.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getSearchEntityIndexesForTest} from "~/server/search/data/index/search_entity_index.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

/**
 * Screenshots the search modal showing a result of every entity type. The standout
 * case is the `Site` entity: a site's preview is determined by its "first entity",
 * so we seed six sites — one per possible first entity (`null`, a project task, a
 * task, a channel, a document, and a task collection) — and capture how each one
 * renders.
 *
 * Each screenshot is a single search: we type a query, then tab down through the
 * results with `ArrowDown` until the intended entity is selected so its preview
 * renders in the peek pane on the right. We use a distinct query per result so the
 * content can be realistic instead of sharing one artificial keyword.
 *
 * Site-contained entities are created as Cass (the demo perspective and the site
 * owner); assignees and message authors carry the real ownership.
 */
export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {space, accounts} = await runner.createDemoSpace(context);

    // Re-index an entity and make it searchable immediately. Created entities normally
    // wait ~10s before they're indexed, which is too long for a test, so we drive the
    // indexer directly and refresh the keyword index ourselves.
    async function index(
        update: Extract<
            Parameters<typeof context.jobs.sendAndWait>[0],
            {readonly type: "IndexSearchEntity"}
        >["update"],
    ) {
        await context.jobs.sendAndWait({type: "IndexSearchEntity", spaceId: space.id, update});
    }

    // --- Sites (one per possible "first entity") ----------------------------

    const documentSite = await TestSite.create(accounts.cassCade, {
        name: "Realtime Reliability",
        access: "Public",
    });
    const taskSite = await TestSite.create(accounts.cassCade, {
        name: "Enterprise SSO",
        access: "Public",
    });
    const projectTaskSite = await TestSite.create(accounts.cassCade, {
        name: "Editor Roadmap",
        access: "Public",
    });
    const channelSite = await TestSite.create(accounts.cassCade, {
        name: "Launches",
        access: "Public",
    });
    const collectionSite = await TestSite.create(accounts.cassCade, {
        name: "Hiring",
        access: "Public",
    });
    // First entity stays `null` — a hub Matt just spun up for his next editor project
    // before adding any pages.
    const emptySite = await TestSite.create(accounts.cassCade, {
        name: "Image Galleries",
        access: "Public",
    });

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    // --- Document (first entity of `documentSite`) --------------------------

    const document = await TestDocument.create(accounts.cassCade, {
        title: "Reconnection backoff design notes",
        access: {type: "Site", siteId: documentSite.id},
        sitePosition: {
            siteId: documentSite.id,
            parentId: documentSite.initialRootContainerId,
            orderKey: initialOrderKey,
        },
        body: markdown`
Goal: stop the reconnect storm after a deploy. When an instance restarts every client reconnects at
the same instant and knocks it over before it has warmed up.

## Approach

Jittered exponential backoff on the client. First retry after a random delay in [0, 1s], then double
the ceiling each attempt up to 30s. The jitter spreads the herd so a restarted instance sees a ramp
instead of a wall.

## Rollout

Ship behind a flag, watch p99 reconnect time, then widen. Targets: p99 reconnect under 2s and no
instance over 70% CPU during a rolling deploy.
        `,
    });

    // --- Task (first entity of `taskSite`) ----------------------------------

    const task = await TestTask.create(accounts.cassCade, {
        title: "Acme Corp blocked on SSO. Need an ETA",
        assignee: accounts.elleKappaTan,
        assigneeStatus: "Active",
        priority: "High",
        notes: markdown`
Acme won\u2019t expand past the pilot without SAML. They asked for a rough quarter. Need an honest
ETA I can take back to them without overpromising.
        `,
    });
    await taskSite.addEntity(accounts.cassCade, {
        entityId: `Task:${task.id}`,
        parentId: taskSite.initialRootContainerId,
        orderKey: initialOrderKey,
    });

    // --- Project task (first entity of `projectTaskSite`) -------------------

    const projectTask = await TestTask.create(accounts.cassCade, {
        title: "Tables in the rich text editor",
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        layout: "Project",
        dueDate: new CalendarDate(2025, 10, 15),
        priority: "High",
        notes: markdown`
Tables for documents. Needs a real cell selection model, Tab and arrow navigation between cells, and
a column resizing story the whole team can live with. Targeting the October 15 ship.
        `,
    });
    await TestTask.create(accounts.cassCade, {
        title: "Cell selection model",
        parent: projectTask,
        assignee: accounts.masonClay,
        status: "Closed",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Keyboard navigation between cells",
        parent: projectTask,
        assignee: accounts.masonClay,
        status: "Closed",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Snap-to-grid column widths",
        parent: projectTask,
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Toolbar placement",
        parent: projectTask,
        assignee: accounts.mattRHorn,
        status: "Closed",
    });
    await projectTaskSite.addEntity(accounts.cassCade, {
        entityId: `Task:${projectTask.id}`,
        parentId: projectTaskSite.initialRootContainerId,
        orderKey: initialOrderKey,
    });

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    // --- Channel (first entity of `channelSite`) ----------------------------

    const channel = await TestChannel.create(accounts.cassCade, {
        name: "Tables launch",
        description: markdown`
Coordination for shipping tables: release notes, the forum announcement, the help doc, and demo
updates. **Target ship is October 15**. Keep everything customer-facing in here.
        `,
        access: {
            type: "Site",
            siteId: channelSite.id,
            position: {parentId: channelSite.initialRootContainerId, orderKey: initialOrderKey},
        },
    });
    await channel.createPost(
        accounts.hollyEvergreen,
        markdown`
Launch plan for tables

Targeting October 15. Customer-facing checklist: release notes drafted, help doc in review, and a
short blog post on what tables unlock. @ sending you a one-liner for the demo script by Friday.
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:20:00-06:00")},
    );
    await channel.createPost(
        accounts.masonClay,
        markdown`
Tables are live

Shipped to production this morning. Snap-to-grid resizing is on by default, hold Alt for fine
control. Keep an eye out for anything weird with paste from spreadsheets.
        `,
        {overrideCreatedTime: new Date("2025-10-15T10:02:00-05:00")},
    );
    await channel.createPost(
        accounts.hollyEvergreen,
        markdown`
Help doc published: Working with tables

Live on the help center now, with a short walkthrough video. Forwarding to the two design partners
who asked for tables. Good excuse to check back in.
        `,
        {overrideCreatedTime: new Date("2025-10-16T09:15:00-06:00")},
    );

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    // --- Task collection (first entity of `collectionSite`) -----------------

    const collection = await TestTaskCollection.create(accounts.cassCade, {
        name: "Senior backend hire",
        access: "Public",
        color: "blue",
    });
    // Earlier pipeline stages, already done.
    await TestTask.create(accounts.cassCade, {
        title: "Screen resumes and build shortlist",
        assignee: accounts.cassCade,
        collections: collection,
        status: "Closed",
    });
    await TestTask.create(accounts.cassCade, {
        title: "First-round interviews",
        assignee: accounts.elleKappaTan,
        collections: collection,
        status: "Closed",
    });
    await TestTask.create(accounts.cassCade, {
        title: "System design round",
        assignee: accounts.elleKappaTan,
        collections: collection,
        status: "Closed",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Final-round debrief with Rose",
        assignee: accounts.roseCompas,
        collections: collection,
        status: "Closed",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Reference checks",
        assignee: accounts.cassCade,
        collections: collection,
        status: "Closed",
    });
    // Where the hire stands now.
    await TestTask.create(accounts.cassCade, {
        title: "Comp approved, send offer",
        assignee: accounts.cassCade,
        assigneeStatus: "Active",
        collections: collection,
        dueDate: new CalendarDate(2025, 10, 17),
        priority: "High",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Schedule offer call with Rose",
        assignee: accounts.cassCade,
        assigneeStatus: "Active",
        collections: collection,
        priority: "Medium",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Draft first-week onboarding plan",
        assignee: accounts.elleKappaTan,
        collections: collection,
    });
    await collectionSite.addEntity(accounts.cassCade, {
        entityId: `TaskCollection:${collection.id}`,
        parentId: collectionSite.initialRootContainerId,
        orderKey: initialOrderKey,
    });

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    // --- Chat (standalone room) ---------------------------------------------

    const chat = await TestChat.createRoom(accounts.cassCade, {
        // Pin the chat ID so the account-pile preview (seeded by `Chat:${chatId}`) is
        // identical across runs. Without this the facepile members/order shuffle each run,
        // making the screenshot flaky.
        id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "columnResizingChat"),
        name: "Column resizing",
        access: "Public",
    });
    await chat.sendMessage(
        accounts.masonClay,
        markdown`
Got column resizing working. drag the border and the width follows your cursor. Feels great
        `,
        {overrideCreatedTime: new Date("2025-09-30T16:12:00-04:00")},
    );
    await chat.sendMessage(
        accounts.mattRHorn,
        markdown`
It feels good in isolation. My worry is people end up with tables full of arbitrary pixel widths.
I\u2019d snap to a grid so columns stay proportioned. It\u2019s the reason newspapers used fixed
column measures for a century.
        `,
        {overrideCreatedTime: new Date("2025-09-30T16:31:00-04:00")},
    );
    await chat.sendMessage(
        accounts.masonClay,
        markdown`
Snapping feels restrictive if you already have a specific layout in mind though
        `,
        {overrideCreatedTime: new Date("2025-10-01T11:05:00-05:00")},
    );
    await chat.sendMessage(
        accounts.cassCade,
        markdown`
Compromise: snap by default, hold Alt for smooth. Ship that.
        `,
        {overrideCreatedTime: new Date("2025-10-06T10:18:00-04:00")},
    );
    await chat.sendMessage(
        accounts.mattRHorn,
        markdown`
Works for me.
        `,
        {overrideCreatedTime: new Date("2025-10-06T10:22:00-04:00")},
    );
    await chat.sendMessage(
        accounts.masonClay,
        markdown`
yeah I can live with that
        `,
        {overrideCreatedTime: new Date("2025-10-06T10:24:00-05:00")},
    );

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    // --- Post (standalone, in a channel we don't index) ---------------------

    const engineeringChannel = await TestChannel.create(accounts.cassCade, {
        name: "Engineering",
        access: "Public",
    });
    const post = await engineeringChannel.createPost(
        accounts.elleKappaTan,
        markdown`
Reconnection storms after every deploy

When an instance restarts every client reconnects at the same instant and briefly overwhelms it
before it\u2019s warmed up (thundering herd). The fix is jittered backoff on the client so the new
instance sees a ramp, not a wall. Writing it up in the reliability doc.
        `,
        // Pin the created time inside the `UNIVERSE.md` window so the post's timestamp is
        // stable across runs instead of showing the wall-clock time.
        {overrideCreatedTime: new Date("2025-09-24T13:30:00-07:00")},
    );

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    // --- Index everything we want to surface, then refresh ------------------
    //
    // Sites are indexed last so each one's `firstEntityId` reflects the entity we just
    // added. The `Engineering` channel is intentionally left out so the only result
    // for the post is the post itself.

    await index({type: "Document", documentId: document.id, updatedTraits: {type: "None"}});
    await index({type: "Task", taskId: task.id, updatedTraits: {type: "None"}});
    await index({type: "Task", taskId: projectTask.id, updatedTraits: {type: "None"}});
    await index({type: "Channel", channelId: channel.id, updatedTraits: {type: "None"}});
    await index({
        type: "TaskCollection",
        collectionId: collection.id,
        updatedTraits: {type: "None"},
    });
    await index({type: "Chat", chatId: chat.id, updatedTraits: {type: "None"}});
    await index({type: "Post", postId: post.id, updatedTraits: {type: "None"}});

    for (const site of [
        documentSite,
        taskSite,
        projectTaskSite,
        channelSite,
        collectionSite,
        emptySite,
    ]) {
        await index({type: "Site", siteId: site.id, updatedTraits: {type: "None"}});
    }

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // The cross-account chat activity above leaves Cass with unread loud
    // notifications, and the nav-rail badge count is delivered over realtime so it
    // climbs as the page settles — flaking every screenshot. Clear the inbox so the
    // badge is deterministically absent, then drain the archive writes.
    await clearAccountInbox(accounts.cassCade);
    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    // --- Open the search modal and walk through the results -----------------
    //
    // Each search reopens the modal from a fresh page. A freshly opened modal has no
    // selected result, so pressing `ArrowDown` once reliably selects the first result.
    // (Reusing one modal across searches lets a previous selection carry over and land
    // `ArrowDown` on the wrong result.)

    await openSearchModal(runner, accounts.cassCade, space.id);
    await runner.screenshot("a0", "empty");

    // One of each entity type.
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "reconnection backoff",
        resultText: "Reconnection backoff design notes",
        peekText: "Reconnection backoff design notes",
        orderKey: "a1",
        name: "result-document",
    });
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Acme Corp",
        resultText: "Acme Corp blocked on SSO. Need an ETA",
        peekText: "Acme Corp blocked on SSO. Need an ETA",
        orderKey: "a2",
        name: "result-task",
    });
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Tables launch",
        resultText: "Tables launch",
        peekText: "Tables launch",
        orderKey: "a3",
        name: "result-channel",
    });
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Column resizing",
        resultText: "Column resizing",
        peekText: "hold Alt for smooth",
        orderKey: "a4",
        name: "result-chat",
    });
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Senior backend hire",
        resultText: "Senior backend hire",
        peekText: "Senior backend hire",
        orderKey: "a5",
        name: "result-task-collection",
    });
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Reconnection storms",
        resultText: "Reconnection storms after every deploy",
        peekText: "thundering herd",
        orderKey: "a6",
        name: "result-post",
    });

    // The six site previews, by first entity.
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Image Galleries",
        resultText: "Image Galleries",
        peekText: "Start building Image Galleries",
        orderKey: "a7",
        name: "site-first-entity-none",
    });
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Realtime Reliability",
        resultText: "Realtime Reliability",
        peekText: "Reconnection backoff design notes",
        orderKey: "a8",
        name: "site-first-entity-document",
    });
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Enterprise SSO",
        resultText: "Enterprise SSO",
        peekText: "Acme Corp blocked on SSO. Need an ETA",
        orderKey: "a9",
        name: "site-first-entity-task",
    });
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Editor Roadmap",
        resultText: "Editor Roadmap",
        peekText: "Tables in the rich text editor",
        orderKey: "aA",
        name: "site-first-entity-project-task",
    });
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Launches",
        resultText: "Launches",
        peekText: "Tables launch",
        orderKey: "aB",
        name: "site-first-entity-channel",
    });
    await searchAndScreenshot(runner, accounts.cassCade, space.id, {
        query: "Hiring",
        resultText: "Hiring",
        peekText: "Senior backend hire",
        orderKey: "aC",
        name: "site-first-entity-task-collection",
    });
}

/**
 * Navigate to a fresh page and open the search modal via the sidebar button.
 */
async function openSearchModal(
    runner: ScreenshotTestRunner,
    session: Parameters<ScreenshotTestRunner["goto"]>[0],
    spaceId: string,
) {
    await runner.goto(session, `/s/${spaceId}/inbox`);
    await runner.getByLabel("Search").first().click();
    await runner.getByTestId("SearchModal").waitFor();
}

/**
 * Reopen the search modal, type a query, then tab down through the results with
 * `ArrowDown` until the intended entity's preview renders in the peek pane, and
 * screenshot it.
 *
 * We tab to the entity rather than assuming it's the first result: search blends
 * keyword and semantic ranking (and the local test embedding model is low
 * quality), so the intended entity isn't always on top. Walking the list with the
 * arrow keys is robust to its exact position.
 *
 * - `resultText` is text that uniquely identifies the intended entity's result
 *   row. We tab until that row is the selected one — keying off the selected row
 *   (rather than the preview contents) avoids stopping early on a different result
 *   whose preview happens to mention the same text (e.g. a task whose preview
 *   shows the collection it belongs to).
 * - `peekText` is text that confirms the intended entity's preview has finished
 *   loading in the peek pane.
 */
async function searchAndScreenshot(
    runner: ScreenshotTestRunner,
    session: Parameters<ScreenshotTestRunner["goto"]>[0],
    spaceId: string,
    {
        query,
        resultText,
        peekText,
        orderKey,
        name,
    }: {query: string; resultText: string; peekText: string; orderKey: string; name: string},
) {
    await openSearchModal(runner, session, spaceId);

    const modal = runner.getByTestId("SearchModal");
    const input = modal.getByPlaceholder(/^Search/).first();
    await input.fill(query);
    await modal.getByText(resultText).first().waitFor();

    // Wait for keyword + semantic search to settle so the result list is stable before
    // we start navigating it.
    await runner.page.waitForLoadState("networkidle");

    // The intended entity's result row, once it's the selected one.
    const selectedRow = modal.locator('[aria-selected="true"]').filter({hasText: resultText});

    // Tab down through the results until the intended row is selected. Re-focus the
    // input before each press: selecting a result can move focus into the preview, and
    // `ArrowDown` only navigates while the search input is focused.
    let selected = false;
    for (let i = 0; i < 12 && !selected; i++) {
        await input.focus();
        await runner.page.keyboard.press("ArrowDown");
        selected = await selectedRow
            .waitFor({timeout: 2000})
            .then(() => true)
            .catch(() => false);
    }
    assert(selected, `Never selected the ${resultText} result while tabbing ${query} results`);

    // Wait for the preview to finish loading, then let its requests settle so the
    // screenshot is stable.
    await runner.getByTestId("SearchModalPeek").getByText(peekText).first().waitFor();
    await runner.page.waitForLoadState("networkidle");

    await runner.screenshot(orderKey, name);
}
