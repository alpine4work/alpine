import {CalendarDate} from "@internationalized/date";
import Mustache from "mustache";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";

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
                cassMention: `[](https://alpine.inc/s/${space.id}/accounts/${accounts.cassCade.account.id}?mention=short)`,
                masonMention: `[](https://alpine.inc/s/${space.id}/accounts/${accounts.masonClay.account.id}?mention=short)`,
                mattMention: `[](https://alpine.inc/s/${space.id}/accounts/${accounts.mattRHorn.account.id}?mention=short)`,
                elleMention: `[](https://alpine.inc/s/${space.id}/accounts/${accounts.elleKappaTan.account.id}?mention=short)`,
                cliffMention: `[](https://alpine.inc/s/${space.id}/accounts/${accounts.cliffWeathers.account.id}?mention=short)`,
                hollyMention: `[](https://alpine.inc/s/${space.id}/accounts/${accounts.hollyEvergreen.account.id}?mention=short)`,
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
        title: "Tables GA — stabilize and announce",
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
        entityId: `TaskCollection:${taskCollection.id}` satisfies SiteItemSearchEntityId,
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
        entityId: `Task:${projectTask.id}` satisfies SiteItemSearchEntityId,
        parentId: taskSite.initialRootContainerId,
        orderKey: initialOrderKey,
    });

    const chatSite = await TestSite.create(accounts.cassCade, {
        name: siteName,
        access: "Public",
    });
    const roomChat = await TestChat.createRoom(accounts.cassCade, {
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
First draft of the bets doc is up. Owners — your sections are flagged. Comments by Friday.
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
SSO pilot — two design partners verbally in. Will know who\u2019s signed by January.
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
Great. Locking the doc Monday — last call for pushback before then.
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

    await runner.goto(session, `/s/${session.space.id}/documents/${document.id}`);
    await runner.page
        .getByTestId("ContentFileEntityPreview:Site")
        .nth(siteFileIds.length - 1)
        .waitFor();

    await runner.screenshot(orderKey, name);
}
