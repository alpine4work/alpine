import Mustache from "mustache";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {screenshotFileEntity} from "~/app/screenshot_tests/helpers/screenshot_file_entity.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestSite} from "~/server/sites/test_helpers/test_site.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {ChatId} from "~/shared/id/types/id_types.js";

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {space, accounts} = await runner.createDemoSpace(context);

    // Create the loading chat in the background while doing all our other screenshot
    // work since it may take a while.
    const loadingChatPromise = (async () => {
        const loadingChat = await TestChat.createRoom(accounts.masonClay, {
            id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "loadingChat"),
            name: "Lorem Ipsum",
            access: "Private",
        });

        const loadingTimeBase = new Date("2025-10-14T15:24:00.000Z");

        for (let index = 0; index < 105; index++) {
            await loadingChat.sendMessage(
                accounts.masonClay,
                `Lorem ipsum dolor sit amet ${index + 1}`,
                {overrideCreatedTime: new Date(loadingTimeBase.getTime() + index)},
            );

            // Every 10 messages, wait for SQS jobs to complete.
            if ((index + 1) % 10 === 0) {
                await ProcessContextModule.waitForTestTasks();
                await runner.services.waitForSqsProcessJobs();
            }
        }

        await ProcessContextModule.waitForTestTasks();
        await runner.services.waitForSqsProcessJobs();

        return loadingChat;
    })();

    {
        const directOneOnOneChat = await TestChat.get(accounts.cassCade, accounts.elleKappaTan);

        await runner.goto(accounts.cassCade, `/chat/${directOneOnOneChat.id}`, {
            fixedTime: new Date("2025-10-02T21:00:00Z"),
        });
        await runner.screenshot("a0", "direct-one-on-one-empty");

        await createDirectOneOnOneChatMessages(directOneOnOneChat, accounts, runner);

        await runner.goto(accounts.cassCade, `/chat/${directOneOnOneChat.id}`, {
            fixedTime: new Date("2025-10-02T21:00:00Z"),
        });
        await runner.screenshot("a1", "direct-one-on-one");

        await runner.getByRole("button", {name: "More"}).first().click();
        await runner.screenshot("a2", "direct-one-on-one-more-menu");
    }

    {
        const directGroupChat = await TestChat.get(
            accounts.cassCade,
            accounts.elleKappaTan,
            accounts.masonClay,
            accounts.mattRHorn,
        );

        await runner.goto(accounts.cassCade, `/chat/${directGroupChat.id}`, {
            fixedTime: new Date("2025-10-02T21:00:00Z"),
        });
        await runner.screenshot("a3", "direct-group-empty");

        const {roseDecisionMessage: message} = await createDirectGroupChatMessages(
            directGroupChat,
            accounts,
            runner,
        );

        const messageModel = await message.get();
        assert(messageModel.payload.type === "Content");
        const messageAt = `${messageModel.payload.content.doc.content.size}@${
            messageModel.payload.contentUpdate?.mappings.length ?? 0
        }`;

        await runner.goto(accounts.cassCade, `/chat/${directGroupChat.id}`, {
            fixedTime: new Date("2025-10-02T21:00:00Z"),
        });
        await runner.screenshot("a4", "direct-group");

        await runner.getByRole("button", {name: "More"}).first().click();
        await runner.screenshot("a5", "direct-group-more-menu");

        await runner.getByRole("menuitem", {name: "Turn into chat room"}).click();
        await runner
            .getByText("Chat rooms are named and can be shared with more people.")
            .waitFor();

        await runner.screenshot("a6", "turn-into-room");

        await runner.goto(accounts.cassCade, `/chat/${directGroupChat.id}`, {
            fixedTime: new Date("2025-10-02T21:00:00Z"),
            peekPath: `/chat/${directGroupChat.id}/message/${message.index}/reactions?at=${messageAt}`,
        });
        await runner.screenshot("a7", "message-reactions");
    }

    const incidentResponseRoomChat = await TestChat.createRoom(accounts.cassCade, {
        id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "roomChat"),
        name: "Incident Response",
        access: "Public",
    });
    {
        await createRoomChatMessages(incidentResponseRoomChat, accounts, runner);

        await runner.goto(accounts.cassCade, `/chat/${incidentResponseRoomChat.id}`, {
            fixedTime: new Date("2025-10-02T21:00:00Z"),
        });
        await runner.screenshot("a8", "room");

        const oldRoomAccessPolicy = await incidentResponseRoomChat.roomAccess.get();
        assert(oldRoomAccessPolicy.type === "Local");
        await incidentResponseRoomChat.roomAccess.grantUrl(accounts.cassCade);

        await runner.goto(null, `/chat/${incidentResponseRoomChat.id}`);
        await runner.getByRole("heading", {name: "Incident Response"}).waitFor();
        await runner.getByText("No, the doc is doing its job").waitFor();
        await runner.screenshot("a9", "room-url-grant");

        // Screenshot the room standalone and inside a site (showing the site breadcrumb).
        // Reuses the existing "Incident Response" room; `screenshotFileEntity` adds it to
        // the site, screenshots, then removes it.
        const reliabilitySite = await TestSite.create(accounts.cassCade, {
            name: "Realtime Reliability",
            access: "Public",
        });
        await screenshotFileEntity(
            runner,
            accounts.cassCade,
            "a9",
            "aA",
            `Chat:${incidentResponseRoomChat.id}`,
            {
                siteOptions: {
                    site: reliabilitySite,
                    revertAccessPolicy: () =>
                        incidentResponseRoomChat.roomAccess.set(
                            accounts.cassCade,
                            oldRoomAccessPolicy,
                        ),
                },
            },
        );
    }

    await runner.goto(accounts.cassCade, `/dev/empty/${space.id}`, {
        fixedTime: new Date("2025-10-02T21:00:00Z"),
        peekPath: `/chat/new/${space.id}`,
    });
    await runner.screenshot("aA", "new");

    await runner.goto(accounts.cassCade, `/dev/empty/${space.id}`, {
        fixedTime: new Date("2025-10-02T21:00:00Z"),
        peekPath: `/chat/room/new/${space.id}`,
    });
    await runner.screenshot("aB", "new-room");

    {
        const loadingChat = await loadingChatPromise;

        await runner.goto(accounts.masonClay, `/chat/${loadingChat.id}`, {
            allowPauseNetwork: true,
        });

        await runner.pauseNetwork();
        await runner.getByTestId("MessagingScrollView").evaluate(element => {
            element.scrollTop = 0;
        });
        await runner.screenshot("aC", "chat-loading");
    }

    {
        const oldIncidentResponseRoomChatAccessPolicy =
            await incidentResponseRoomChat.roomAccess.get();

        // Open the peek against `/dev/empty` so the background is plain and the screenshot
        // focuses on the chat peek under test.
        await runner.goto(accounts.cassCade, `/dev/empty/${space.id}`, {
            fixedTime: new Date("2025-10-02T21:00:00Z"),
            peekPath: `/chat/${incidentResponseRoomChat.id}`,
        });
        await runner.getByRole("heading", {name: "Incident Response"}).first().waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("aD", "chat-peek");

        // Double click the room name to open the inline name editor. Wait for the editor
        // input to take focus so the focus ring and text selection are visible.
        await runner.getByTestId("PeekStackOverlay").getByText("Incident Response").dblclick();
        await runner
            .getByPlaceholder("Incident Response")
            .and(runner.page.locator(":focus"))
            .waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("aDE1", "chat-peek-name-editor");

        // Replace the name then click away. Losing focus asks for confirmation instead of
        // saving silently.
        await runner.getByPlaceholder("Incident Response").fill("Lorem ipsum");
        await runner.getByTestId("MessagingScrollView").first().click();
        await runner.getByText("Save chat name").waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("aDE3", "chat-peek-name-editor-confirm-save");

        // Discard the new name so the rest of the screenshots see the original name.
        await runner.getByRole("button", {name: "Discard name"}).click();
        await runner.getByTestId("PeekStackOverlay").getByText("Incident Response").waitFor();

        await runner
            .getByTestId("MessagingScrollView")
            .first()
            .evaluate(element => {
                element.scrollTop = 200;
            });
        await runner.mouse.move(0, 0);
        await runner.screenshot("aDS", "chat-peek-scrolled");

        const surveySite = await TestSite.create(accounts.cassCade, {
            name: "Operational Excellence",
            access: "Public",
        });
        await surveySite.addEntity(accounts.cassCade, {
            entityId: `Chat:${incidentResponseRoomChat.id}`,
            parentId: surveySite.initialRootContainerId,
            orderKey: initialOrderKey,
        });

        await ProcessContextModule.waitForTestTasks();
        await runner.services.waitForSqsProcessJobs();

        await runner.goto(accounts.cassCade, `/dev/empty/${space.id}`, {
            fixedTime: new Date("2025-10-02T21:00:00Z"),
            peekPath: `/chat/${incidentResponseRoomChat.id}`,
        });
        await runner.getByRole("heading", {name: "Incident Response"}).first().waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("aE", "chat-peek-in-site");

        // Double click the room name to open the inline name editor. Wait for the editor
        // input to take focus so the focus ring and text selection are visible.
        await runner.getByTestId("PeekStackOverlay").getByText("Incident Response").dblclick();
        await runner
            .getByPlaceholder("Incident Response")
            .and(runner.page.locator(":focus"))
            .waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("aEE1", "chat-peek-in-site-name-editor");

        // Replace the name then click away. Losing focus asks for confirmation instead of
        // saving silently.
        await runner.getByPlaceholder("Incident Response").fill("Lorem ipsum");
        await runner.getByTestId("MessagingScrollView").first().click();
        await runner.getByText("Save chat name").waitFor();
        await runner.mouse.move(0, 0);
        await runner.screenshot("aEE3", "chat-peek-in-site-name-editor-confirm-save");

        // Discard the new name so the rest of the screenshots see the original name.
        await runner.getByRole("button", {name: "Discard name"}).click();
        await runner.getByTestId("PeekStackOverlay").getByText("Incident Response").waitFor();

        // Same peek, scrolled — verifies the grown nav bar (chip + name + actions) stays
        // anchored at the top while the message list scrolls beneath it.
        await runner
            .getByTestId("MessagingScrollView")
            .first()
            .evaluate(element => {
                element.scrollTop = 200;
            });
        await runner.mouse.move(0, 0);
        await runner.screenshot("aF", "chat-peek-in-site-scrolled");

        await surveySite.removeEntity(accounts.cassCade, `Chat:${incidentResponseRoomChat.id}`);
        assert(oldIncidentResponseRoomChatAccessPolicy.type === "Local");
        await incidentResponseRoomChat.roomAccess.set(
            accounts.cassCade,
            oldIncidentResponseRoomChatAccessPolicy,
        );
    }
}

async function createDirectOneOnOneChatMessages(
    chat: TestChat,
    accounts: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
) {
    const {cassCade, elleKappaTan} = accounts;

    const sendMessage = async (...args: Parameters<TestChat["sendMessage"]>) => {
        const message = await chat.sendMessage(...args);
        await runner.services.waitForSqsProcessJobs();
        return message;
    };

    await sendMessage(
        cassCade,
        markdown`
hey, need your Q4 planning input by EOD friday. capacity estimates + what you want on the docket.
SSO scoping should go in there but you tell me what else
        `,
        {overrideCreatedTime: new Date("2025-09-29T10:47:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
short bullets are fine, don\u2019t over-engineer it
        `,
        {overrideCreatedTime: new Date("2025-09-29T10:47:01-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
yeah will do
        `,
        {overrideCreatedTime: new Date("2025-09-29T11:13:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
can i push back on one thing
        `,
        {overrideCreatedTime: new Date("2025-09-29T11:13:01-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
go
        `,
        {overrideCreatedTime: new Date("2025-09-29T11:14:00-04:00")},
    );

    const regionalFailoverMessage = await sendMessage(
        elleKappaTan,
        markdown`
the way you have the doc framed rn makes it sound like sso is the only infra thing for q4. realtime
isn\u2019t actually done. there\u2019s a second phase i want to scope: regional failover. and i
don\u2019t want it to disappear because sso is louder
        `,
        {overrideCreatedTime: new Date("2025-09-29T11:16:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
fair. add it, that\u2019s literally what the doc is for
        `,
        {overrideCreatedTime: new Date("2025-09-29T11:17:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
rough sizing? is this 2 weeks or 8
        `,
        {overrideCreatedTime: new Date("2025-09-29T11:17:01-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
closer to 8. ill write it up
        `,
        {overrideCreatedTime: new Date("2025-09-29T11:19:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
🙏
        `,
        {overrideCreatedTime: new Date("2025-09-29T11:19:01-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
side note: did you fill out the debrief for the candidate yesterday yet? rose wants to talk thursday
and i\u2019d like her to have it before then
        `,
        {overrideCreatedTime: new Date("2025-09-29T15:41:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
not yet
        `,
        {overrideCreatedTime: new Date("2025-09-29T15:58:00-04:00")},
    );

    const candidateDebriefMessage = await sendMessage(
        elleKappaTan,
        markdown`
will do it tonight. short version: hes good. system design was solid, asked the right questions,
didnt try to bs anything when he didnt know something
        `,
        {overrideCreatedTime: new Date("2025-09-29T15:59:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
only thing id flag is he kept reaching for managed solutions when wed probably want to build the
thing ourselves. but thats coachable and honestly might just be where he is rn
        `,
        {overrideCreatedTime: new Date("2025-09-29T16:00:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
ok thats helpful. just fill the form, even shorter than what you just typed is fine. rose will read
between the lines
        `,
        {overrideCreatedTime: new Date("2025-09-29T16:02:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
k
        `,
        {overrideCreatedTime: new Date("2025-09-29T16:02:01-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
debrief is in
        `,
        {overrideCreatedTime: new Date("2025-09-30T12:31:00-04:00")},
    );

    const reconnectSoakMessage = await sendMessage(
        elleKappaTan,
        markdown`
also pushed the new reconnection logic to staging last night. jittered backoff is in. ran the soak
test and the reconnect storm stays under 30% server load even with 50k clients reconnecting at once
        `,
        {overrideCreatedTime: new Date("2025-09-30T12:32:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
oh nice
        `,
        {overrideCreatedTime: new Date("2025-09-30T12:34:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
that\u2019s the thundering herd thing right
        `,
        {overrideCreatedTime: new Date("2025-09-30T12:34:01-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
yeah
        `,
        {overrideCreatedTime: new Date("2025-09-30T12:35:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
old failure mode was ~100% load for like 45 seconds and then the new instance would fall over and
the whole thing would cascade. now its a smooth ramp, peaks around 28% and decays in under a minute
        `,
        {overrideCreatedTime: new Date("2025-09-30T12:36:00-04:00")},
    );

    const writePostMessage = await sendMessage(
        cassCade,
        markdown`
love that. can you write it up in a post when you have a min? even just a paragraph. team will want
to know and tbh it\u2019s a good story for the q4 recap too
        `,
        {overrideCreatedTime: new Date("2025-09-30T12:37:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
on it
        `,
        {overrideCreatedTime: new Date("2025-09-30T12:38:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
cliff is asking again about sso timeline for Acme
        `,
        {overrideCreatedTime: new Date("2025-09-30T16:15:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
i told him you\u2019d give him a number when scoping was done. he\u2019s pushing because their
renewal is in jan
        `,
        {overrideCreatedTime: new Date("2025-09-30T16:15:01-04:00")},
    );

    const ssoRangeMessage = await sendMessage(
        elleKappaTan,
        markdown`
i can give him a range. q1 with risk. probably february if nothing weird shows up in saml provider
testing, march if it does
        `,
        {overrideCreatedTime: new Date("2025-09-30T16:33:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
but i dont want him quoting that to the customer as a date
        `,
        {overrideCreatedTime: new Date("2025-09-30T16:34:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
yeah no i\u2019ll handle that translation. can you ping him directly tho? he listens better when it
comes from you, and he\u2019ll have follow-up questions i can\u2019t answer
        `,
        {overrideCreatedTime: new Date("2025-09-30T16:35:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
sure
        `,
        {overrideCreatedTime: new Date("2025-09-30T16:36:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
you\u2019re the best!
        `,
        {overrideCreatedTime: new Date("2025-09-30T16:51:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
post is up
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:42:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
also cliff and i talked. he\u2019s fine with the range. he was already telling acme \u201Cearly next
year\u201D so this just gives him something to back it up
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:42:01-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
amazing. thank you for handling that
        `,
        {overrideCreatedTime: new Date("2025-10-01T10:08:00-04:00")},
    );

    const graphMessage = await sendMessage(
        cassCade,
        markdown`
omg also saw your post. the graph is really good
        `,
        {overrideCreatedTime: new Date("2025-10-01T10:09:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
matt helped me clean it up
        `,
        {overrideCreatedTime: new Date("2025-10-01T10:11:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
the first version had like 9 colors
        `,
        {overrideCreatedTime: new Date("2025-10-01T10:11:01-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
lol of course it did
        `,
        {overrideCreatedTime: new Date("2025-10-01T10:12:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
quick one: for q4, are you ok with mason continuing to own the editor stuff solo through end of
november? i know you two pair on cross-stack things and i want to make sure tables shipping
doesn\u2019t block you on anything
        `,
        {overrideCreatedTime: new Date("2025-10-01T13:48:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
yeah hes fine. tables is mostly client-side. the only server piece is the collab schema migration
and weve already done that
        `,
        {overrideCreatedTime: new Date("2025-10-01T13:55:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
if anything ill have more time once realtime closes out
        `,
        {overrideCreatedTime: new Date("2025-10-01T13:56:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
ok good. i\u2019ll plan around that
        `,
        {overrideCreatedTime: new Date("2025-10-01T13:57:00-04:00")},
    );

    const roseDebriefMessage = await sendMessage(
        cassCade,
        markdown`
rose loved the debrief btw. she\u2019s leaning yes. final call after the 2pm with them today
        `,
        {overrideCreatedTime: new Date("2025-10-02T08:34:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
nice
        `,
        {overrideCreatedTime: new Date("2025-10-02T11:21:00-04:00")},
    );

    await regionalFailoverMessage.setReaction(cassCade, "Yes");
    await candidateDebriefMessage.setReaction(cassCade, "ThankYou");
    await reconnectSoakMessage.setReaction(cassCade, "Celebrate");
    await writePostMessage.setReaction(elleKappaTan, "Yes");
    await ssoRangeMessage.setReaction(cassCade, "ThankYou");
    await graphMessage.setReaction(elleKappaTan, "Happy");
    await roseDebriefMessage.setReaction(elleKappaTan, "ThankYou");

    await runner.services.waitForSqsProcessJobs();
}

async function createDirectGroupChatMessages(
    chat: TestChat,
    accounts: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
) {
    const {cassCade, elleKappaTan, masonClay, mattRHorn} = accounts;

    const sendMessage = async (...args: Parameters<TestChat["sendMessage"]>) => {
        const message = await chat.sendMessage(...args);
        await runner.services.waitForSqsProcessJobs();
        return message;
    };

    const latestTablesBuildMessage = await sendMessage(
        masonClay,
        markdown`
latest tables build is on staging if anyone wants to poke at it
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:14:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
the thing i want eyes on is column resize. drag the border and width tracks your cursor. so the
smooth option, not snapping
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:14:01-04:00")},
    );

    const nestedListsMessage = await sendMessage(
        masonClay,
        markdown`
also: nested lists inside cells work now, copy/paste from sheets does something reasonable in 4 out
of 5 cases
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:15:00-04:00")},
    );

    await sendMessage(
        mattRHorn,
        markdown`
I\u2019ll dig in this afternoon. Quick reaction from what you posted in the design review: I\u2019m
still not sold on smooth resize.
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:32:00-04:00")},
    );

    const proportionalSpacingMessage = await sendMessage(
        mattRHorn,
        markdown`
When typewriters moved from monospaced to proportional spacing, an entire craft of layout had to be
relearned, and most early proportional documents looked terrible because people kept reaching for
the freedom they\u2019d just been given. The freedom to put a column at any pixel width is the same
kind of trap. Most users don\u2019t actually want pixel-precise control—they want columns that look
right next to each other, and a free drag makes that harder, not easier.
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:34:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
idk feels heavy
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:35:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
every other table tool i\u2019ve used lets you drag freely. lowkey think users will be annoyed if it
snaps when they\u2019re trying to hit a specific width
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:35:01-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
doesnt matter to me as long as the width is just a number on the cell node. snap or no snap is a
client decision, the backend doesnt care
        `,
        {overrideCreatedTime: new Date("2025-09-30T10:41:00-04:00")},
    );

    const decisionDocMessage = await sendMessage(
        cassCade,
        markdown`
Ok let\u2019s not relitigate this in chat. Matt, put the snap argument in the design doc with
examples. Mason, same for smooth. I\u2019ll read both and call it Monday.
        `,
        {overrideCreatedTime: new Date("2025-09-30T11:02:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
Also tbf the every-other-tool-does-it thing isn\u2019t a strong argument by itself, you both know
that.
        `,
        {overrideCreatedTime: new Date("2025-09-30T11:03:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
fair
        `,
        {overrideCreatedTime: new Date("2025-09-30T11:04:00-04:00")},
    );

    await sendMessage(
        mattRHorn,
        markdown`
Added to the doc. New section: \u201CColumn resizing—why snap\u201D Three examples, including the
1984 Mac printer driver bit if anyone has the patience.
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:18:00-04:00")},
    );

    const auditNotesMessage = await sendMessage(
        mattRHorn,
        markdown`
Also linked it to the audit notes from week 2. Image resizing in our editor already snaps to a
12-column grid. If we go smooth on tables we\u2019ll have two interaction models for resizable
things in the same surface, which is exactly the kind of inconsistency the audit was supposed to
head off.
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:19:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
hm
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:21:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
ok that\u2019s a real point. didn\u2019t have the image grid in my head
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:21:01-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
will write mine up tonight. probably won\u2019t change my mind but i want the case in the doc
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:22:00-04:00")},
    );

    const imageGridMessage = await sendMessage(
        elleKappaTan,
        markdown`
fwiw the image grid was only added bc continuous was producing genuinely bad layouts in shared docs.
people would resize on a wide monitor and it would look broken on everyone elses screen
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:24:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
not arguing for either, just data
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:25:00-04:00")},
    );

    await sendMessage(
        mattRHorn,
        markdown`
That\u2019s exactly the argument.
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:31:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
ok
        `,
        {overrideCreatedTime: new Date("2025-09-30T14:34:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
Read both sections. Talking to Rose at 11. Will land somewhere by EOD.
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:08:00-04:00")},
    );

    const modifierKeyMessage = await sendMessage(
        mattRHorn,
        markdown`
A possibility worth considering: modifier key for the override. Snap by default, hold a key for
smooth. We get the consistent-by-default behavior and the power user escape hatch at the same time.
I\u2019d argue for Alt; Shift is already overloaded for multi-select.
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:33:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
wait i actually like that
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:34:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
alt makes sense. shift is taken in like 4 places already
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:35:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
yeah alt is fine. shift+drag does range select in the cell selection model so dont put it on shift
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:38:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
Ok hold that thought, let me talk to Rose first before we lock anything in.
        `,
        {overrideCreatedTime: new Date("2025-10-01T09:39:00-04:00")},
    );

    const roseDecisionMessage = await sendMessage(
        cassCade,
        markdown`
Talked to Rose. She\u2019s good with snap-by-default + alt-for-smooth.
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:47:00-04:00")},
    );

    await sendMessage(
        cassCade,
        markdown`
Mason: can you spec out the modifier behavior in your task? Matt: please update the design doc to
reflect the decision and drop the back-and-forth sections so it reads as the final answer.
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:47:01-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
on it
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:48:00-04:00")},
    );

    await sendMessage(
        mattRHorn,
        markdown`
Will do.
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:49:00-04:00")},
    );

    const percentSnapMessage = await sendMessage(
        mattRHorn,
        markdown`
We should pick the snap intervals carefully. My instinct is percentages of the document width (10%,
12.5%, 16.66%, 20%, 25%, 33%, 50%), not pixels. Pixels are meaningless when documents reflow.
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:51:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
agreed on percentages. think 8 stops is too many tho if we\u2019re trying to be opinionated. 5 is
probably the sweet spot
        `,
        {
            parent: {
                type: "MessagesRange",
                startIndex: percentSnapMessage.index,
                endIndex: percentSnapMessage.index,
                startContentVersion: 0,
                endContentVersion: 0,
                startPos: 46,
                endPos: 94,
            },
            overrideCreatedTime: new Date("2025-10-01T12:53:00-04:00"),
        },
    );

    const snapIntervalsMessage = await sendMessage(
        mattRHorn,
        markdown`
Let\u2019s try 5 and tune.
        `,
        {overrideCreatedTime: new Date("2025-10-01T12:54:00-04:00")},
    );

    const finalThanksMessage = await sendMessage(
        cassCade,
        markdown`
Love it. Thanks all!
        `,
        {overrideCreatedTime: new Date("2025-10-02T11:27:00-04:00")},
    );

    await latestTablesBuildMessage.setReaction(cassCade, "Celebrate");
    await nestedListsMessage.setReaction(cassCade, "Celebrate");
    await proportionalSpacingMessage.setReaction(masonClay, "No");
    await decisionDocMessage.setReaction(masonClay, "Yes");
    await decisionDocMessage.setReaction(mattRHorn, "Yes");
    await auditNotesMessage.setReaction(cassCade, "Yes");
    await imageGridMessage.setReaction(mattRHorn, "ThankYou");
    await modifierKeyMessage.setReaction(cassCade, "Yes");
    await modifierKeyMessage.setReaction(masonClay, "Heart");
    await roseDecisionMessage.setReaction(masonClay, "Celebrate");
    await roseDecisionMessage.setReaction(mattRHorn, "Yes");
    await snapIntervalsMessage.setReaction(cassCade, "Yes");
    await finalThanksMessage.setReaction(masonClay, "Celebrate");

    await runner.services.waitForSqsProcessJobs();

    return {roseDecisionMessage};
}

async function createRoomChatMessages(
    chat: TestChat,
    accounts: DemoSpaceAccounts,
    runner: ScreenshotTestRunner,
) {
    const {
        cassCade,
        cliffWeathers,
        elleKappaTan,
        hollyEvergreen,
        masonClay,
        mattRHorn,
        roseCompas,
    } = accounts;

    const sendMessage = async (...args: Parameters<TestChat["sendMessage"]>) => {
        const message = await chat.sendMessage(...args);
        await runner.services.waitForSqsProcessJobs();
        return message;
    };

    await sendMessage(
        elleKappaTan,
        markdown`
seeing a spike in websocket disconnects starting ~8:09. only \`us-east-2\` and \`us-east-1\` so far,
west coast is clean
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:14:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
pulling the deploy log now
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:14:01-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
yeah this is us. the 7:55 deploy. rolling it back
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:16:00-04:00")},
    );

    const supportPingMessage = await sendMessage(
        masonClay,
        Mustache.render(
            markdown`
{{hollyMention}} already has 2 in support saying chat isn\u2019t updating. Pulling her in
            `,
            {
                hollyMention: `[](https://alpine.inc/mention/${accounts.hollyEvergreen.account.id}#short)`,
            },
        ),
        {overrideCreatedTime: new Date("2025-09-03T08:17:00-04:00")},
    );

    await sendMessage(
        roseCompas,
        markdown`
How bad is it?
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:18:00-04:00")},
    );

    const impactMessage = await sendMessage(
        elleKappaTan,
        markdown`
docs and chat still load on refresh. live updates are broken til the page reloads. messages send,
they just dont render on the other side until the recipient refreshes. data is fine, nothing is lost
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:19:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
~12% of active sessions, concentrated east coast
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:19:01-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
rollback is in flight, ~3 min for instances to drain
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:21:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
I have a frontend hotfix ready that forces a reconnect on idle if the rollback doesn\u2019t clear
it. Won\u2019t ship unless we need it
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:25:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
hold it. rollback should be enough. one moving part at a time
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:27:00-04:00")},
    );

    const hollyTicketsMessage = await sendMessage(
        hollyEvergreen,
        markdown`
4 tickets so far, all variations of \u201Cchat seems frozen\u201D or \u201Cdid I lose
messages.\u201D Nobody is angry yet, just confused
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:31:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
disconnect rate is back to baseline. clients reattaching cleanly
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:33:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
fix confirmed. watching the next 30 min before i call it
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:34:00-04:00")},
    );

    await sendMessage(
        roseCompas,
        markdown`
What do I tell people?
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:36:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
something like:

> Between 8:09 and 8:34 AM ET, roughly 1 in 8 users saw stale realtime updates in documents and
> chat. No data was lost. Content was delayed until the affected page was refreshed. Expect a full
> postmortem soon.
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:37:00-04:00")},
    );

    await sendMessage(
        roseCompas,
        markdown`
Copying that almost verbatim. Thank you.
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:38:00-04:00")},
    );

    await sendMessage(
        roseCompas,
        Mustache.render(
            markdown`
Also {{elleMention}}, postmortem by Friday. And I want this one to have clear action items.
It\u2019s the second deploy-induced incident this quarter. This can\u2019t happen again.
            `,
            {
                elleMention: `[](https://alpine.inc/mention/${accounts.elleKappaTan.account.id}#short)`,
            },
        ),
        {overrideCreatedTime: new Date("2025-09-03T08:39:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
ok. already started writing a postmortem
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:40:00-04:00")},
    );

    await sendMessage(
        hollyEvergreen,
        markdown`
Replied to all open tickets. One customer made a joke about us \u201Cvibing with the network
gods,\u201D the rest were chill
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:42:00-04:00")},
    );

    const tShirtMessage = await sendMessage(
        masonClay,
        markdown`
\u201CVibing with the network gods\u201D is going on a t-shirt
        `,
        {overrideCreatedTime: new Date("2025-09-03T08:43:00-04:00")},
    );

    const stableMessage = await sendMessage(
        elleKappaTan,
        markdown`
called it stable. 90 min clean, no anomalies. closing the active incident.
        `,
        {overrideCreatedTime: new Date("2025-09-03T11:48:00-04:00")},
    );

    const followupsMessage = await sendMessage(
        elleKappaTan,
        markdown`
followups in the postmortem doc, but the headline ones:

- reconnection logic on the client needs jittered backoff (this would have masked most of the
  user-visible symptom even with the bad deploy)
- deploys should drain a single AZ at a time, not a whole region
- add a synthetic that exercises the websocket fanout post-deploy so we catch this in the canary
  instead of in production
        `,
        {overrideCreatedTime: new Date("2025-09-03T11:49:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
the first one is its own multi-week project. im going to scope it as the next thing i pick up after
the immediate deploy guardrails
        `,
        {overrideCreatedTime: new Date("2025-09-03T11:50:00-04:00")},
    );

    await sendMessage(
        roseCompas,
        markdown`
Good. That\u2019s exactly the framing I wanted.
        `,
        {overrideCreatedTime: new Date("2025-09-03T11:52:00-04:00")},
    );

    const praiseMessage = await sendMessage(
        roseCompas,
        markdown`
This was handled really well Elle, thank you.
        `,
        {overrideCreatedTime: new Date("2025-09-03T11:53:00-04:00")},
    );

    await sendMessage(
        cliffWeathers,
        markdown`
Search isn\u2019t finding the demo doc I made 20 min ago. Is that on me or is there an issue?
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:18:00-04:00")},
    );

    const demoConcernMessage = await sendMessage(
        cliffWeathers,
        markdown`
Asking because I\u2019m about to do this demo and I\u2019d rather know now lol
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:19:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
It\u2019s a bug. Checking
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:19:01-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
opensearch ingestion lag. queue depth chart looks like a wall
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:21:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
something started backing up around 9:45 and hasnt drained since
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:22:00-04:00")},
    );

    await sendMessage(
        masonClay,
        markdown`
Indexer node count looks normal, CPU is fine. Doesn\u2019t look like a capacity issue
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:24:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
yeah its not capacity. one consumer is bricked. looking at the log now
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:26:00-04:00")},
    );

    const wedgedIndexerMessage = await sendMessage(
        elleKappaTan,
        markdown`
found it. one of the indexers is stuck retrying the same document. its got ~14k child comments and
the indexer is choking on the serialization step. the retry loop is blocking the whole partition
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:31:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
other partitions are draining normally. so this is localized, not a full outage
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:32:00-04:00")},
    );

    await sendMessage(
        roseCompas,
        markdown`
How visible is this externally? Trying to figure out if I need to say anything.
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:33:00-04:00")},
    );

    const mildImpactMessage = await sendMessage(
        masonClay,
        markdown`
Not really visible. Search works, you just won\u2019t find anything you created in roughly the last
90 min. Anything older is fine. Most users won\u2019t notice
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:35:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
killing the wedged worker. the doc will get reindexed in a separate pass that wont block. queue
should drain inside 15 min
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:37:00-04:00")},
    );

    await sendMessage(
        roseCompas,
        markdown`
Ok, no comms. Just keep me posted.
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:38:00-04:00")},
    );

    await sendMessage(
        cliffWeathers,
        markdown`
Demo is at 12:30 so genuinely fine for me, I was being dramatic
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:39:00-04:00")},
    );

    const auditDocMessage = await sendMessage(
        masonClay,
        Mustache.render(
            markdown`
Also lol, the 14k-comments doc is {{mattMention}}\u2019s editor interaction audit. Of course it is
            `,
            {
                mattMention: `[](https://alpine.inc/mention/${accounts.mattRHorn.account.id}#short)`,
            },
        ),
        {overrideCreatedTime: new Date("2025-10-09T11:42:00-04:00")},
    );

    await sendMessage(
        elleKappaTan,
        markdown`
ofc
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:43:00-04:00")},
    );

    const mattCalledMessage = await sendMessage(
        mattRHorn,
        markdown`
I\u2019m sorry, I\u2019ve been called.
        `,
        {overrideCreatedTime: new Date("2025-10-09T11:43:01-04:00")},
    );

    const finalAuditMessage = await sendMessage(
        masonClay,
        markdown`
No, the doc is doing its job. It\u2019s just doing it really hard
        `,
        {
            parent: mattCalledMessage,
            overrideCreatedTime: new Date("2025-10-09T11:44:00-04:00"),
        },
    );

    await supportPingMessage.setReaction(hollyEvergreen, "Yes");
    await impactMessage.setReaction(roseCompas, "ThankYou");
    await hollyTicketsMessage.setReaction(roseCompas, "Heart");
    await tShirtMessage.setReaction(hollyEvergreen, "Laugh");
    await tShirtMessage.setReaction(roseCompas, "No");
    await stableMessage.setReaction(roseCompas, "Celebrate");
    await followupsMessage.setReaction(masonClay, "Yes");
    await followupsMessage.setReaction(roseCompas, "ThankYou");
    await praiseMessage.setReaction(elleKappaTan, "ThankYou");
    await demoConcernMessage.setReaction(masonClay, "Yes");
    await wedgedIndexerMessage.setReaction(masonClay, "Yes");
    await mildImpactMessage.setReaction(roseCompas, "ThankYou");
    await auditDocMessage.setReaction(elleKappaTan, "Lolsob");
    await auditDocMessage.setReaction(mattRHorn, "Laugh");
    await finalAuditMessage.setReaction(mattRHorn, "Laugh");
    await finalAuditMessage.setReaction(cassCade, "Laugh");

    await runner.services.waitForSqsProcessJobs();
}
