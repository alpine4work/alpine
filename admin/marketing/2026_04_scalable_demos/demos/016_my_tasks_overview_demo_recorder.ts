import {today} from "@internationalized/date";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const timeZone = getCurrentTimeZone();
    const todayDate = today(timeZone);
    const daysFromToday = (days: number) =>
        days >= 0 ? todayDate.add({days}) : todayDate.subtract({days: -days});

    // ── Overdue ────────────────────────────────────────────────────────── Lives in
    // the Overdue section because it has a due date in the past and Cass has not
    // marked it Active yet. This is the task Cass closes in step 2 of the recording.

    const overdueInputReminder = await TestTask.create(accounts.cassCade, {
        title: "Send Q4 planning input deadline reminder",
        assignee: accounts.cassCade,
        priority: "Medium",
        dueDate: daysFromToday(-1),
    });

    // ── Active (in-progress) ───────────────────────────────────────────── A single
    // task Cass is currently driving. Shows at the top of the view under the "Active"
    // header regardless of due date.

    const q3SurveySynthesis = await TestTask.create(accounts.cassCade, {
        title: "Compile Q3 survey findings into Q4 planning doc",
        assignee: accounts.cassCade,
        priority: "High",
        dueDate: daysFromToday(2),
    });
    await q3SurveySynthesis.updateAssigneeStatus(accounts.cassCade, "Active");

    // ── Due today ────────────────────────────────────────────────────────

    const sprintCheckin = await TestTask.create(accounts.cassCade, {
        title: "Sprint check-in: tables column resizing",
        assignee: accounts.cassCade,
        priority: "Medium",
        dueDate: todayDate,
    });

    const oneOnOneWithRose = await TestTask.create(accounts.cassCade, {
        title: "1:1 with Rose",
        assignee: accounts.cassCade,
        priority: "Medium",
        dueDate: todayDate,
    });

    // ── Due soon (this week → three weeks out) ───────────────────────────

    const [
        onePagerReview,
        hiringDebrief,
        tablesShipDateCheck,
        q4PlanningSynthesis,
        offsiteScheduling,
        q4PlanningFinalReview,
    ] = await runAllPromises([
        TestTask.create(accounts.cassCade, {
            title: "Review Holly’s sales one-pager edits",
            assignee: accounts.cassCade,
            priority: "Medium",
            dueDate: daysFromToday(3),
        }),
        TestTask.create(accounts.cassCade, {
            title: "Hiring debrief notes: senior backend candidate",
            assignee: accounts.cassCade,
            priority: "High",
            dueDate: daysFromToday(5),
        }),
        TestTask.create(accounts.cassCade, {
            title: "Confirm tables ship date with Matt",
            assignee: accounts.cassCade,
            priority: "Medium",
            dueDate: daysFromToday(7),
        }),
        TestTask.create(accounts.cassCade, {
            title: "Q4 planning doc: synthesize team inputs",
            assignee: accounts.cassCade,
            priority: "High",
            dueDate: daysFromToday(14),
        }),
        TestTask.create(accounts.cassCade, {
            title: "Schedule team offsite for late October",
            assignee: accounts.cassCade,
            priority: "Low",
            dueDate: daysFromToday(14),
        }),
        TestTask.create(accounts.cassCade, {
            title: "Q4 planning final review with Rose",
            assignee: accounts.cassCade,
            priority: "Medium",
            dueDate: daysFromToday(21),
        }),
    ]);

    // ── Remaining (no due date) ────────────────────────────────────────── The
    // starred High-priority item with no due date is the task Cass surfaces in step 4
    // after filtering by priority and then marks Active.

    const ssoScopingNextSteps = await TestTask.create(accounts.cassCade, {
        title: "SSO scoping next steps with Elle",
        assignee: accounts.cassCade,
        priority: "High",
    });

    const notificationControlsInput = await TestTask.create(accounts.cassCade, {
        title: "Notification controls: gather Q4 input",
        assignee: accounts.cassCade,
        priority: "Medium",
    });

    const caseStudyTwoTimeline = await TestTask.create(accounts.cassCade, {
        title: "Plan customer case study #2 timeline with Holly",
        assignee: accounts.cassCade,
        priority: "Low",
    });

    // ── Closed (for visual texture in the Closed section) ────────────────

    const reliabilityShipAnnouncement = await TestTask.create(accounts.cassCade, {
        title: "Draft announcement for Elle’s realtime reliability ship",
        assignee: accounts.cassCade,
        priority: "Medium",
        dueDate: daysFromToday(-4),
    });
    await reliabilityShipAnnouncement.updateStatus(accounts.cassCade, "Closed");

    const onePagerApproval = await TestTask.create(accounts.cassCade, {
        title: "Approve updated sales one-pager",
        assignee: accounts.cassCade,
        priority: "Low",
        dueDate: daysFromToday(-3),
    });
    await onePagerApproval.updateStatus(accounts.cassCade, "Closed");

    // Silence unused-binding warnings — these tasks populate the view via their side
    // effects (created + assigned to Cass).
    void sprintCheckin;
    void oneOnOneWithRose;
    void onePagerReview;
    void hiringDebrief;
    void tablesShipDateCheck;
    void q4PlanningSynthesis;
    void offsiteScheduling;
    void q4PlanningFinalReview;
    void ssoScopingNextSteps;
    void notificationControlsInput;
    void caseStudyTwoTimeline;
    void overdueInputReminder;

    await recorder.record({
        instructions: markdown`
Cass starts her day in “My tasks.” It’s the single page where she sees what’s active, what’s
overdue, what’s due today, and what’s coming up across everything assigned to her. The demo shows
three quick beats: closing yesterday’s overdue task, filtering by priority to surface 2 unscheduled
High-priority items – one of which is bumped to Active while the other is scheduled for the end of
the week.

1. Expand the Chrome window so the corner radiuses aren’t in the recording frame.

2. Start recording on the “My tasks” page. Scroll slowly once from the top through “Overdue,” “Due
   today,” “Due soon,” and “Remaining” so the shape of the day is visible, then scroll back up.

3. **Close the overdue task.** In the “Overdue” section, click the status circle on “Send Q4
   planning input deadline reminder” to close it. The section should collapse away or update so the
   list tightens up.

4. **Filter by High priority.** Open the filter/sort menu at the top of the view, add a priority
   filter, and select “High.” The list should now show only High-priority items across sections.

5. **Find “SSO scoping next steps with Elle”** in the “Remaining” section (no due date). Click the
   status circle / Active toggle to mark it Active. It should animate up into the “Active” section
   at the top of the view.

6. **Find “Notification controls: gather Q4 input”** in the “Remaining” section (no due date). Click
   the date picker and set the due date to the end of the week.

7. Clear the priority filter so the list looks tidy as the recording ends, and leave the mouse near
   the “Active” section header so the loop point is clean.
        `,
        session: accounts.cassCade,
        path: `/s/${space.id}/tasks`,
        viewport: scalableDemoWideViewport,
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
            await page.evaluate("dev.taskFloatingCreateButton.toggleVisibility()");
        },
    });
});
