import {CalendarDate} from "@internationalized/date";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {scrollLocatorToBottom} from "~/app/screenshot_tests/helpers/scroll_locator_to_bottom.js";
import {
    refreshTaskCollectionIndexForTest,
    refreshTaskIndexForTest,
} from "~/server/tasks/data/task_index.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";

// Wednesday morning of week 5, the sprint where the tables feature gets its final
// walkthrough. All activity and comments below are backdated relative to this time
// so the feed's relative timestamps render deterministically.
const activityScreenshotTime = new Date("2025-10-08T13:00:00Z");

function getTaskActivityScreenshotActionOptions(date: Date) {
    return {time: [date.getTime(), 0] as const, overrideCommittedTimeForTest: date};
}

export async function runTaskActivityFeedScreenshots(
    context: TestActualContext,
    runner: ScreenshotTestRunner,
    accounts: DemoSpaceAccounts,
) {
    async function waitForTaskIndex() {
        await runner.drainBackgroundWork();

        await runAllPromises([
            refreshTaskIndexForTest(context),
            refreshTaskCollectionIndexForTest(context),
        ]);
    }

    const bugs = await TestTaskCollection.create(accounts.cassCade, {
        name: "Bugs",
        access: "Public",
        color: "red",
    });

    // A bug from the tables project with a realistic lifecycle. The feed renders
    // interwoven with the comments, sorted by time, and demonstrates read-time
    // aggregation: Mason's two consecutive due date changes render as one item and
    // actor changes split items. Each row carries a compact relative date ("2d")
    // measured against the fixed screenshot time.
    const task = await TestTask.create(accounts.masonClay, {
        id: unsafelyGenerateStableId<TaskId>(runner.stableRandom, "taskActivityFeedTask"),
        title: "Merged cell borders double up when tables nest",
        collections: bugs,
        ...getTaskActivityScreenshotActionOptions(new Date("2025-10-03T15:12:00-05:00")),
    });

    // Mason schedules the fix, then nudges the date after checking the sprint plan.
    // Same actor, same field, back to back: one feed item.
    await task.updateDueDate(
        accounts.masonClay,
        new CalendarDate(2025, 10, 9),
        getTaskActivityScreenshotActionOptions(new Date("2025-10-06T10:05:00-05:00")),
    );
    await task.updateDueDate(
        accounts.masonClay,
        new CalendarDate(2025, 10, 10),
        getTaskActivityScreenshotActionOptions(new Date("2025-10-06T10:06:00-05:00")),
    );
    await task.updatePriority(
        accounts.masonClay,
        "High",
        getTaskActivityScreenshotActionOptions(new Date("2025-10-06T10:07:00-05:00")),
    );

    // Cass flags the bug for the walkthrough and triages it onto Mason's plate. The
    // assignment lands after her comment, starting a new run.
    await task.createComment(
        accounts.cassCade,
        markdown`
Can you get to this one before the walkthrough Thursday? Matt\u2019s audit doc has a repro table
that hits it every time.
        `,
        {overrideCreatedTime: new Date("2025-10-06T12:30:00-04:00")},
    );
    await task.updateAssignee(
        accounts.cassCade,
        accounts.masonClay,
        getTaskActivityScreenshotActionOptions(new Date("2025-10-06T12:31:00-04:00")),
    );

    // Mason ships a fix and closes the task.
    await task.updateStatus(
        accounts.masonClay,
        "Closed",
        getTaskActivityScreenshotActionOptions(new Date("2025-10-07T16:45:00-05:00")),
    );

    // Matt catches the regression the next morning. Different actor: his reopen
    // renders as its own item instead of collapsing into Mason's close.
    await task.createComment(
        accounts.mattRHorn,
        markdown`
Reopening — merged cells inside the inner table bring the double border back. A table border should
read like one ruled line; the moment it doubles it stops reading as structure and starts reading as
a rendering bug.
        `,
        {overrideCreatedTime: new Date("2025-10-08T08:15:00-04:00")},
    );
    await task.updateStatus(
        accounts.mattRHorn,
        "Open",
        getTaskActivityScreenshotActionOptions(new Date("2025-10-08T08:16:00-04:00")),
    );

    // Mason digs in the same morning: two comments a minute apart with notes +
    // assignee updates between them. Without the activity break those comments would
    // merge; the intervening run keeps the second comment's name/face visible.
    await task.createComment(
        accounts.masonClay,
        markdown`
Looking at the nested merge path now. Pretty sure the outer table\u2019s border style is winning
over the inner one when cells merge.
        `,
        {overrideCreatedTime: new Date("2025-10-08T10:00:00-04:00")},
    );
    await task.typeNotes(
        accounts.masonClay,
        "Repro: nest a 2×2 table inside another table cell, then toggle merged cells on the outer table.",
        {overrideUpdatedTimeForTest: new Date("2025-10-08T10:00:30-04:00")},
    );
    await task.updateAssignee(
        accounts.masonClay,
        accounts.cassCade,
        // A few seconds after the notes write so the two activity rows stay in a stable
        // order when the wall-clock times would otherwise collide.
        getTaskActivityScreenshotActionOptions(new Date("2025-10-08T10:00:45-04:00")),
    );
    await task.createComment(
        accounts.masonClay,
        markdown`
Repro\u2019s on my branch if you want to poke. Putting Cass on this so it\u2019s on the walkthrough
checklist.
        `,
        {overrideCreatedTime: new Date("2025-10-08T10:01:00-04:00")},
    );

    await waitForTaskIndex();

    await runner.goto(accounts.cassCade, `/task/${task.id}`, {
        fixedTime: activityScreenshotTime,
    });
    // The initial title window folds into the creation item, so no "renamed the task"
    // row appears despite the title written at creation.
    await runner.getByText("reopened the task").waitFor();
    await runner.getByText("updated the notes").waitFor();
    // Cass assigned earlier too, so pin Mason's later assignment specifically.
    await runner.getByText("Mason assigned the task to").waitFor();
    // Second Mason comment must keep its author chrome (activity split the merge).
    // MessageView renders the full account name rather than the short activity-row
    // name.
    const secondMasonComment = runner.getByTestId(`MessageView:${task.id}:3`);
    await secondMasonComment.getByText("Mason Clay", {exact: true}).waitFor();
    await secondMasonComment.getByText("Putting Cass on this").waitFor();
    // The interwoven feed lives below the task fields; scroll so the conversation is
    // what's captured.
    await scrollLocatorToBottom(runner.getByTestId("TaskDetailScrollView"));
    await runner.screenshot("c000", "task-activity-feed");

    // The column resizing debate: a long comment thread exercising the feed's
    // range-query rendering around unloaded comment gaps.
    //
    // Activity only renders where both surrounding comment times are known. Two
    // captures pin the two sides of that rule:
    //
    // - `c001` deep-links to Cass's decision comment near the end of the thread (the
    //   jump loads a window around it): the activity between it and its loaded
    //   neighbors renders above/below it as usual.
    // - `c002` opens the thread from the top with the network paused after the first
    //   page: the rest of the thread stays an unloaded shimmer gap, and the activity
    //   inside the gap and after the last comment renders NOWHERE. (The old interleave
    //   rendered all of it squashed above the comment input; this baseline pins that
    //   it stays hidden until the gap loads.)

    const editor = await TestTaskCollection.create(accounts.cassCade, {
        name: "Editor",
        access: "Public",
        color: "blue",
    });

    const resizingTask = await TestTask.create(accounts.masonClay, {
        id: unsafelyGenerateStableId<TaskId>(runner.stableRandom, "taskActivityFeedResizingTask"),
        title: "Column resizing: smooth drag or snap to grid",
        collections: editor,
        ...getTaskActivityScreenshotActionOptions(new Date("2025-09-29T10:15:00-05:00")),
    });

    // A hundred comments, ~105 minutes apart, running Sep 30 → Oct 7. The bulk of the
    // thread cycles through debate remarks (only a handful are ever on screen at
    // once); the last six comments are the decision sequence `c001` jumps to.
    const debateStartTime = new Date("2025-09-30T09:30:00-04:00");
    const debateCommentSpacingMs = 105 * 60 * 1000;
    const debateCommentTimeAt = (index: number) =>
        new Date(debateStartTime.getTime() + index * debateCommentSpacingMs);

    const debateRemarks: ReadonlyArray<{session: typeof accounts.cassCade; text: string}> = [
        {
            session: accounts.masonClay,
            text: "Smooth drag is live on my branch if anyone wants to feel it out",
        },
        {
            session: accounts.mattRHorn,
            text: "Tried it. It feels precise, but precision isn\u2019t the same as control — most people don\u2019t want a 137px column, they want a third.",
        },
        {
            session: accounts.elleKappaTan,
            text: "fwiw the width values sync fine either way, storage doesn\u2019t care",
        },
        {
            session: accounts.cassCade,
            text: "Where did we land on what happens at narrow viewport widths?",
        },
        {
            session: accounts.masonClay,
            text: "Columns clamp to a min width and the table scrolls horizontally past that",
        },
        {
            session: accounts.mattRHorn,
            text: "Grids won because carpenters had jigs. Freehand cuts look organic until you put two of them next to each other.",
        },
        {
            session: accounts.masonClay,
            text: "Lowkey not sure the jig metaphor holds, people resize columns like twice ever",
        },
        {
            session: accounts.elleKappaTan,
            text: "if they only do it twice then snapping costs them nothing",
        },
        {
            session: accounts.cassCade,
            text: "Survey says tables are a top-three ask, so whatever we pick needs to demo well.",
        },
        {
            session: accounts.mattRHorn,
            text: "Every table in our own docs would end up better proportioned with snapping. That\u2019s the tell.",
        },
        {
            session: accounts.masonClay,
            text: "Counterpoint: spreadsheet people. They have an exact width in their head and snap fights them",
        },
        {
            session: accounts.elleKappaTan,
            text: "we could log resize events for a week and see what fraction end near a snap point",
        },
        {
            session: accounts.cassCade,
            text: "Let\u2019s not run a study for a column border tbh. We have enough signal.",
        },
        {
            session: accounts.mattRHorn,
            text: "The floating format menu overlaps the drag handle at narrow widths — separate issue, filing it.",
        },
        {session: accounts.masonClay, text: "Fixed the handle overlap in the latest push btw"},
        {
            session: accounts.elleKappaTan,
            text: "resize is smooth at 120hz now too, the raf batching was the issue",
        },
        {
            session: accounts.mattRHorn,
            text: "Snapping also photographs better. Screenshots of arbitrary widths always look slightly broken.",
        },
        {session: accounts.masonClay, text: "Ok I keep going back and forth, both feel defensible"},
        {session: accounts.cassCade, text: "Same thread, day four. I\u2019m calling it this week."},
        {session: accounts.masonClay, text: "Works for me"},
    ];

    const decisionSequence: ReadonlyArray<{session: typeof accounts.cassCade; text: string}> = [
        {
            session: accounts.mattRHorn,
            text: "Final case: snap by default gives every table a rhythm. Freeform is a mode, not a default.",
        },
        {
            session: accounts.masonClay,
            text: "And my final case: never fight the cursor. If the hand moves, the column moves",
        },
        // The deep-link target for `c001`, at comment index 96.
        {
            session: accounts.cassCade,
            text: "Decision: snap by default, hold Alt for smooth resize. Mason gets the escape hatch, Matt gets the rhythm. Shipping it in the walkthrough build.",
        },
        {session: accounts.masonClay, text: "Alt for smooth is honestly clean"},
        {
            session: accounts.mattRHorn,
            text: "Good call. A default that teaches and a modifier that trusts.",
        },
        {session: accounts.elleKappaTan, text: "shipping it"},
    ];

    const debateCommentCount = 100;
    const decisionCommentIndex = debateCommentCount - decisionSequence.length + 2;

    for (let index = 0; index < debateCommentCount; index++) {
        const decisionIndex = index - (debateCommentCount - decisionSequence.length);
        const {session, text} =
            decisionIndex >= 0
                ? decisionSequence[decisionIndex]!
                : debateRemarks[index % debateRemarks.length]!;

        await resizingTask.createComment(session, text, {
            overrideCreatedTime: debateCommentTimeAt(index),
        });

        // Avoid sending all comment notifications and search indexing jobs through the
        // local queue at once. The notification jobs contend on the same inbox entries, so
        // a large burst can exhaust transaction retries before the queue drains.
        if ((index + 1) % 10 === 0) {
            await runner.drainBackgroundWork();
        }
    }

    // Activity interleaved with the decision sequence, rendered by `c001`: Cass bumps
    // the priority right before her decision and sets the walkthrough deadline right
    // after it.
    await resizingTask.updatePriority(
        accounts.cassCade,
        "High",
        getTaskActivityScreenshotActionOptions(debateCommentTimeAt(decisionCommentIndex - 0.5)),
    );
    await resizingTask.updateDueDate(
        accounts.cassCade,
        new CalendarDate(2025, 10, 10),
        getTaskActivityScreenshotActionOptions(debateCommentTimeAt(decisionCommentIndex + 0.5)),
    );

    // Activity hidden by `c002`: an assignment deep inside the unloaded gap and notes
    // captured after the last comment. Neither may render while the comments around
    // them are unloaded slots.
    await resizingTask.updateAssignee(
        accounts.cassCade,
        accounts.masonClay,
        getTaskActivityScreenshotActionOptions(debateCommentTimeAt(30.5)),
    );
    await resizingTask.typeNotes(
        accounts.masonClay,
        "Decision: snap by default, Alt for smooth. Snap points at 1/12 column widths.",
        {overrideUpdatedTimeForTest: debateCommentTimeAt(debateCommentCount + 0.5)},
    );

    await waitForTaskIndex();

    // `c002`: from the top with the network paused, the thread past the first page
    // stays an unloaded gap. The scroll to the bottom renders the gap's shimmer slots
    // — and none of the gap's or the tail's activity.
    await runner.goto(accounts.cassCade, `/task/${resizingTask.id}`, {
        fixedTime: activityScreenshotTime,
        allowPauseNetwork: true,
    });
    // The remark cycle repeats this text every 20 comments; only the first instance is
    // in the loaded page.
    await runner.getByText(debateRemarks[0]!.text).first().waitFor();
    await runner.pauseNetwork();
    await scrollLocatorToBottom(runner.getByTestId("TaskDetailScrollView"), {
        withExpectedScrollHeightChange: true,
    });
    await runner.screenshot("c002", "task-activity-feed-gap");
}
