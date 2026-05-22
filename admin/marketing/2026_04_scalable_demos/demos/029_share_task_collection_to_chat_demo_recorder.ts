import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDemoCursor} from "~/admin/marketing/2026_04_scalable_demos/helpers/demo_cursor.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoWideViewport} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_wide_viewport.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const demoFixedTime = new Date("2025-10-16T11:20:00-04:00");
    const defaultTypingDurationMs = 1500;

    const collection = await TestTaskCollection.create(accounts.cassCade, {
        name: "Tables Launch Follow-ups",
        access: "Private",
        color: "blue",
    });

    const [
        keyboardAuditTask,
        helpDocExampleTask,
        altResizeTask,
        toolbarSpacingTask,
        supportTriageTask,
    ] = await runAllPromises([
        TestTask.create(accounts.cassCade, {
            title: "Audit keyboard navigation edge cases after ship",
            collections: [collection],
            assignee: accounts.masonClay,
            assigneeStatus: "Active",
            priority: "High",
            notes: markdown`
First pass on real-world reports after tables shipped. Focus on Tab, Shift-Tab, and list behavior
inside table cells.
            `,
        }),
        TestTask.create(accounts.cassCade, {
            title: "Add customer-facing example table to help doc",
            collections: [collection],
            assignee: accounts.hollyEvergreen,
            priority: "Medium",
        }),
        TestTask.create(accounts.cassCade, {
            title: "Confirm Alt-resize language in help doc",
            collections: [collection],
            assignee: accounts.cassCade,
            priority: "Medium",
        }),
        TestTask.create(accounts.cassCade, {
            title: "Review toolbar spacing on narrow widths",
            collections: [collection],
            assignee: accounts.mattRHorn,
            priority: "Medium",
        }),
        TestTask.create(accounts.cassCade, {
            title: "Pull first-week support issues into cleanup list",
            collections: [collection],
            assignee: accounts.cassCade,
            priority: "Low",
        }),
    ]);

    await runAllPromises([
        altResizeTask.updateStatus(accounts.cassCade, "Closed"),
        supportTriageTask.updateStatus(accounts.cassCade, "Closed"),
    ]);

    const chat = await TestChat.get(accounts.cassCade, accounts.masonClay);

    await chat.sendMessage(
        accounts.cassCade,
        "Can you give the post-launch follow-ups list a quick pass before I send it to Holly?",
        {overrideCreatedTime: new Date("2025-10-16T11:12:00-04:00")},
    );
    await chat.sendMessage(accounts.masonClay, "yeah send it over", {
        overrideCreatedTime: new Date("2025-10-16T10:13:00-05:00"),
    });
    await chat.sendMessage(
        accounts.masonClay,
        "lowkey the keyboard edge cases are the main thing i care about",
        {overrideCreatedTime: new Date("2025-10-16T10:13:45-05:00")},
    );

    void keyboardAuditTask;
    void helpDocExampleTask;
    void toolbarSpacingTask;

    const collectionPath = `/s/${space.id}/tasks/collections/${collection.id}`;

    await recorder.record({
        instructions: markdown`
# Demo: sharing a task collection into chat

Cass is reviewing a private task collection of tables-launch follow-ups. Mason already has their DM
and asked to see the list. The recording is fully automated: it opens the share menu, selects Mason,
types a short message in the share overlay, and shares the collection. Because notify is on by
default, the share still sends into chat even though the demo stays focused on the task collection
page.

1. Expand the Chrome window so corner radiuses aren\u2019t visible in the recording frame.

2. Start recording, then press Enter in this terminal to begin the automated actions.
        `,
        session: accounts.cassCade,
        path: collectionPath,
        viewport: scalableDemoWideViewport,
        fixedTime: demoFixedTime,
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
            await page.evaluate("dev.taskFloatingCreateButton.toggleVisibility()");
        },
        actions: [
            async page => {
                const cursor = await createDemoCursor(page, {watchCssCursor: true});

                await cursor.jumpTo(140, 540);
                await wait(1800);

                const shareButton = page.getByRole("button", {name: "Share"}).first();
                await cursor.clickElement(shareButton);

                const shareOverlay = page.getByTestId("ShareOverlay");
                await shareOverlay.waitFor({state: "visible"});
                await wait(350);

                const addPeopleInput = shareOverlay.getByPlaceholder("Add people");
                await cursor.clickElement(addPeopleInput);
                await page.keyboard.type("mason", {delay: 70});

                const masonOption = page.getByRole("option", {
                    name: accounts.masonClay.account.initialName,
                });
                await masonOption.waitFor({state: "visible"});
                await wait(250);
                await cursor.clickElement(masonOption);

                await wait(300);

                const messageInput = shareOverlay.getByLabel("Message");
                const shareMessage =
                    "sending this over so you can start with the keyboard follow-ups";
                await cursor.clickElement(messageInput, undefined, {xOffset: 120, yOffset: 18});
                await page.keyboard.type(shareMessage, {
                    delay: Math.round(defaultTypingDurationMs / shareMessage.length),
                });

                await wait(350);

                const shareSelectionButton = shareOverlay.getByRole("button", {
                    name: "Share",
                    exact: true,
                });
                await cursor.clickElement(shareSelectionButton);

                await shareOverlay
                    .getByTestId(`ShareOverlayAccountGrant:${accounts.masonClay.account.id}`)
                    .waitFor();
                await wait(2200);
            },
        ],
    });
});
