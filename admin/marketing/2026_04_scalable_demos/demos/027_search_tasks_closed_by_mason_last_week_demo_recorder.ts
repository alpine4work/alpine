import {CalendarDateTime, today} from "@internationalized/date";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDemoCursor} from "~/admin/marketing/2026_04_scalable_demos/helpers/demo_cursor.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    getSearchEntityIndexesForTest,
    processIndexSearchEntityJob,
    searchByKeywords,
} from "~/server/search/data/index/search_entity_index.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {FeedEntry, FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {UrlPath} from "~/shared/helpers/http/url_path.open_source.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {Schema} from "~/shared/schema/schema.js";

const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);
    const daysAgoAt = (days: number, hour: number, minute: number) =>
        new CalendarDateTime(currentDate.year, currentDate.month, currentDate.day, hour, minute)
            .subtract({days})
            .toDate(timeZone);
    const taskTimeAt = (days: number, hour: number, minute: number, tick = 0) =>
        [daysAgoAt(days, hour, minute).getTime(), tick] as const;

    const mentionUrl = (session: {account: {id: string}}) =>
        `https://alpine.inc/mention/${session.account.id}#short`;

    const [announcementsChannel, engineeringChannel, planningChannel, salesChannel] =
        await runAllPromises([
            TestChannel.create(accounts.hollyEvergreen, {
                name: "Announcements",
                access: "Public",
                description: "Launches and customer-facing product updates.",
            }),
            TestChannel.create(accounts.elleKappaTan, {
                name: "Engineering",
                access: "Public",
                description: "Reliability work, technical notes, and implementation updates.",
            }),
            TestChannel.create(accounts.cassCade, {
                name: "Q4 Planning",
                access: "Public",
                description: "Planning inputs for notification control, search, and SSO.",
            }),
            TestChannel.create(accounts.cliffWeathers, {
                name: "Sales",
                access: "Public",
                description: "Deal notes, collateral feedback, and customer asks.",
            }),
        ]);

    const [q4PlanningCollection, q4PlanningDoc, surveySummaryDoc, ssoScopeDoc, salesOnePagerDoc] =
        await runAllPromises([
            TestTaskCollection.create(accounts.cassCade, {
                name: "Q4 Planning",
                access: "Public",
                color: "green",
            }),
            TestDocument.create(accounts.cassCade, {
                title: "Q4 Planning Draft",
                access: "Public",
                body: markdown`
Q4 planning should stay tight: notification control, search performance on large workspaces, and the
narrowest honest SSO path.

Current stack:

1. Notification control
2. Faster search on larger workspaces
3. Enterprise SSO

- [x] Survey summary folded in
- [ ] [Mason](MASON_MENTION) sizes notification control v1
- [ ] [Elle](ELLE_MENTION) adds search and SSO capacity notes
- [ ] Rose makes the final call Friday
                `
                    .replaceAll("MASON_MENTION", mentionUrl(accounts.masonClay))
                    .replaceAll("ELLE_MENTION", mentionUrl(accounts.elleKappaTan)),
            }),
            TestDocument.create(accounts.hollyEvergreen, {
                title: "Q3 Customer Survey Summary",
                access: "Public",
                body: markdown`
We heard back from 51 customers. The pattern is stable:

| Rank | Theme                | Owner          |
| ---- | -------------------- | -------------- |
| 1    | Tables in documents  | [Mason](MASON) |
| 2    | Notification control | [Cass](CASS)   |
| 3    | Faster search        | [Elle](ELLE)   |

The tables request is finally satisfied, which gives us room to focus on quieter defaults and faster
retrieval in larger workspaces.
                `
                    .replaceAll("MASON", mentionUrl(accounts.masonClay))
                    .replaceAll("CASS", mentionUrl(accounts.cassCade))
                    .replaceAll("ELLE", mentionUrl(accounts.elleKappaTan)),
            }),
            TestDocument.create(accounts.elleKappaTan, {
                title: "Enterprise SSO Technical Scope",
                access: "Public",
                body: markdown`
SSO scope covers SAML 2.0, OIDC, workspace admin configuration, and the migration path from password
accounts.

Keep v1 narrow:

- One provider per workspace
- No SCIM
- Honest migration story for existing accounts

[Cliff](CLIFF_MENTION) needs an ETA, but the answer has to stay real.
                `.replaceAll("CLIFF_MENTION", mentionUrl(accounts.cliffWeathers)),
            }),
            TestDocument.create(accounts.hollyEvergreen, {
                title: "Sales One-Pager (Final)",
                access: "Public",
                body: markdown`
Alpine gives technical teams documents, tasks, chat, forum, inbox, and search in one workspace.

Lead with the home feed and the way search understands the work people are already touching. Keep
the pitch plain.
                `,
            }),
        ]);

    await runAllPromises([
        q4PlanningDoc.updateContentPreview(),
        surveySummaryDoc.updateContentPreview(),
        ssoScopeDoc.updateContentPreview(),
        salesOnePagerDoc.updateContentPreview(),
    ]);

    const [tablesLaunchProject, ssoImplementationWindowTask] = await runAllPromises([
        TestTask.create(accounts.cassCade, {
            title: "Tables launch polish",
            layout: "Project",
            assignee: accounts.masonClay,
            assigneeStatus: "Active",
            priority: "High",
            notes: markdown`
Final pass after launch: one more sweep of keyboard navigation, selection edge cases, and column
resize behavior before we move on.
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
Cliff has multiple enterprise prospects asking for SSO. We need one clean answer for Q4 planning.
            `,
        }),
    ]);

    const createClosedMasonTask = async ({
        title,
        notes,
        createdDaysAgo,
        createdHour,
        createdMinute,
        closedDaysAgo,
        closedHour,
        closedMinute,
    }: {
        title: string;
        notes: string;
        createdDaysAgo: number;
        createdHour: number;
        createdMinute: number;
        closedDaysAgo: number;
        closedHour: number;
        closedMinute: number;
    }) => {
        const task = await TestTask.create(accounts.cassCade, {
            parent: tablesLaunchProject,
            title,
            assignee: accounts.masonClay,
            priority: "High",
            time: taskTimeAt(createdDaysAgo, createdHour, createdMinute),
            notes,
        });

        await task.updateStatus(accounts.masonClay, "Closed", {
            time: taskTimeAt(closedDaysAgo, closedHour, closedMinute, 1),
        });

        return task;
    };

    const [
        shipKeyboardNavigationTask,
        selectedCellHoverTask,
        altResizeCursorTask,
        emptyCellSelectionTask,
        launchFeedbackTask,
        initialSpacingPassTask,
    ] = await runAllPromises([
        createClosedMasonTask({
            title: "Ship keyboard navigation edge-case fixes",
            notes: markdown`
Close the remaining keyboard-only gaps in tables:

- arrow navigation now skips merged cells cleanly
- shift selection keeps the correct anchor after column inserts
- enter returns focus to the previously active cell after editing
            `,
            createdDaysAgo: 13,
            createdHour: 9,
            createdMinute: 10,
            closedDaysAgo: 12,
            closedHour: 16,
            closedMinute: 20,
        }),
        createClosedMasonTask({
            title: "Tighten selected-cell hover state",
            notes: markdown`
Tighten the selected-cell hover treatment so it feels stable while editing:

- hover ring no longer doubles up on the active selection
- drag handles stay visible while moving across dense grids
- dark text contrast now holds on the pale blue selected background
            `,
            createdDaysAgo: 12,
            createdHour: 10,
            createdMinute: 5,
            closedDaysAgo: 11,
            closedHour: 15,
            closedMinute: 35,
        }),
        createClosedMasonTask({
            title: "Resolve Alt-resize cursor behavior",
            notes: markdown`
Make the alternate resize interaction reliable so power users can hold Alt to resize from the center
without leaving the wrong cursor behind on neighboring columns.
            `,
            createdDaysAgo: 11,
            createdHour: 11,
            createdMinute: 25,
            closedDaysAgo: 10,
            closedHour: 17,
            closedMinute: 5,
        }),
        createClosedMasonTask({
            title: "Polish empty-cell selection visuals",
            notes: markdown`
Polish the empty-state grid selection details:

- empty cells keep the same selection fill as populated cells
- multi-cell outlines no longer clip at row boundaries
- placeholder affordances fade correctly once selection starts
            `,
            createdDaysAgo: 10,
            createdHour: 9,
            createdMinute: 40,
            closedDaysAgo: 9,
            closedHour: 14,
            closedMinute: 50,
        }),
        TestTask.create(accounts.cassCade, {
            parent: tablesLaunchProject,
            title: "Review launch feedback follow-ups",
            assignee: accounts.masonClay,
            assigneeStatus: "Active",
            priority: "Medium",
            time: taskTimeAt(0, 9, 15),
        }),
        TestTask.create(accounts.cassCade, {
            parent: tablesLaunchProject,
            title: "Initial table toolbar spacing pass",
            assignee: accounts.masonClay,
            priority: "Medium",
            time: taskTimeAt(11, 10, 15),
            status: "Closed",
        }),
    ]);

    const indexedTasks = [
        tablesLaunchProject,
        ssoImplementationWindowTask,
        shipKeyboardNavigationTask,
        selectedCellHoverTask,
        altResizeCursorTask,
        emptyCellSelectionTask,
        launchFeedbackTask,
        initialSpacingPassTask,
    ];
    const indexedTaskTimeById = new Map([
        [shipKeyboardNavigationTask.id, daysAgoAt(12, 16, 20)],
        [selectedCellHoverTask.id, daysAgoAt(11, 15, 35)],
        [altResizeCursorTask.id, daysAgoAt(10, 17, 5)],
        [emptyCellSelectionTask.id, daysAgoAt(9, 14, 50)],
    ] as const);
    const closedTaskTitles = [
        "Ship keyboard navigation edge-case fixes",
        "Tighten selected-cell hover state",
        "Resolve Alt-resize cursor behavior",
        "Polish empty-cell selection visuals",
    ];

    await runAllPromises(
        indexedTasks.map(task =>
            processIndexSearchEntityJob(
                space.systemAction(),
                {
                    type: "IndexSearchEntity",
                    spaceId: space.id,
                    update: {
                        type: "Task",
                        taskId: task.id,
                        updatedTraits: {type: "Any"},
                    },
                },
                indexedTaskTimeById.get(task.id) ?? new Date(),
                {addData: () => {}},
            ),
        ),
    );

    await context.opensearch.refresh(SearchEntityKeywordIndex);

    const closedTaskSearchResults = await searchByKeywords(accounts.cassCade.action(), {
        spaceId: space.id,
        queryText: "tasks closed by mason last week",
        limit: 20,
        timeZone,
        currentTime: new Date(),
    });
    const closedTaskSearchResultTitles = new Set(
        // @ts-expect-error
        closedTaskSearchResults.map(result => result.model.initialData.title),
    );
    for (const closedTaskTitle of closedTaskTitles) {
        if (!closedTaskSearchResultTitles.has(closedTaskTitle)) {
            // eslint-disable-next-line cyberworlds/no-global-error
            throw new Error(
                `Missing expected search result for query \u201Ctasks closed by mason last week\u201D: ${closedTaskTitle}`,
            );
        }
    }

    const [tablesAnnouncementPost, reliabilityPost, planningInputsPost, salesPost] =
        await runAllPromises([
            announcementsChannel.createPost(
                accounts.hollyEvergreen,
                markdown`
### Tables are live

Tables shipped cleanly. Help doc is published, screenshots are current, and the customer email copy
is ready.

Big thanks to Mason and Matt for getting the interaction model into a place that feels calm.
                `,
                {overrideCreatedTime: daysAgoAt(1, 10, 10)},
            ),
            engineeringChannel.createPost(
                accounts.elleKappaTan,
                markdown`
jittered reconnect backoff is live everywhere now

deploy health checks are gating traffic and the reconnect spike alert is wired into on call

no sync incidents since rollout
                `,
                {overrideCreatedTime: daysAgoAt(2, 14, 25)},
            ),
            planningChannel.createPost(
                accounts.cassCade,
                markdown`
Q4 planning inputs are due Thursday. Please add capacity notes directly to the planning draft.

I\u2019m especially looking for the real tradeoff between notification control, search speed, and
SSO.
                `,
                {overrideCreatedTime: daysAgoAt(3, 9, 5)},
            ),
            salesChannel.createPost(
                accounts.cliffWeathers,
                markdown`
Meridian came in through the case study and the one-pager held up well in the first call.

I still want a stronger inbox section before the next round, but the \u201Cone workspace\u201D pitch
is landing.
                `,
                {overrideCreatedTime: daysAgoAt(4, 15, 40)},
            ),
        ]);

    await runAllPromises([
        tablesAnnouncementPost.setReaction(accounts.cassCade, "Celebrate"),
        tablesAnnouncementPost.setReaction(accounts.masonClay, "Heart"),
        tablesAnnouncementPost.setReaction(accounts.mattRHorn, "Happy"),
        reliabilityPost.setReaction(accounts.cassCade, "ThankYou"),
        reliabilityPost.setReaction(accounts.roseCompas, "Celebrate"),
        planningInputsPost.setReaction(accounts.roseCompas, "ThankYou"),
        salesPost.setReaction(accounts.hollyEvergreen, "Happy"),
        salesPost.setReaction(accounts.cassCade, "Celebrate"),
        tablesAnnouncementPost.createComment(
            accounts.masonClay,
            "the launch feedback looks good so far",
        ),
        reliabilityPost.createComment(accounts.cassCade, "Thank you. This makes the week calmer."),
        planningInputsPost.createComment(
            accounts.elleKappaTan,
            "i\u2019ll add search and sso capacity notes before lunch",
        ),
    ]);

    const entries: Array<FeedEntry> = [
        {
            type: "Task",
            taskId: tablesLaunchProject.id,
            sharedTime: daysAgoAt(0, 9, 55),
            sharerId: accounts.cassCade.account.id,
            creator: {id: accounts.cassCade.account.id, from: null},
            event: "UpdatedToProjectLayout",
        },
        {
            type: "Post",
            postId: tablesAnnouncementPost.id,
            channelId: announcementsChannel.id,
            authorId: accounts.hollyEvergreen.account.id,
            createdTime: tablesAnnouncementPost.createdTime,
        },
        {
            type: "Document",
            documentId: q4PlanningDoc.id,
            sharedTime: daysAgoAt(1, 11, 40),
            sharerId: accounts.cassCade.account.id,
            creator: {id: accounts.cassCade.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
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
            sharedTime: daysAgoAt(2, 13, 5),
            sharerId: accounts.cassCade.account.id,
            creator: {id: accounts.cassCade.account.id, from: null},
            event: "Created",
        },
        {
            type: "Document",
            documentId: surveySummaryDoc.id,
            sharedTime: daysAgoAt(2, 11, 30),
            sharerId: accounts.hollyEvergreen.account.id,
            creator: {id: accounts.hollyEvergreen.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Task",
            taskId: ssoImplementationWindowTask.id,
            sharedTime: daysAgoAt(3, 16, 0),
            sharerId: accounts.cliffWeathers.account.id,
            creator: {id: accounts.cliffWeathers.account.id, from: null},
            event: "SharedProjectLayoutWithInheritedAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: planningInputsPost.id,
            channelId: planningChannel.id,
            authorId: accounts.cassCade.account.id,
            createdTime: planningInputsPost.createdTime,
        },
        {
            type: "Document",
            documentId: ssoScopeDoc.id,
            sharedTime: daysAgoAt(4, 13, 20),
            sharerId: accounts.elleKappaTan.account.id,
            creator: {id: accounts.elleKappaTan.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: salesPost.id,
            channelId: salesChannel.id,
            authorId: accounts.cliffWeathers.account.id,
            createdTime: salesPost.createdTime,
        },
        {
            type: "Document",
            documentId: salesOnePagerDoc.id,
            sharedTime: daysAgoAt(5, 12, 10),
            sharerId: accounts.hollyEvergreen.account.id,
            creator: {id: accounts.hollyEvergreen.account.id, from: null},
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
This automated demo starts on Cass\u2019s feed, clicks into search, and types \u201Ctasks closed by
mason last week\u201D, then steps through the returned tasks one by one.
        `,
        session: accounts.cassCade,
        path: url.toString(),
        viewport: scalableDemoWideViewport,
        actions: [
            async page => {
                const feedScrollView = page.getByTestId("PostListScrollView");
                await feedScrollView.waitFor({state: "visible"});

                const searchButton = page.getByRole("button", {name: "Search"});
                const searchInput = page.getByTestId("SearchModal").locator("input").first();
                const cursor = await createDemoCursor(page, {
                    scale: 1.5,
                    watchCssCursor: true,
                });

                await cursor.hide();
                await wait(450);
                await cursor.jumpTo(120, 210);
                await cursor.show();
                await wait(800);
                await cursor.moveToElement(searchButton, 1000);
                await wait(160);
                await searchButton.click();
                await page.getByTestId("SearchModal").waitFor({state: "visible"});
                await wait(450);

                await searchInput.waitFor({state: "visible"});
                await cursor.hide();
                await wait(180);

                const searchQueryText = "tasks closed by mason last week";
                await searchInput.pressSequentially(searchQueryText, {
                    delay: 30,
                });
                await searchInput.evaluate((input, queryText) => {
                    if ((input as HTMLInputElement).value !== queryText)
                        (input as HTMLInputElement).value = queryText;
                    input.dispatchEvent(new Event("input", {bubbles: true}));
                }, searchQueryText);
                await wait(900);

                const searchEntityViews = page.getByTestId("SearchEntityView");
                await searchEntityViews.first().waitFor({state: "visible"});
                await cursor.show();
                await wait(200);

                for (let index = 0; index < 2; index++) {
                    const result = searchEntityViews.nth(index);
                    await result.scrollIntoViewIfNeeded();
                    await result.waitFor({state: "visible"});
                    await cursor.moveToElement(result, 850);
                    await wait(120);
                    await cursor.clickElement(result, 500, {watchCssCursor: true});
                    await wait(1000);
                }
            },
        ],
    });
});
