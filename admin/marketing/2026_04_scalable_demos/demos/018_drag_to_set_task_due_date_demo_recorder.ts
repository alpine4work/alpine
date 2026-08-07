import {today} from "@internationalized/date";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const timeZone = getCurrentTimeZone();
    const todayDate = today(timeZone);
    const daysFromToday = (days: number) =>
        days >= 0 ? todayDate.add({days}) : todayDate.subtract({days: -days});

    // ── Active (in-progress) ───────────────────────────────────────────── A single
    // task Cass is currently driving so the "Active" header at the top of the view
    // isn't empty when the demo opens.

    const q3SurveySynthesis = await TestTask.create(accounts.cassCade, {
        title: "Compile Q3 survey findings into Q4 planning doc",
        assignee: accounts.cassCade,
        priority: "High",
        dueDate: daysFromToday(2),
    });
    await q3SurveySynthesis.updateAssigneeStatus(accounts.cassCade, "Active");

    // ── Due today ──────────────────────────────────────────────────────── Two
    // already-scheduled tasks under "Due today." Important: this section is also where
    // Cass uses the inline "+" to create a new task in step 5 — it needs at least one
    // existing item so the section header is visible from the start.

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

    // ── Due soon (this week → three weeks out) ─────────────────────────── These give
    // the "Due soon" section visible shape, so when Cass drags a task into it in step
    // 3 there's a real list landing under a real header.

    const [
        onePagerReview,
        hiringDebrief,
        tablesShipDateCheck,
        q4PlanningSynthesis,
        offsiteScheduling,
    ] = await runAllPromises([
        TestTask.create(accounts.cassCade, {
            title: "Review Holly\u2019s sales one-pager edits",
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
    ]);

    // ── Remaining (no due date) ────────────────────────────────────────── "SSO
    // scoping next steps with Elle" is the task Cass drags out of Remaining and into
    // "Due soon" in step 3 — its due date gets set automatically from the section it
    // lands in. The other two are filler so Remaining doesn't look one-line.

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

    // Silence unused-binding warnings — these tasks populate the view via their side
    // effects (created + assigned to Cass).
    void sprintCheckin;
    void oneOnOneWithRose;
    void onePagerReview;
    void hiringDebrief;
    void tablesShipDateCheck;
    void q4PlanningSynthesis;
    void offsiteScheduling;
    void ssoScopingNextSteps;
    void notificationControlsInput;
    void caseStudyTwoTimeline;

    await recorder.record({
        instructions: markdown`
Cass is in \u201CMy tasks.\u201D Setting a due date in Alpine doesn\u2019t have to mean opening a
date picker — she can drop a task into a relative-date section and it lands with that date, or
create a task straight inside a section so it\u2019s authored with the due date already attached.
Two beats: one drag, one inline create.

1. Expand the Chrome window so the corner radiuses aren\u2019t in the recording frame.

2. Start recording on the \u201CMy tasks\u201D page. Pause for a beat at the top so the
   relative-date section headers — \u201CActive,\u201D \u201CDue today,\u201D \u201CDue soon,\u201D
   \u201CRemaining\u201D — are visible. Scroll slowly down through the sections once so the viewer
   reads the shape of the day, then scroll back to the top.

3. **Drag a task into a relative-date section.** Scroll to the \u201CRemaining\u201D section. Click
   and hold on \u201CSSO scoping next steps with Elle,\u201D drag it up, and drop it inside the
   \u201CDue soon\u201D section (this week). The task should appear in \u201CDue soon\u201D with its
   due date set automatically — no date picker opened.

4. Pause for a beat so the viewer registers that the dragged task now sits under \u201CDue
   soon\u201D with a real relative date attached. Scroll back up so the top sections are visible
   again.

5. **Create a task directly inside a relative-date section.** Hover over the \u201CDue today\u201D
   section header so the inline \u201C+\u201D appears at the top of the section. Click it. Type
   \u201CBlock focus time for Q4 plan review\u201D and press Enter. The new task is created already
   due today — again, no date picker.

6. Pause for a beat so both new states are visible (the dragged task in \u201CDue soon,\u201D the
   inline task in \u201CDue today\u201D). Park the mouse near the top of the view so the loop point
   is clean.
        `,
        session: accounts.cassCade,
        path: `/my-tasks/${space.id}`,
        viewport: scalableDemoWideViewport,
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
            await page.evaluate("dev.taskFloatingCreateButton.toggleVisibility()");
        },
    });
});
