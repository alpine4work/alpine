import {CalendarDateTime, today} from "@internationalized/date";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDemoCursor} from "~/admin/marketing/2026_04_scalable_demos/helpers/demo_cursor.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scrollDemo} from "~/admin/marketing/2026_04_scalable_demos/helpers/scroll_demo.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {FeedEntry, FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
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

    const accountMentionUrl = (accountSession: {account: {id: string}}) =>
        `https://alpine.inc/mention/${accountSession.account.id}?short`;

    const [announcementsChannel, engineeringChannel, craftChannel, salesChannel, planningChannel] =
        await runAllPromises([
            TestChannel.create(accounts.hollyEvergreen, {
                name: "Announcements",
                access: "Public",
                description: "Product launches, company updates, and customer-facing milestones.",
            }),
            TestChannel.create(accounts.elleKappaTan, {
                name: "Engineering",
                access: "Public",
                description: "Technical updates, reliability work, and implementation decisions.",
            }),
            TestChannel.create(accounts.mattRHorn, {
                name: "Craft",
                access: "Public",
                description: "Design reviews, interaction notes, and product polish.",
            }),
            TestChannel.create(accounts.cliffWeathers, {
                name: "Sales",
                access: "Public",
                description: "Pipeline updates, prospect blockers, and sales collateral.",
            }),
            TestChannel.create(accounts.cassCade, {
                name: "Q4 Planning",
                access: "Public",
                description: "Planning inputs and decisions for the next quarter.",
            }),
        ]);

    const [q4PlanningCollection, caseStudiesCollection, tablesCollection] = await runAllPromises([
        TestTaskCollection.create(accounts.cassCade, {
            name: "Q4 Planning",
            access: "Public",
            color: "green",
        }),
        TestTaskCollection.create(accounts.hollyEvergreen, {
            name: "Case Studies",
            access: "Public",
            color: "pink",
        }),
        TestTaskCollection.create(accounts.masonClay, {
            name: "Tables Launch",
            access: "Public",
            color: "blue",
        }),
    ]);

    const [
        q4PlanningDoc,
        surveySummaryDoc,
        editorAuditDoc,
        ssoScopeDoc,
        salesOnePagerDoc,
        seniorBackendOfferDoc,
        tablesHelpDoc,
    ] = await runAllPromises([
        TestDocument.create(accounts.cassCade, {
            title: "Q4 Planning Draft",
            access: "Public",
            body: markdown`
Q4 planning should stay tight: notification control, search performance on large workspaces, and the
SSO implementation path. Tables shipped cleanly, so the next quarter needs to protect that momentum,
not reopen the editor roadmap.

Current priority stack:

1. **Notification control** because the survey feedback is loud and repeated. [Holly](HOLLY_MENTION)
   has the quotes.
2. _Search speed_ for larger accounts that are starting to feel workspace scale.
3. **SSO** if [Elle](ELLE_MENTION) can keep the first implementation narrow enough.

<mark class="highlight-green">Default plan: notification control first.</mark>

- [x] Survey summary added to this draft.
- [ ] [Mason](MASON_MENTION) sizes the smallest useful notification-control scope.
- [ ] [Cliff](CLIFF_MENTION) adds the SSO prospect count.
- [ ] Rose makes the final call Friday.

Cass owns the consolidated plan. Rose will make final priority calls after everyone adds capacity
notes.
            `
                .replaceAll("HOLLY_MENTION", accountMentionUrl(accounts.hollyEvergreen))
                .replaceAll("ELLE_MENTION", accountMentionUrl(accounts.elleKappaTan))
                .replaceAll("MASON_MENTION", accountMentionUrl(accounts.masonClay))
                .replaceAll("CLIFF_MENTION", accountMentionUrl(accounts.cliffWeathers)),
        }),
        TestDocument.create(accounts.hollyEvergreen, {
            title: "Q3 Customer Survey Summary",
            access: "Public",
            body: markdown`
We heard back from 51 customers. The pattern is clear: people like having docs, tasks, chat, and
forum in one place, but they want better control over what interrupts them.

| Rank | Theme                | Owner                  | Signal                                                |
| ---- | -------------------- | ---------------------- | ----------------------------------------------------- |
| 1    | Tables in documents  | [Mason](MASON_MENTION) | <mark class="highlight-green">Already shipping</mark> |
| 2    | Notification control | [Cass](CASS_MENTION)   | Per-channel mute, inbox filters, quiet hours          |
| 3    | Faster search        | [Elle](ELLE_MENTION)   | Large workspaces feel the slowdown first              |

Representative notes:

> \u201CI love having everything in one place, but I still need quieter defaults.\u201D

> \u201CSearch is fine until the workspace gets large enough that history matters.\u201D

Notification control should be the leading product bet. Search speed is close behind, especially for
larger accounts that are deciding whether to expand. The tables result is satisfying, but _not_ the
whole story.
            `
                .replaceAll("MASON_MENTION", accountMentionUrl(accounts.masonClay))
                .replaceAll("CASS_MENTION", accountMentionUrl(accounts.cassCade))
                .replaceAll("ELLE_MENTION", accountMentionUrl(accounts.elleKappaTan)),
        }),
        TestDocument.create(accounts.mattRHorn, {
            title: "Editor Interaction Audit",
            access: "Public",
            body: markdown`
Before tables becomes part of the editor, we need an honest map of every interaction the editor
already owns. The table model should feel inevitable, not bolted on, and [Mason](MASON_MENTION)
should not have to rediscover every old shortcut by hand.

**What holds up**

- Text mark toolbar state is clear.
- Keyboard shortcuts mostly preserve the writer\u2019s _rhythm_.

**Needs revisiting**

- Selection color is doing too much work. Tables need a spatial selection model.
- Structural blocks need calmer toolbar behavior.

<mark class="highlight-blue">Snap column resizing by default.</mark> Hold Alt for smooth resizing
when precision matters. This gives most tables proportion while preserving control for edge cases.
            `.replaceAll("MASON_MENTION", accountMentionUrl(accounts.masonClay)),
        }),
        TestDocument.create(accounts.elleKappaTan, {
            title: "Enterprise SSO Technical Scope",
            access: "Public",
            body: markdown`
SSO scope covers SAML 2.0, OIDC, workspace admin configuration, and the migration path from password
accounts. This is a quarter-sized project, not a patch. [Cliff](CLIFF_MENTION) needs an ETA, but the
answer still has to be honest.

Implementation path:

1. Account enters email on login.
2. Alpine resolves the workspace identity provider.
3. User redirects to the provider and returns through a verified callback.
4. Alpine links or creates the account and starts the session.

Keep v1 narrow:

- [x] One provider per workspace for v1.
- [ ] Session duration policy needs [Rose](ROSE_MENTION) and [Cass](CASS_MENTION).
- [ ] SCIM stays out of scope, but the account model should not block it.

<mark class="highlight-orange">Main risk: migration from password accounts.</mark>
            `
                .replaceAll("CLIFF_MENTION", accountMentionUrl(accounts.cliffWeathers))
                .replaceAll("ROSE_MENTION", accountMentionUrl(accounts.roseCompas))
                .replaceAll("CASS_MENTION", accountMentionUrl(accounts.cassCade)),
        }),
        TestDocument.create(accounts.hollyEvergreen, {
            title: "Sales One-Pager (Final)",
            access: "Public",
            body: markdown`
Alpine gives technical teams documents, tasks, chat, forum, inbox, and search in one workspace.

Teams switch when the cost of coordination gets louder than the work itself. The pitch should stay
plain:

- Fewer tabs. Specs, tasks, and decisions live together.
- Better follow-through. Forum posts become tasks without losing context.
- Search that understands work. Results rank by relevance to the people and projects you touch.
- <mark class="highlight-purple">Home feed</mark> shows created and shared work without another
  status meeting.

For [Cliff](CLIFF_MENTION)\u2019s demos, lead with the home feed. It shows the whole company moving
at once: created work, shared docs, project updates, and the conversations around them. Keep the
inbox section _shorter than the live demo_.
            `.replaceAll("CLIFF_MENTION", accountMentionUrl(accounts.cliffWeathers)),
        }),
        TestDocument.create(accounts.cassCade, {
            title: "Senior Backend Offer Notes",
            access: "Public",
            body: markdown`
Final round was strong. [Rose](ROSE_MENTION) and [Elle](ELLE_MENTION) both flagged the same thing:
the candidate explains tradeoffs without turning the conversation into a lecture.

Rose and Cass are aligned: make the offer.

- Strength: durable ownership of auth and infrastructure work.
- Team fit: direct, careful, comfortable with uncertainty.
- Timing: lines up with SSO and the reliability follow-ups.

| Item          | Owner                  | Status                                         |
| ------------- | ---------------------- | ---------------------------------------------- |
| Compensation  | [Cass](CASS_MENTION)   | <mark class="highlight-orange">Drafting</mark> |
| First project | [Elle](ELLE_MENTION_2) | SSO scope                                      |

Offer goes out this week. Cass owns compensation details and start-date coordination. Elle should
join the close call if the candidate wants to talk through the first project.
            `
                .replaceAll("ROSE_MENTION", accountMentionUrl(accounts.roseCompas))
                .replaceAll("ELLE_MENTION_2", accountMentionUrl(accounts.elleKappaTan))
                .replaceAll("ELLE_MENTION", accountMentionUrl(accounts.elleKappaTan))
                .replaceAll("CASS_MENTION", accountMentionUrl(accounts.cassCade)),
        }),
        TestDocument.create(accounts.hollyEvergreen, {
            title: "Tables Help Doc",
            access: "Public",
            body: markdown`
Use the insert menu, pick table, then choose the starting size. You can add or remove rows and
columns from the table toolbar.

Keyboard notes:

- Tab advances to the next cell.
- Shift-Tab moves back.
- Arrow keys move inside text first, then across cell boundaries when the cursor reaches an edge.

Before publishing:

- [x] Add the Alt-resize note.
- [x] Confirm screenshots with [Mason](MASON_MENTION).
- [ ] Add one customer-facing example table.

For resizing, columns snap to the grid by default. Hold Alt while dragging for smooth resizing. This
keeps most tables tidy while preserving precision for edge cases.
            `.replaceAll("MASON_MENTION", accountMentionUrl(accounts.masonClay)),
        }),
    ]);

    await runAllPromises([
        q4PlanningDoc.updateContentPreview(),
        surveySummaryDoc.updateContentPreview(),
        editorAuditDoc.updateContentPreview(),
        ssoScopeDoc.updateContentPreview(),
        salesOnePagerDoc.updateContentPreview(),
        seniorBackendOfferDoc.updateContentPreview(),
        tablesHelpDoc.updateContentPreview(),
    ]);

    const [
        tablesLaunchTask,
        ssoProspectTask,
        surveyFollowupTask,
        notificationControlScopeTask,
        searchPerformanceCapacityTask,
    ] = await runAllPromises([
        TestTask.create(accounts.cassCade, {
            title: "Tables launch polish",
            layout: "Project",
            assignee: accounts.masonClay,
            assigneeStatus: "Active",
            priority: "High",
            collections: tablesCollection,
            notes: markdown`
Final pass after launch: help doc screenshots, keyboard navigation edge cases, and one last sweep of
column resizing behavior.
            `,
        }),
        TestTask.create(accounts.cliffWeathers, {
            title: "Decide Q4 SSO implementation window",
            layout: "Project",
            assignee: accounts.elleKappaTan,
            assigneeStatus: "Active",
            priority: "High",
            collections: q4PlanningCollection,
            notes: markdown`
Cliff has three enterprise prospects asking for SSO. We need one honest implementation window for Q4
planning, not three custom promises.
            `,
        }),
        TestTask.create(accounts.hollyEvergreen, {
            title: "Turn survey findings into Q4 product bets",
            layout: "Project",
            assignee: accounts.cassCade,
            priority: "Medium",
            collections: q4PlanningCollection,
            notes: markdown`
Pull the customers who mentioned per-channel mute, inbox filters, or quiet hours. Use the quotes in
the Q4 planning draft.
            `,
        }),
        TestTask.create(accounts.cassCade, {
            title: "Define notification control v1 scope",
            layout: "Project",
            assignee: accounts.masonClay,
            priority: "High",
            collections: q4PlanningCollection,
            notes: markdown`
Pick the smallest useful scope: per-channel mute, inbox filters, quiet hours, or some combination
that does not sprawl into a settings redesign.
            `,
        }),
        TestTask.create(accounts.cassCade, {
            title: "Estimate search performance capacity",
            layout: "Project",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
            collections: q4PlanningCollection,
            notes: markdown`
Search speed is the second customer theme. Estimate what we can actually improve in Q4 alongside SSO
and notification control.
            `,
        }),
    ]);

    await runAllPromises([
        TestTask.create(accounts.masonClay, {
            parent: tablesLaunchTask,
            title: "Verify table keyboard navigation in production",
        }),
        TestTask.create(accounts.hollyEvergreen, {
            parent: tablesLaunchTask,
            title: "Publish final help doc screenshots",
        }),
        TestTask.create(accounts.mattRHorn, {
            parent: tablesLaunchTask,
            title: "Review table toolbar empty-cell state",
        }),
        TestTask.create(accounts.masonClay, {
            parent: tablesLaunchTask,
            title: "Confirm column resize snapping feels calm",
        }),
        TestTask.create(accounts.hollyEvergreen, {
            parent: tablesLaunchTask,
            title: "Add one customer-facing example table",
        }),
        TestTask.create(accounts.mattRHorn, {
            parent: tablesLaunchTask,
            title: "Check table selection polish on narrow screens",
        }),
        TestTask.create(accounts.elleKappaTan, {
            parent: ssoProspectTask,
            title: "Confirm SAML and OIDC implementation estimate",
            assignee: accounts.elleKappaTan,
            priority: "High",
        }),
        TestTask.create(accounts.cassCade, {
            parent: surveyFollowupTask,
            title: "Group survey quotes by Q4 theme",
            assignee: accounts.cassCade,
            priority: "Medium",
        }),
        TestTask.create(accounts.masonClay, {
            parent: notificationControlScopeTask,
            title: "Sketch per-channel mute interaction",
            assignee: accounts.masonClay,
            priority: "High",
        }),
        TestTask.create(accounts.elleKappaTan, {
            parent: searchPerformanceCapacityTask,
            title: "Estimate index sharding impact",
            assignee: accounts.elleKappaTan,
            priority: "Medium",
        }),
        TestTask.create(accounts.hollyEvergreen, {
            title: "Meridian Labs case study approval",
            assignee: accounts.hollyEvergreen,
            priority: "High",
            collections: caseStudiesCollection,
        }),
        TestTask.create(accounts.hollyEvergreen, {
            title: "Northstar Systems interview notes",
            assignee: accounts.hollyEvergreen,
            priority: "Medium",
            collections: caseStudiesCollection,
        }),
        TestTask.create(accounts.cliffWeathers, {
            title: "Cobalt Robotics customer intro",
            assignee: accounts.cliffWeathers,
            priority: "Medium",
            collections: caseStudiesCollection,
        }),
    ]);

    const [
        tablesAnnouncementPost,
        reliabilityPost,
        cliffInboundPost,
        imageGalleryPost,
        inputsPost,
    ] = await runAllPromises([
        announcementsChannel.createPost(
            accounts.hollyEvergreen,
            markdown`
### Tables are live

Tables shipped this morning. Help doc is published, screenshots are current, and the announcement
copy is ready for customer emails.

Big thanks to Mason and Matt for getting the selection model into a place that feels calm.
            `,
            {overrideCreatedTime: daysAgoAt(0, 10, 10)},
        ),
        engineeringChannel.createPost(
            accounts.elleKappaTan,
            markdown`
Jittered reconnect backoff is live everywhere. Deploy health checks are gating traffic now, and the
new reconnect spike alert is hooked into the on-call policy.

No sync incidents since rollout.
            `,
            {overrideCreatedTime: daysAgoAt(1, 14, 25)},
        ),
        salesChannel.createPost(
            accounts.cliffWeathers,
            markdown`
Meridian case study drove a real inbound. New VP Eng prospect came in through Holly\u2019s piece,
and they are exactly the profile we wanted: 40-person engineering team, too many tools, actively
looking for consolidation.

The one-pager worked well in the first call. I still want a stronger inbox section before the next
round.
            `,
            {overrideCreatedTime: daysAgoAt(2, 15, 40)},
        ),
        craftChannel.createPost(
            accounts.mattRHorn,
            markdown`
### Early thoughts on image galleries

I wrote down the first pass before it turns into folklore. The short version: image galleries should
behave like document structure, not like loose attachments.

If tables taught us anything, it is that spatial tools still need editorial discipline.
            `,
            {overrideCreatedTime: daysAgoAt(3, 11, 35)},
        ),
        planningChannel.createPost(
            accounts.cassCade,
            markdown`
Q4 planning inputs are due Thursday. Please add capacity notes directly to the planning draft. I am
especially looking for the tradeoff between notification control, search speed, and SSO.

I will consolidate Friday morning so Rose has a clean version before final review.
            `,
            {overrideCreatedTime: daysAgoAt(4, 9, 5)},
        ),
    ]);

    await runAllPromises([
        craftChannel.createPost(
            accounts.masonClay,
            markdown`
The table toolbar feels much better after Matt\u2019s spacing pass. I still think the hover state is
a little too quiet when a cell is selected, but it is no longer fighting the text toolbar.
            `,
            {overrideCreatedTime: daysAgoAt(2, 17, 15)},
        ),
        craftChannel.createPost(
            accounts.hollyEvergreen,
            markdown`
### Help doc screenshots

I uploaded the final table screenshots. The Alt-resize note is short enough now that customers
should not miss it.
            `,
            {overrideCreatedTime: daysAgoAt(1, 16, 5)},
        ),
        craftChannel.createPost(
            accounts.cassCade,
            markdown`
Matt, Mason, I\u2019m calling the tables interaction model settled unless launch feedback shows a
real problem. Let\u2019s save the remaining editor polish for the next pass.
            `,
            {overrideCreatedTime: daysAgoAt(1, 12, 50)},
        ),
    ]);

    await runAllPromises([
        tablesAnnouncementPost.setReaction(accounts.cassCade, "Celebrate"),
        tablesAnnouncementPost.setReaction(accounts.masonClay, "Heart"),
        tablesAnnouncementPost.setReaction(accounts.mattRHorn, "Happy"),
        tablesAnnouncementPost.setReaction(accounts.roseCompas, "ThankYou"),
        reliabilityPost.setReaction(accounts.cassCade, "ThankYou"),
        reliabilityPost.setReaction(accounts.masonClay, "Happy"),
        reliabilityPost.setReaction(accounts.roseCompas, "Celebrate"),
        cliffInboundPost.setReaction(accounts.hollyEvergreen, "Happy"),
        cliffInboundPost.setReaction(accounts.roseCompas, "Heart"),
        cliffInboundPost.setReaction(accounts.cassCade, "Celebrate"),
        imageGalleryPost.setReaction(accounts.masonClay, "Happy"),
        imageGalleryPost.setReaction(accounts.cassCade, "Heart"),
        imageGalleryPost.setReaction(accounts.hollyEvergreen, "ThankYou"),
        inputsPost.setReaction(accounts.roseCompas, "ThankYou"),
        inputsPost.setReaction(accounts.elleKappaTan, "Happy"),
        inputsPost.setReaction(accounts.hollyEvergreen, "Heart"),
        inputsPost.setReaction(accounts.cliffWeathers, "Celebrate"),
    ]);

    await runAllPromises([
        tablesAnnouncementPost.createComment(
            accounts.masonClay,
            "the Alt-resize compromise is holding up in production",
        ),
        tablesAnnouncementPost.createComment(
            accounts.mattRHorn,
            "The grid snap gives the table a spine. Good call shipping it this way.",
        ),
        reliabilityPost.createComment(
            accounts.cassCade,
            "Thank you. This makes launch week calmer.",
        ),
        cliffInboundPost.createComment(
            accounts.hollyEvergreen,
            "I\u2019ll add the inbox paragraph before the next call.",
        ),
        cliffInboundPost.createComment(
            accounts.cassCade,
            "Loop me in if SSO comes up again. We need one clean answer.",
        ),
        imageGalleryPost.createComment(
            accounts.masonClay,
            "Lowkey agree. Attachments are too loose for what people expect here",
        ),
        inputsPost.createComment(
            accounts.elleKappaTan,
            "i\u2019ll add capacity notes for sso and search before lunch",
        ),
        inputsPost.createComment(
            accounts.hollyEvergreen,
            "Survey quotes are grouped now. I left the sharp ones in the doc.",
        ),
    ]);

    const planningRoom = await TestChat.createRoom(accounts.cassCade, {
        name: "Q4 planning sync",
        access: "Public",
    });

    await planningRoom.sendMessage(accounts.cassCade, "Thread for the last planning bits.", {
        overrideCreatedTime: daysAgoAt(0, 9, 20),
    });
    await planningRoom.sendMessage(
        accounts.roseCompas,
        "I want fewer priorities stated more clearly.",
        {
            overrideCreatedTime: daysAgoAt(0, 9, 24),
        },
    );
    await planningRoom.sendMessage(
        accounts.elleKappaTan,
        "sso is the only one where the unknowns can eat the quarter",
        {overrideCreatedTime: daysAgoAt(0, 9, 27)},
    );

    const entries: Array<FeedEntry> = [
        {
            type: "Document",
            documentId: q4PlanningDoc.id,
            sharedTime: daysAgoAt(0, 10, 35),
            sharerId: accounts.cassCade.account.id,
            creator: {id: accounts.cassCade.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: tablesAnnouncementPost.id,
            channelId: announcementsChannel.id,
            authorId: accounts.hollyEvergreen.account.id,
            createdTime: tablesAnnouncementPost.createdTime,
        },
        {
            type: "Task",
            taskId: tablesLaunchTask.id,
            sharedTime: daysAgoAt(0, 9, 55),
            sharerId: accounts.cassCade.account.id,
            creator: {id: accounts.cassCade.account.id, from: null},
            event: "UpdatedToProjectLayout",
        },
        {
            type: "Document",
            documentId: tablesHelpDoc.id,
            sharedTime: daysAgoAt(0, 9, 30),
            sharerId: accounts.hollyEvergreen.account.id,
            creator: {id: accounts.hollyEvergreen.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "RoomChat",
            chatId: planningRoom.id,
            sharedTime: daysAgoAt(0, 9, 20),
            sharerId: accounts.cassCade.account.id,
            creatorId: accounts.cassCade.account.id,
            event: "Created",
        },
        {
            type: "Post",
            postId: reliabilityPost.id,
            channelId: engineeringChannel.id,
            authorId: accounts.elleKappaTan.account.id,
            createdTime: reliabilityPost.createdTime,
        },
        {
            type: "TaskCollection",
            collectionId: q4PlanningCollection.id,
            sharedTime: daysAgoAt(1, 13, 10),
            sharerId: accounts.cassCade.account.id,
            creator: {id: accounts.cassCade.account.id, from: null},
            event: "Created",
        },
        {
            type: "Document",
            documentId: surveySummaryDoc.id,
            sharedTime: daysAgoAt(1, 11, 45),
            sharerId: accounts.hollyEvergreen.account.id,
            creator: {id: accounts.hollyEvergreen.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: cliffInboundPost.id,
            channelId: salesChannel.id,
            authorId: accounts.cliffWeathers.account.id,
            createdTime: cliffInboundPost.createdTime,
        },
        {
            type: "Document",
            documentId: editorAuditDoc.id,
            sharedTime: daysAgoAt(2, 12, 25),
            sharerId: accounts.mattRHorn.account.id,
            creator: {id: accounts.mattRHorn.account.id, from: null},
            event: "Created",
        },
        {
            type: "Channel",
            channelId: craftChannel.id,
            sharedTime: daysAgoAt(2, 10, 50),
            sharerId: accounts.mattRHorn.account.id,
            creatorId: accounts.mattRHorn.account.id,
            event: "Created",
        },
        {
            type: "Post",
            postId: imageGalleryPost.id,
            channelId: craftChannel.id,
            authorId: accounts.mattRHorn.account.id,
            createdTime: imageGalleryPost.createdTime,
        },
        {
            type: "Task",
            taskId: ssoProspectTask.id,
            sharedTime: daysAgoAt(3, 16, 0),
            sharerId: accounts.cliffWeathers.account.id,
            creator: {id: accounts.cliffWeathers.account.id, from: null},
            event: "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant",
        },
        {
            type: "Document",
            documentId: ssoScopeDoc.id,
            sharedTime: daysAgoAt(3, 13, 20),
            sharerId: accounts.elleKappaTan.account.id,
            creator: {id: accounts.elleKappaTan.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Task",
            taskId: surveyFollowupTask.id,
            sharedTime: daysAgoAt(4, 14, 0),
            sharerId: accounts.hollyEvergreen.account.id,
            creator: {id: accounts.hollyEvergreen.account.id, from: null},
            event: "UpdatedToProjectLayout",
        },
        {
            type: "Post",
            postId: inputsPost.id,
            channelId: planningChannel.id,
            authorId: accounts.cassCade.account.id,
            createdTime: inputsPost.createdTime,
        },
        {
            type: "Document",
            documentId: salesOnePagerDoc.id,
            sharedTime: daysAgoAt(5, 12, 10),
            sharerId: accounts.hollyEvergreen.account.id,
            creator: {id: accounts.hollyEvergreen.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "TaskCollection",
            collectionId: caseStudiesCollection.id,
            sharedTime: daysAgoAt(5, 10, 45),
            sharerId: accounts.hollyEvergreen.account.id,
            creator: {id: accounts.hollyEvergreen.account.id, from: null},
            event: "Created",
        },
        {
            type: "Document",
            documentId: seniorBackendOfferDoc.id,
            sharedTime: daysAgoAt(6, 15, 15),
            sharerId: accounts.cassCade.account.id,
            creator: {id: accounts.cassCade.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
    ];

    const url = new UrlPath(`/dev/feed/${space.id}`);
    url.searchParams.set(
        "entries",
        JSON.stringify(Schema.array(FeedEntrySchema).serialize(entries)),
    );

    await recorder.record({
        instructions: markdown`
Manual setup:

- Make the recording window bigger so we don\u2019t have rounded corners in the cropped recording.
- Scroll to the bottom of the feed so the virtualized scroll view gets the correct height for all
  items. Then scroll back to the top of the page.

Otherwise all actions are automated.
        `,
        session: accounts.cassCade,
        path: url.toString(),
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
            await page.evaluate("dev.feed.toggleLeftSideBarVisibility()");
        },
        actions: [
            async page => {
                const feedScrollView = page.getByTestId("PostListScrollView");
                await feedScrollView.waitFor({state: "visible"});

                const documentContentEditor = page.getByTestId("DocumentContentEditorMain");
                const taskDetailView = page.getByTestId("TaskDetailScrollView");

                const cursor = await createDemoCursor(page, {
                    scale: 1.5,
                    watchCssCursor: true,
                });
                await cursor.hide();

                await wait(300);
                await scrollDemo(feedScrollView, {distance: 4892, durationMs: 4500});
                await wait(300);

                await cursor.jumpTo(607, 219);
                await cursor.show();
                await wait(300);
                await cursor.click(510, 365, 900);
                await cursor.hide();
                await wait(1100);
                await scrollDemo(documentContentEditor, {distance: 77, durationMs: 2000});
                await wait(1500);

                await page.keyboard.press("Escape");
                await wait(700);

                await scrollDemo(feedScrollView, {distance: -4285, durationMs: 4500});
                await wait(300);
                await cursor.setCursorType("default");
                await cursor.show();
                await wait(200);
                await cursor.click(397, 321, 750);
                await cursor.hide();
                await cursor.jumpTo(0, 0);
                await wait(1500);
                await scrollDemo(taskDetailView, {distance: 264, durationMs: 2000});
                await wait(1500);
                await page.keyboard.press("Escape");
            },
        ],
    });
});
