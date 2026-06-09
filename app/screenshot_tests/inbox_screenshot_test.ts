import Mustache from "mustache";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/data/test_helpers/test_task_collection.js";
import {LocalAccessPolicy} from "~/shared/access/access_policy.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {ChatId, PostId, TaskId} from "~/shared/id/types/id_types.js";

const inboxScreenshotTime = new Date("2025-10-17T17:00:00.000Z");

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {space, accounts} = await runner.createDemoSpace(context);
    // Need a standardized access policy so that we can convert entities to and from
    // sites.
    const initialAccessPolicy = getStandardizedAccessPolicy(accounts);

    const {chat, chatRoom, channel, document, task} = await createInboxEntries(
        accounts,
        runner,
        initialAccessPolicy,
    );
    {
        await screenshotInboxEntry(
            runner,
            accounts.cassCade,
            space.id,
            chat.path,
            "a0",
            "chat",
            "rose loved the debrief",
        );
        await screenshotInboxEntry(
            runner,
            accounts.cassCade,
            space.id,
            document.path,
            "a1",
            "document-comments",
            "Want to flag that I don",
        );
        await screenshotInboxEntry(
            runner,
            accounts.cassCade,
            space.id,
            task.path,
            "a2",
            "task",
            "We need to make a decision on table column resizing",
        );
        await screenshotInboxEntry(
            runner,
            accounts.cassCade,
            space.id,
            channel.path,
            "a3",
            "post",
            "Should we use",
        );
        await screenshotInboxEntry(
            runner,
            accounts.cassCade,
            space.id,
            chatRoom.path,
            "a4",
            "chat-room",
            "Tables pairing",
        );
    }

    // Same flow as before, but add all entities to a site
    {
        const site = await TestSite.create(accounts.cassCade, {
            name: "Inbox Showcase",
            access: initialAccessPolicy,
        });

        await runAllPromises([
            site.addEntity(accounts.cassCade, {
                entityId: `Chat:${chatRoom.chatRoom.id}`,
                parentId: site.initialRootContainerId,
                orderKey: assertOrderKey("a1"),
            }),
            site.addEntity(accounts.cassCade, {
                entityId: `Channel:${channel.channel.id}`,
                parentId: site.initialRootContainerId,
                orderKey: assertOrderKey("a2"),
            }),
            site.addEntity(accounts.cassCade, {
                entityId: `Document:${document.document.id}`,
                parentId: site.initialRootContainerId,
                orderKey: assertOrderKey("a3"),
            }),
        ]);

        // Special handling that allows us to add the task to the site.
        await site.access.set(accounts.cassCade, {
            type: "Local",
            accountGrantById: new Map([
                [accounts.cassCade.account.id, {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        });
        await site.addEntity(accounts.cassCade, {
            entityId: `Task:${task.task.id}`,
            parentId: site.initialRootContainerId,
            orderKey: assertOrderKey("a4"),
        });

        await waitForNotifications(runner);

        await screenshotInboxEntry(
            runner,
            accounts.cassCade,
            space.id,
            document.path,
            "a5",
            "document-in-site-comments",
            "Want to flag that I don",
        );
        await screenshotInboxEntry(
            runner,
            accounts.cassCade,
            space.id,
            task.path,
            "a6",
            "task-in-site",
            "We need to make a decision on table column resizing",
        );
        await screenshotInboxEntry(
            runner,
            accounts.cassCade,
            space.id,
            channel.path,
            "a7",
            "post-in-site",
            "Should we use",
        );
        await screenshotInboxEntry(
            runner,
            accounts.cassCade,
            space.id,
            chatRoom.path,
            "a8",
            "chat-room-in-site",
            "Tables pairing",
        );
    }
}

async function createInboxEntries(
    accounts: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
    initialAccessPolicy: LocalAccessPolicy,
) {
    const chat = await createChatInboxEntry(accounts, runner);
    const chatRoom = await createChatRoomInboxEntry(accounts, runner, initialAccessPolicy);
    const channel = await createForumInboxEntry(accounts, runner, initialAccessPolicy);
    const document = await createDocumentNewCommentThreadsInboxEntry(
        accounts,
        runner,
        initialAccessPolicy,
    );
    const task = await createTaskInboxEntry(accounts, runner, initialAccessPolicy);

    await waitForNotifications(runner);

    return {
        chat,
        chatRoom,
        channel,
        document,
        task,
    };
}

async function createChatInboxEntry(
    {cassCade, elleKappaTan}: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
) {
    const chat = await TestChat.get(cassCade, elleKappaTan);

    const sendMessage = async (...args: Parameters<TestChat["sendMessage"]>) => {
        const message = await chat.sendMessage(...args);
        await runner.services.waitForSqsProcessJobs();
        return message;
    };

    const graphMessage = await sendMessage(
        cassCade,
        markdown`
omg also saw your post. the graph is really good
        `,
        {overrideCreatedTime: new Date("2025-10-16T10:09:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
matt helped me clean it up
        `,
        {overrideCreatedTime: new Date("2025-10-16T10:11:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
the first version had like 9 colors
        `,
        {overrideCreatedTime: new Date("2025-10-16T10:11:01-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
lol of course it did
        `,
        {overrideCreatedTime: new Date("2025-10-16T10:12:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
quick one: for q4, are you ok with mason continuing to own the editor stuff solo through end of
november? i know you two pair on cross-stack things and i want to make sure tables shipping
doesn\u2019t block you on anything
        `,
        {overrideCreatedTime: new Date("2025-10-16T13:48:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
yeah hes fine. tables is mostly client-side. the only server piece is the collab schema migration
and weve already done that
        `,
        {overrideCreatedTime: new Date("2025-10-16T13:55:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
if anything ill have more time once realtime closes out
        `,
        {overrideCreatedTime: new Date("2025-10-16T13:56:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
ok good. i\u2019ll plan around that
        `,
        {overrideCreatedTime: new Date("2025-10-16T13:57:00-04:00")},
    );

    const roseDebriefMessage = await sendMessage(
        cassCade,
        markdown`
rose loved the debrief btw. she\u2019s leaning yes. final call after the 2pm with them today
        `,
        {overrideCreatedTime: new Date("2025-10-17T08:34:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
nice
        `,
        {overrideCreatedTime: new Date("2025-10-17T11:21:00-04:00")},
    );

    await graphMessage.setReaction(elleKappaTan, "Happy");
    await roseDebriefMessage.setReaction(elleKappaTan, "ThankYou");

    await waitForNotifications(runner);

    return {chat, path: `/chat/${chat.id}`};
}

async function createForumInboxEntry(
    {
        cassCade,
        cliffWeathers,
        elleKappaTan,
        hollyEvergreen,
        masonClay,
        mattRHorn,
    }: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
    initialAccessPolicy: LocalAccessPolicy,
) {
    const channel = await TestChannel.create(mattRHorn, {
        name: "Craft",
        description: markdown`
Where we sweat the small stuff. Spacing, motion, hover states, copy that reads a beat off,
animations that feel cheap, empty states that say the wrong thing. If something in the product is
bugging you and it\u2019s smaller than a feature, post it here.
        `,
        access: initialAccessPolicy,
    });

    await channel.subscribe(cassCade);

    const codeBlockPost = await channel.createPost(
        masonClay,
        markdown`
While I was testing tables I kept playing with our code block UI and I want to revisit it. Right now
the copy button only shows up on hover. It\u2019s clean when you\u2019re reading but every time I
want to copy I have to remember the button is even there and aim my mouse at the right corner.

Two questions for the channel:

1. Should the copy button be always-visible?
2. If yes, where does it sit so it doesn\u2019t fight with the language label?

Proposal: copy button is always-visible in the top-right corner. Move the language label to
top-left. Copy is an action people use _a lot_ for shareable code snippets (which is basically every
doc in our engineering wiki).
        `,
        {
            // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
            // makes sure the reaction party on any messages is stable across renders.
            id: unsafelyGenerateStableId<PostId>(runner.stableRandom, "codeBlockPost"),
            overrideCreatedTime: new Date("2025-10-03T14:12:00.000Z"),
        },
    );

    const signInPost = await channel.createPost(
        hollyEvergreen,
        markdown`
Should we use \u201CSign in\u201D or \u201CLog in\u201D on the marketing site? I\u2019m rewriting
the homepage CTA and I\u2019m seeing both in different places. Want to standardize before I push.
        `,
        {
            // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
            // makes sure the reaction party on any messages is stable across renders.
            id: unsafelyGenerateStableId<PostId>(runner.stableRandom, "signInPost"),
            overrideCreatedTime: new Date("2025-10-14T15:08:00.000Z"),
        },
    );

    await waitForNotifications(runner);
    await channel.unsubscribe(cassCade);

    await codeBlockPost.sendMessage(
        mattRHorn,
        markdown`
I\u2019ve been on the fence on this for a year. Hover-reveal is cleaner visually but the cost (as
you mention) is discoverability. Half the customers I\u2019ve talked to in research didn\u2019t
realize we _had_ a copy button.
        `,
        {overrideCreatedTime: new Date("2025-10-03T13:31:00.000Z")},
    );
    await codeBlockPost.sendMessage(
        elleKappaTan,
        markdown`
+1 always visible. also the hover thing is straight up broken on touch devices
        `,
        {overrideCreatedTime: new Date("2025-10-03T13:48:00.000Z")},
    );
    const shippedComment = await codeBlockPost.sendMessage(
        masonClay,
        markdown`
shipped. landed in production this morning
        `,
        {overrideCreatedTime: new Date("2025-10-04T16:30:00.000Z")},
    );
    const signInComment = await signInPost.sendMessage(
        mattRHorn,
        markdown`
Sign in. Reads more human. When have you ever been asked to \u201Clog in\u201D to an in person event
but if you\u2019ve gone to an event you\u2019ve definitely been asked to \u201Csign in\u201D.
        `,
        {overrideCreatedTime: new Date("2025-10-14T15:24:00.000Z")},
    );

    await codeBlockPost.setReaction(mattRHorn, "Yes");
    await codeBlockPost.setReaction(elleKappaTan, "Yes");
    await codeBlockPost.setReaction(cliffWeathers, "Celebrate");

    await signInComment.setReaction(hollyEvergreen, "ThankYou");

    await shippedComment.setReaction(mattRHorn, "Celebrate");
    await shippedComment.setReaction(elleKappaTan, "Celebrate");

    await waitForNotifications(runner);

    return {channel, path: `/notifications/channel-posts/${channel.id}-0`};
}

async function createDocumentNewCommentThreadsInboxEntry(
    accounts: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
    initialAccessPolicy: LocalAccessPolicy,
) {
    const {cassCade, elleKappaTan, mattRHorn} = accounts;

    const document = await TestDocument.create(cassCade, {
        title: "Q3 Planning",
        access: initialAccessPolicy,
        body: createPlanningDocumentBody(),
    });

    const syncDeployIncidentRange = await getDocumentTextRange(document, "sync deploy incident");
    const openQuestionsRange = await getDocumentTextRange(
        document,
        "remaining open questions are small",
    );

    await document.createCommentThread(
        elleKappaTan,
        syncDeployIncidentRange,
        markdown`
small thing: calling it \u201Cthe sync deploy incident\u201D makes it sound like the deployment was
the cause. the underlying fragility was already there, the deploy just surfaced it. i don\u2019t
think the takeaway here should be \u201Cdon\u2019t push code on fridays\u201D
        `,
        {overrideCreatedTime: new Date("2025-10-13T12:18:00-04:00")},
    );

    await document.createCommentThread(
        mattRHorn,
        openQuestionsRange,
        markdown`
Want to flag that I don\u2019t think the column resizing question is small. It shapes how every
table a user creates ends up looking, it sets the pattern people internalize. The reason typesetters
spent a century arguing about column widths is that the answer is load-bearing on whether the result
reads well. I\u2019d rather take an extra week than ship a snap-vs-smooth answer that doesn\u2019t
feel right. Not blocking, just registering the concern in the doc rather than only in chat.
        `,
        {overrideCreatedTime: new Date("2025-10-13T16:35:00-04:00")},
    );

    await waitForNotifications(runner);

    return {document, path: `/notifications/document-threads/${document.id}-0`};
}

async function createTaskInboxEntry(
    {cassCade, masonClay, mattRHorn}: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
    initialAccessPolicy: LocalAccessPolicy,
) {
    const collection = await TestTaskCollection.create(cassCade, {
        name: "Tables",
        access: initialAccessPolicy,
        color: "blue",
    });

    const projectTask = await TestTask.create(cassCade, {
        title: "Tables",
        assignee: masonClay,
        assigneeStatus: "Active",
        collections: collection,
        layout: "Project",
        notes: markdown`
Tables in the rich text editor. Insert, edit, navigate, resize, and paste in from a spreadsheet. The
last open design question is how column resizing should feel.
        `,
        priority: "High",
    });

    const task = await TestTask.create(cassCade, {
        // A stable `Id` here is important for `<ReactionParty>`'s `randomSeed` prop. This
        // makes sure the reaction party on any messages is stable across renders.
        id: unsafelyGenerateStableId<TaskId>(runner.stableRandom, "task"),
        title: "We need to make a decision on table column resizing",
        parent: projectTask,
        assignee: masonClay,
        assigneeStatus: "Active",
        priority: "High",
        notes: markdown`
Column resizing is split between two good instincts. Snap-to-resize keeps tables orderly and makes
the default output look intentional. Smooth resize follows the cursor exactly and gives people
control when they have a specific layout in mind.

We need one default behavior, plus a clear escape hatch if the default is too opinionated.
        `,
    });

    await task.createComment(
        cassCade,
        markdown`
I\u2019ll make a call by tomorrow. Please keep the thread focused on the tradeoff: what users feel
while dragging, how messy the output gets, and where the escape hatch should live.
        `,
        {overrideCreatedTime: new Date("2025-10-07T10:20:00-04:00")},
    );

    await waitForNotifications(runner);

    await task.createComment(
        mattRHorn,
        markdown`
The modifier-key compromise still seems right to me: snap by default, hold Alt for smooth. It keeps
normal docs tidy without blocking precise layout work when someone really needs it.
        `,
        {overrideCreatedTime: new Date("2025-10-07T10:47:00-04:00")},
    );

    await waitForNotifications(runner);

    return {task, path: `/task/${task.id}`, collection};
}

async function createChatRoomInboxEntry(
    {cassCade, mattRHorn}: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
    initialAccessPolicy: LocalAccessPolicy,
) {
    const chatRoom = await TestChat.createRoom(cassCade, {
        // Pin the chat ID so the account-pile preview (seeded by `Chat:${chatId}`) is
        // identical across runs. Without this the facepile members/order shuffle each run,
        // making the screenshot flaky.
        id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "tablesPairingChat"),
        name: "Tables pairing",
        access: initialAccessPolicy,
    });

    const sendMessage = async (...args: Parameters<TestChat["sendMessage"]>) => {
        const message = await chatRoom.sendMessage(...args);
        await runner.services.waitForSqsProcessJobs();
        return message;
    };

    const graphMessage = await sendMessage(
        cassCade,
        markdown`
omg also saw your post. the graph is really good
        `,
        {overrideCreatedTime: new Date("2025-10-16T10:09:00-04:00")},
    );
    await sendMessage(
        mattRHorn,
        markdown`
matt helped me clean it up
        `,
        {overrideCreatedTime: new Date("2025-10-16T10:11:00-04:00")},
    );
    await sendMessage(
        mattRHorn,
        markdown`
the first version had like 9 colors
        `,
        {overrideCreatedTime: new Date("2025-10-16T10:11:01-04:00")},
    );
    await sendMessage(
        cassCade,
        markdown`
lol of course it did
        `,
        {overrideCreatedTime: new Date("2025-10-16T10:12:00-04:00")},
    );
    const roseDebriefMessage = await sendMessage(
        cassCade,
        markdown`
rose loved the debrief btw. she\u2019s leaning yes. final call after the 2pm with them today
        `,
        {overrideCreatedTime: new Date("2025-10-17T08:34:00-04:00")},
    );
    await sendMessage(
        mattRHorn,
        markdown`
nice
        `,
        {overrideCreatedTime: new Date("2025-10-17T11:21:00-04:00")},
    );

    await graphMessage.setReaction(mattRHorn, "Happy");
    await roseDebriefMessage.setReaction(mattRHorn, "ThankYou");

    await waitForNotifications(runner);

    return {chatRoom, path: `/chat/${chatRoom.id}`};
}

async function screenshotInboxEntry(
    runner: ScreenshotTestRunner,
    session: DemoSpaceAccounts["cassCade"],
    spaceId: string,
    selectedSpacePath: string,
    orderKey: string,
    name: string,
    expectedText: string,
) {
    await runner.goto(
        session,
        `/inbox/${spaceId}?selected=${encodeSelectedSpacePath(selectedSpacePath)}`,
        {fixedTime: inboxScreenshotTime},
    );
    await runner.page.getByText(expectedText).first().waitFor();
    await runner.getByTestId("InboxViewEntries").waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot(orderKey, name);
}

async function waitForNotifications(runner: ScreenshotTestRunner) {
    await ProcessContextModule.waitForTestTasks();
    await runner.services.waitForSqsProcessJobs();
}

function encodeSelectedSpacePath(selectedSpacePath: string) {
    const textEncoder = new TextEncoder();
    return encodeBase64(textEncoder.encode(selectedSpacePath), "Rfc4648Url");
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

    // @ts-expect-error: TypeScript doesn't understand that `descendants()` is executed synchronously...
    return assertExists(range);
}

function createPlanningDocumentBody() {
    return Mustache.render(
        markdown`
Author: {{cassMention}}

Everything in here is WIP. I want input from each of you in your section by Friday. Rose and I will
finalize the week after.

A few notes coming in:

- The sync deploy incident at the end of August is the reason Elle\u2019s reliability work is P0
  this quarter. We don\u2019t want a repeat of that.
- Mason has tables far enough along that we can credibly commit to a ship date. We\u2019ve spent
  weeks on the design, and the remaining open questions are small.
- Holly\u2019s first case study just published and Cliff\u2019s pipeline is in the best shape
  it\u2019s been all year. We should keep that flywheel turning.

## Priorities

<table data-column-widths="1,3,3,3">
<thead>
<tr>
<th>

Priority

</th>
<th>

Project

</th>
<th>

Owner(s)

</th>
<th>

Outcome

</th>
</tr>
</thead>
<tbody>
<tr>
<td>

<mark class="highlight-red">P0</mark>

</td>
<td>

Tables in the rich text editor

</td>
<td>

{{masonMention}} + {{mattMention}}

</td>
<td>

GA rollout

</td>
</tr>
<tr>
<td>

<mark class="highlight-red">P0</mark>

</td>
<td>

Realtime reliability

</td>
<td>

{{elleMention}}

</td>
<td>

Remaining phases rolled out

</td>
</tr>
<tr>
<td>

<mark class="highlight-red">P0</mark>

</td>
<td>

Senior backend engineer hire

</td>
<td>

{{cassMention}} + {{roseMention}}

</td>
<td>

Offer accepted with Q4 start date

</td>
</tr>
<tr>
<td>

<mark class="highlight-orange">P1</mark>

</td>
<td>

Enterprise SSO scoping

</td>
<td>

{{elleMention}} + {{cliffMention}}

</td>
<td>

Reviewable design doc

</td>
</tr>
<tr>
<td>

<mark class="highlight-orange">P1</mark>

</td>
<td>

Customer case studies

</td>
<td>

{{hollyMention}}

</td>
<td>

Second published, third in draft

</td>
</tr>
<tr>
<td>

<mark class="highlight-blue">P2</mark>

</td>
<td>

Sales enablement (one-pager + demo script)

</td>
<td>

{{hollyMention}} + {{cliffMention}}

</td>
<td>

In Cliff\u2019s hands and used in live demos

</td>
</tr>
<tr>
<td>

<mark class="highlight-blue">P2</mark>

</td>
<td>

Editor interaction audit

</td>
<td>

{{mattMention}}

</td>
<td>

Living reference doc

</td>
</tr>
</tbody>
</table>
        `,
        {
            masonMention: "Mason Clay",
            elleMention: "Elle Kappa-Tan",
            cassMention: "Cass Cade",
            mattMention: "Matt R. Horn",
            roseMention: "Rose Compas",
            cliffMention: "Cliff Weathers",
            hollyMention: "Holly Evergreen",
        },
    );
}

// Needed so that we can convert all of the entities to site entities.
function getStandardizedAccessPolicy(accounts: DemoSpaceAccounts): LocalAccessPolicy {
    return {
        type: "Local",
        accountGrantById: new Map(
            mapIterable(Object.values(accounts), session => [
                session.account.id,
                {level: "Manage", generation: 0},
            ]),
        ),
        defaultGrant: {level: "Manage", generation: 1},
        urlGrant: null,
    };
}
