import {CalendarDate} from "@internationalized/date";
import Mustache from "mustache";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {screenshotFileEntity} from "~/app/screenshot_tests/helpers/screenshot_file_entity.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {
    refreshTaskCollectionIndexForTest,
    refreshTaskIndexForTest,
} from "~/server/tasks/data/task_index.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateId, unsafelyGenerateStableId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";
import {serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";

const personalScreenshotTime = new Date("2025-10-01T13:00:00Z");
const sprintScreenshotTime = new Date("2025-10-08T13:00:00Z");

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    async function waitForTaskIndex() {
        await ProcessContextModule.waitForTestTasks();
        await runner.services.waitForSqsProcessJobs();

        await runAllPromises([
            refreshTaskIndexForTest(context),
            refreshTaskCollectionIndexForTest(context),
        ]);
    }

    const {space, accounts} = await runner.createDemoSpace(context);

    await runner.goto(accounts.cassCade, `/s/${space.id}/tasks`, {
        fixedTime: personalScreenshotTime,
    });
    await runner.screenshot("a0", "personal-empty");

    const collections = await createTaskCollections(accounts.cassCade);

    await createPersonalTasks(accounts.cassCade, collections);
    await waitForTaskIndex();

    await runner.goto(accounts.cassCade, `/s/${space.id}/tasks`, {
        fixedTime: personalScreenshotTime,
    });
    await runner.screenshot("a1", "personal");

    const {projectTask, featuredProjectTask} = await createTablesProject(
        runner.stableRandom,
        accounts,
        collections,
    );
    await waitForTaskIndex();

    {
        const searchParams = new URLSearchParams();
        searchParams.set(
            "create",
            serializeTaskQueryFiltersSearchParam([
                {type: "Layout", operation: {type: "OneOf", layouts: ["Project"]}},
            ]),
        );

        await runner.goto(
            accounts.cassCade,
            `/s/${space.id}/tasks/${generateId<TaskId>()}?${searchParams.toString()}`,
            {fixedTime: sprintScreenshotTime},
        );
        await runner.screenshot("a2", "project-new");
    }

    await runner.goto(accounts.cassCade, `/s/${space.id}/tasks/${projectTask.id}`, {
        fixedTime: sprintScreenshotTime,
    });
    await runner.getByText("2/3").first().click();
    await runner.getByText("Snap math + grid").waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a3", "project");

    await runner.goto(accounts.cassCade, `/s/${space.id}/tasks/${projectTask.id}`, {
        fixedTime: sprintScreenshotTime,
        peekPath: `/s/${space.id}/tasks/${featuredProjectTask.id}`,
    });
    await runner.getByTestId("PeekStack").waitFor();
    await runner.screenshot("a4", "task-peek");

    {
        await runner.goto(accounts.cassCade, `/s/${space.id}/dev/empty`, {
            fixedTime: sprintScreenshotTime,
            peekPath: `/s/${space.id}/tasks/${generateId<TaskId>()}?create`,
        });
        await runner.screenshot("a5", "task-new");
    }

    await runner.goto(accounts.cassCade, `/s/${space.id}/tasks/${featuredProjectTask.id}`, {
        fixedTime: sprintScreenshotTime,
    });
    await runner.screenshot("a6", "task");

    await createSprintTasksAndBugTasks(accounts, collections);
    await waitForTaskIndex();

    await runner.goto(accounts.cassCade, `/s/${space.id}/tasks/view`, {
        fixedTime: sprintScreenshotTime,
    });
    await runner.screenshot("a7", "query-empty");

    {
        const searchParams = new URLSearchParams();
        searchParams.set("name", "Sprint Review");
        searchParams.set(
            "filter",
            serializeTaskQueryFiltersSearchParam([
                {
                    type: "Collections",
                    operation: {
                        type: "IncludesOneOf",
                        collectionIds: new Set([collections.sprintOct6.id]),
                    },
                },
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
            ]),
        );
        searchParams.set(
            "sort",
            serializeTaskQuerySortsSearchParam([
                {type: "Assignee", missing: "Last"},
                {type: "DisplayStatus", direction: "Descending"},
                {type: "Priority", direction: "Descending"},
            ]),
        );

        await runner.goto(
            accounts.cassCade,
            `/s/${space.id}/tasks/view?${searchParams.toString()}`,
            {fixedTime: sprintScreenshotTime},
        );
    }
    await runner.screenshot("a8", "query");

    await runner.goto(accounts.cassCade, `/s/${space.id}/dev/empty`, {
        fixedTime: sprintScreenshotTime,
        peekPath: `/s/${space.id}/tasks/collections/${generateId()}?create`,
    });
    await runner.screenshot("a9", "collection-new");

    const bugsPath = `/s/${space.id}/tasks/collections/${collections.bugs.id}`;

    await runner.goto(accounts.cassCade, bugsPath, {fixedTime: sprintScreenshotTime});
    await runner.screenshot("aA", "collection");

    await screenshotFileEntity(runner, accounts.cassCade, "aA", "aB", `Task:${projectTask.id}`, {
        fixedTime: sprintScreenshotTime,
    });

    await screenshotFileEntity(
        runner,
        accounts.cassCade,
        "aB",
        "aC",
        `TaskCollection:${collections.bugs.id}`,
        {fixedTime: sprintScreenshotTime},
    );

    await projectTask.access.grantUrl(accounts.cassCade);
    await collections.bugs.access.grantUrl(accounts.cassCade);

    await runner.goto(null, `/s/${space.id}/tasks/${projectTask.id}`, {
        fixedTime: sprintScreenshotTime,
    });
    await runner.getByText("2/3").first().click();
    await runner.getByText("Snap math + grid").waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("aC", "project-url-grant");

    await runner.goto(null, `/s/${space.id}/tasks/${projectTask.id}`, {
        fixedTime: sprintScreenshotTime,
        peekPath: `/s/${space.id}/tasks/${featuredProjectTask.id}`,
    });
    await runner.getByText("2/3").first().click();
    await runner.getByText("Snap math + grid").waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("aD", "task-peek-url-grant");

    await runner.goto(null, `/s/${space.id}/tasks/${featuredProjectTask.id}`, {
        fixedTime: sprintScreenshotTime,
    });
    await runner.screenshot("aE", "task-url-grant");

    await runner.goto(null, `/s/${space.id}/tasks/collections/${collections.bugs.id}`, {
        fixedTime: sprintScreenshotTime,
    });
    await runner.screenshot("aF", "collection-url-grant");
}

async function createTaskCollections(session: TestSpaceSession) {
    return {
        bugs: await TestTaskCollection.create(session, {
            name: "Bugs",
            access: "Public",
            color: "red",
        }),
        caseStudies: await TestTaskCollection.create(session, {
            name: "Case Studies",
            access: "Public",
            color: "pink",
        }),
        design: await TestTaskCollection.create(session, {
            name: "Design",
            access: "Public",
            color: "purple",
        }),
        editorAudit: await TestTaskCollection.create(session, {
            name: "Editor Audit",
            access: "Public",
            color: "indigo",
        }),
        enterpriseSso: await TestTaskCollection.create(session, {
            name: "Enterprise SSO",
            access: "Public",
            color: "blue",
        }),
        helpCenter: await TestTaskCollection.create(session, {
            name: "Help Center",
            access: "Public",
            color: "green",
        }),
        hiring: await TestTaskCollection.create(session, {
            name: "Hiring",
            access: "Private",
            color: "orange",
        }),
        realtimeReliability: await TestTaskCollection.create(session, {
            name: "Realtime Reliability",
            access: "Public",
            color: "pink",
        }),
        sales: await TestTaskCollection.create(session, {
            name: "Sales",
            access: "Public",
        }),
        sprintOct6: await TestTaskCollection.create(session, {
            name: "Sprint (Oct 6)",
            access: "Public",
            color: "green",
        }),
        tables: await TestTaskCollection.create(session, {
            name: "Tables",
            access: "Public",
            color: "blue",
        }),
    };
}

async function createPersonalTasks(
    session: TestSpaceSession,
    collections: Awaited<ReturnType<typeof createTaskCollections>>,
) {
    const q4PlanningTask = await TestTask.create(session, {
        title: "Q4 planning",
        assignee: session,
        assigneeStatus: "Active",
        dueDate: new CalendarDate(2025, 10, 13),
        collections: collections.sprintOct6,
        priority: "High",
    });

    await TestTask.create(session, {
        title: "Overview section",
        parent: q4PlanningTask,
        status: "Closed",
    });

    await TestTask.create(session, {
        title: "Engineering section frame",
        parent: q4PlanningTask,
        status: "Closed",
    });

    await TestTask.create(session, {
        title: "Hiring section",
        parent: q4PlanningTask,
        status: "Closed",
    });

    await TestTask.create(session, {
        title: "Roll up Holly’s survey findings into the inputs section",
        parent: q4PlanningTask,
    });
    await TestTask.create(session, {
        title: "GTM section - Cliff and Holly inputs",
        parent: q4PlanningTask,
    });
    await TestTask.create(session, {
        title: "Open questions / things I want Rose to weigh in on",
        parent: q4PlanningTask,
    });
    await TestTask.create(session, {
        title: "Walk through with Rose before circulating",
        parent: q4PlanningTask,
    });

    await TestTask.create(session, {
        title: "Make the call on column resize",
        assignee: session,
        collections: collections.tables,
        dueDate: new CalendarDate(2025, 10, 1),
        notes: markdown`
Mason and Matt have been going back and forth for a week. Read both threads end to end this morning
and post the decision in the tables project doc by EOD so they can both move on. Leaning
snap-by-default with Alt for smooth.
        `,
    });

    await TestTask.create(session, {
        title: "Read Holly’s Q3 survey summary before meeting",
        assignee: session,
        dueDate: new CalendarDate(2025, 10, 1),
        priority: "Medium",
    });

    const offerPackageTask = await TestTask.create(session, {
        title: "Close senior backend engineer",
        assignee: session,
        collections: collections.hiring,
        dueDate: new CalendarDate(2025, 10, 3),
        priority: "High",
    });

    await TestTask.create(session, {
        title: "Pull comp band from the H2 plan",
        parent: offerPackageTask,
        status: "Closed",
    });

    await TestTask.create(session, {
        title: "Confirm equity range with Rose",
        parent: offerPackageTask,
        status: "Closed",
    });

    await TestTask.create(session, {
        title: "Draft the offer letter",
        parent: offerPackageTask,
    });
    await TestTask.create(session, {
        title: "Reference checks",
        parent: offerPackageTask,
    });
    await TestTask.create(session, {
        title: "Call with Rose to deliver package personally",
        parent: offerPackageTask,
    });

    const kickoffDocTask = await TestTask.create(session, {
        title: "Sprint kickoff deck (week of Oct 6)",
        assignee: session,
        dueDate: new CalendarDate(2025, 10, 3),
        priority: "Medium",
    });

    await TestTask.create(session, {
        title: "Carry-overs section",
        parent: kickoffDocTask,
    });
    await TestTask.create(session, {
        title: "New work intake",
        parent: kickoffDocTask,
    });
    await TestTask.create(session, {
        title: "Owners + check-in cadence",
        parent: kickoffDocTask,
    });

    await TestTask.create(session, {
        title: "Send Q4 planning reminder",
        assignee: session,
        parent: q4PlanningTask,
        dueDate: new CalendarDate(2025, 10, 2),
        notes: "Inputs are due Friday. Rose, Mason, and Cliff still need a light nudge in chat.",
        priority: "Low",
    });

    await TestTask.create(session, {
        title: "Move the all-hands to a recurring slot",
        assignee: session,
    });

    await TestTask.create(session, {
        title: "Pipeline review prep",
        assignee: session,
        collections: collections.sales,
    });

    const onboardingPlanTask = await TestTask.create(session, {
        title: "Onboarding plan for new backend hire",
        assignee: session,
        collections: [collections.sprintOct6, collections.hiring],
        dueDate: new CalendarDate(2025, 10, 17),
        priority: "Medium",
    });

    {
        await TestTask.create(session, {
            title: "First-week shape (1:1s, repo tour, first PR target)",
            parent: onboardingPlanTask,
        });
        await TestTask.create(session, {
            title: "Pair with Elle on the technical onboarding",
            parent: onboardingPlanTask,
        });
        await TestTask.create(session, {
            title: "Onboarding buddy assignment",
            parent: onboardingPlanTask,
        });
    }

    await TestTask.create(session, {
        title: "Block Rose’s calendar for the offer call",
        assignee: session,
        collections: collections.hiring,
        priority: "High",
    });

    await TestTask.create(session, {
        title: "Figure out SSO ETA for Acme",
        assignee: session,
        collections: collections.sales,
    });

    const tablesLaunchCoordinationTask = await TestTask.create(session, {
        title: "Tables launch coordination",
        assignee: session,
        collections: [collections.tables, collections.sprintOct6],
        dueDate: new CalendarDate(2025, 10, 14),
        priority: "High",
    });

    {
        await TestTask.create(session, {
            title: "Confirm ship date with Mason once column resize is settled",
            parent: tablesLaunchCoordinationTask,
        });
        await TestTask.create(session, {
            title: "Sync with Holly on help doc draft",
            parent: tablesLaunchCoordinationTask,
        });
        await TestTask.create(session, {
            title: "Forum announcement - draft with Holly, Rose to bless",
            parent: tablesLaunchCoordinationTask,
        });
        await TestTask.create(session, {
            title: "Internal heads-up to Cliff so he can mention it on demos",
            parent: tablesLaunchCoordinationTask,
        });
    }
}

async function createTablesProject(
    stableRandom: StableRandom,
    accounts: DemoSpaceAccounts,
    collections: Awaited<ReturnType<typeof createTaskCollections>>,
) {
    const projectTask = await TestTask.create(accounts.cassCade, {
        title: "Tables",
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        collections: collections.sprintOct6,
        dueDate: new CalendarDate(2025, 10, 15),
        layout: "Project",
        notes: markdown`
Tables in our rich text editor. Insert, edit, navigate, resize, paste in from a spreadsheet. The
bulk of the work is a custom cell selection model sitting on top of the document’s existing
selection state.
        `,
        priority: "High",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Design spec v1",
        parent: projectTask,
        assignee: accounts.mattRHorn,
        notes: "Living doc with sections on selection model, toolbar, keyboard nav, and column resizing.",
        priority: "High",
        status: "Closed",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Design cell selection model",
        parent: projectTask,
        assignee: accounts.mattRHorn,
        notes: "Resolved in favor of spatial selection over document-like highlighting.",
        priority: "Medium",
        status: "Closed",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Empty + error states pass",
        parent: projectTask,
        assignee: accounts.mattRHorn,
        notes: "Placeholder, paste-too-large message, resize cursor, and last-row-deleted behavior.",
        priority: "Low",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Insert + edit cells (basic)",
        parent: projectTask,
        assignee: accounts.masonClay,
        notes: "The bedrock: slash command, type in cells, render inside lists, blockquotes, and callouts.",
        priority: "High",
        status: "Closed",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Add/remove rows",
        parent: projectTask,
        assignee: accounts.masonClay,
        notes: "Rows are in and covered by the basic table editing path.",
        priority: "Medium",
        status: "Closed",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Add/remove columns",
        parent: projectTask,
        assignee: accounts.masonClay,
        notes: "Every row updates together through a small table helper.",
        priority: "Medium",
        status: "Closed",
    });

    const columnResizeTask = await TestTask.create(accounts.cassCade, {
        title: "Column resizing: snap default, alt keydown for smooth",
        parent: projectTask,
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        collections: [collections.sprintOct6],
        notes: "Snap to a 12-column grid by default, hold Alt while dragging for continuous resize.",
        priority: "High",
    });

    {
        await TestTask.create(accounts.cassCade, {
            title: "Snap math + grid",
            parent: columnResizeTask,
            status: "Closed",
        });

        await TestTask.create(accounts.cassCade, {
            title: "Alt smooth drag",
            parent: columnResizeTask,
            status: "Closed",
        });

        await TestTask.create(accounts.cassCade, {
            title: "Visual snap indicator",
            parent: columnResizeTask,
        });
    }

    await TestTask.create(accounts.cassCade, {
        title: "Help doc visual review",
        parent: projectTask,
        assignee: accounts.mattRHorn,
        assigneeStatus: "Active",
        notes: "Holly’s draft is in good shape. Make sure screenshots match the final UI and the snap-to-grid language stays practical.",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Design review of v1 prototype",
        parent: projectTask,
        assignee: accounts.mattRHorn,
        notes: "Review done. Notes filed against the open Mason tasks above.",
        status: "Closed",
    });

    const featuredProjectTask = await TestTask.create(accounts.cassCade, {
        // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
        // makes sure the reaction party on any messages is stable across renders.
        id: unsafelyGenerateStableId<TaskId>(stableRandom, "featuredProjectTask"),
        title: "Keyboard navigation between cells",
        parent: projectTask,
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        collections: [collections.sprintOct6],
        priority: "High",
        notes: markdown`
The obvious arrow key navigation model breaks once cells can have multiple lines: should up/down in
a cell move within the paragraph or should it move between cells?
        `,
    });

    {
        await TestTask.create(accounts.cassCade, {
            title: "Tab / shift+tab through cells",
            parent: featuredProjectTask,
            status: "Closed",
        });

        const arrowKeysTask = await TestTask.create(accounts.cassCade, {
            title: "Arrow keys",
            parent: featuredProjectTask,
        });

        await TestTask.create(accounts.cassCade, {
            title: "Left / Right within a cell",
            parent: arrowKeysTask,
            status: "Closed",
        });

        await TestTask.create(accounts.cassCade, {
            title: "Left / Right cross the cell boundary at line edge",
            parent: arrowKeysTask,
            status: "Closed",
        });

        await TestTask.create(accounts.cassCade, {
            title: "Up / Down within a cell - track the visual line",
            parent: arrowKeysTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "Up / Down cross the cell boundary at top / bottom edge",
            parent: arrowKeysTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "Shift+Arrow extends cell selection once at a boundary",
            parent: arrowKeysTask,
        });

        const enterTask = await TestTask.create(accounts.cassCade, {
            title: "Enter",
            parent: featuredProjectTask,
        });

        await TestTask.create(accounts.cassCade, {
            title: "Inside a cell - newline inside the cell, no row change",
            parent: enterTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "On the last cell - exits the table into the next block",
            parent: enterTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "Escape collapses cell selection back to document selection",
            parent: featuredProjectTask,
        });
    }

    const toolbarTask = await TestTask.create(accounts.cassCade, {
        title: "Toolbar: anchor to row above the table",
        parent: projectTask,
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        notes: markdown`
Going with Matt’s anchor model. The table toolbar takes priority whenever a cell selection is active
so it no longer fights the floating format menu.
        `,
        priority: "Low",
    });

    {
        await TestTask.create(accounts.cassCade, {
            title: "Hide the floating menu while a cell selection is active",
            parent: toolbarTask,
            assignee: accounts.masonClay,
        });

        await TestTask.create(accounts.cassCade, {
            title: "Edge case: table at the very top of the doc",
            parent: toolbarTask,
            assignee: accounts.masonClay,
        });
    }

    await TestTask.create(accounts.cassCade, {
        title: "Paste from spreadsheet content",
        parent: projectTask,
        assignee: accounts.masonClay,
        notes: "Excel, Google Sheets, and Numbers all paste different HTML. Normalize before measuring the 200-row case.",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Nested content inside cells",
        parent: projectTask,
        assignee: accounts.masonClay,
        notes: "Bullets, numbered lists, and code blocks need the same block handling path with a different parent.",
        priority: "Medium",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Final design walkthrough",
        parent: projectTask,
        assignee: accounts.mattRHorn,
        collections: [collections.sprintOct6],
        notes: "Sit with Mason and click through every boring state: empty, single-row, single-column, and too wide.",
        priority: "High",
    });

    await featuredProjectTask.createComment(
        accounts.masonClay,
        Mustache.render(
            markdown`
{{mattMention}} tab is solid now and left/right finally feels normal at cell boundaries. up/down is
the last tricky part because document position and visual line are not the same thing once a cell
wraps
            `,
            {
                mattMention: `[](https://alpine.inc/s/${accounts.masonClay.space.id}/accounts/${accounts.mattRHorn.account.id}?mention=short)`,
            },
        ),
        {overrideCreatedTime: new Date("2025-10-06T14:18:00-04:00")},
    );

    const comment2 = await featuredProjectTask.createComment(
        accounts.mattRHorn,
        markdown`
The important bit is that movement feels spatial. If the caret is on the visual top line, Up should
leave the cell otherwise it should stay inside the cell. That distinction is what makes the table
feel like a table instead of a paragraph with borders.
        `,
        {overrideCreatedTime: new Date("2025-10-06T14:42:00-04:00")},
    );
    await comment2.setReaction(accounts.masonClay, "Yes");

    return {projectTask, featuredProjectTask};
}

async function createSprintTasksAndBugTasks(
    accounts: DemoSpaceAccounts,
    collections: Awaited<ReturnType<typeof createTaskCollections>>,
) {
    const sprint = collections.sprintOct6;
    const bugs = collections.bugs;

    await TestTask.create(accounts.cassCade, {
        title: "Delete-row keyboard shortcut conflicts with delete-line in surrounding doc",
        assignee: accounts.masonClay,
        collections: bugs,
        priority: "High",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Undo after image upload removes the wrong block",
        collections: bugs,
        priority: "High",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Review notes from sprint retro",
        assignee: accounts.cassCade,
        collections: [sprint],
        dueDate: new CalendarDate(2025, 10, 17),
        priority: "Medium",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Figure out reproduction for chat message wrong ordering bug",
        assignee: accounts.cassCade,
        collections: [sprint],
        status: "Closed",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Phase 2 of realtime reliability work rollout",
        assignee: accounts.elleKappaTan,
        collections: [sprint, collections.realtimeReliability],
        dueDate: new CalendarDate(2025, 10, 8),
        priority: "High",
        status: "Closed",
    });

    const chatOrderingTask = await TestTask.create(accounts.cassCade, {
        title: "Chat messages out of order in busy rooms",
        assignee: accounts.elleKappaTan,
        assigneeStatus: "Active",
        collections: [collections.realtimeReliability, sprint, bugs],
        priority: "High",
    });

    {
        await TestTask.create(accounts.cassCade, {
            title: "reproduce locally",
            parent: chatOrderingTask,
            status: "Closed",
        });

        await TestTask.create(accounts.cassCade, {
            title: "confirm bus vs client merge - it is the client",
            parent: chatOrderingTask,
            status: "Closed",
        });

        await TestTask.create(accounts.cassCade, {
            title: "patch",
            parent: chatOrderingTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "backfill a regression test",
            parent: chatOrderingTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "mention in the realtime forum update",
            parent: chatOrderingTask,
        });
    }

    await TestTask.create(accounts.cassCade, {
        title: "SSO scoping doc",
        assignee: accounts.elleKappaTan,
        collections: [sprint, collections.enterpriseSso],
        dueDate: new CalendarDate(2025, 10, 17),
        priority: "High",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Document title doesn’t sync via realtime",
        assignee: accounts.elleKappaTan,
        collections: [sprint, bugs, collections.realtimeReliability],
        priority: "Medium",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Column resize handle is hard to grab on retina displays",
        assignee: accounts.masonClay,
        collections: bugs,
        priority: "Medium",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Cursor jumps when toggling between two open documents quickly",
        assignee: null,
        collections: bugs,
        priority: "Medium",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Search returns nothing when the query is only emoji",
        assignee: null,
        collections: bugs,
        priority: "Low",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Typing indicator shows wrong avatar in groups of 4+",
        assignee: null,
        collections: bugs,
        priority: "Low",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Reconnect storm after wake from sleep",
        assignee: accounts.elleKappaTan,
        collections: [sprint, bugs, collections.realtimeReliability],
        priority: "High",
        status: "Closed",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Cursor jumps to start of line when toggling bold mid-word",
        assignee: accounts.masonClay,
        collections: [sprint, bugs],
        priority: "High",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Search results do not refresh after a space is renamed",
        collections: bugs,
        priority: "Medium",
    });
    await TestTask.create(accounts.cassCade, {
        title: "Drag to reorder a task breaks if you drag over the scrollbar",
        collections: bugs,
        priority: "Low",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Slash menu opens on every keystroke after backslash",
        assignee: accounts.masonClay,
        collections: [sprint, bugs],
        priority: "Low",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Image gallery sketches",
        assignee: accounts.mattRHorn,
        assigneeStatus: "Active",
        collections: [sprint, collections.design, collections.editorAudit],
        priority: "Medium",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Reply box loses draft when switching browser tabs",
        collections: bugs,
        priority: "Medium",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Phantom selection account names in doc overlap when names are long",
        assignee: accounts.mattRHorn,
        collections: [sprint, collections.design, bugs],
        priority: "Low",
    });

    await TestTask.create(accounts.cassCade, {
        title: "Inbox unread count off by one after mark all read",
        assignee: accounts.masonClay,
        collections: [sprint, bugs],
        priority: "Medium",
    });

    const editorAuditTask = await TestTask.create(accounts.cassCade, {
        title: "Editor interaction audit",
        assignee: accounts.mattRHorn,
        collections: [sprint, collections.editorAudit, collections.design],
        priority: "Medium",
        status: "Closed",
    });

    {
        await TestTask.create(accounts.cassCade, {
            title: "Test 1",
            status: "Closed",
            parent: editorAuditTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "Test 2",
            status: "Closed",
            parent: editorAuditTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "Test 3",
            status: "Closed",
            parent: editorAuditTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "Test 4",
            status: "Closed",
            parent: editorAuditTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "Test 5",
            status: "Closed",
            parent: editorAuditTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "Test 6",
            status: "Closed",
            parent: editorAuditTask,
        });
        await TestTask.create(accounts.cassCade, {
            title: "Test 7",
            status: "Closed",
            parent: editorAuditTask,
        });
    }

    await TestTask.create(accounts.cassCade, {
        title: "Keyboard navigation skips merged cells",
        collections: bugs,
        priority: "Medium",
    });
}
