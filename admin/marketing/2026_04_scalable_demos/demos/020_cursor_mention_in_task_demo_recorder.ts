import {createDemoMockCursorBot} from "~/admin/environment/demo_space/create_demo_mock_bots.js";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {createMockAgentRecording} from "~/admin/environment/demo_space/create_mock_agent_recording.js";
import {putMockAgentRecording} from "~/admin/environment/demo_space/put_mock_agent_recording.js";
import {createDemoCursor} from "~/admin/marketing/2026_04_scalable_demos/helpers/demo_cursor.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    // Instantiate the Cursor bot into the space. Pass `services` so the bot gets a
    // webhook URL pointing at the local agent service mock endpoint — required for
    // `putMockAgentRecording` to work.
    const {cursor} = await createDemoMockCursorBot(
        accounts.roseCompas,
        services.getAppServiceTokenAgent(),
        services,
    );

    // ── Bug collection ─────────────────────────────────────────────────────────────
    const bugsCollection = await TestTaskCollection.create(accounts.elleKappaTan, {
        name: "🪲 Bugs",
        access: "Public",
    });

    // ── Focus task: "Due date shows wrong day" ─────────────────────────────────────
    // This is the task Elle will delegate to @Cursor. Holly left a comment after
    // hearing from a customer.
    const dueDateTask = await TestTask.create(accounts.elleKappaTan, {
        title: "Due date shows wrong day",
        collections: [bugsCollection],
        priority: "High",
        notes: markdown`
### Steps to reproduce

1. Create a task and set a due date
2. Mark the task complete, then uncomplete it.
3. View the task as a user whose local timezone is in Australian Western Central Time.

### Expected

Due date shows the correct calendar day.

### Actual

Due date appears one day earlier than expected.
        `,
    });

    await dueDateTask.createComment(
        accounts.hollyEvergreen,
        "Just got a customer report on this one \u2014 they\u2019re seeing the wrong day on due dates across their whole board. Might be a timezone offset issue.",
    );

    // Pre-register Cursor's reply so it's ready to stream the moment the webhook
    // fires. Holly's comment is index 0; Elle's @Cursor comment (sent from the
    // browser) is index 1.
    await putMockAgentRecording(
        "cursor",
        cursor,
        `/tasks/${dueDateTask.id}`,
        createMockAgentRecording(
            [
                2000,
                "## Incorrect Due Date Display\n\nStarted coding. I\u2019ll let you know when I\u2019m done [(watch me work)](http://localhost:3000).",
            ],
            {waitMillisecondsBetweenTokens: 15},
        ),
    );

    // ── Remaining bugs ─────────────────────────────────────────────────────────────
    await runAllPromises([
        TestTask.create(accounts.elleKappaTan, {
            title: "Closed task still shows overdue badge",
            collections: [bugsCollection],
            priority: "Medium",
        }),
        TestTask.create(accounts.elleKappaTan, {
            title: "Notification count stuck after mark-all-read",
            collections: [bugsCollection],
            priority: "Medium",
        }),
        TestTask.create(accounts.elleKappaTan, {
            title: "Presence indicator stays active after tab close",
            collections: [bugsCollection],
            priority: "Low",
        }),
        TestTask.create(accounts.elleKappaTan, {
            title: "Reconnection banner flashes briefly on page load",
            collections: [bugsCollection],
            priority: "Low",
        }),
        TestTask.create(accounts.elleKappaTan, {
            title: "Forum post reaction count stale until refresh",
            collections: [bugsCollection],
            priority: "Low",
        }),
        TestTask.create(accounts.elleKappaTan, {
            title: "Floating toolbar repositions incorrectly near top of document",
            collections: [bugsCollection],
            priority: "Medium",
        }),
        TestTask.create(accounts.elleKappaTan, {
            title: "Tasks due on Mondays are automatically reprioritized to \u201CLow\u201D",
            collections: [bugsCollection],
            priority: "Medium",
        }),
    ]);

    await recorder.record({
        instructions: markdown`
# Demo: @mentioning Cursor in a task comment

Elle has a collection of open bugs. One of them \u2014 \u201CDue date shows wrong day\u201D \u2014
just came in from a customer via Holly. The recording is fully automated: it opens the task peek,
shows the bug notes and Holly\u2019s comment, then types \u201C@Cursor take a look at this?\u201D
and sends it.

1. Expand the Chrome window so corner radiuses aren\u2019t in the recording frame.

2. Start recording, then press Enter in this terminal to begin the automated actions.
        `,
        session: accounts.elleKappaTan,
        path: `/task-collection/${bugsCollection.id}`,
        viewport: {width: scalableDemoWideViewportWidth},
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
            await page.evaluate("dev.taskFloatingCreateButton.toggleVisibility()");
        },
        actions: [
            async page => {
                const cursor = await createDemoCursor(page);

                // Start with the cursor parked near the bottom-left, out of the way of the task
                // list so the initial pause feels natural.
                await cursor.jumpTo(120, 500);

                // Pause so the viewer can take in the bug list.
                await wait(2000);

                // Move to the task row to reveal the hover state, then click "Open".
                const taskRow = page.getByTestId(`TaskRowView:${dueDateTask.id}`);
                await cursor.clickElement(taskRow.getByRole("button", {name: "Open"}).first());

                // Wait for the peek to open and the comments to load.
                const taskMainView = page.getByTestId("TaskDetailViewMain");
                await taskMainView.waitFor({state: "visible"});

                await wait(500);

                await cursor.moveToElement(taskMainView);

                await wait(500);

                // Animate the scroll manually via requestAnimationFrame so we get a smooth
                // ease-in-out curve. commentInput.evaluate passes the element handle directly into
                // the browser context, so page.evaluate returns when the Promise resolves, i.e.
                // when the animation finishes.
                const commentInput = page.getByLabel("New comment");
                await commentInput.evaluate(input => {
                    // Walk up the DOM to find the nearest scrollable ancestor.
                    let scrollable: HTMLElement | null = input.parentElement;
                    while (scrollable) {
                        const {overflow, overflowY} = getComputedStyle(scrollable);
                        if (
                            /(auto|scroll)/.test(overflow + overflowY) &&
                            scrollable.scrollHeight > scrollable.clientHeight
                        ) {
                            break;
                        }
                        scrollable = scrollable.parentElement;
                    }
                    if (!scrollable) return;

                    const inputRect = input.getBoundingClientRect();
                    const containerRect = scrollable.getBoundingClientRect();
                    const targetScrollTop =
                        scrollable.scrollTop +
                        inputRect.top -
                        containerRect.top -
                        scrollable.clientHeight / 2 +
                        inputRect.height / 2;

                    const startScrollTop = scrollable.scrollTop;
                    const distance = targetScrollTop - startScrollTop;
                    const duration = 700;
                    const s = scrollable;

                    return new Promise<void>(resolve => {
                        const startTime = performance.now();
                        function step(now: number) {
                            const t = Math.min((now - startTime) / duration, 1);
                            // Ease-in-out curve.
                            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                            s.scrollTop = startScrollTop + distance * eased;
                            if (t < 1) requestAnimationFrame(step);
                            else resolve();
                        }
                        requestAnimationFrame(step);
                    });
                });

                // Animate the cursor to the comment input and click to focus it.
                await cursor.clickElement(commentInput, undefined, {xOffset: 80, yOffset: 10});

                // Type @Cursor and wait for the mention picker to surface it.
                await page.keyboard.type("@Cursor", {delay: 60});
                await wait(500);

                // Select Cursor from the mention picker.
                await page.keyboard.press("Enter");

                // Complete the message and send.
                await page.keyboard.type(" investigate and propose a fix", {delay: 40});
                await wait(300);
                await page.keyboard.press("Enter");

                // Brief pause so the sent comment renders before Cursor starts responding. The app
                // fires the webhook automatically when it detects the @Cursor mention, which
                // triggers the pre-recorded reply to stream.
                await wait(800);

                // Hold until Cursor's reply has finished streaming.
                await wait(4000);
            },
        ],
    });
});
