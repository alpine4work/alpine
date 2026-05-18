import {CalendarDateTime, today} from "@internationalized/date";
import Mustache from "mustache";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const debug = createDebug(import.meta.url);

export async function createFictionalAmbrookHeroFeed({
    cassCade,
    mattRHorn,
    elleKappaTan,
    masonClay,
    roseCompas,
    chatGpt,
    hollyEvergreen,
}: DemoSpaceAccounts & {
    chatGpt: TestBotAccount;
}) {
    debug("Creating feed");

    const {space} = cassCade;

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);
    const baseTime = new CalendarDateTime(currentDate.year, 5, 22, 9);

    const [{engineeringChannel, post: post1}, recruitingCollection, {kudosChannel, post: post2}] =
        await runAllPromises([
            (async () => {
                const engineeringChannel = await TestChannel.create(roseCompas, {
                    name: "Engineering",
                    access: "Public",
                });

                const roadmapDocument = await TestDocument.create(roseCompas, {
                    title: "Roadmap Q1 2026",
                    access: "Public",
                });

                const post = await engineeringChannel.createPost(
                    masonClay,
                    Mustache.render(
                        markdown`
[ChatGPT](https://alpine.inc/s/{{spaceId}}/accounts/{{chatGptAccountId}}?mention) please write an
executive summary of everything the engineering team worked in Q1 2026 and whether we met our
estimates from
[Product Roadmap (Q1 2026)](https://alpine.inc/s/{{spaceId}}/documents/{{roadmapDocumentId}}?mention).

cc [Cass](https://alpine.inc/s/{{spaceId}}/accounts/{{cassCadeAccountId}}?mention=short) let\u2019s
use this for our retro today
                        `,
                        {
                            spaceId: space.id,
                            chatGptAccountId: chatGpt.id,
                            roadmapDocumentId: roadmapDocument.id,
                            cassCadeAccountId: cassCade.account.id,
                        },
                    ),
                    {
                        overrideCreatedTime: baseTime
                            .subtract({days: 1})
                            .add({hours: 2, minutes: 2})
                            .toDate(timeZone),
                    },
                );

                // Make sure Cass has a loud notification.
                await retryWithExponentialBackoff(async retry => {
                    try {
                        const inboxEntry = await getInboxEntry(cassCade.action(), {
                            spaceId: space.id,
                            key: {type: "PostComments", postId: post.id},
                        });

                        assert(inboxEntry.model.loudNotificationCount === 1);
                    } catch (error) {
                        throw retry(error);
                    }
                });

                await post.setReaction(cassCade, "Celebrate");

                // Make sure Cass's reaction clears the loud notification.
                await retryWithExponentialBackoff(async retry => {
                    try {
                        const inboxEntry = await getInboxEntry(cassCade.action(), {
                            spaceId: space.id,
                            key: {type: "PostComments", postId: post.id},
                        });

                        assert(inboxEntry.model.loudNotificationCount === 0);
                    } catch (error) {
                        throw retry(error);
                    }
                });

                await post.setReaction(elleKappaTan, "Yes");

                await post.createComment(chatGpt, "Blah blah blah.");
                await post.createComment(elleKappaTan, "Blah blah blah.");
                await post.createComment(chatGpt, "Blah blah blah.");

                return {engineeringChannel, post};
            })(),
            (async () => {
                const recruitingCollection = await TestTaskCollection.create(roseCompas, {
                    name: "Recruiting",
                    access: "Public",
                });

                await recruitingCollection.updateColor(roseCompas, "red");

                await runAllPromises([
                    (async () => {
                        const task = await TestTask.create(roseCompas, {
                            title: "Interview Cara Bina",
                            collections: [recruitingCollection],
                            assignee: roseCompas,
                        });

                        await task.updateAssigneeStatus(roseCompas, "Active");
                    })(),
                    TestTask.create(roseCompas, {
                        title: "Add listing to CSM industry job board",
                        collections: [recruitingCollection],
                        assignee: roseCompas,
                    }),
                    TestTask.create(roseCompas, {
                        title: "LinkedIn candidate sourcing",
                        collections: [recruitingCollection],
                        assignee: roseCompas,
                    }),
                ]);

                return recruitingCollection;
            })(),
            (async () => {
                const kudosChannel = await TestChannel.create(roseCompas, {
                    name: "Kudos",
                    access: "Public",
                });

                const post = await kudosChannel.createPost(
                    hollyEvergreen,
                    Mustache.render(
                        markdown`
Kudos to [Matt R Horn](https://alpine.inc/s/{{spaceId}}/accounts/{{mattRHornAccountId}}?mention) for
designing our offsite swag. It looks soooo good!!
                        `,
                        {
                            spaceId: space.id,
                            mattRHornAccountId: mattRHorn.account.id,
                        },
                    ),
                    {
                        overrideCreatedTime: baseTime
                            .subtract({days: 1})
                            .add({hours: 0, minutes: 48})
                            .toDate(timeZone),
                    },
                );

                await post.setReaction(hollyEvergreen, "Celebrate");
                await post.setReaction(masonClay, "ThankYou");
                await post.setReaction(roseCompas, "Celebrate");
                await post.setReaction(cassCade, "Happy");
                await post.setReaction(elleKappaTan, "Yes");
                await post.setReaction(mattRHorn, "Heart");

                await post.createComment(mattRHorn, "Blah blah blah.");
                await post.createComment(roseCompas, "Blah blah blah.");
                await post.createComment(cassCade, "Blah blah blah.");
                await post.createComment(elleKappaTan, "Blah blah blah.");
                await post.createComment(mattRHorn, "Blah blah blah.");
                await post.createComment(mattRHorn, "Blah blah blah.");
                await post.createComment(mattRHorn, "Blah blah blah.");

                return {kudosChannel, post};
            })(),
        ]);

    const entries: Array<FeedEntry> = [
        {
            type: "Post",
            postId: post1.id,
            channelId: engineeringChannel.id,
            authorId: masonClay.account.id,
            createdTime: post1.createdTime,
        },
        {
            type: "TaskCollection",
            collectionId: recruitingCollection.id,
            sharedTime: baseTime.subtract({days: 1}).add({hours: 1, minutes: 32}).toDate(timeZone),
            sharerId: roseCompas.account.id,
            creatorId: roseCompas.account.id,
            event: "SharedWithAccessPolicyDefaultGrant",
        },
        {
            type: "Post",
            postId: post2.id,
            channelId: kudosChannel.id,
            authorId: hollyEvergreen.account.id,
            createdTime: post2.createdTime,
        },
    ];

    debug("Created feed");

    return entries;
}
