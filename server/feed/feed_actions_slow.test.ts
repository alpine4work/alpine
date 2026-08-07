import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    getAndUpdateFeedEntries,
    processAddFeedAccountCandidateEntryJob,
    processAddFeedCandidateEntryJob,
} from "~/server/feed/feed_actions.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestPost} from "~/server/forum/test_helpers/test_post.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {FeedPostEntryModel} from "~/shared/feed/feed_entry_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

import.meta.jest.useFakeTimers();

const context = createTestContext({
    forumInjection,
    processJob: async (context, job) => {
        if (job.type === "AddFeedCandidateEntry") {
            await processAddFeedCandidateEntryJob(context, job);
        }

        if (job.type === "AddFeedAccountCandidateEntry") {
            await processAddFeedAccountCandidateEntryJob(context, job);
        }
    },
});

test(
    "limits the number of candidate entries we add to a new account\u2019s feed",
    async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();

        const channel = await TestChannel.create(session1);
        const posts: Array<TestPost> = [];

        for (let i = 0; i < 1050; i++) {
            import.meta.jest.advanceTimersByTime(1000);
            posts.push(await channel.createPost(session1));
            await ProcessContextModule.waitForTestTasks();
        }

        const session2 = await space.createSession();

        expect(
            await getAndUpdateFeedEntries(session2.action(), {
                spaceId: space.id,
                limit: 1000,
            }),
        ).toEqual({
            startCursor: [50, 0],
            endCursor: [0, 0],
            hasMoreEntries: false,
            entries: [
                ...(await runAllPromises(
                    Array.from(posts)
                        .reverse()
                        .slice(0, 500)
                        .map(
                            async post => new FeedPostEntryModel({post: await post.getRealtime()}),
                        ),
                )),
                {
                    type: "Welcome",
                    addedTime: expect.any(Date),
                    emailDomainWithAutoAddAccountsEnabled: null,
                },
            ],
            wasFeedCreated: true,
        });
    },
    // Match Bazel's `medium` test size timeout.
    300 * 1000,
);
