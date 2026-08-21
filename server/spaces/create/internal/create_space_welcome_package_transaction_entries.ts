import {dangerouslyGetBotIfExistsWithoutAuthorization} from "~/server/bots/dangerously_get_bot_without_authorization.js";
import {
    chatGptKnownBotId,
    cursorKnownBotId,
} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {internalDangerouslyCreateChannelTransactionEntries} from "~/server/forum/data/internal_dangerously_create_channel_transaction_entries.js";
import {internalDangerouslyCreateInstallBotInSpaceTransactionEntries} from "~/server/spaces/install_bot_in_space.js";
import {SpaceWelcomePackageItem, SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, ChannelId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function createSpaceWelcomePackageTransactionEntries(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    {
        currentTime,
        ownerAccountId,
        spaceId,
    }: {
        currentTime: Date;
        ownerAccountId: AccountId;
        spaceId: SpaceId;
    },
): Promise<{
    welcomePackageItem: SpaceWelcomePackageItem;
    transactionEntries: Array<DynamoTransactionEntry>;
}> {
    const generalChannelId = generateId<ChannelId>();
    const randomChannelId = generateId<ChannelId>();
    let chatGptBotAccountId: AccountId | null = null;
    let cursorBotAccountId: AccountId | null = null;

    const transactionEntries: Array<DynamoTransactionEntry | Array<DynamoTransactionEntry>> = [];

    transactionEntries.push(
        internalDangerouslyCreateChannelTransactionEntries(context, {
            ownerAccountId,
            spaceId,
            channelId: generalChannelId,
            channelName: "General",
            channelDescription: createSimpleMessageContent(
                "Share company-wide announcements, updates, or events. These are the posts everyone should see.",
            ),
            createdTime: currentTime,
        }),
    );

    transactionEntries.push(
        internalDangerouslyCreateChannelTransactionEntries(context, {
            ownerAccountId,
            spaceId,
            channelId: randomChannelId,
            channelName: "Random",
            channelDescription: createSimpleMessageContent(
                "A place for conversations that aren\u2019t about work. Share memes, ask for recommendations, or post about whatever\u2019s on your mind.",
            ),
            createdTime: currentTime,
        }),
    );

    let chatGptBotId: BotId | null = null;
    let cursorBotId: BotId | null = null;

    switch (process.env.NODE_ENV) {
        case "development":
        case "production": {
            chatGptBotId = chatGptKnownBotId;
            cursorBotId = cursorKnownBotId;
            break;
        }
        case "test": {
            // If the known bots exist in our test environment, use them! For example, they'll
            // exist in `auth_screenshot_test.ts`.
            const [chatGptKnownBot, cursorKnownBot] = await runAllPromises([
                dangerouslyGetBotIfExistsWithoutAuthorization(context, chatGptKnownBotId),
                dangerouslyGetBotIfExistsWithoutAuthorization(context, cursorKnownBotId),
            ]);

            chatGptBotId = chatGptBotIdForTest ?? (chatGptKnownBot ? chatGptKnownBotId : null);
            cursorBotId = cursorBotIdForTest ?? (cursorKnownBot ? cursorKnownBotId : null);
            break;
        }
    }

    // Don't instantiate ChatGPT in test environments where we haven't created a
    // `BotId`.
    if (chatGptBotId !== null) {
        chatGptBotAccountId = generateId<AccountId>();

        transactionEntries.push(
            await internalDangerouslyCreateInstallBotInSpaceTransactionEntries(context, {
                currentTime,
                spaceId,
                botId: chatGptBotId,
                accountId: chatGptBotAccountId,
            }).then(({transactionEntries}) => transactionEntries),
        );
    }

    // Don't instantiate Cursor in test environments where we haven't created a
    // `BotId`.
    if (cursorBotId !== null) {
        cursorBotAccountId = generateId<AccountId>();

        transactionEntries.push(
            await internalDangerouslyCreateInstallBotInSpaceTransactionEntries(context, {
                currentTime,
                spaceId,
                botId: cursorBotId,
                accountId: cursorBotAccountId,
            }).then(({transactionEntries}) => transactionEntries),
        );
    }

    const welcomePackageItem: SpaceWelcomePackageItem = {
        partitionType: "Space",
        sortRangeType: "WelcomePackage",
        spaceId,
        generalChannelId,
        randomChannelId,
        chatGptBotAccountId,
        cursorBotAccountId,
    };

    transactionEntries.push(SpacesTable.transactionCreateItem(welcomePackageItem));

    return {
        welcomePackageItem,
        transactionEntries: transactionEntries.flat(),
    };
}

let chatGptBotIdForTest: BotId | null = null;
let cursorBotIdForTest: BotId | null = null;

/**
 * Allow tests to provide a ChatGPT bot.
 */
export async function withChatGptBotIdForTest<Value>(
    botId: BotId,
    action: () => Promise<Value>,
): Promise<Value> {
    assert(process.env.NODE_ENV === "test");
    assert(chatGptBotIdForTest === null);

    chatGptBotIdForTest = botId;
    try {
        const value = await action();
        return value;
    } finally {
        chatGptBotIdForTest = null;
    }
}

/**
 * Allow tests to provide a Cursor bot.
 */
export async function withCursorBotIdForTest<Value>(
    botId: BotId,
    action: () => Promise<Value>,
): Promise<Value> {
    assert(process.env.NODE_ENV === "test");
    assert(cursorBotIdForTest === null);

    cursorBotIdForTest = botId;
    try {
        const value = await action();
        return value;
    } finally {
        cursorBotIdForTest = null;
    }
}
