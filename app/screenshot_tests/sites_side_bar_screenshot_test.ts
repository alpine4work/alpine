import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {clearAccountInbox} from "~/app/screenshot_tests/helpers/clear_account_inbox.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    OrderKey,
    assertOrderKey,
    generateOrderKeyBetween,
} from "~/shared/helpers/sort/order_key.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {ChatId, PostId} from "~/shared/id/types/id_types.js";
import {SiteContainerId, printSiteContainerId} from "~/shared/sites/site_entry_id.js";

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {accounts} = await runner.createDemoSpace(context);

    const site = await TestSite.create(accounts.cassCade, {
        name: "FY2026 H2 Planning",
        access: "Public",
    });

    const rootContainerId = site.initialRootContainerId;

    // Top-level section with deeply nested content so the depth lines have multiple
    // ancestors to span — mirrors the "Test multiselect → Contractors → Deep nesting"
    // shape that motivated this screenshot test.
    const planningSectionId = await site.addSection(accounts.cassCade, {
        label: "Planning",
        orderKey: assertOrderKey("a1"),
        parent: site.initialSideBarRoot,
    });
    const planningSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: planningSectionId,
    });

    const engineeringSectionId = await site.addSection(accounts.cassCade, {
        label: "Engineering",
        orderKey: assertOrderKey("a1"),
        parent: {type: "SideBarSection", id: planningSectionId},
    });
    const engineeringSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: engineeringSectionId,
    });

    // A second top-level section so we can see the line stop at the right depth and
    // not bleed into subsequent siblings.
    const launchesSectionId = await site.addSection(accounts.cassCade, {
        label: "Launches",
        orderKey: assertOrderKey("a2"),
        parent: site.initialSideBarRoot,
    });
    const launchesSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: launchesSectionId,
    });

    // Depth-0 entry at the very top — depth-0 rows should never render a line slot.
    const okrsTask = await TestTask.create(accounts.cassCade, {
        title: "Lock the OKRs",
        assignee: accounts.cassCade,
        priority: "High",
        notes: markdown`
Get the OKRs locked before the all-hands. Rose has the company-level outcomes; this task is the
build out underneath: bets, owners, measurable signals, and the rough sequencing across the half.
        `,
    });
    await okrsTask.createComment(
        accounts.cassCade,
        markdown`
Draft of the bets doc is up for review. Aiming to lock by Monday morning, please drop comments
inline by EOD Friday. Rose is doing the final pass over the weekend.
        `,
        {overrideCreatedTime: new Date("2025-10-15T15:14:00-04:00")},
    );
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${okrsTask.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a0"),
    });

    // Document with a rich body so document-chrome screenshots show real content
    // rather than an empty editor.
    const betsDocument = await TestDocument.create(accounts.cassCade, {
        title: "Bets and Owners",
        access: {type: "Site", siteId: site.id},
        body: markdown`
Author: Cass Cade

Draft of the H2 portfolio. Inputs from each owner are due by the end of next week. Rose and I will
finalize the week after.

## Priorities

- **P0**: Tables GA + follow-on editor polish (Mason Clay)
- **P0**: Realtime reliability phase 3 (Elle Kappa-Tan)
- **P1**: Enterprise SSO design partner build (Elle Kappa-Tan + Cliff Weathers)
- **P2**: Customer case studies + sales enablement (Holly Evergreen)
        `,
        sitePosition: {
            siteId: site.id,
            parentId: rootContainerId,
            orderKey: assertOrderKey("a05"),
        },
    });

    // Project task with subtasks so the project-task chrome screenshot has real child
    // rows instead of an empty subtasks list.
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
        orderKey: assertOrderKey("a06"),
    });

    // Task collection with member tasks so the task-collection chrome screenshot shows
    // a populated list instead of an empty board.
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
        orderKey: assertOrderKey("a07"),
    });

    const tablesGAChatRoom = await createTablesGAChatRoom({
        site,
        rootContainerId,
        accounts,
        runner,
    });

    // Depth-1 entry inside Planning (sits above the nested Engineering section).
    const betsTask = await TestTask.create(accounts.cassCade, {
        title: "Bets list reviewed with Rose",
        assignee: accounts.cassCade,
        status: "Closed",
    });
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${betsTask.id}`,
        parentId: planningSectionContainerId,
        orderKey: assertOrderKey("a0"),
    });

    // Depth-2 entries inside Engineering — these are the rows where the line for
    // Planning has to extend all the way down through the Engineering column.
    const tablesTask = await TestTask.create(accounts.cassCade, {
        title: "Stabilize and announce Tables GA",
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        priority: "High",
    });
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${tablesTask.id}`,
        parentId: engineeringSectionContainerId,
        orderKey: assertOrderKey("a0"),
    });

    const realtimeTask = await TestTask.create(accounts.cassCade, {
        title: "Realtime reliability phase 3",
        assignee: accounts.elleKappaTan,
        assigneeStatus: "Active",
        priority: "High",
    });
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${realtimeTask.id}`,
        parentId: engineeringSectionContainerId,
        orderKey: assertOrderKey("a1"),
    });

    const ssoTask = await TestTask.create(accounts.cassCade, {
        title: "Enterprise SSO pilot",
        assignee: accounts.elleKappaTan,
    });
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${ssoTask.id}`,
        parentId: engineeringSectionContainerId,
        orderKey: assertOrderKey("a2"),
    });

    const statusChannel = await createStatusChannel({
        site,
        planningSectionContainerId,
        accounts,
        runner,
    });

    // Depth-1 entries under Launches — separate top-level section.
    const launchPostTask = await TestTask.create(accounts.cassCade, {
        title: "Tables GA launch post",
        assignee: accounts.hollyEvergreen,
    });
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${launchPostTask.id}`,
        parentId: launchesSectionContainerId,
        orderKey: assertOrderKey("a0"),
    });

    const ssoAnnounceTask = await TestTask.create(accounts.cassCade, {
        title: "SSO design-partner announcement",
        assignee: accounts.cliffWeathers,
    });
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${ssoAnnounceTask.id}`,
        parentId: launchesSectionContainerId,
        orderKey: assertOrderKey("a1"),
    });

    // Trailing depth-0 entry after both sections — depth-0 rows should never render a
    // line slot, even when they follow nested content.
    const walkthroughTask = await TestTask.create(accounts.cassCade, {
        title: "Walk through with Rose before all-hands",
        assignee: accounts.cassCade,
        priority: "High",
    });
    await site.addEntity(accounts.cassCade, {
        entityId: `Task:${walkthroughTask.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a3"),
    });

    // The chat room and status channel above leave Cass with unread loud
    // notifications, and the nav-rail badge count is realtime-delivered so it climbs
    // as the page settles — flaking every screenshot in this suite. Clear the inbox
    // before loading the page so it mounts at inbox zero with no badge.
    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();
    await clearAccountInbox(accounts.cassCade);
    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    await runner.goto(accounts.cassCade, `/site/${site.id}`);

    // Wait for the section labels (plain text in the sidebar) — proxy for "the whole
    // tree has rendered" so the screenshot captures every depth slot.
    await runner.getByText("Planning").first().waitFor();
    await runner.getByText("Engineering").first().waitFor();

    // Nested sections default to collapsed, so we click Engineering to expand it and
    // reveal its depth-2 children. The depth-2 rows are the ones that need _two_ lines
    // (one for Planning, one for Engineering) to verify the comb pattern.
    await runner.getByText("Engineering").first().click();
    await runner.getByText("Realtime reliability phase 3").first().waitFor();

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    await runner.screenshot("a0", "depth-lines");

    await runActivationAndScrollScenario(accounts.cassCade, runner);
    await runSiteLifecycleScenario(accounts.cassCade, runner);
    await runDeepNestingScenario(accounts.cassCade, runner);
    await runLongTitlesScenario(accounts.cassCade, runner);
    await runGhostRowMenuScenario(accounts.cassCade, runner);
    await runEntityContextMenuScenario(accounts.cassCade, runner);
    await runSectionContextMenuScenario(accounts.cassCade, runner);
    await runDragOverlayExpandedSectionScenario(accounts.cassCade, runner, site.id);
    await runDragOverlayCollapsedSectionScenario(accounts.cassCade, runner, site.id);
    await runSearchModalMultiselectScenario(accounts.cassCade, runner);
    await runShareMenuScenario(accounts.cassCade, runner);
    await runShareSwitchTogglingOffScenario(accounts.cassCade, runner);
    await runShareSwitchTogglingOnScenario(accounts.cassCade, runner);

    // Chrome around each entity type, navigating to entities that live inside the
    // showcase site so every screenshot doubles as a marketing-ready surface with real
    // content — body text, comments, posts, messages, subtasks. Run last so the
    // active-entity state from the share scenarios doesn't bleed across.
    await runner.goto(accounts.cassCade, `/doc/${betsDocument.id}`);
    await runner.getByText("Bets and Owners").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("aj", "chrome-around-document");

    await runner.goto(accounts.cassCade, `/task/${okrsTask.id}`);
    await runner.getByText("Lock the OKRs").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("ak", "chrome-around-task");

    await runner.goto(accounts.cassCade, `/task/${tablesProjectTask.id}`);
    await runner.getByText("Tables GA Project").first().waitFor();
    await runner.getByText("GTM section with Cliff + Holly").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("al", "chrome-around-project-task");

    await runner.goto(accounts.cassCade, `/task-collection/${tablesCollection.id}`);
    await runner.getByText("Tables crew").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("am", "chrome-around-task-collection");

    await runner.goto(accounts.cassCade, `/channel/${statusChannel.id}`);
    await runner.getByText("Status", {exact: true}).first().waitFor();
    await runner.getByText("Tables status", {exact: false}).first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("an", "chrome-around-channel");

    await runner.goto(accounts.cassCade, `/chat/${tablesGAChatRoom.id}`);
    await runner.getByText("Tables GA launch room").first().waitFor();
    await runner.getByText("latest tables build", {exact: false}).first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("ao", "chrome-around-chat-room");

    await runViewerAccessScenario(site, accounts, runner, async () => {
        await runner.goto(accounts.hollyEvergreen, `/chat/${tablesGAChatRoom.id}`);
        await runner.getByText("Tables GA launch room").first().waitFor();
        await runner.getByText("latest tables build", {exact: false}).first().waitFor();
        await runner.mouse.move(0, 0);

        await runner.screenshot("ap", "view-access-sidebar");
    });
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
            position: {parentId: rootContainerId, orderKey: assertOrderKey("a08")},
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
    planningSectionContainerId,
    accounts,
    runner,
}: {
    site: TestSite;
    planningSectionContainerId: SiteContainerId;
    accounts: DemoSpaceAccounts;
    runner: ScreenshotTestRunner;
}) {
    // Another depth-1 entry under Planning after the nested Engineering section —
    // confirms the Planning line continues past the section block. Populated with a
    // real post + replies so the channel-chrome screenshot shows actual content.
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
track for late February.
        `,
        {overrideCreatedTime: new Date("2025-10-17T10:08:00.000Z")},
    );
    await tablesWeeklyPost.setReaction(accounts.cassCade, "Celebrate");
    await tablesWeeklyPost.setReaction(accounts.elleKappaTan, "Yes");
    await site.addEntity(accounts.cassCade, {
        entityId: `Channel:${statusChannel.id}`,
        parentId: planningSectionContainerId,
        orderKey: assertOrderKey("a2"),
    });

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    return statusChannel;
}

/**
 * Second scenario: navigate directly to an entity URL for a task buried inside a
 * nested (default-collapsed) section, far enough down a long sibling list that it
 * would be below the sidebar's scroll viewport. This exercises the sideBarState
 * context end-to-end — on site activation the ancestor chain is pre-expanded and
 * the row is scrolled into view, with no per-navigation reaction afterwards.
 */
async function runActivationAndScrollScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
) {
    const site = await TestSite.create(session, {
        name: "Engineering archive",
        access: "Public",
    });

    // A couple of top-level tasks so the section below is meaningfully indented.
    const topLevelKey1 = generateOrderKeyBetween(null, null);
    const topLevelTask1 = await TestTask.create(session, {
        title: "Triage incoming bug reports",
        assignee: session,
    });
    await site.addEntity(session, {
        entityId: `Task:${topLevelTask1.id}`,
        parentId: site.initialRootContainerId,
        orderKey: topLevelKey1,
    });

    const topLevelKey2 = generateOrderKeyBetween(topLevelKey1, null);
    const topLevelTask2 = await TestTask.create(session, {
        title: "Sync with Rose on H2 OKRs",
        assignee: session,
    });
    await site.addEntity(session, {
        entityId: `Task:${topLevelTask2.id}`,
        parentId: site.initialRootContainerId,
        orderKey: topLevelKey2,
    });

    // Root section "Completed initiatives" — expanded by default at depth 0.
    const rootSectionKey = generateOrderKeyBetween(topLevelKey2, null);
    const completedSectionId = await site.addSection(session, {
        label: "Completed initiatives",
        orderKey: rootSectionKey,
        parent: site.initialSideBarRoot,
    });
    const completedSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: completedSectionId,
    });

    // Many archived items inside Completed initiatives. The list is intentionally tall
    // enough to exceed the sidebar viewport so the target row would be below the fold
    // without an explicit scroll — that's how this screenshot proves
    // `initialScrollTargetEntityId` actually drives a scroll, not just the
    // ancestor-expansion half of the context.
    const completedTaskTitles = [
        "Stabilize and announce Tables GA",
        "Realtime reliability phase 2",
        "Realtime reliability phase 1",
        "Enterprise SSO design partner kickoff",
        "Mobile inbox redesign",
        "Search affinity tuning round 1",
        "Search affinity tuning round 2",
        "Spell-check alpha",
        "Sites preview file rollout",
        "Onboarding playbook refresh",
        "Customer case study – Acme",
        "Customer case study – Globex",
        "Customer case study – Initech",
        "Q3 metrics review",
        "Q3 retrospective notes",
        "Annual security audit prep",
        "Forum search ranking tweak",
        "Notification batching v2",
        "Task assignee migration",
        "Document outline overhaul",
        "Chat reactions rollout",
        "Inbox grouping experiment",
        "Sidebar drag-and-drop polish",
        "Realtime presence indicators",
        "Mention autocomplete refresh",
        "API rate-limiting headers",
        "Feed algorithm v3",
        "Cold-start onboarding email",
        "Pricing page redesign",
        "Sales handoff document v2",
        "Calendar sync investigation",
        "Slack integration kickoff",
        "Linear migration helper",
        "Workspace export tool",
        "Audit log polish",
        "Channel notification settings UX",
    ];
    let lastChildKey: OrderKey | null = null;
    for (const title of completedTaskTitles) {
        lastChildKey = generateOrderKeyBetween(lastChildKey, null);
        const task = await TestTask.create(session, {
            title,
            assignee: session,
            status: "Closed",
        });
        await site.addEntity(session, {
            entityId: `Task:${task.id}`,
            parentId: completedSectionContainerId,
            orderKey: lastChildKey,
        });
    }

    // Nested section at depth 1 — collapsed by default. The active entity will live
    // inside this section, so activation has to expand it for the row to even mount.
    const nestedSectionKey = generateOrderKeyBetween(lastChildKey, null);
    const oldProjectsSectionId = await site.addSection(session, {
        label: "Old projects",
        orderKey: nestedSectionKey,
        parent: {type: "SideBarSection", id: completedSectionId},
    });
    const oldProjectsSectionContainerId = printSiteContainerId({
        type: "SideBarSection",
        id: oldProjectsSectionId,
    });

    // The target task — depth 2, inside the default-collapsed nested section, far
    // enough down that the sidebar must scroll for it to be visible.
    const targetTask = await TestTask.create(session, {
        title: "FY2025 budget review",
        assignee: session,
        status: "Closed",
    });
    await site.addEntity(session, {
        entityId: `Task:${targetTask.id}`,
        parentId: oldProjectsSectionContainerId,
        orderKey: generateOrderKeyBetween(null, null),
    });

    // Navigating to the entity URL is what triggers `useSideBarState`'s
    // initialization: ancestors of `targetTask` get expanded and the scroll target is
    // armed for the first paint.
    await runner.goto(session, `/task/${targetTask.id}`);

    // Wait until the row for the target task mounts — proves the ancestor chain was
    // expanded.
    await runner.getByText("FY2025 budget review").first().waitFor();

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    await runner.screenshot("a1", "expand-and-scroll-to-active-entity");
}

/**
 * The full lifecycle of a brand-new site, driven through the real UI on a single
 * site instead of spinning up a fresh site per screenshot. We follow the natural
 * order a user works in — create, name, favorite, set permissions, then add the
 * first piece of content — and screenshot each surface as the site transitions
 * from empty to full:
 *
 * 1. **`create-flow-editor-open`** — what a user sees the moment they click the
 *    global "+" Create button in the space sidebar and pick "Site" from the
 *    overlay. The create route adds `?focus=name` which `SiteNameHeader` reads to
 *    open `SiteNameEditor` immediately with the default `"New site"` name
 *    pre-selected and focused, so the user can type a real name without an extra
 *    click. The welcome copy ("Start building New site") and the empty sidebar are
 *    also visible.
 * 2. **`create-flow-renamed-site`** — type a real name into the open editor, press
 *    Enter. After the rename mutation completes the new name appears in both the
 *    header and the welcome copy, proving the rename was saved (the welcome copy
 *    reads from the same site context that wraps the header, so a stale-cache
 *    rename would not update it).
 * 3. **`navigation-bar-menu-{not-,}favorited`** — an _empty_ site has no sidebar,
 *    so its 3-dot menu lives in the **top navigation bar** (`More`). Capture it
 *    both before and after favoriting (the star fills in).
 * 4. **`make-site-private-modal`** — newly created sites are private by default,
 *    so we first share the site (no confirmation), then toggle it back to private,
 *    which asks for confirmation. Capture that modal.
 * 5. **`site-menu-{not-,}favorited`** — add the first entity through the UI. Now
 *    the site is _full_, so the sidebar renders its own navigation bar `More`
 *    menu. Capture the favorite/unfavorite states there too.
 *
 * Worth driving through the UI because the create button → overlay → Site item
 * path is the canonical entry point and exercises the `?focus=name` →
 * SiteNameHeader handoff, and because reusing one site keeps the empty→full
 * transition (and which menu surface owns favoriting at each stage) honest.
 */
async function runSiteLifecycleScenario(session: TestSpaceSession, runner: ScreenshotTestRunner) {
    // Start somewhere neutral inside the space — any entity URL puts the global "+"
    // button in the space sidebar in view.
    await runner.goto(session, `/home/${session.space.id}`);

    // Click the global "+" Create button. `IconButton` exposes its `description` as
    // `aria-label`, so a label lookup finds it deterministically without depending on
    // icon SVG markup.
    await runner.getByLabel("Create", {exact: true}).first().click();

    // Pick "Site" in the create overlay's secondary menu. The item is rendered as
    // `role="menuitem"` with `aria-labelledby` pointing at the label box, so the name
    // match below targets exactly that label (not the longer description text also
    // inside the item).
    //
    // The create overlay puts a sibling pointer-clearance layer over the page that
    // intercepts pointer events (see `withoutClearSelectionOnMouseDownClassName`) and
    // contains focus with react-aria's `FocusScope`, so Playwright can't get a mouse
    // click or keyboard Enter to reliably reach the menuitem. The menuitem
    // implementation exposes a `.press()` method on its DOM element specifically so
    // tests and shortcuts can trigger it imperatively — call that here. This is the
    // same handler the menuitem would invoke on a real user activation; we're
    // bypassing only Playwright's event-dispatch path, not the menuitem's own
    // `onPress` logic.
    await runner
        .getByRole("menuitem", {name: "Site"})
        .first()
        .evaluate(element => {
            (element as HTMLElement & {press(): void}).press();
        });

    // The "Create → Site" handler generates a `siteId` on the client and navigates to
    // `/site/$siteId?create&focus=name`, which creates the site in the loader then
    // renders — and because the URL carries `?focus=name`, `SiteNameHeader` opens
    // directly in edit mode with `SiteNameEditor`'s input auto-focused and the
    // existing "New site" name pre-selected. Wait for navigation, the welcome copy,
    // and the editor's input (placeholder "New site") to all be on screen.
    await runner.page.waitForURL(/\/site\//);
    await runner.getByText("Start building New site").first().waitFor();
    await runner.getByPlaceholder("New site").first().waitFor();
    await runner.mouse.move(0, 0);

    await runner.screenshot("a2", "create-flow-editor-open");

    // The editor's input is already focused with the placeholder name selected, so
    // typing replaces it wholesale and Enter commits.
    await runner.page.keyboard.type("H2 stretch goals");
    await runner.page.keyboard.press("Enter");

    // Wait for the rename to land — the welcome copy comes from the same site context
    // as the header, so seeing the new name there confirms the rename mutation
    // resolved and the site model has the updated `name` field.
    await runner.getByText("Start building H2 stretch goals").first().waitFor();
    await runner.mouse.move(0, 0);

    await runner.screenshot("a25", "create-flow-renamed-site");

    // Capture the new site's id from the URL before we navigate away — we come back to
    // its `/site/$siteId` page once it has content (see the full-site steps).
    const siteIdMatch = runner.page.url().match(/\/site\/([^/?#]+)/);
    if (!siteIdMatch)
        throw new InternalError("Could not determine the created site id from the URL");
    const siteId = siteIdMatch[1];

    // Let the new site's search entity index so favoriting resolves cleanly.
    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    // --- Empty site: the 3-dot menu lives in the top navigation bar (`More`), not the
    // sidebar (an empty site has no sidebar). Favorite + Copy link flow through it.
    await runner.getByLabel("More").first().click();
    await runner.getByText("Favorite").first().waitFor();
    await runner.getByText("Copy link").first().waitFor();
    await runner.screenshot("a26", "navigation-bar-menu-not-favorited");

    // Favoriting updates the star in place without closing the menu, so screenshot the
    // filled-star state directly rather than reopening (reopening is blocked by the
    // open menu's pointer-clearance backdrop).
    await runner.getByText("Favorite").first().click();
    await ProcessContextModule.waitForTestTasks();
    await runner.screenshot("a27", "navigation-bar-menu-favorited");

    // Unfavorite — still inside the open menu — so the full-site sidebar menu steps
    // below start from a clean not-favorited state (favorite state is shared across
    // both menu surfaces). Then close the menu so it doesn't intercept later clicks.
    await runner.getByText("Favorite").first().click();
    await ProcessContextModule.waitForTestTasks();
    await runner.page.keyboard.press("Escape");

    // --- Permissions: newly created sites are private by default. Sharing a site (a
    // `Local` access policy) takes effect immediately with no confirmation, so toggle
    // the switch on first to reach the public state.
    await runner.getByLabel("Toggle sharing with everyone", {exact: false}).first().click();
    await runner
        .getByLabel("Icon indicating the site is shared with everyone", {exact: false})
        .first()
        .waitFor();

    // Toggling back to private asks the user to confirm. Capture that modal.
    await runner.getByLabel("Toggle sharing with everyone", {exact: false}).first().click();
    await runner.getByText("Make this site private?").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a28", "make-site-private-modal");

    // Confirm to actually make the site private again, returning to the default state.
    await runner.getByRole("button", {name: "Confirm"}).first().click();
    await runner
        .getByLabel("Icon indicating the site is private", {exact: false})
        .first()
        .waitFor();
    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    // --- Add the first piece of content through the UI. `createDocumentInSite`
    // navigates to the new document, so the site is no longer empty afterwards.
    await runner.getByText("Add to site", {exact: true}).first().click();
    await runner.getByText("Document", {exact: true}).first().click();
    await runner.page.waitForURL(/\/doc\//);
    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    // Back on the now-full site page the sidebar renders its own navigation bar whose
    // `More` menu takes over favoriting from the nav bar menu.
    await runner.goto(session, `/site/${siteId}`);
    await runner.getByLabel("More").first().waitFor();
    await runner.getByLabel("More").first().click();
    await runner.getByText("Favorite").first().waitFor();
    await runner.getByText("Copy link").first().waitFor();
    await runner.screenshot("a29", "site-menu-not-favorited");

    // The star fills in place here too, so screenshot the favorited state without
    // reopening the menu.
    await runner.getByText("Favorite").first().click();
    await ProcessContextModule.waitForTestTasks();
    await runner.screenshot("a2a", "site-menu-favorited");

    // Unfavorite so this throwaway site doesn't surface as a favorite in the space
    // chrome of later screenshots, then close the menu.
    await runner.getByText("Favorite").first().click();
    await ProcessContextModule.waitForTestTasks();
    await runner.page.keyboard.press("Escape");
}

/**
 * Section nested 3 levels deep so the comb of vertical lines is at its visual
 * extreme. Verifies that the depth-line math holds up at depths the typical user
 * won't hit but a power user might.
 */
async function runDeepNestingScenario(session: TestSpaceSession, runner: ScreenshotTestRunner) {
    const site = await TestSite.create(session, {
        name: "FY2026 H2 Planning",
        access: "Public",
    });

    const root = site.initialSideBarRoot;
    const level1 = await site.addSection(session, {
        label: "Engineering",
        orderKey: assertOrderKey("a0"),
        parent: root,
    });
    const level2 = await site.addSection(session, {
        label: "Tables",
        orderKey: assertOrderKey("a0"),
        parent: {type: "SideBarSection", id: level1},
    });
    const level3 = await site.addSection(session, {
        label: "Editor",
        orderKey: assertOrderKey("a0"),
        parent: {type: "SideBarSection", id: level2},
    });
    const level3Container = printSiteContainerId({type: "SideBarSection", id: level3});

    let firstTaskId: string | null = null;
    for (const [index, title] of [
        "Column resizing decision",
        "Paste from Google Sheets",
        "Header row freeze",
    ].entries()) {
        const task = await TestTask.create(session, {title, assignee: session});
        if (firstTaskId === null) firstTaskId = task.id;
        await site.addEntity(session, {
            entityId: `Task:${task.id}`,
            parentId: level3Container,
            orderKey: assertOrderKey(`a${index}`),
        });
    }

    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    // Navigate to the deepest task. The site activation auto-expands the ancestor
    // chain (Engineering → Tables → Editor) so the comb is visible without us having
    // to drive clicks.
    await runner.goto(session, `/task/${firstTaskId}`);
    await runner.getByText("Column resizing decision").first().waitFor();
    await runner.mouse.move(0, 0);

    await runner.screenshot("a3", "deep-nesting-comb");

    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();
}

/**
 * Site name and entry titles long enough to overflow the sidebar. Verifies the
 * `textOverflow: ellipsis` truncation in both the header and the row labels.
 */
async function runLongTitlesScenario(session: TestSpaceSession, runner: ScreenshotTestRunner) {
    const site = await TestSite.create(session, {
        name: "FY2026 H2 engineering planning and rollout",
        access: "Public",
    });

    const rootId = site.initialRootContainerId;
    for (const [index, title] of [
        "Quarterly retrospective and cross-team handoff coordination (Q3 follow-ups)",
        "Sales pipeline review with Cliff covering Q4 commitments and renewals",
        "Realtime reliability phase 3: alerting wired end-to-end with paging policy review",
    ].entries()) {
        const task = await TestTask.create(session, {title, assignee: session, priority: "High"});
        await site.addEntity(session, {
            entityId: `Task:${task.id}`,
            parentId: rootId,
            orderKey: assertOrderKey(`a${index}`),
        });
    }

    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    await runner.goto(session, `/site/${site.id}`);
    await runner.getByText("Quarterly retrospective", {exact: false}).first().waitFor();
    await runner.mouse.move(0, 0);

    await runner.screenshot("a4", "long-titles");
}

/**
 * Click the ghost "+ Add" row, capture the opened menu showing every entity-create
 * row (Document / Task / Channel / Task collection / Section) plus the search-for-
 * existing row.
 */
async function runGhostRowMenuScenario(session: TestSpaceSession, runner: ScreenshotTestRunner) {
    const site = await TestSite.create(session, {
        name: "FY2026 H2 Planning",
        access: "Public",
    });

    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    await runner.goto(session, `/site/${site.id}`);
    await runner.getByText("Add", {exact: true}).first().waitFor();
    await runner.getByText("Add", {exact: true}).first().click();

    // Wait for the menu to render an item the user would recognize.
    await runner.getByText("Document", {exact: true}).first().waitFor();
    await runner.getByText("Search for existing", {exact: false}).first().waitFor();

    await runner.screenshot("a5", "ghost-row-menu");
}

/**
 * Right-click on an entity row to capture its context menu — Insert above / Insert
 * below, Copy link, Remove from site. The full per-row affordance.
 */
async function runEntityContextMenuScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
) {
    const site = await TestSite.create(session, {
        name: "FY2026 H2 Planning",
        access: "Public",
    });

    const task = await TestTask.create(session, {
        title: "Lock the OKRs",
        assignee: session,
        priority: "High",
    });
    await site.addEntity(session, {
        entityId: `Task:${task.id}`,
        parentId: site.initialRootContainerId,
        orderKey: assertOrderKey("a0"),
    });

    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    await runner.goto(session, `/site/${site.id}`);
    await runner.getByText("Lock the OKRs").first().waitFor();
    await runner.getByText("Lock the OKRs").first().click({button: "right"});

    await runner.getByText("Insert above").first().waitFor();
    await runner.getByText("Copy link").first().waitFor();
    await runner.getByText("Remove task from site").first().waitFor();

    await runner.screenshot("a8", "entity-context-menu");
}

/**
 * Right-click on a section header to capture its context menu — Rename / Add
 * section / Add entity / Delete section. Captures the "Delete section" disabled
 * state because the section has children (a real-world common case).
 */
async function runSectionContextMenuScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
) {
    const site = await TestSite.create(session, {
        name: "FY2026 H2 Planning",
        access: "Public",
    });

    const sectionId = await site.addSection(session, {
        label: "Planning",
        orderKey: assertOrderKey("a0"),
        parent: site.initialSideBarRoot,
    });
    const sectionContainerId = printSiteContainerId({type: "SideBarSection", id: sectionId});

    const task = await TestTask.create(session, {title: "Bets and Owners", assignee: session});
    await site.addEntity(session, {
        entityId: `Task:${task.id}`,
        parentId: sectionContainerId,
        orderKey: assertOrderKey("a0"),
    });

    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    await runner.goto(session, `/site/${site.id}`);
    await runner.getByText("Planning", {exact: true}).first().waitFor();
    // Match exactly "Planning" so we hit the section row, not the site name header
    // (which contains the word "Planning" as a substring).
    await runner.getByText("Planning", {exact: true}).first().click({button: "right"});

    await runner.getByText("Rename").first().waitFor();
    await runner.getByText("Delete section").first().waitFor();

    await runner.screenshot("a9", "section-context-menu");
}

/**
 * Begin a drag on an EXPANDED section in the showcase site — the dnd-kit
 * `DragOverlay` renders a compact preview of the section header plus its real
 * child rows (a mix of documents, tasks, sub-sections, channels).
 */
async function runDragOverlayExpandedSectionScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    siteId: string,
) {
    await runner.goto(session, `/site/${siteId}`);
    await runner.getByText("Planning", {exact: true}).first().waitFor();
    await runner.getByText("Bets list reviewed with Rose").first().waitFor();

    await beginDragOnRow(runner, "Planning", {exact: true});

    await runner.screenshot("aa", "drag-overlay-expanded-section");

    await runner.mouse.up();
}

/**
 * Begin a drag on a COLLAPSED section in the showcase site — the overlay should
 * mirror what's on screen, just the section header without a children preview.
 * Proves the `SiteSideBarContent` trimming we wired in earlier.
 */
async function runDragOverlayCollapsedSectionScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    siteId: string,
) {
    await runner.goto(session, `/site/${siteId}`);
    await runner.getByText("Launches", {exact: true}).first().waitFor();

    // Collapse the Launches section first — root sections default to expanded.
    await runner.getByText("Launches", {exact: true}).first().click();
    await runner.mouse.move(0, 0);

    await beginDragOnRow(runner, "Launches", {exact: true});

    await runner.screenshot("ab", "drag-overlay-collapsed-section");

    await runner.mouse.up();
}

/**
 * Drives the dnd-kit MouseSensor activation sequence (150ms delay + a real pointer
 * move) on a row identified by visible text, leaving the page in a mid-drag state
 * suitable for screenshotting.
 */
async function beginDragOnRow(
    runner: ScreenshotTestRunner,
    rowText: string,
    options: {exact?: boolean} = {},
) {
    const row = runner.getByText(rowText, options).first();
    const box = await row.boundingBox();
    if (!box)
        throw new InternalError(`Couldn\u2019t locate the bounding box of \u201C${rowText}\u201D`);

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await runner.mouse.move(startX, startY);
    await runner.mouse.down();
    // dnd-kit's MouseSensor uses `activationConstraint: {delay: 150, tolerance: 500}`.
    // Wait past the delay then nudge the pointer so dnd-kit observes a pointermove and
    // emits `onDragStart`.
    await runner.page.waitForTimeout(200);
    await runner.mouse.move(startX, startY + 40);
}

/**
 * Open the "Search for existing" modal from the ghost row and pick a couple of
 * entities — captures the multiselect chip state above the listbox, which is the
 * key affordance for adding many entities to a site at once.
 */
async function runSearchModalMultiselectScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
) {
    const site = await TestSite.create(session, {
        name: "FY2026 H2 Planning",
        access: "Public",
    });

    // Pre-create a few standalone entities; whichever ones the search index has picked
    // up by the time the modal opens will appear in the listbox. The empty/initial
    // state of the modal is the important part of this screenshot — the chrome around
    // the input, the "Add to site" CTA, etc. — and we don't want the test to flake on
    // search-indexing timing.
    await TestTask.create(session, {title: "Planning sync notes", assignee: session});
    await TestDocument.create(session, {title: "Planning kickoff doc", access: "Public"});
    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    await runner.goto(session, `/site/${site.id}`);
    await runner.getByText("Add", {exact: true}).first().waitFor();
    await runner.getByText("Add", {exact: true}).first().click();
    await runner.getByText("Search for existing", {exact: false}).first().click();

    await runner.getByPlaceholder("Search for a document", {exact: false}).first().waitFor();
    await runner.mouse.move(0, 0);

    await runner.screenshot("af", "search-modal");
}

/**
 * Click the `Share` button on a site-resident document — captures the share
 * overlay (member list, copy-link CTA, etc.) sitting next to the site sidebar.
 */
async function runShareMenuScenario(session: TestSpaceSession, runner: ScreenshotTestRunner) {
    const site = await TestSite.create(session, {
        name: "FY2026 H2 Planning",
        access: "Public",
    });
    const document = await TestDocument.create(session, {
        title: "Bets and Owners",
        access: {type: "Site", siteId: site.id},
        sitePosition: {
            siteId: site.id,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        },
    });

    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    await runner.goto(session, `/doc/${document.id}`);
    await runner.getByText("Bets and Owners").first().waitFor();
    await runner.getByRole("button", {name: "Share"}).first().click();
    await runner.getByText("Copy link").first().waitFor();

    await runner.screenshot("ag", "share-menu");
}

/**
 * Confirmation modal that appears when toggling the share switch OFF on a
 * site-resident entity. Permissions live on the site, so the modal warns that
 * making it private affects every entity in the site, not just this one.
 */
async function runShareSwitchTogglingOffScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
) {
    const site = await TestSite.create(session, {
        name: "FY2026 H2 Planning",
        access: "Public",
    });
    const document = await TestDocument.create(session, {
        title: "Bets and Owners",
        access: {type: "Site", siteId: site.id},
        sitePosition: {
            siteId: site.id,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        },
    });

    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    await runner.goto(session, `/doc/${document.id}`);
    await runner.getByText("Bets and Owners").first().waitFor();

    // The switch label includes the space name; substring match keeps the test
    // agnostic to the demo space's display name.
    await runner.getByLabel("Toggle sharing with everyone", {exact: false}).first().click();
    await runner.getByText("Make the entire site private?").first().waitFor();

    await runner.screenshot("ah", "share-switch-toggling-off");
}

/**
 * Confirmation modal that appears when toggling the share switch ON for a private
 * site. Mirror of the toggle-off case — warns that sharing affects every entity in
 * the site.
 */
async function runShareSwitchTogglingOnScenario(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
) {
    const site = await TestSite.create(session, {
        name: "FY2026 H2 Planning",
        access: "Private",
    });
    const document = await TestDocument.create(session, {
        title: "Bets and Owners",
        access: {type: "Site", siteId: site.id},
        sitePosition: {
            siteId: site.id,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a0"),
        },
    });

    await runner.services.waitForSqsProcessJobs();
    await ProcessContextModule.waitForTestTasks();

    await runner.goto(session, `/doc/${document.id}`);
    await runner.getByText("Bets and Owners").first().waitFor();

    await runner.getByLabel("Toggle sharing with everyone", {exact: false}).first().click();
    await runner.getByText("Share the entire site?").first().waitFor();

    await runner.screenshot("ai", "share-switch-toggling-on");
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
    site: TestSite,
    accounts: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
    run: () => Promise<void>,
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

    // This is the first time the suite signs in as Holly, so her inbox still holds
    // every notification the earlier scenarios generated — clear it so the nav-rail
    // badge doesn't flake these screenshots (same reasoning as the cassCade clear in
    // `run`).
    await runner.drainBackgroundWork();
    await clearAccountInbox(accounts.hollyEvergreen);
    await runner.drainBackgroundWork();

    await run();

    assert(oldAccess.type === "Local");
    await site.access.set(accounts.cassCade, oldAccess);
}
