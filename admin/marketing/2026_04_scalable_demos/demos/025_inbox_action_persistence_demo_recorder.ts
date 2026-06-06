import {CalendarDateTime, today} from "@internationalized/date";
import {Locator, Page} from "playwright";
import {
    DemoSpaceAccounts,
    createDemoSpace,
} from "~/admin/environment/demo_space/create_demo_space.js";
import {
    inboxActionPersistenceDemoRecordingHeight,
    inboxActionPersistenceDemoRecordingWidth,
} from "~/admin/marketing/2026_04_scalable_demos/demos/025_inbox_action_persistence_demo_shared.js";
import {
    DemoCursor,
    createDemoCursor,
} from "~/admin/marketing/2026_04_scalable_demos/helpers/demo_cursor.js";
import {runScalableDemoRecorder} from "~/admin/marketing/2026_04_scalable_demos/helpers/run_scalable_demo_recorder.js";
import {scrollDemo} from "~/admin/marketing/2026_04_scalable_demos/helpers/scroll_demo.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getInbox} from "~/server/notifications/data/get_inbox.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const taskNotificationSnippet =
    "i\u2019d keep v1 to filters and channel mute. quiet hours turns this into settings work";
const documentNotificationSnippet =
    "This is the right scope. Filters plus per-channel mute gives people control";
const forumNotificationSnippet = "Meridian signed the pilot this morning";
const celebrateReactionPickerOffsetPx = 41;

runScalableDemoRecorder(async (context, services, recorder) => {
    const {space, accounts} = await createDemoSpace(context, services.getAppServiceTokenAgent());

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);
    const todayAt = (hour: number, minute: number) =>
        new CalendarDateTime(
            currentDate.year,
            currentDate.month,
            currentDate.day,
            hour,
            minute,
        ).toDate(timeZone);

    await runAllPromises([
        createTaskInboxEntry(accounts, todayAt),
        createForumInboxEntry(accounts, todayAt),
        createDocumentInboxEntry(accounts, todayAt),
    ]);

    await waitForNotifications(services);
    await retryWithExponentialBackoff(async retry => {
        try {
            await waitForNotifications(services);

            const inbox = await getInbox(accounts.cassCade.action(), {
                spaceId: space.id,
                consistency: "Strong",
            });

            assert(
                inbox.model.entryCount === 3,
                `Expected 3 inbox entries, got ${inbox.model.entryCount}`,
            );
        } catch (error) {
            throw retry(error);
        }
    });

    await recorder.record({
        instructions: markdown`
This automated demo shows that Alpine\u2019s inbox entries are not dismissed just because Cass opens
them. Each entry stays in the inbox until Cass takes action in the relevant product surface.

The recording opens on Cass\u2019s inbox with notifications from Tasks, Forum, and Docs. The
automation uses a task comment, a Celebrate reaction on Cliff\u2019s won-deal post, and a document
comment to show each inbox entry clearing only after Cass takes action.
        `,
        session: accounts.cassCade,
        path: `/inbox/${space.id}`,
        viewport: {
            width: inboxActionPersistenceDemoRecordingWidth,
            height: inboxActionPersistenceDemoRecordingHeight,
        },
        prepare: async page => {
            await page.evaluate("dev.spaceSideBar.toggleVisibility()");
        },
        actions: [
            async page => {
                await runInboxActionPersistenceDemo(page);
            },
        ],
    });
});

async function createTaskInboxEntry(
    {cassCade, masonClay}: DemoSpaceAccounts,
    todayAt: (hour: number, minute: number) => Date,
) {
    const q4PlanningCollection = await TestTaskCollection.create(cassCade, {
        name: "Q4 Planning",
        access: "Public",
        color: "green",
    });

    const task = await TestTask.create(cassCade, {
        title: "Define notification control v1 scope",
        assignee: masonClay,
        assigneeStatus: "Active",
        priority: "High",
        collections: q4PlanningCollection,
        notes: markdown`
Pick the smallest useful first version for notification control. The customer survey points at
per-channel mute, inbox filters, and quiet hours, but v1 should not turn into a full settings
redesign.
        `,
    });

    await task.createComment(masonClay, taskNotificationSnippet, {
        overrideCreatedTime: todayAt(11, 20),
    });
}

async function createDocumentInboxEntry(
    {cassCade, mattRHorn}: DemoSpaceAccounts,
    todayAt: (hour: number, minute: number) => Date,
) {
    const document = await TestDocument.create(cassCade, {
        title: "Q4 Planning Draft",
        access: "Public",
        body: markdown`
This draft consolidates Q4 inputs for final review. It should stay narrow: one product bet, one
infrastructure bet, and one go-to-market bet.

## Product bet

Notification control is the leading product bet. Per-channel mute and inbox filters are the smallest
useful starting point. Quiet hours can follow after the first version proves people use it.

## Infrastructure bet

Enterprise SSO scoping stays active, but the implementation window should be stated honestly. The
technical unknowns are real enough that this should not become a casual sales promise.

## Go-to-market bet

The first case study is creating better inbound. The one-pager needs to explain the inbox more
clearly before the next enterprise demo.
        `,
    });

    await document.updateContentPreview();

    const range = await getDocumentTextRange(document, "Per-channel mute and inbox filters");

    await document.createCommentThread(mattRHorn, range, documentNotificationSnippet, {
        overrideCreatedTime: todayAt(10, 35),
    });
}

async function createForumInboxEntry(
    {cassCade, cliffWeathers}: DemoSpaceAccounts,
    todayAt: (hour: number, minute: number) => Date,
) {
    const channel = await TestChannel.create(cliffWeathers, {
        name: "Sales",
        access: "Public",
        description: "Pipeline updates, prospect blockers, and customer wins.",
    });

    await channel.subscribe(cassCade);

    await channel.createPost(
        cliffWeathers,
        markdown`
FORUM_NOTIFICATION_SNIPPET. Contract is in, security signed off, and they want the first workspace
stood up next week.

Holly\u2019s case study got us in the door, the new one-pager handled the first call, and the inbox
section closed the loop with their VP Eng. Huge team win!
        `.replace("FORUM_NOTIFICATION_SNIPPET", forumNotificationSnippet),
        {overrideCreatedTime: todayAt(10, 55)},
    );
}

async function waitForNotifications(services: {waitForSqsProcessJobs(): Promise<void>}) {
    await services.waitForSqsProcessJobs();
}

async function runInboxActionPersistenceDemo(page: Page) {
    const inboxEntries = page.getByTestId("InboxViewEntries");
    await inboxEntries.waitFor({state: "visible"});
    await inboxEntries.getByText(taskNotificationSnippet).waitFor({state: "visible"});
    await inboxEntries.getByText(forumNotificationSnippet).waitFor({state: "visible"});
    await inboxEntries.getByText(documentNotificationSnippet).waitFor({state: "visible"});

    const cursor = await createDemoCursor(page, {scale: 1.5});
    await cursor.hide();
    await cursor.jumpTo(527, 270);
    await cursor.show();
    await wait(1000);

    await commentOnSelectedTask({
        page,
        cursor,
        entryText: taskNotificationSnippet,
        commentText: "Makes sense. I\u2019ll leave quiet hours out of v1",
    });

    await openEntryAndReactCelebrate({
        page,
        cursor,
        entryText: forumNotificationSnippet,
    });

    await openEntryAndComment({
        page,
        cursor,
        entryText: documentNotificationSnippet,
        commentText: "Amazing, thanks!",
    });
}

async function commentOnSelectedTask({
    page,
    cursor,
    entryText,
    commentText,
}: {
    page: Page;
    cursor: DemoCursor;
    entryText: string;
    commentText: string;
}) {
    const inboxEntries = page.getByTestId("InboxViewEntries");
    const taskScrollView = page.getByTestId("TaskDetailScrollView");
    await taskScrollView.waitFor({state: "visible"});

    await scrollDemo(taskScrollView, {targetScrollTop: 358, durationMs: 800});
    await wait(250);

    await sendVisibleComment({page, cursor, commentText, delay: 28});
    await expectEntryToLeaveInbox(inboxEntries, entryText);
}

async function openEntryAndComment({
    page,
    cursor,
    entryText,
    commentText,
}: {
    page: Page;
    cursor: DemoCursor;
    entryText: string;
    commentText: string;
}) {
    const inboxEntries = page.getByTestId("InboxViewEntries");
    const entry = inboxEntries.getByText(entryText).first();

    await cursor.clickElement(entry, 700, {watchCssCursor: true});
    await wait(320);

    await sendVisibleComment({page, cursor, commentText, delay: 48});
    await expectEntryToLeaveInbox(inboxEntries, entryText);
}

async function openEntryAndReactCelebrate({
    page,
    cursor,
    entryText,
}: {
    page: Page;
    cursor: DemoCursor;
    entryText: string;
}) {
    const inboxEntries = page.getByTestId("InboxViewEntries");
    const entry = inboxEntries.getByText(entryText).first();

    await cursor.clickElement(entry, 700, {watchCssCursor: true});
    await wait(400);

    const postFooter = page.locator('[data-testid^="PostContentViewFooter:"]').first();
    await postFooter.waitFor({state: "visible"});

    const reactionButton = postFooter.getByRole("button").first();
    const reactionButtonBox = assertExists(await reactionButton.boundingBox());
    const reactionButtonCenter = {
        x: reactionButtonBox.x + reactionButtonBox.width / 2,
        y: reactionButtonBox.y + reactionButtonBox.height / 2,
    };

    await cursor.moveToElement(reactionButton, 650);
    await page.mouse.down();
    await wait(300);
    await cursor.moveTo(
        reactionButtonCenter.x - celebrateReactionPickerOffsetPx,
        reactionButtonCenter.y - celebrateReactionPickerOffsetPx,
        700,
        {dispatchPointerMoveEvents: true},
    );
    await wait(150);
    await page.mouse.up();
    await wait(1000);

    await expectEntryToLeaveInbox(inboxEntries, entryText);
}

async function sendVisibleComment({
    page,
    cursor,
    commentText,
    delay,
}: {
    page: Page;
    cursor: DemoCursor;
    commentText: string;
    delay: number;
}) {
    const commentInput = page.getByLabel("New comment").last();
    await commentInput.waitFor({state: "visible"});
    await commentInput.scrollIntoViewIfNeeded();
    await cursor.clickElement(commentInput, 500);
    await cursor.setCursorType("text");
    await commentInput.pressSequentially(commentText, {delay});
    await wait(250);
    await page.keyboard.press("Enter");
    await wait(900);
}

async function expectEntryToLeaveInbox(inboxEntries: Locator, entryText: string) {
    await inboxEntries.getByText(entryText).waitFor({state: "detached", timeout: 5000});
}

async function getDocumentTextRange(
    document: TestDocument,
    text: string,
): Promise<{from: number; to: number}> {
    const content = await document.getContent();
    let range: {from: number; to: number} | null = null;

    content.descendants((node, pos) => {
        if (range) return false;
        if (!node.isText) return true;

        const index = node.text!.indexOf(text);
        if (index === -1) return true;

        range = {from: pos + index, to: pos + index + text.length};
        return false;
    });

    // @ts-expect-error: TypeScript doesn't understand that `descendants()` is synchronous.
    return assertExists(range);
}
