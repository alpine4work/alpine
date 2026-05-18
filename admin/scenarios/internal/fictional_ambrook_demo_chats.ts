import {CalendarDateTime, today} from "@internationalized/date";
import {addSeconds} from "date-fns";
import Mustache from "mustache";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {parseTestMessageContent} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const debug = createDebug(import.meta.url);

export async function createFictionalAmbrookDemoChats(
    tokenAgent: TokenAgent,
    accounts: DemoSpaceAccounts & {
        chatGpt: TestBotAccount;
    },
) {
    return runAllPromises([
        createFictionalAmbrookDemoChat1(tokenAgent, accounts),
        createFictionalAmbrookDemoChat2(tokenAgent, accounts),
    ]);
}

async function createFictionalAmbrookDemoChat1(
    tokenAgent: TokenAgent,
    {
        cassCade,
        elleKappaTan,
        mattRHorn,
    }: DemoSpaceAccounts & {
        chatGpt: TestBotAccount;
    },
) {
    debug("Creating chat 1");

    const {space} = cassCade;

    const timeZone = getCurrentTimeZone();
    const currentDate = today(timeZone);
    const baseTime = new CalendarDateTime(currentDate.year, 5, 22, 9);

    const chat = await TestChat.get(cassCade, elleKappaTan);

    await chat.sendMessage(
        elleKappaTan,
        markdown`
hey i know you\u2019re probably still off the grid on your adventure but just lmk when you\u2019re
back in civilization
        `,
        {
            overrideCreatedTime: baseTime.toDate(timeZone),
        },
    );

    const firstMessage = await chat.sendMessage(
        cassCade,
        Mustache.render(
            markdown`
Hi Elle! I finally made it back to land today

There were some weather delays which is why I didn\u2019t respond sooner, but everything is good!
I\u2019m pretty tired but I\u2019ll send you +
[Matt](https://alpine.inc/s/{{spaceId}}/accounts/{{mattRHornAccountId}}?mention=short) the
sorted/tagged customer feedback as soon as I can
            `,
            {
                spaceId: space.id,
                mattRHornAccountId: mattRHorn.account.id,
            },
        ),
        {
            overrideCreatedTime: baseTime.add({days: 2, minutes: 12}).toDate(timeZone),
        },
    );

    await chat.sendMessage(
        elleKappaTan,
        markdown`
im not surprised, 15 days of sea kayaking is probably exhausting for anyone!
        `,
        {
            overrideCreatedTime: baseTime.add({days: 2, minutes: 15}).toDate(timeZone),
            parent: {
                type: "MessagesRange",
                startIndex: firstMessage.index,
                endIndex: firstMessage.index,
                startContentVersion: 0,
                endContentVersion: 0,
                startPos: 141,
                endPos: 157,
            },
        },
    );

    await chat.sendMessage(
        cassCade,
        markdown`
Totally. All worth it, though
        `,
        {
            overrideCreatedTime: baseTime.add({days: 2, minutes: 16}).toDate(timeZone),
        },
    );

    await chat.sendMessage(
        elleKappaTan,
        markdown`
🚣🚣🚣
        `,
        {
            overrideCreatedTime: baseTime.add({days: 2, minutes: 17}).toDate(timeZone),
        },
    );

    await chat.sendMessage(
        elleKappaTan,
        markdown`
sorry one last q, any ideas for what project i work on next?
        `,
        {
            overrideCreatedTime: baseTime.add({days: 2, minutes: 17}).toDate(timeZone),
        },
    );

    // Make sure there's a loud notification in Cass's inbox.
    await retryWithExponentialBackoff(async retry => {
        try {
            const inboxEntry = await getInboxEntry(cassCade.action(), {
                spaceId: space.id,
                key: {type: "Chat", chatId: chat.id},
            });

            assert(inboxEntry.model.loudNotificationCount > 0);
        } catch (error) {
            throw retry(error);
        }
    });

    await chat.sendMessage(
        cassCade,
        markdown`
Not sure. Before going I was thinking the receipt uploader, but I wonder if the profit dashboard is
actually more important

I\u2019ll send you some more thoughts tomorrow
        `,
        {
            overrideCreatedTime: baseTime.add({days: 2, minutes: 18}).toDate(timeZone),
        },
    );

    // Make sure Cass's message clears the loud notification.
    await retryWithExponentialBackoff(async retry => {
        try {
            const inboxEntry = await getInboxEntry(cassCade.action(), {
                spaceId: space.id,
                key: {type: "Chat", chatId: chat.id},
            });

            assert(inboxEntry.model.loudNotificationCount === 0);
        } catch (error) {
            throw retry(error);
        }
    });

    debug("Created chat 1");

    return chat;
}

async function createFictionalAmbrookDemoChat2(
    tokenAgent: TokenAgent,
    {
        cassCade,
        cliffWeathers,
        chatGpt,
    }: DemoSpaceAccounts & {
        chatGpt: TestBotAccount;
    },
) {
    debug("Creating chat 2");

    const {space} = cassCade;

    const document = await TestDocument.create(cassCade, {title: "Customer Feedback from Sales"});

    const chat = await TestChat.get(cassCade, cliffWeathers, chatGpt);

    await chat.sendMessage(
        cliffWeathers,
        Mustache.render(
            markdown`
[ChatGPT](https://alpine.inc/s/{{spaceId}}/accounts/{{chatGptAccountId}}?mention) please sort and
tag the feedback in
[Customer Feedback from Sales](https://alpine.inc/s/{{spaceId}}/documents/{{documentId}}?mention).
            `,
            {
                spaceId: space.id,
                chatGptAccountId: chatGpt.id,
                documentId: document.id,
            },
        ),
    );

    const streamMessage = await chat.sendMessage(chatGpt.action(chat.getBotScope()), "", {
        isStream: true,
    });

    await streamMessage.putStreamPart(chatGpt.action(chat.getBotScope()), 0, {
        type: "Reasoning",
        content: parseTestMessageContent(space.id, "I\u2019m thinking here"),
    });

    await streamMessage.putStreamPart(
        chatGpt.action(chat.getBotScope()),
        1,
        markdown`
Absolutely. I\u2019ll read and group the feedback into clear themes.

- **Feature: Receipt Mobile Scanner**

    Needs: offline capture, no in-field categorization, reliable OCR on bad receipts, super-simple
    UX for operators.

- **Feature: Grants Navigator**

    Needs: curated \u201Ctop X this month,\u201D clear checklists, especially for small/mid farms.

- **Feature: Profit by Acre Dashboard**

    Needs: flexible units (acre/block/enterprise), cost allocation support, lender/investor-friendly
    outputs.
        `,
        {
            overrideCreatedTime: addSeconds(new Date(), 22),
        },
    );

    await streamMessage.completeStream(chatGpt.action(chat.getBotScope()));

    // Make sure there's a loud notification in Cass's inbox.
    await retryWithExponentialBackoff(async retry => {
        try {
            const inboxEntry = await getInboxEntry(cassCade.action(), {
                spaceId: space.id,
                key: {type: "Chat", chatId: chat.id},
            });

            assert(inboxEntry.model.loudNotificationCount > 0);
        } catch (error) {
            throw retry(error);
        }
    });

    await chat.sendMessage(
        cassCade,
        markdown`
Nice, I can use this. Thanks Cliff
        `,
    );

    // Make sure Cass's message clears the loud notification.
    await retryWithExponentialBackoff(async retry => {
        try {
            const inboxEntry = await getInboxEntry(cassCade.action(), {
                spaceId: space.id,
                key: {type: "Chat", chatId: chat.id},
            });

            assert(inboxEntry.model.loudNotificationCount === 0);
        } catch (error) {
            throw retry(error);
        }
    });

    debug("Created chat 2");

    return chat;
}
