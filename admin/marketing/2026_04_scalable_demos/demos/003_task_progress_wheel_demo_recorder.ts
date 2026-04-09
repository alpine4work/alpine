import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoNarrowViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_narrow_viewport_width.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const space = await TestSpace.create(context, {name: "Alpine"});
    const session = await space.createSession();

    const parentTask = await TestTask.create(session, {title: "Parent"});

    const tasks = await runAllPromises([
        TestTask.create(session, {parent: parentTask, title: "Ad campaign creative"}),
        TestTask.create(session, {parent: parentTask, title: "Website redesign"}),
        TestTask.create(session, {parent: parentTask, title: "Onboarding email sequence"}),
        TestTask.create(session, {parent: parentTask, title: "Book activation event venue"}),
        TestTask.create(session, {parent: parentTask, title: "New swag designs"}),
        TestTask.create(session, {parent: parentTask, title: "Run website headline experiment"}),
    ]);

    const childTasks = await runAllPromises([
        TestTask.create(session, {parent: tasks[1], title: "Come up with visual identity"}),
        TestTask.create(session, {parent: tasks[1], title: "Take product shots"}),
        TestTask.create(session, {parent: tasks[1], title: "Write new copy"}),
        TestTask.create(session, {parent: tasks[1], title: "Executive review"}),
        TestTask.create(session, {parent: tasks[1], title: "Vibe code new design"}),
    ]);

    await childTasks[0].updateStatus(session, "Closed");

    const grandChildTasks = await runAllPromises([
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 1"}),
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 2"}),
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 3"}),
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 4"}),
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 5"}),
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 6"}),
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 7"}),
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 8"}),
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 9"}),
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 10"}),
        TestTask.create(session, {parent: childTasks[1], title: "Grand child task 11"}),
    ]);

    await runAllPromises(
        grandChildTasks
            .slice(0, 4)
            .map(grandChildTask => grandChildTask.updateStatus(session, "Closed")),
    );

    await runAllPromises([
        TestTask.create(session, {parent: tasks[2]}),
        TestTask.create(session, {parent: tasks[2]}),
        TestTask.create(session, {parent: tasks[4]}),
        TestTask.create(session, {parent: tasks[4]}),
        TestTask.create(session, {parent: tasks[4]}),
        TestTask.create(session, {parent: tasks[4]}),
    ]);

    await recorder.record({
        instructions: markdown`
1. Scroll so all child tasks are on screen and just below the navigation bar.

2. Click the expand button to show child tasks.

3. Close the \u201CWrite new copy\u201D child task.

4. Use your mouse to gently circle the task progress wheel to highlight that it changed.

5. Open/close the \u201CWrite new copy\u201D child task again one or two more times.

6. Click the expand button to hide child tasks.
        `,
        session,
        path: `/s/${space.id}/tasks/${parentTask.id}`,
        viewport: {width: scalableDemoNarrowViewportWidth, height: scalableDemoNarrowViewportWidth},
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
    });
});
