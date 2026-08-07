import {CalendarDate} from "@internationalized/date";
import Mustache from "mustache";
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
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {assertOrderKey, initialOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.open_source.js";
import {ChatId, PostId} from "~/shared/id/types/id_types.open_source.js";
import {printSiteContainerId} from "~/shared/sites/site_entry_id.js";

const schema = DocumentContentProsemirrorSchema;

// Each site shares the same name so the previews emphasize the variation in the
// nested first entity. All inner content is themed around FY2026 H2 planning.
const siteName = "FY2026 H2 Planning";

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {space, accounts} = await runner.createDemoSpace(context);

    const emptySite = await TestSite.create(accounts.cassCade, {
        name: siteName,
        access: "Public",
    });

    const documentSite = await TestSite.create(accounts.cassCade, {
        name: siteName,
        access: "Public",
    });
    await TestDocument.create(accounts.cassCade, {
        title: "Bets and Owners",
        access: {type: "Site", siteId: documentSite.id},
        body: Mustache.render(
            markdown`
Author: {{cassMention}}

Draft of the H2 portfolio. Inputs from each owner are due by the end of next week. Rose and I will
finalize the week after.

## Priorities

<table data-column-widths="1,3,3,3">
<thead>
<tr>
<th>

Priority

</th>
<th>

Bet

</th>
<th>

Owner(s)

</th>
<th>

H2 outcome

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

<mark class="highlight-red">P0</mark>

</td>
<td>

Tables GA + follow-on editor polish

</td>
<td>

{{masonMention}} + {{mattMention}}

</td>
<td>

GA stable, two follow-on editor improvements shipped

</td>
</tr>
<tr>
<td>

<mark class="highlight-red">P0</mark>

</td>
<td>

Realtime reliability phase 3

</td>
<td>

{{elleMention}}

</td>
<td>

p99 reconnect under 2s, alerting wired end-to-end

</td>
</tr>
<tr>
<td>

<mark class="highlight-orange">P1</mark>

</td>
<td>

Enterprise SSO build window

</td>
<td>

{{elleMention}} + {{cliffMention}}

</td>
<td>

Pilot live with two design-partner accounts

</td>
</tr>
<tr>
<td>

<mark class="highlight-blue">P2</mark>

</td>
<td>

Customer case studies + sales enablement

</td>
<td>

{{hollyMention}}

</td>
<td>

Third case study published, demo script in Cliff\u2019s hands

</td>
</tr>
</tbody>
</table>
            `,
            {
                cassMention: `[](https://alpine.inc/mention/${accounts.cassCade.account.id}#short)`,
                masonMention: `[](https://alpine.inc/mention/${accounts.masonClay.account.id}#short)`,
                mattMention: `[](https://alpine.inc/mention/${accounts.mattRHorn.account.id}#short)`,
                elleMention: `[](https://alpine.inc/mention/${accounts.elleKappaTan.account.id}#short)`,
                cliffMention: `[](https://alpine.inc/mention/${accounts.cliffWeathers.account.id}#short)`,
                hollyMention: `[](https://alpine.inc/mention/${accounts.hollyEvergreen.account.id}#short)`,
            },
        ),
        sitePosition: {
            siteId: documentSite.id,
            parentId: documentSite.initialRootContainerId,
            orderKey: initialOrderKey,
        },
    });

    const channelSite = await TestSite.create(accounts.cassCade, {
        name: siteName,
        access: "Public",
    });
    await TestChannel.create(accounts.cassCade, {
        name: "Launches",
        description: markdown`
Where we coordinate every H2 launch end-to-end. Ship dates, release notes, forum posts, demo
updates. If a launch is coming in the next six months and it touches customers, post it here.
        `,
        access: {
            type: "Site",
            siteId: channelSite.id,
            position: {parentId: channelSite.initialRootContainerId, orderKey: initialOrderKey},
        },
    });

    const taskCollection = await TestTaskCollection.create(accounts.cassCade, {
        name: "Big Bets",
        access: "Public",
        color: "blue",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Stabilize and announce Tables GA",
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        collections: taskCollection,
        dueDate: new CalendarDate(2026, 1, 15),
        priority: "High",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Realtime reliability phase 3 rollout",
        assignee: accounts.elleKappaTan,
        assigneeStatus: "Active",
        collections: taskCollection,
        dueDate: new CalendarDate(2026, 2, 26),
        priority: "High",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Enterprise SSO design partner pilot",
        assignee: accounts.elleKappaTan,
        collections: taskCollection,
        dueDate: new CalendarDate(2026, 4, 1),
        priority: "High",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Third customer case study (drafted in H1, ship in H2)",
        assignee: accounts.hollyEvergreen,
        collections: taskCollection,
        priority: "Medium",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Senior backend engineer onboarded and ramped",
        assignee: accounts.cassCade,
        collections: taskCollection,
        priority: "Medium",
        status: "Closed",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Sales enablement refresh ahead of Q1 pipeline push",
        assignee: accounts.cliffWeathers,
        collections: taskCollection,
        priority: "Low",
    });

    const taskCollectionSite = await TestSite.create(accounts.cassCade, {
        name: siteName,
        access: "Public",
    });
    await taskCollectionSite.addEntity(accounts.cassCade, {
        entityId: `TaskCollection:${taskCollection.id}`,
        parentId: taskCollectionSite.initialRootContainerId,
        orderKey: initialOrderKey,
    });

    const projectTask = await TestTask.create(accounts.cassCade, {
        title: "Lock the OKRs",
        assignee: accounts.cassCade,
        assigneeStatus: "Active",
        dueDate: new CalendarDate(2026, 1, 9),
        layout: "Project",
        notes: markdown`
Get the OKRs locked before the all-hands. Rose has the company-level outcomes; this task is the
build out underneath: bets, owners, measurable signals, and the rough sequencing across the half.
        `,
        priority: "High",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Bets list reviewed with Rose",
        parent: projectTask,
        assignee: accounts.cassCade,
        status: "Closed",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Engineering breakdown with Elle and Mason",
        parent: projectTask,
        assignee: accounts.cassCade,
        status: "Closed",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Design throughput model with Matt",
        parent: projectTask,
        assignee: accounts.mattRHorn,
        assigneeStatus: "Active",
    });
    await TestTask.create(accounts.cassCade, {
        title: "GTM section with Cliff + Holly",
        parent: projectTask,
        assignee: accounts.hollyEvergreen,
        priority: "Medium",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Walk through with Rose before all-hands",
        parent: projectTask,
        assignee: accounts.cassCade,
        priority: "High",
    });

    const taskSite = await TestSite.create(accounts.cassCade, {
        name: siteName,
        access: "Public",
    });
    await taskSite.addEntity(accounts.cassCade, {
        entityId: `Task:${projectTask.id}`,
        parentId: taskSite.initialRootContainerId,
        orderKey: initialOrderKey,
    });

    const chatSite = await TestSite.create(accounts.cassCade, {
        name: siteName,
        access: "Public",
    });
    const roomChat = await TestChat.createRoom(accounts.cassCade, {
        // Pin the chat ID so the account-pile preview (seeded by `Chat:${chatId}`) is
        // identical across runs. Without this the facepile members/order shuffle each run,
        // making the screenshot flaky.
        id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "planningRoomChat"),
        name: "Planning room",
        access: {
            type: "Site",
            siteId: chatSite.id,
            position: {parentId: chatSite.initialRootContainerId, orderKey: initialOrderKey},
        },
    });

    await roomChat.sendMessage(
        accounts.roseCompas,
        markdown`
Opening this room for the H2 planning cycle. Try to keep tactical decisions in here so the bets doc
stays a clean read.
        `,
        {overrideCreatedTime: new Date("2025-12-08T14:02:00-05:00")},
    );
    await roomChat.sendMessage(
        accounts.cassCade,
        markdown`
First draft of the bets doc is up. Owners – your sections are flagged. Comments by Friday.
        `,
        {overrideCreatedTime: new Date("2025-12-09T09:14:00-05:00")},
    );
    await roomChat.sendMessage(
        accounts.elleKappaTan,
        markdown`
Realtime phase 3 is going to land late February. Phase 2 numbers came in clean so I\u2019m
comfortable committing to it.
        `,
        {overrideCreatedTime: new Date("2025-12-09T11:42:00-05:00")},
    );
    await roomChat.sendMessage(
        accounts.cliffWeathers,
        markdown`
Two design partners verbally in for SSO pilot. Will know who\u2019s signed by January.
        `,
        {overrideCreatedTime: new Date("2025-12-10T16:08:00-05:00")},
    );
    await roomChat.sendMessage(
        accounts.hollyEvergreen,
        markdown`
Third case study is drafted, customer review next week. Should publish early H2.
        `,
        {overrideCreatedTime: new Date("2025-12-11T10:20:00-05:00")},
    );
    await roomChat.sendMessage(
        accounts.cassCade,
        markdown`
Great. Locking the doc Monday. Last call for pushback before then.
        `,
        {overrideCreatedTime: new Date("2025-12-12T17:30:00-05:00")},
    );

    // Order matches the user-facing gallery order: empty, document, channel,
    // collection, task, chat room.
    const sitesInGalleryOrder: ReadonlyArray<{name: string; fileId: FileEntityId}> = [
        {name: "empty", fileId: `Site:${emptySite.id}`},
        {name: "with-document", fileId: `Site:${documentSite.id}`},
        {name: "with-channel", fileId: `Site:${channelSite.id}`},
        {name: "with-task-collection", fileId: `Site:${taskCollectionSite.id}`},
        {name: "with-task", fileId: `Site:${taskSite.id}`},
        {name: "with-chat", fileId: `Site:${chatSite.id}`},
    ];

    // One full-width preview per site so each entity type has a high-fidelity
    // screenshot to look at.
    const fullWidthOrderKeys = ["a0", "a1", "a2", "a3", "a4", "a5"];
    for (const [index, {name, fileId}] of sitesInGalleryOrder.entries()) {
        await screenshotSiteFiles(runner, accounts.cassCade, [fileId], {
            filesPerRow: 1,
            orderKey: fullWidthOrderKeys[index]!,
            name,
        });
    }

    const siteFileIds = sitesInGalleryOrder.map(({fileId}) => fileId);

    await screenshotSiteFiles(runner, accounts.cassCade, siteFileIds, {
        filesPerRow: 2,
        orderKey: "a6",
        name: "gallery-2-per-row",
    });

    await screenshotSiteFiles(runner, accounts.cassCade, siteFileIds, {
        filesPerRow: 3,
        orderKey: "a7",
        name: "gallery-3-per-row",
    });

    const {site, statusChannel} = await createH2PlanningSite(runner, accounts);

    // Open the status channel in a peek over a blank background so the screenshot
    // focuses on the peek under test. Wait for the channel's weekly status post — it
    // only renders in the channel detail, so it's a clean signal the channel loaded.
    await runner.goto(accounts.cassCade, `/dev/empty/${space.id}`, {
        peekPath: `/channel/${statusChannel.id}`,
    });
    await runner
        .getByTestId("PeekStackOverlay")
        .getByText("Tables status week of Oct 13")
        .first()
        .waitFor();

    // Tap the site breadcrumb chip to open the site `navigate` route within the peek.
    await runner
        .getByTestId("PeekStackOverlay")
        .getByRole("button", {name: site.initialName})
        .click();

    // The `navigate` route shows the in-order site tree. `Lock the OKRs` is a depth-0
    // tree entry that only appears in the tree (not the channel), so waiting for it
    // confirms the tree finished loading.
    await runner.getByTestId("PeekStackOverlay").getByText("Lock the OKRs").first().waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a8", "peek-navigate");
}

async function screenshotSiteFiles(
    runner: ScreenshotTestRunner,
    session: TestSpaceSession,
    siteFileIds: ReadonlyArray<FileEntityId>,
    {filesPerRow, orderKey, name}: {filesPerRow: number; orderKey: string; name: string},
) {
    const fileRows = [];
    for (let i = 0; i < siteFileIds.length; i += filesPerRow) {
        fileRows.push(
            schema.node(
                "fileRow",
                {},
                siteFileIds.slice(i, i + filesPerRow).map(fileId => schema.node("file", {fileId})),
            ),
        );
    }

    const document = await TestDocument.create(session, {
        content: [schema.node("title"), ...fileRows],
    });

    await runner.goto(session, `/doc/${document.id}`);
    await runner.page
        .getByTestId("ContentFileEntityPreview:Site")
        .nth(siteFileIds.length - 1)
        .waitFor();

    await runner.screenshot(orderKey, name);
}

async function createH2PlanningSite(runner: ScreenshotTestRunner, accounts: DemoSpaceAccounts) {
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
        time: [new Date("2025-10-15T15:13:00-04:00").getTime(), 0],
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
    await TestDocument.create(accounts.cassCade, {
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

    await site.addEntity(accounts.cassCade, {
        entityId: `Chat:${tablesGAChatRoom.id}`,
        parentId: rootContainerId,
        orderKey: assertOrderKey("a08"),
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

    await site.addEntity(accounts.cassCade, {
        entityId: `Channel:${statusChannel.id}`,
        parentId: planningSectionContainerId,
        orderKey: assertOrderKey("a2"),
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

    await clearAccountInbox(accounts.cassCade, runner);
    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    return {site, statusChannel};
}

async function createTablesGAChatRoom({
    accounts,
    runner,
}: {
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
        access: "Public",
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
    accounts,
    runner,
}: {
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

    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();

    return statusChannel;
}
