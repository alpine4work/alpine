import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestPushContextModules} from "~/server/dynamo/test_helpers/create_test_push_context_modules.js";
import {subscribeToChannel} from "~/server/forum/data/subscribe_to_channel.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {getInboxEntriesForAccount} from "~/server/notifications/data/get_inbox_entries_for_account.js";
import {getInboxForAccount} from "~/server/notifications/data/get_inbox_for_account.js";
import {processNotificationEvent} from "~/server/notifications/data/process/process_notification_event.js";
import {createNotificationsTestScenario} from "~/server/notifications/data/test_helpers/create_notifications_test_scenario.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

const context = createTestContext({
    processJob: async (context, job, _jobStartTime, span) => {
        if (job.type === "NotificationEvent") {
            await processNotificationEvent(context, job.event, span);
        }
    },
});

describe("getInboxEntriesForAccount()", () => {
    test("count of non-archived entries returned matches the Inbox entryCount rollup", async () => {
        const scenario = await createNotificationsTestScenario(context);
        const {space, session1, session2} = scenario;

        const [channelA, channelB] = await runAllPromises([
            TestChannel.create(session1),
            TestChannel.create(session1),
        ]);

        await runAllPromises([
            subscribeToChannel(session2.action(), channelA.id),
            subscribeToChannel(session2.action(), channelB.id),
        ]);

        // Two different non-archived entries for session2: a subscribed channel post and a
        // separate mention-comment in a different channel.
        await channelA.createPost(session1);
        const postB = await channelB.createPost(session1);
        await postB.createComment(session1, scenario.mentionAccount2MessageContent);

        await ProcessContextModule.waitForTestTasks();

        const [entries, inbox] = await runAllPromises([
            getInboxEntriesForAccount(session2.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
                limit: 100,
                afterCursor: null,
                filter: "New",
            }),
            getInboxForAccount(session2.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
            }),
        ]);

        expect(entries.items).toHaveLength(inbox.model.entryCount);
    });

    test("sum of loudNotificationCount across non-archived entries matches the Inbox loudNotificationCount rollup", async () => {
        const scenario = await createNotificationsTestScenario(context);
        const {space, session1, session2} = scenario;

        const [channelA, channelB] = await runAllPromises([
            TestChannel.create(session1),
            TestChannel.create(session1),
        ]);

        await runAllPromises([
            subscribeToChannel(session2.action(), channelA.id),
            subscribeToChannel(session2.action(), channelB.id),
        ]);

        // Two separate loud entries (one mention-comment per channel) plus one quiet
        // entry. With distinct posts the per-entry loud counts each contribute to the
        // rollup, which catches a regression that only counts loud entries instead of
        // summing them.
        const postA = await channelA.createPost(session1);
        await postA.createComment(session1, scenario.mentionAccount2MessageContent);

        const postB = await channelB.createPost(session1);
        await postB.createComment(session1, scenario.mentionAccount2MessageContent);

        await channelA.createPost(session1);

        await ProcessContextModule.waitForTestTasks();

        const [entries, inbox] = await runAllPromises([
            getInboxEntriesForAccount(session2.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
                limit: 100,
                afterCursor: null,
                filter: "New",
            }),
            getInboxForAccount(session2.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
            }),
        ]);

        const loudNotificationCountSum = entries.items.reduce(
            (sum, item) => sum + item.model.loudNotificationCount,
            0,
        );
        expect(loudNotificationCountSum).toBe(inbox.model.loudNotificationCount);
    });

    test("empty inbox returns no entries and a zero rollup", async () => {
        const scenario = await createNotificationsTestScenario(context);
        const {space, session2} = scenario;

        const [entries, inbox] = await runAllPromises([
            getInboxEntriesForAccount(session2.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
                limit: 100,
                afterCursor: null,
                filter: "New",
            }),
            getInboxForAccount(session2.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
            }),
        ]);

        expect(entries.items).toHaveLength(0);
        expect(inbox.model).toMatchObject({
            entryCount: 0,
            loudNotificationCount: 0,
        });
    });

    test("archiving a loud entry decrements both the entries query and the rollup", async () => {
        const scenario = await createNotificationsTestScenario(context);
        const {space, session1, session2} = scenario;

        const [quietChannel, loudChannel] = await runAllPromises([
            TestChannel.create(session1),
            TestChannel.create(session1),
        ]);

        await runAllPromises([
            subscribeToChannel(session2.action(), quietChannel.id),
            subscribeToChannel(session2.action(), loudChannel.id),
        ]);

        await quietChannel.createPost(session1);
        const loudPost = await loudChannel.createPost(session1);
        await loudPost.createComment(session1, scenario.mentionAccount2MessageContent);

        await ProcessContextModule.waitForTestTasks();

        await archiveInboxEntry(session2.action().clone(createTestPushContextModules()), {
            spaceId: space.id,
            key: {type: "PostComments", postId: loudPost.id},
        });

        const [entries, inbox] = await runAllPromises([
            getInboxEntriesForAccount(session2.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
                limit: 100,
                afterCursor: null,
                filter: "New",
            }),
            getInboxForAccount(session2.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
            }),
        ]);

        expect(entries.items).toHaveLength(1);
        expect(inbox.model).toMatchObject({
            entryCount: 1,
            loudNotificationCount: 0,
        });
    });

    test("`Done` filter returns no entries when only non-archived entries exist", async () => {
        const scenario = await createNotificationsTestScenario(context);
        const {space, session1, session2} = scenario;

        const channel = await TestChannel.create(session1);
        await subscribeToChannel(session2.action(), channel.id);

        await channel.createPost(session1);
        await ProcessContextModule.waitForTestTasks();

        const [doneEntries, inbox] = await runAllPromises([
            getInboxEntriesForAccount(session2.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
                limit: 100,
                afterCursor: null,
                filter: "Done",
            }),
            getInboxForAccount(session2.action(), {
                spaceId: space.id,
                accountId: session2.account.id,
            }),
        ]);

        expect(doneEntries.items).toHaveLength(0);
        // The rollup tracks non-archived entries only, so it should reflect the single
        // un-archived entry that the `Done` filter excludes.
        expect(inbox.model.entryCount).toBe(1);
    });
});
