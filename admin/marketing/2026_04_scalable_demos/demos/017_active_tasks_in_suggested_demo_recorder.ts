import {CalendarDateTime, today} from "@internationalized/date";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {addSearchAffinityEntityPointsForTest} from "~/server/search/data/table/search_entity_actions.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {FeedEntry, FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {Schema} from "~/shared/schema/schema.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);
    const daysAgoAt = (days: number, hour: number, minute: number) =>
        new CalendarDateTime(currentDate.year, currentDate.month, currentDate.day, hour, minute)
            .subtract({days})
            .toDate(timeZone);

    const spaceId = space.id;
    const accountId = accounts.cassCade.account.id;
    const mentionUrl = (accountSession: {account: {id: string}}) =>
        `https://alpine.inc/mention/${accountSession.account.id}?short`;

    // ── Active project tasks Cass is driving this week ────────────────── These three
    // are the top of Cass's suggested list. Each is a `layout: "Project"` task with
    // Cass marked Active so it carries the "in progress" dot the suggested sidebar
    // shows.

    const q4PlanningProject = await TestTask.create(accounts.cassCade, {
        title: "Q4 Planning",
        layout: "Project",
        assignee: accounts.cassCade,
        priority: "High",
    });
    await q4PlanningProject.updateAssigneeStatus(accounts.cassCade, "Active");

    const tablesProject = await TestTask.create(accounts.cassCade, {
        title: "Tables in Rich Text Editor",
        layout: "Project",
        assignee: accounts.cassCade,
        priority: "High",
    });
    await tablesProject.updateAssigneeStatus(accounts.cassCade, "Active");

    const seniorBackendHiringProject = await TestTask.create(accounts.cassCade, {
        title: "Senior Backend Engineer Hiring",
        layout: "Project",
        assignee: accounts.cassCade,
        priority: "Medium",
        notes: markdown`
## Role

A second backend engineer working alongside Elle on Alpine\u2019s server-side: realtime sync, the
DynamoDB data layer that backs every product surface, OpenSearch indexing and ranking, and the
reliability work that keeps the live product up.

## What you\u2019ll own

- Realtime infrastructure: connection handling, presence, deployment safety
- Data modeling in DynamoDB for documents, tasks, chat, and forum entities
- Search and affinity ranking in OpenSearch
- Shared on-call rotation with Elle

## What we\u2019re looking for

- 6+ years of production backend experience, ideally on a small team where you owned systems end to
  end
- Strong TypeScript or another typed language with disciplined migration habits
- Distributed systems chops: opinions about consistency, retries, and what happens when the network
  misbehaves
- Comfortable being one of two people responsible for keeping a live product up

## Nice to have

- Realtime collaboration experience (CRDTs, OT, or similar)
- DynamoDB single-table design or wide-column data modeling
- Search relevance work beyond plumbing queries

## What we\u2019re not optimizing for

- Specific framework background. Node.js, AWS, Cloudflare — none of it is exotic.
- Pedigree. Track record is what matters.
        `,
    });
    await seniorBackendHiringProject.updateAssigneeStatus(accounts.cassCade, "Active");

    // Hiring funnel subtasks in chronological order. Earlier rounds are closed,
    // reference checks and the offer letter are in flight this week, onboarding hasn't
    // started.
    await runAllPromises([
        TestTask.create(accounts.cassCade, {
            parent: seniorBackendHiringProject,
            title: "Draft and post job description",
            assignee: accounts.cassCade,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.cassCade, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: seniorBackendHiringProject,
            title: "Intro call with candidate",
            assignee: accounts.cassCade,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.cassCade, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: seniorBackendHiringProject,
            title: "Technical screen with Elle",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.elleKappaTan, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: seniorBackendHiringProject,
            title: "On-site: system design",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.elleKappaTan, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: seniorBackendHiringProject,
            title: "On-site: code review",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.elleKappaTan, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: seniorBackendHiringProject,
            title: "On-site: working session",
            assignee: accounts.cassCade,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.cassCade, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: seniorBackendHiringProject,
            title: "Final-round debrief with Rose",
            assignee: accounts.cassCade,
            priority: "High",
        }).then(task => task.updateStatus(accounts.cassCade, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: seniorBackendHiringProject,
            title: "Reference checks",
            assignee: accounts.cassCade,
            priority: "High",
        }).then(task => task.updateAssigneeStatus(accounts.cassCade, "Active")),
        TestTask.create(accounts.cassCade, {
            parent: seniorBackendHiringProject,
            title: "Prepare and send offer letter",
            assignee: accounts.cassCade,
            priority: "High",
        }).then(task => task.updateAssigneeStatus(accounts.cassCade, "Active")),
        TestTask.create(accounts.cassCade, {
            parent: seniorBackendHiringProject,
            title: "Onboarding plan and start-date logistics",
            assignee: accounts.cassCade,
            priority: "Medium",
        }),
    ]);

    // A few child tasks under the Tables project so the preview has shape when Cass
    // clicks in at the end of the recording.
    await runAllPromises([
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Selection model",
            assignee: accounts.masonClay,
            priority: "High",
        }).then(task => task.updateStatus(accounts.masonClay, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Keyboard navigation between cells",
            assignee: accounts.masonClay,
            priority: "High",
        }).then(task => task.updateStatus(accounts.masonClay, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Toolbar placement",
            assignee: accounts.mattRHorn,
            priority: "Medium",
        }).then(task => task.updateStatus(accounts.mattRHorn, "Closed")),
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Column resizing: snap with Alt for smooth",
            assignee: accounts.masonClay,
            priority: "High",
        }).then(task => task.updateAssigneeStatus(accounts.masonClay, "Active")),
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Help doc and forum announcement",
            assignee: accounts.hollyEvergreen,
            priority: "Medium",
        }),
        TestTask.create(accounts.cassCade, {
            parent: tablesProject,
            title: "Paste from spreadsheet edge cases",
            assignee: accounts.masonClay,
            priority: "Medium",
        }),
    ]);

    // ── Other entities that fill out the suggested list ─────────────────

    const [engineeringChannel, announcementsChannel, leadsChannel] = await runAllPromises([
        TestChannel.create(accounts.cassCade, {name: "Engineering", access: "Public"}),
        TestChannel.create(accounts.cassCade, {name: "Announcements", access: "Public"}),
        TestChannel.create(accounts.cassCade, {name: "Leads", access: "Public"}),
    ]);

    const [surveySummaryDoc, salesOnePagerDoc, q4PlanningDoc] = await runAllPromises([
        TestDocument.create(accounts.hollyEvergreen, {
            title: "Q3 Customer Survey Summary",
            access: "Public",
            body: markdown`
We sent the Q3 customer survey to 84 accounts at the end of August and heard back from 51 (61%
response rate, up from 48% last quarter).

## Top themes

1. **Table support in documents.** 34 of 51 respondents mentioned this unprompted. Good timing given
   what [Mason](MASON_MENTION) is building.

2. **Notification control.** 28 respondents. Per-channel mute, inbox filters, and quiet hours were
   the three most-requested features.

3. **Search speed on large workspaces.** 19 respondents. Mostly from teams with 50+ members.
            `.replace("MASON_MENTION", mentionUrl(accounts.masonClay)),
        }),
        TestDocument.create(accounts.hollyEvergreen, {
            title: "Sales One-Pager (Final)",
            access: "Public",
            body: markdown`
## What is Alpine?

Alpine is a productivity suite for technical teams. Documents, tasks, chat, forum, inbox, and search
in one product. Built for teams of 10–200 who are tired of juggling five disconnected tools.
            `,
        }),
        TestDocument.create(accounts.cassCade, {
            title: "Q4 Planning Draft",
            access: "Public",
            body: markdown`
Living draft. Pulling together inputs from each team for the Q4 plan. Final review with
[Rose](ROSE_MENTION) end of next week.

## Engineering

[Mason](MASON_MENTION) and [Matt](MATT_MENTION) finishing tables this week. Notification control is
the leading Q4 candidate based on the customer survey. [Elle](ELLE_MENTION) starts SSO
implementation.

## Go-to-market

Sales one-pager and demo script in rotation. [Cliff](CLIFF_MENTION) wants two more case studies on
the docket. [Holly](HOLLY_MENTION) drafting #2 already.

## Hiring

Senior backend engineer offer goes out this week.
            `
                .replace("ROSE_MENTION", mentionUrl(accounts.roseCompas))
                .replace("MASON_MENTION", mentionUrl(accounts.masonClay))
                .replace("MATT_MENTION", mentionUrl(accounts.mattRHorn))
                .replace("ELLE_MENTION", mentionUrl(accounts.elleKappaTan))
                .replace("CLIFF_MENTION", mentionUrl(accounts.cliffWeathers))
                .replace("HOLLY_MENTION", mentionUrl(accounts.hollyEvergreen)),
        }),
    ]);

    await runAllPromises([
        surveySummaryDoc.updateContentPreview(),
        salesOnePagerDoc.updateContentPreview(),
        q4PlanningDoc.updateContentPreview(),
    ]);

    // ── Forum posts that show up in today's home feed ───────────────

    const masonColumnResizingPost = await engineeringChannel.createPost(
        accounts.masonClay,
        markdown`
Column resizing for tables just landed. Snap by default, hold Alt for smooth. Both modes feel right
after a few minutes of use. The handle hit area is generous so it doesn\u2019t fight selection. Last
big piece before we ship.
        `,
        {overrideCreatedTime: daysAgoAt(0, 8, 42)},
    );
    await masonColumnResizingPost.setReaction(accounts.cassCade, "Heart");
    await masonColumnResizingPost.setReaction(accounts.mattRHorn, "ThankYou");
    await masonColumnResizingPost.setReaction(accounts.elleKappaTan, "GenericLike");

    const hollyTablesAnnouncementPost = await announcementsChannel.createPost(
        accounts.hollyEvergreen,
        markdown`
### Tables ship Wednesday ✨

Help doc is in review and the forum announcement is ready to go. If you have screenshots or short
clips of tables in real docs you\u2019ve been writing, drop them in this thread and I\u2019ll work
them in.
        `,
        {overrideCreatedTime: daysAgoAt(0, 9, 5)},
    );
    await hollyTablesAnnouncementPost.setReaction(accounts.cassCade, "Celebrate");
    await hollyTablesAnnouncementPost.setReaction(accounts.roseCompas, "Heart");
    await hollyTablesAnnouncementPost.setReaction(accounts.masonClay, "GenericLike");

    const ellePost = await engineeringChannel.createPost(
        accounts.elleKappaTan,
        markdown`
realtime reliability rollout complete. jittered backoff is on every client and the deploy gating is
wired up. zero sync incidents in the last three weeks. closing this one out.
        `,
        {overrideCreatedTime: daysAgoAt(1, 16, 20)},
    );
    await ellePost.setReaction(accounts.cassCade, "Celebrate");
    await ellePost.setReaction(accounts.masonClay, "ThankYou");

    const cliffInboundPost = await leadsChannel.createPost(
        accounts.cliffWeathers,
        markdown`
New inbound from the Meridian case study is in!

It\u2019s a40-person eng team, similar shape to Meridian. Demo\u2019s booked for Thursday.
[Holly](HOLLY_MENTION) the case study is doing exactly what we needed – you rock.
        `.replace("HOLLY_MENTION", mentionUrl(accounts.hollyEvergreen)),
        {overrideCreatedTime: daysAgoAt(2, 11, 38)},
    );
    await cliffInboundPost.setReaction(accounts.cassCade, "Celebrate");
    await cliffInboundPost.setReaction(accounts.hollyEvergreen, "Heart");
    await cliffInboundPost.setReaction(accounts.roseCompas, "GenericLike");

    // ── Suggested list ranking ────────────────────────────────────────── Active
    // tasks dominate the top three. Then a mix of docs, channels, and people Cass
    // touches every day so the order looks like a real workspace.

    const randomDocTitles = [
        "Company Values",
        "All Hands — October 2025",
        "Hiring Rubric: Senior Backend",
        "Brand Voice Guide",
        "1:1 Template",
        "Vendor Contracts Index",
        "Press Kit Draft",
        "PTO Policy",
        "Weekly Metrics Digest",
        "Customer References List",
    ];

    await runAllPromises([
        // 1 — Senior Backend Engineer Hiring project (Active).
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Task:${seniorBackendHiringProject.id}`,
            points: 999_000_000,
        }),
        // 2 — Tables in Rich Text Editor project (Active). The one Cass clicks into at the
        // end of the recording.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Task:${tablesProject.id}`,
            points: 998_000_000,
        }),
        // 3 — Q4 Planning project (Active).
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Task:${q4PlanningProject.id}`,
            points: 997_000_000,
        }),
        // 4 — Q4 Planning doc.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Document:${q4PlanningDoc.id}`,
            points: 996_000_000,
        }),
        // 5 — Rose's account.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${accounts.roseCompas.account.id}`,
            points: 995_000_000,
        }),
        // 6 — Engineering channel.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Channel:${engineeringChannel.id}`,
            points: 994_000_000,
        }),
        // 7 — Q3 Customer Survey Summary doc.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Document:${surveySummaryDoc.id}`,
            points: 993_000_000,
        }),
        // 8 — Mason's account.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${accounts.masonClay.account.id}`,
            points: 992_000_000,
        }),
        // 9 — Sales One-Pager doc.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Document:${salesOnePagerDoc.id}`,
            points: 991_000_000,
        }),
        // 10 — Announcements channel.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Channel:${announcementsChannel.id}`,
            points: 990_000_000,
        }),
        // 11 — Matt's account.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Account:${accounts.mattRHorn.account.id}`,
            points: 989_000_000,
        }),
        // 14 — Leads channel.
        addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
            spaceId,
            accountId,
            entityId: `Channel:${leadsChannel.id}`,
            points: 986_000_000,
        }),
        // 17+ — Random docs to fill out the tail of the list.
        ...randomDocTitles.map((title, index) =>
            TestDocument.create(accounts.cassCade, {title}).then(doc =>
                addSearchAffinityEntityPointsForTest(accounts.cassCade.action(), {
                    spaceId,
                    accountId,
                    entityId: `Document:${doc.id}`,
                    points: 983_000_000 - index * 1_000_000,
                }),
            ),
        ),
    ]);

    // Suggested-list-only entities that round out the visible space but don't need
    // their own affinity boost.
    void TestTaskCollection.create(accounts.cassCade, {name: "Sprint Oct 13", access: "Public"});

    // ── Feed entries (left side of the home feed) ───────────────────────

    const entries: Array<FeedEntry> = [
        {
            type: "Post",
            postId: hollyTablesAnnouncementPost.id,
            channelId: announcementsChannel.id,
            authorId: accounts.hollyEvergreen.account.id,
            createdTime: hollyTablesAnnouncementPost.createdTime,
        },
        {
            type: "Post",
            postId: masonColumnResizingPost.id,
            channelId: engineeringChannel.id,
            authorId: accounts.masonClay.account.id,
            createdTime: masonColumnResizingPost.createdTime,
        },
        {
            type: "Document",
            documentId: q4PlanningDoc.id,
            sharedTime: daysAgoAt(0, 7, 50),
            sharerId: accounts.cassCade.account.id,
            creator: {id: accounts.cassCade.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: ellePost.id,
            channelId: engineeringChannel.id,
            authorId: accounts.elleKappaTan.account.id,
            createdTime: ellePost.createdTime,
        },
        {
            type: "Post",
            postId: cliffInboundPost.id,
            channelId: leadsChannel.id,
            authorId: accounts.cliffWeathers.account.id,
            createdTime: cliffInboundPost.createdTime,
        },
        {
            type: "Document",
            documentId: surveySummaryDoc.id,
            sharedTime: daysAgoAt(3, 13, 0),
            sharerId: accounts.hollyEvergreen.account.id,
            creator: {id: accounts.hollyEvergreen.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
    ];

    const url = new UrlPath(`/dev/feed/${spaceId}`);
    url.searchParams.set(
        "entries",
        JSON.stringify(Schema.array(FeedEntrySchema).serialize(entries)),
    );

    await recorder.record({
        instructions: markdown`
Cass logs into Alpine in the morning. The home feed shows what\u2019s new across the team overnight,
and the right-hand sidebar surfaces Suggested — affinity-ranked, with the projects she\u2019s
actively working on pinned at the top. The point of the demo: in two glances she sees both
\u201Cwhat\u2019s new for the day\u201D (the feed) and \u201Cwhat\u2019s mine to drive\u201D (active
tasks at the top of suggested), then clicks straight into the project that needs her.

1. Start with the cursor parked over the home feed entries on the left, near the top. Pause for a
   beat so the viewer registers the layout: feed on the left, Suggested on the right.

2. Scroll the feed slowly one screen down so a couple of new updates pass by — Holly\u2019s tables
   ship announcement, Mason\u2019s column-resizing post, the Q4 planning draft, Elle\u2019s realtime
   reliability post, Cliff\u2019s new inbound. Then scroll back to the top.

3. Move the cursor over to the Suggested header on the right. Hover briefly so the viewer\u2019s eye
   follows.

4. The top three items in Suggested are the projects Cass is actively working on: \u201CQ4
   Planning,\u201D \u201CTables in Rich Text Editor,\u201D and \u201CSenior Backend Engineer
   Hiring,\u201D each carrying the active-status indicator. Hover the first one for a beat, then the
   second.

5. Click \u201CTables in Rich Text Editor.\u201D The project peek/preview opens showing the child
   tasks — selection model and keyboard nav closed, column resizing in progress, help doc pending.
   Hold for a second so the contents are legible.

6. Close the peek (Esc or click outside) so the home feed is visible again. Park the cursor near
   where you started so the loop point is clean.
        `,
        session: accounts.cassCade,
        path: url.toString(),
        viewport: scalableDemoWideViewport,
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
