import {chatGptKnownBotId} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {internalDangerouslyCreateChannelTransactionEntries} from "~/server/forum/data/internal_dangerously_create_channel_transaction_entries.js";
import {internalDangerouslyCreateInstantiateBotSpaceAccountTransactionEntries} from "~/server/spaces/instantiate_bot_space_account.js";
import {SpaceWelcomePackageItem, SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";

export async function createSpaceWelcomePackageTransactionEntries(
    context: ServerActionContext,
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
                "A place for conversations that aren’t about work. Share memes, ask for recommendations, or post about whatever’s on your mind.",
            ),
            createdTime: currentTime,
        }),
    );

    let botId: BotId | null = null;

    switch (process.env.NODE_ENV) {
        case "development":
        case "production":
            botId = chatGptKnownBotId;
            break;
        case "test":
            botId = chatGptBotIdForTest;
            break;
    }

    // Don't instantiate ChatGPT in test environments where we haven't created
    // a `BotId`.
    if (botId !== null) {
        chatGptBotAccountId = generateId<AccountId>();

        transactionEntries.push(
            await internalDangerouslyCreateInstantiateBotSpaceAccountTransactionEntries(context, {
                currentTime,
                spaceId,
                botId,
                accountId: chatGptBotAccountId,
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
    };

    transactionEntries.push(SpacesTable.transactionCreateItem(welcomePackageItem));

    return {
        welcomePackageItem,
        transactionEntries: transactionEntries.flat(),
    };
}

let chatGptBotIdForTest: BotId | null = null;

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
