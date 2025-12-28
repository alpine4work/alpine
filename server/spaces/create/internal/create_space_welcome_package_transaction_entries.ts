import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {internalDangerouslyCreateChannelTransactionEntries} from "~/server/forum/data/internal_dangerously_create_channel_transaction_entries.js";
import {internalDangerouslyCreateInstantiateBotSpaceAccountTransactionEntries} from "~/server/spaces/instantiate_bot_space_account.js";
import {SpaceWelcomePackageItem, SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {chatGptKnownBotId} from "~/shared/bots/known_bot_ids.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
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

    // Don't instantiate ChatGPT in test environments since we won't have created
    // a `BotId`.
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "production") {
        chatGptBotAccountId = generateId<AccountId>();

        transactionEntries.push(
            await internalDangerouslyCreateInstantiateBotSpaceAccountTransactionEntries(context, {
                currentTime,
                spaceId,
                botId:
                    process.env.NODE_ENV !== "production"
                        ? getDynamoSeedConstants().chatGptBotId
                        : chatGptKnownBotId,
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
