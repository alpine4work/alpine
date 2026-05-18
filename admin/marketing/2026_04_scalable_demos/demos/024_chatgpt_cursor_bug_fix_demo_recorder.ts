import {createDemoMockBots} from "~/admin/environment/demo_space/create_demo_mock_bots.js";
import {createDemoSpace} from "~/admin/environment/demo_space/create_demo_space.js";
import {createMockAgentRecording} from "~/admin/environment/demo_space/create_mock_agent_recording.js";
import {putMockAgentRecording} from "~/admin/environment/demo_space/put_mock_agent_recording.js";
import {createDemoCursor} from "~/admin/marketing/2026_04_scalable_demos/helpers/demo_cursor.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scalableDemoDefaultViewportWidth} from "~/admin/marketing/2026_04_scalable_demos/helpers/scalable_demo_default_viewport.js";
import {scrollDemo} from "~/admin/marketing/2026_04_scalable_demos/helpers/scroll_demo.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import type {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {type FeedEntry, FeedEntrySchema} from "~/shared/feed/feed_entry_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {Schema} from "~/shared/schema/schema.js";

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const {chatGpt, cursor: cursorBot} = await createDemoMockBots(
        accounts.roseCompas,
        services.getAppServiceTokenAgent(),
        services,
    );

    const demoFixedTime = new Date("2025-10-16T11:58:00-04:00");

    const spaceUrl = `https://alpine.inc/s/${space.id}`;
    const accountMentionUrl = (account: {id: string}) =>
        `${spaceUrl}/accounts/${account.id}?mention=short`;
    const documentMentionUrl = (document: TestDocument) =>
        `${spaceUrl}/documents/${document.id}?mention`;
    const postMentionUrl = (post: TestPost) => `${spaceUrl}/posts/${post.id}?mention`;
    const taskMentionUrl = (task: TestTask) => `${spaceUrl}/tasks/${task.id}?mention`;

    const [engineeringChannel, planningChannel, supportChannel] = await runAllPromises([
        TestChannel.create(accounts.elleKappaTan, {
            name: "Engineering",
            access: "Public",
            description: "Technical updates, reliability work, and implementation decisions.",
        }),
        TestChannel.create(accounts.cassCade, {
            name: "Q4 Planning",
            access: "Public",
            description: "Planning inputs and decisions for the next quarter.",
        }),
        TestChannel.create(accounts.hollyEvergreen, {
            name: "Support",
            access: "Public",
            description: "Customer reports, escalations, and support patterns.",
        }),
    ]);

    const bugsCollection = await TestTaskCollection.create(accounts.elleKappaTan, {
        name: "Bugs",
        access: "Public",
    });

    const [tableKeyboardNotesDoc, editorAuditDoc, q4PlanningDoc] = await runAllPromises([
        TestDocument.create(accounts.masonClay, {
            title: "Table Keyboard Behavior Notes",
            access: "Public",
            body: markdown`
### Table cell keyboard rules

The table keymap should only take Tab when the cursor is in plain cell text. If the cursor is inside
a list item in a table cell, list indentation wins first.

Expected behavior:

- Tab in plain table text moves to the next cell.
- Shift-Tab in plain table text moves to the previous cell.
- Tab inside a list item indents the list item.
- Shift-Tab inside a list item outdents the list item.
- Cell navigation resumes only after the list command declines the key.

This keeps table navigation predictable without breaking the editor behavior people already know.
            `,
        }),
        TestDocument.create(accounts.mattRHorn, {
            title: "Editor Interaction Audit",
            access: "Public",
            body: markdown`
### Keyboard priority

The editor should treat local structure before spatial movement. Lists are local structure. Tables
are spatial movement. When a list lives inside a table cell, the list gets the first chance to
handle Tab and Shift-Tab.

This matches the physical metaphor: edit the thing your cursor is in before moving to the next
container. It also prevents table support from feeling like a special mode bolted onto the editor.
            `,
        }),
        TestDocument.create(accounts.cassCade, {
            title: "Q4 Planning Draft",
            access: "Public",
            body: markdown`
### Product quality

Tables shipped this week. The launch is the right call, but we should keep one engineer available
for small editor follow-ups from real customer usage.

Priorities:

- Fix regressions that interrupt writing flow.
- Keep notification control as the top Q4 product bet.
- Protect Elle\u2019s realtime reliability rollout from scope creep.
            `,
        }),
    ]);

    await runAllPromises([
        tableKeyboardNotesDoc.updateContentPreview(),
        editorAuditDoc.updateContentPreview(),
        q4PlanningDoc.updateContentPreview(),
    ]);

    const tableListIndentationBugTask = await TestTask.create(accounts.elleKappaTan, {
        title: "Tab indents list instead of moving focus",
        collections: [bugsCollection],
        assignee: accounts.masonClay,
        assigneeStatus: "Active",
        priority: "High",
        notes: markdown`
### Report

Tab currently moves focus to the next table cell when the cursor is inside a bulleted list nested in
the current cell.

### Expected

List indentation should run first. Table navigation should only take Tab or Shift-Tab when the
cursor is in plain table cell content.
        `,
    });

    await tableListIndentationBugTask.createComment(
        accounts.hollyEvergreen,
        markdown`
Support has a matching customer report in the feed. The customer can use manual indentation for now,
but this breaks the help-doc writing flow.
        `,
    );

    const [tablesLaunchPost, keyboardPriorityPost, planningPost, reliabilityPost] =
        await runAllPromises([
            engineeringChannel.createPost(
                accounts.masonClay,
                markdown`
Tables launch follow-up: the editor is stable after the release, but I want one more pass on
keyboard edge cases now that customers are using tables in real docs.
                `,
                {overrideCreatedTime: new Date("2025-10-16T09:20:00-04:00")},
            ),
            engineeringChannel.createPost(
                accounts.mattRHorn,
                markdown`
Table keymap precedence follow-up from the audit

Lists inside table cells should keep normal indentation behavior. Table navigation can take Tab only
when the current block is plain cell content.
                `,
                {overrideCreatedTime: new Date("2025-10-16T09:48:00-04:00")},
            ),
            planningChannel.createPost(
                accounts.cassCade,
                markdown`
Q4 planning draft is moving. I pulled Holly\u2019s survey themes into the product section and left
space for engineering capacity notes.
                `,
                {overrideCreatedTime: new Date("2025-10-16T10:05:00-04:00")},
            ),
            engineeringChannel.createPost(
                accounts.elleKappaTan,
                markdown`
realtime rollout is at 100 percent now

no new reconnect spikes since the jitter change shipped
                `,
                {overrideCreatedTime: new Date("2025-10-16T10:35:00-04:00")},
            ),
        ]);

    const bugReportPost = await supportChannel.createPost(
        accounts.hollyEvergreen,
        markdown`
### Bug report: Tab skips out of lists inside table cells

A customer hit this while updating their launch checklist in a table. It reproduces in our help-doc
draft too.

Steps:

1. Insert a table in a document.
2. Add a bulleted list inside a table cell.
3. Place the cursor on the second bullet.
4. Press Tab.

Actual: focus jumps to the next table cell.

Expected: the bullet should indent first. Table navigation should only take over when the cursor is
not inside list content.
        `,
        {overrideCreatedTime: new Date("2025-10-16T11:10:00-04:00")},
    );

    await runAllPromises([
        bugReportPost.createComment(
            accounts.masonClay,
            markdown`
This is cooked but it tracks with the keymap ordering. I think table navigation is catching Tab
before the list command sees it.
            `,
            {overrideCreatedTime: new Date("2025-10-16T11:18:00-04:00")},
        ),
        bugReportPost.createComment(
            accounts.mattRHorn,
            markdown`
This is exactly the kind of conflict the audit called out. Local structure first, then spatial
movement. Otherwise tables feel like a mode switch.
            `,
            {overrideCreatedTime: new Date("2025-10-16T11:24:00-04:00")},
        ),
        bugReportPost.createComment(
            accounts.elleKappaTan,
            markdown`
if this is client keymap order then it should be a small fix
            `,
            {overrideCreatedTime: new Date("2025-10-16T11:29:00-04:00")},
        ),
        bugReportPost.createComment(
            accounts.hollyEvergreen,
            markdown`
Customer is unblocked for now with manual indentation, but this is visible enough that I would fix
it before the help doc gets wider distribution.
            `,
            {overrideCreatedTime: new Date("2025-10-16T11:36:00-04:00")},
        ),
    ]);

    await runAllPromises([
        tablesLaunchPost.setReaction(accounts.cassCade, "ThankYou"),
        tablesLaunchPost.setReaction(accounts.mattRHorn, "Happy"),
        keyboardPriorityPost.setReaction(accounts.masonClay, "ThankYou"),
        reliabilityPost.setReaction(accounts.cassCade, "ThankYou"),
        reliabilityPost.setReaction(accounts.masonClay, "Happy"),
        reliabilityPost.setReaction(accounts.roseCompas, "Celebrate"),
        bugReportPost.setReaction(accounts.cassCade, "ThankYou"),
        bugReportPost.setReaction(accounts.mattRHorn, "GenericLike"),
    ]);

    await runAllPromises([
        tablesLaunchPost.createComment(
            accounts.mattRHorn,
            markdown`
The remaining edge cases are mostly keyboard feel. Worth one clean pass before people build bigger
tables in docs.
            `,
            {overrideCreatedTime: new Date("2025-10-16T09:32:00-04:00")},
        ),
        keyboardPriorityPost.createComment(
            accounts.masonClay,
            markdown`
Yep. I can keep the table command later in the chain so the nested block gets first shot
            `,
            {overrideCreatedTime: new Date("2025-10-16T09:57:00-04:00")},
        ),
        planningPost.createComment(
            accounts.roseCompas,
            markdown`
Thanks. I want one explicit line on editor polish capacity before this goes to the leadership doc.
            `,
            {overrideCreatedTime: new Date("2025-10-16T10:18:00-04:00")},
        ),
        reliabilityPost.createComment(
            accounts.masonClay,
            markdown`
nice. the absence of reconnect noise is honestly the feature
            `,
            {overrideCreatedTime: new Date("2025-10-16T10:42:00-04:00")},
        ),
    ]);

    await putMockAgentRecording(
        "chat-gpt",
        chatGpt,
        `/posts/${bugReportPost.id}`,
        createMockAgentRecording(
            space.id,
            [
                1_500,
                `I found the context across Alpine: [Table Keyboard Behavior Notes](${documentMentionUrl(
                    tableKeyboardNotesDoc,
                )}), [the earlier keymap post](${postMentionUrl(
                    keyboardPriorityPost,
                )}), and [the related bug task](${taskMentionUrl(tableListIndentationBugTask)}).`,
                100,
                "Expected behavior: Tab in plain table text moves between cells. Tab inside a list item nested in a table cell indents the list item first. Shift-Tab mirrors that by outdenting before moving to the previous cell.",
                100,
                "So the bug is that table navigation is winning before the list keymap gets a chance to handle the key.",
                100,
                `[Cursor](${accountMentionUrl(
                    cursorBot,
                )}), please fix the editor keymap ordering so list indentation runs before table cell navigation when the selection is inside list content. Add a regression test covering a bulleted list inside a table cell.`,
            ],
            {waitMillisecondsBetweenTokens: 12},
        ),
    );

    await putMockAgentRecording(
        "cursor",
        cursorBot,
        `/posts/${bugReportPost.id}`,
        createMockAgentRecording(
            space.id,
            [
                1_000,
                "## Table tab keydown fix\n\nStarted coding. I\u2019ll let you know when I\u2019m done ([watch me work](http://localhost:3000)).",
            ],
            {waitMillisecondsBetweenTokens: 12},
        ),
    );

    const entries: Array<FeedEntry> = [
        {
            type: "Post",
            postId: tablesLaunchPost.id,
            channelId: engineeringChannel.id,
            authorId: accounts.masonClay.account.id,
            createdTime: tablesLaunchPost.createdTime,
        },
        {
            type: "Document",
            documentId: editorAuditDoc.id,
            sharedTime: new Date("2025-10-16T09:55:00-04:00"),
            sharerId: accounts.mattRHorn.account.id,
            creator: {id: accounts.mattRHorn.account.id, from: null},
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: planningPost.id,
            channelId: planningChannel.id,
            authorId: accounts.cassCade.account.id,
            createdTime: planningPost.createdTime,
        },
        {
            type: "Post",
            postId: reliabilityPost.id,
            channelId: engineeringChannel.id,
            authorId: accounts.elleKappaTan.account.id,
            createdTime: reliabilityPost.createdTime,
        },
        {
            type: "Post",
            postId: bugReportPost.id,
            channelId: supportChannel.id,
            authorId: accounts.hollyEvergreen.account.id,
            createdTime: bugReportPost.createdTime,
        },
    ];

    const url = new UrlPath(`/s/${space.id}/dev/feed`);
    url.searchParams.set(
        "entries",
        JSON.stringify(Schema.array(FeedEntrySchema).serialize(entries)),
    );

    await recorder.record({
        instructions: markdown`
This demo shows ChatGPT and Cursor coordinating from a feed discussion. Cass scrolls the home feed,
lands on a customer bug report, opens the comments, asks ChatGPT to recover the expected behavior
from a document, an earlier post, and a related bug task, then ChatGPT mentions Cursor with the fix
brief.

The recording is automated after startup.

1. Expand the Chrome window so rounded corners are not included in the recording.

2. Scroll to the bottom of the feed once so the virtualized list measures all items, then scroll
   back to the top.

3. Start recording, then press Enter in this terminal to begin the automated actions.
        `,
        session: accounts.cassCade,
        path: url.toString(),
        fixedTime: demoFixedTime,
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
            await page.evaluate("dev.feed.toggleLeftSideBarVisibility()");
        },
        viewport: {
            width: scalableDemoDefaultViewportWidth,
            height: scalableDemoDefaultViewportWidth,
        },
        actions: [
            async page => {
                const feedScrollView = page.getByTestId("PostListScrollView");
                await feedScrollView.waitFor({state: "visible"});

                const demoCursor = await createDemoCursor(page, {scale: 1.5});
                await demoCursor.setCursorType("default");
                await demoCursor.hide();

                await wait(1000);
                await scrollDemo(feedScrollView, {distance: 719, durationMs: 1200});
                await wait(400);

                await demoCursor.jumpTo(579, 646);
                await demoCursor.setCursorType("default");
                await demoCursor.show();
                await wait(250);
                await demoCursor.click(663, 708, 800);
                await wait(700);

                await scrollDemo(feedScrollView, {distance: 405, durationMs: 600});
                await wait(400);

                // Pin the scroll view to the bottom for the rest of the demo.
                await feedScrollView.evaluate(element => {
                    element.addEventListener("scroll", () => {
                        element.scrollTop = element.scrollHeight - element.clientHeight;
                    });

                    const loop = () => {
                        element.scrollTop = element.scrollHeight - element.clientHeight;
                        requestAnimationFrame(loop);
                    };

                    loop();
                });

                await runAllPromises([
                    page.keyboard.type("@ChatGPT", {delay: 55}),
                    wait(55).then(() => demoCursor.hide()),
                ]);

                await wait(400);
                await page.keyboard.press("Enter", {delay: 70});
                await page.keyboard.type(
                    " we talked about this before but I forget where. Find relevant context, write down the expected behavior here, then hand off to Cursor so it can go fix the bug",
                    {delay: 10},
                );
                await wait(350);
                await page.keyboard.press("Enter", {delay: 70});
            },
        ],
    });
});
