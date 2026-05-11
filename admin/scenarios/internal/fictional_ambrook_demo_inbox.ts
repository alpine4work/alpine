import {CalendarDateTime, today} from "@internationalized/date";
import Mustache from "mustache";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {getInbox} from "~/server/notifications/data/get_inbox.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {
    InboxChannelPostsEntryModel,
    InboxDocumentNewCommentThreadsEntryModel,
} from "~/shared/notifications/inbox_model.js";

const debug = createDebug(import.meta.url);

export async function createFictionalAmbrookDemoInbox({
    cassCade,
    mattRHorn,
    elleKappaTan,
    masonClay,
    cliffWeathers,
    roseCompas,
    hollyEvergreen,
}: DemoSpaceAccounts) {
    debug("Creating inbox");

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);

    const {space} = cassCade;

    const demoAccount = await space.createSession({name: "Cass Cade Inbox Demo Account"});

    // Allow us to wait and make sure `NotificationEvent` is processed and we have the
    // expected number of inbox entries for our demo.
    const waitFor = async (count: number) => {
        await retryWithExponentialBackoff(async retry => {
            try {
                const inbox = await getInbox(demoAccount.action(), {spaceId: space.id});

                assert(
                    inbox.model.entryCount === count,
                    `Expected ${count} inbox entries, got ${inbox.model.entryCount} inbox entries`,
                );
            } catch (error) {
                throw retry(error);
            }
        });
    };

    await waitFor(0);

    {
        const channel = await TestChannel.create(demoAccount, {
            name: "Marketing",
            access: "Public",
        });

        await channel.createPost(
            cliffWeathers,
            markdown`
I updated our content calendar task collection for June:
            `,
            {
                overrideCreatedTime: new CalendarDateTime(
                    currentDate.year,
                    currentDate.month,
                    currentDate.day,
                    9,
                    1,
                ).toDate(timeZone),
            },
        );

        await channel.createPost(
            roseCompas,
            markdown`
Blah blah blah.
            `,
            {
                overrideCreatedTime: new CalendarDateTime(
                    currentDate.year,
                    currentDate.month,
                    currentDate.day,
                    9,
                    2,
                ).toDate(timeZone),
            },
        );

        // Make sure we've created the `ChannelPosts` inbox entry and it has the right
        // number of posts.
        await retryWithExponentialBackoff(async retry => {
            try {
                const inboxEntry = await getInboxEntry(demoAccount.action(), {
                    spaceId: space.id,
                    key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
                });

                assert(inboxEntry.model instanceof InboxChannelPostsEntryModel);
                assert(inboxEntry.model.postIds.size === 2);
            } catch (error) {
                throw retry(error);
            }
        });

        await channel.createPost(
            mattRHorn,
            markdown`
                Our first foray into podcast advertising is going great! We\u2019re seeing a lot
                more sign ups than we expected coming from the campaign\u2019s vanity URLs. What are
                some of the podcasts y\u2019all listen to that you think we should buy ad spots on
                next month?
            `,
            {
                overrideCreatedTime: new CalendarDateTime(
                    currentDate.year,
                    currentDate.month,
                    currentDate.day,
                    9,
                    3,
                ).toDate(timeZone),
            },
        );

        // Make sure we've created the `ChannelPosts` inbox entry and it has the right
        // number of posts.
        await retryWithExponentialBackoff(async retry => {
            try {
                const inboxEntry = await getInboxEntry(demoAccount.action(), {
                    spaceId: space.id,
                    key: {type: "ChannelPosts", channelId: channel.id, bucketGeneration: 0},
                });

                assert(inboxEntry.model instanceof InboxChannelPostsEntryModel);
                assert(inboxEntry.model.postIds.size === 3);
            } catch (error) {
                throw retry(error);
            }
        });
    }

    await waitFor(1);
    debug("Created inbox entry 1");

    {
        const collection = await TestTaskCollection.create(demoAccount, {
            name: "Test",
            access: "Public",
        });

        const task = await TestTask.create(demoAccount, {
            title: "Customer quotes carousel",
            collections: [collection],
        });

        await task.createComment(
            cliffWeathers,
            Mustache.render(
                markdown`
[Cass](https://alpine.inc/s/{{spaceId}}/accounts/{{cassCadeAccountId}}?mention=short) are you sure
we have publicity rights for this customer?
                `,
                {
                    spaceId: space.id,
                    cassCadeAccountId: demoAccount.account.id,
                },
            ),
        );
    }

    await waitFor(2);
    debug("Created inbox entry 2");

    {
        const chat = await TestChat.get(demoAccount, masonClay);
        await chat.sendMessage(masonClay, "You free to chat about this bug?");
    }

    await waitFor(3);
    debug("Created inbox entry 3");

    const document = await TestDocument.create(demoAccount, {
        access: "Public",
        title: "Q2 Product Roadmap",
        body: Mustache.render(
            markdown`
| Project                  | DRI                                                                       | Priority <span hidden data-column-widths="4,3,2"/> |
| ------------------------ | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Receipt Mobile Scanner   | [Mason Clay]({{spaceUrl}}/accounts/{{masonClayAccountId}}?mention)        | <mark class="highlight-blue">Low</mark>            |
| Profit by Acre Dashboard | [Elle Kappa-Tan]({{spaceUrl}}/accounts/{{elleKappaTanAccountId}}?mention) | <mark class="highlight-red">High</mark>            |
| Grants Navigator         | [Cass Cade]({{spaceUrl}}/accounts/{{cassCadeAccountId}}?mention)          | <mark class="highlight-orange">Medium</mark>       |

As the quarter continues we\u2019ll reevaluate our approach. We don\u2019t expect to sign many large
businesses this quarter (instead, we\u2019re looking to go up market in Q4) but that may change if
we end up getting a lot of inbound interest from enterprise customers. If we do move upmarket
earlier than expected we\u2019ll need to prioritize some new projects.

- Blah
- Blah
- Blah
- Blah

# Receipt Mobile Scanner

## Problem & context

Our customers live in receipts: fuel, feed, parts, repairs, lodging, trucking. Today, most of those
end up in glove boxes and shoeboxes, then get dumped on an accountant once or twice a year. That
leads to missing documents, manual data entry, and a constant lag between spending money and
understanding where it went.

## Proposed solution

Build a dead-simple mobile flow to capture receipts in the field the moment they\u2019re handed
over. A user snaps a photo (even offline), the app queues and syncs it when connectivity returns,
and OCR extracts key fields (vendor, date, total, tax, category). Receipts then appear in our app as
structured records, ready to review, tag, and export.

## Primary users

- Farm / ranch owners and managers logging expenses on the go

- Bookkeepers who clean up and categorize receipts

- Accountants who need complete, well-structured records at tax time

## Goals

- Dramatically increase the percentage of receipts captured within 24 hours of the expense

- Reduce manual keying of totals/dates/vendor for both operators and bookkeepers

- Make it trivial to pull complete, exportable support for expenses at month‑end and year‑end
            `,
            {
                spaceUrl: `https://alpine.inc/s/${space.id}`,
                masonClayAccountId: masonClay.account.id,
                elleKappaTanAccountId: elleKappaTan.account.id,
                cassCadeAccountId: cassCade.account.id,
            },
        ),
    });

    {
        const commentThread1 = await document.createCommentThread(
            roseCompas,
            {from: 57, to: 79},
            markdown`
This project should be high priority! It\u2019s a feature our customers are constantly asking us
for. What can we deprioritize to get this done this quarter?
            `,
            {
                overrideCreatedTime: new CalendarDateTime(
                    currentDate.year,
                    currentDate.month,
                    currentDate.day,
                    10,
                    23,
                ).toDate(timeZone),
            },
        );

        await commentThread1.firstComment.setReaction(roseCompas, "Yes");

        const commentThread2 = await document.createCommentThread(
            elleKappaTan,
            {from: 1054, to: 1123},
            "offline is hard blah blah blah",
        );

        await commentThread2.resolve(elleKappaTan);

        await document.createCommentThread(roseCompas, {from: 531, to: 535}, "Blah blah blah.");

        await document.createCommentThread(roseCompas, {from: 539, to: 543}, "Blah blah blah.");

        await document.createCommentThread(roseCompas, {from: 547, to: 551}, "Blah blah blah.");

        // Make sure we've created the `ChannelPosts` inbox entry and it has the right
        // number of posts.
        await retryWithExponentialBackoff(async retry => {
            try {
                const inboxEntry = await getInboxEntry(demoAccount.action(), {
                    spaceId: space.id,
                    key: {
                        type: "DocumentNewCommentThreads",
                        documentId: document.id,
                        bucketGeneration: 0,
                    },
                });

                assert(inboxEntry.model instanceof InboxDocumentNewCommentThreadsEntryModel);
                assert(inboxEntry.model.commentThreadIds.size === 5);
            } catch (error) {
                throw retry(error);
            }
        });
    }

    await waitFor(4);
    debug("Created inbox entry 4");

    const channel = await TestChannel.create(demoAccount, {
        name: "Announcements",
        access: "Public",
    });

    await channel.createPost(
        hollyEvergreen,
        markdown`
Reminder, open enrollment is ending soon! Log onto our HR portal and make sure your health insurance
information is up to date.
        `,
    );

    await waitFor(5);
    debug("Created inbox entry 5");

    debug("Created inbox");

    return demoAccount;
}
