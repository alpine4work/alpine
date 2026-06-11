import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {clearAccountInbox} from "~/app/screenshot_tests/helpers/clear_account_inbox.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";

const mobileViewport = {width: 390, height: 844};

/**
 * Each entity (task, document, channel, chat, task collection) rendered in a
 * mobile viewport, in two states: standalone (no site) and inside a site (where
 * the `[Site name] ›` breadcrumb chip reads above the title). Also covers a
 * subtask whose parent task is in a site — the parent-breadcrumb chain shows the
 * site context even though the subtask itself isn't a direct site member.
 *
 * The site `navigate` route (the in-order tree the chip opens) is also captured so
 * the whole mobile-narrow site experience is screenshotted end-to-end.
 */
export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {space, accounts} = await runner.createDemoSpace(context);
    const cass = accounts.cassCade;

    // ========================================================================
    // Standalone entities (no site membership yet). The first screenshot pass below
    // shows each entity's detail view on mobile without the breadcrumb chip. Pass 2
    // adds each entity to a site and reshoots so we see the chip.
    // ========================================================================

    const okrsTask = await TestTask.create(cass, {
        title: "Lock the OKRs",
        assignee: cass,
        priority: "High",
        notes: markdown`
H2 OKRs need to be final before the all-hands on the 14th. Three things to nail down:

- Tables GA ship target. Mason has the date but we need to commit to it on the call.
- Reliability work — Elle\u2019s jittered backoff phases as the headline number. p99 reconnect under
  2s.
- Pipeline. Cliff\u2019s number for closed-won in Q4, plus the senior backend hire as a leading
  indicator.

Rose and I will draft Friday, share with leads over the weekend, finalize Monday so we can rehearse
the talk Tuesday.
        `,
    });

    const betsDocument = await TestDocument.create(cass, {
        title: "Bets and Owners",
        access: "Public",
        body: markdown`
Draft of the H2 portfolio. Inputs from each owner are due next week.

## P0s

- **Tables GA** — Mason. Targeting Oct 13 ship. Column resizing is the one open design question.
  Snap by default, hold Alt for smooth.
- **Realtime reliability** — Elle. Jittered backoff phases 3–4 plus alerting. p99 reconnect under
  2s, no instance over 70% CPU during a rolling deploy.
- **Senior backend hire** — Cass + Rose. Offer out this week. Q4 start date if they accept.

## P1s

- **Enterprise SSO scoping** — Elle + Cliff. Design doc, not a build. Three of Cliff\u2019s deals
  are gated on this.
- **Customer case studies** — Holly. Second published, third in draft by end of quarter.

## P2s

Tentative. Nothing here is staffed yet.

- **Sales enablement** — Holly + Cliff. One-pager plus a demo script for the tables flow so the team
  isn\u2019t improvising in calls.
- **Editor interaction audit follow-ups** — Matt. Top five paper cuts from the audit, nothing
  bigger.
- **Support macro refresh** — Rose. Quick pass once the GA copy settles.

We\u2019re not committing to anything below P1 until the P0s have a clear path. If you want
something added, bring it to the planning sync with the trade-off you\u2019d make to fit it in.
        `,
    });

    const tablesCollection = await TestTaskCollection.create(cass, {
        name: "Tables crew",
        access: "Public",
        color: "blue",
    });
    const tablesTaskTitles = [
        "Confirm launch checklist owner",
        "Audit keyboard navigation in tables",
        "Write resize affordance copy",
        "Review frozen column prototype",
        "Prep customer migration notes",
        "Update docs screenshots",
        "Verify mobile table fallback",
        "Check paste from Sheets",
        "Add empty state examples",
        "Polish loading skeleton",
        "Test undo after column reorder",
        "Review formula follow-up asks",
        "Close accessibility notes",
        "Draft launch email bullets",
        "Record internal demo clip",
        "Update support macros",
        "Triage beta feedback",
        "Prepare GA release notes",
    ];

    for (const [index, title] of tablesTaskTitles.entries()) {
        await TestTask.create(cass, {
            title,
            assignee:
                index % 3 === 0
                    ? accounts.masonClay
                    : index % 3 === 1
                      ? accounts.hollyEvergreen
                      : cass,
            priority: index % 4 === 0 ? "High" : index % 4 === 1 ? "Medium" : undefined,
            collections: tablesCollection,
        });
    }

    const statusChannel = await TestChannel.create(cass, {
        name: "Status",
        access: "Public",
        description: markdown`
Weekly status sync for the H2 planning cycle. Every Tuesday — what shipped, what\u2019s blocked,
what we\u2019re handing off. Keep it short, link to the doc.
        `,
    });
    await statusChannel.subscribe(cass);

    const launchRoom = await TestChat.createRoom(cass, {
        id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "tablesGAChatRoom"),
        name: "Tables GA launch room",
        access: "Public",
    });
    await launchRoom.sendMessage(
        cass,
        markdown`
Latest tables build is on staging. Holly, can you run the help doc through it once before we cut the
announcement?
        `,
        {
            overrideCreatedTime: new Date("2025-09-30T10:14:00-04:00"),
        },
    );
    const launchMessages = [
        {account: accounts.hollyEvergreen, text: "Yep, I can take the first pass this afternoon."},
        {account: accounts.masonClay, text: "I just pushed a fix for pasted CSV headers."},
        {account: cass, text: "Nice. Please flag anything that changes the announcement copy."},
        {account: accounts.hollyEvergreen, text: "The empty state copy is still a little flat."},
        {account: accounts.elleKappaTan, text: "Perf looks stable on the large workspace seed."},
        {
            account: accounts.masonClay,
            text: "Column resize now snaps at the same interval everywhere.",
        },
        {account: cass, text: "Great, that was the one I wanted settled before GA."},
        {account: accounts.roseCompas, text: "Support macros are drafted. Need one screenshot."},
        {account: accounts.hollyEvergreen, text: "I will grab that after the docs pass."},
        {account: accounts.cliffWeathers, text: "Clifford & Co want to be in the beta quote list."},
        {account: cass, text: "Add them, but keep the launch note customer-agnostic for now."},
        {account: accounts.elleKappaTan, text: "Staging deploy finished. No reconnect spikes."},
        {account: accounts.masonClay, text: "I am checking undo after reorder one more time."},
        {account: accounts.hollyEvergreen, text: "Help doc pass is done. Two small wording notes."},
        {account: cass, text: "Drop them here and I will fold them into the release notes."},
    ];
    const launchTimeBase = new Date("2025-09-30T10:20:00-04:00");
    for (const [index, {account, text}] of launchMessages.entries()) {
        await launchRoom.sendMessage(account, text, {
            overrideCreatedTime: new Date(launchTimeBase.getTime() + index * 60_000),
        });
    }

    await runner.drainBackgroundWork();

    // The status channel subscription and launch room messages above leave Cass with
    // unread loud notifications, and the tab bar's inbox badge is realtime-delivered
    // so whether it shows depends on how quickly notification processing settles —
    // flaking every mobile screenshot in this suite. Clear the inbox before pass 1 so
    // the tab bar renders at inbox zero with no badge.
    await clearAccountInbox(cass);
    await runner.drainBackgroundWork();

    // ======================================================================== Pass 1:
    // each entity on mobile, without a site (no chip).
    // ========================================================================

    await runner.goto(cass, `/s/${space.id}/tasks/${okrsTask.id}`, {viewport: mobileViewport});
    await runner.getByText("Lock the OKRs").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a0", "task-mobile");

    await runner.goto(cass, `/s/${space.id}/documents/${betsDocument.id}`, {
        viewport: mobileViewport,
    });
    await runner.getByText("Bets and Owners").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a1", "document-mobile");

    await runner.goto(cass, `/s/${space.id}/tasks/collections/${tablesCollection.id}`, {
        viewport: mobileViewport,
    });
    await runner.getByText("Tables crew").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a2", "task-collection-mobile");
    await runner.getByTestId("TaskCollectionScrollView").evaluate(element => {
        element.scrollTop = 320;
    });
    await runner.mouse.move(0, 0);
    await runner.screenshot("a2S", "task-collection-mobile-scrolled");

    await runner.goto(cass, `/s/${space.id}/channels/${statusChannel.id}`, {
        viewport: mobileViewport,
    });
    await runner.getByText("Status", {exact: true}).first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a3", "channel-mobile");

    await runner.goto(cass, `/s/${space.id}/chat/${launchRoom.id}`, {viewport: mobileViewport});
    await runner.getByText("Tables GA launch room").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a4", "chat-mobile");
    await runner.getByTestId("MessagingScrollView").evaluate(element => {
        element.scrollTop = 200;
    });
    await runner.mouse.move(0, 0);
    await runner.screenshot("a4S", "chat-mobile-scrolled");

    // ======================================================================== Add
    // each entity to a site. `addEntityToSite` (via `TestSite.addEntity`) updates the
    // access policy of documents, channels, and chats to `type: "Site"` along the way.
    // ========================================================================

    const site = await TestSite.create(cass, {name: "FY2026 H2 Planning", access: "Public"});
    const rootContainerId = site.initialRootContainerId;

    await site.addEntity(cass, {
        entityId: `Task:${okrsTask.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a0"),
    });
    await site.addEntity(cass, {
        entityId: `Document:${betsDocument.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a1"),
    });
    await site.addEntity(cass, {
        entityId: `TaskCollection:${tablesCollection.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a2"),
    });
    await site.addEntity(cass, {
        entityId: `Channel:${statusChannel.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a3"),
    });
    await site.addEntity(cass, {
        entityId: `Chat:${launchRoom.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a4"),
    });

    await runner.drainBackgroundWork();

    // ======================================================================== Pass 2:
    // same entities on mobile, now inside the site (chip visible).
    // ========================================================================

    await runner.goto(cass, `/s/${space.id}/tasks/${okrsTask.id}`, {viewport: mobileViewport});
    await runner.getByText("Lock the OKRs").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a5", "task-mobile-in-site");

    await runner.goto(cass, `/s/${space.id}/documents/${betsDocument.id}`, {
        viewport: mobileViewport,
    });
    await runner.getByText("Bets and Owners").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a6", "document-mobile-in-site");
    await runner.getByTestId("DocumentContentEditorMain").evaluate(element => {
        element.scrollTop = 320;
    });
    await runner.mouse.move(0, 0);
    await runner.screenshot("a6S", "document-mobile-in-site-scrolled");
    // Scroll back up a little. An upward scroll reveals the scrolled-away navigation
    // bar (chip + title) again, now layered over mid-document content.
    await runner.getByTestId("DocumentContentEditorMain").evaluate(element => {
        element.scrollTop = 220;
    });
    await runner.mouse.move(0, 0);
    await runner.screenshot("a6SU", "document-mobile-in-site-scrolled-up");

    await runner.goto(cass, `/s/${space.id}/tasks/collections/${tablesCollection.id}`, {
        viewport: mobileViewport,
    });
    await runner.getByText("Tables crew").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a7", "task-collection-mobile-in-site");
    await runner.getByTestId("TaskCollectionScrollView").evaluate(element => {
        element.scrollTop = 320;
    });
    await runner.mouse.move(0, 0);
    await runner.screenshot("a7S", "task-collection-mobile-in-site-scrolled");
    // Scroll back up a little. An upward scroll reveals the scrolled-away navigation
    // bar (chip + title) again, now layered over mid-list content.
    await runner.getByTestId("TaskCollectionScrollView").evaluate(element => {
        element.scrollTop = 220;
    });
    await runner.mouse.move(0, 0);
    await runner.screenshot("a7SU", "task-collection-mobile-in-site-scrolled-up");

    await runner.goto(cass, `/s/${space.id}/channels/${statusChannel.id}`, {
        viewport: mobileViewport,
    });
    await runner.getByText("Status", {exact: true}).first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a8", "channel-mobile-in-site");

    await runner.goto(cass, `/s/${space.id}/chat/${launchRoom.id}`, {viewport: mobileViewport});
    await runner.getByText("Tables GA launch room").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a9", "chat-mobile-in-site");
    await runner.getByTestId("MessagingScrollView").evaluate(element => {
        element.scrollTop = 200;
    });
    await runner.mouse.move(0, 0);
    await runner.screenshot("a9S", "chat-mobile-in-site-scrolled");

    // ======================================================================== Subtask
    // whose parent task is in the site AND which is itself added to the same site —
    // the worst case for stacking, since the site and the parent both want to appear
    // above the title. The single breadcrumb chain absorbs both ("Site › Parent ›") on
    // one row instead of two.
    // ========================================================================

    const subtask = await TestTask.create(cass, {
        title: "Draft all-hands talking points",
        parent: okrsTask,
        assignee: cass,
        priority: "Medium",
        notes: markdown`
Bullet list for the open. Lead with what shipped in H1 then the H2 bets.
        `,
    });
    await site.addEntity(cass, {
        entityId: `Task:${subtask.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a5"),
    });
    await runner.drainBackgroundWork();

    await runner.goto(cass, `/s/${space.id}/tasks/${subtask.id}`, {viewport: mobileViewport});
    await runner.getByText("Draft all-hands talking points").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("aA", "subtask-mobile-parent-in-site");

    // ======================================================================== The
    // site `navigate` route the chip opens — a navbar + the in-order tree so users can
    // jump to other entities while inside a peek / on mobile.
    // ========================================================================

    await runner.goto(cass, `/site/${site.id}/navigate`, {viewport: mobileViewport});
    await runner.getByText("Lock the OKRs").first().waitFor();
    await runner.getByText("Status", {exact: true}).first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("aB", "navigate-route-mobile");
}
