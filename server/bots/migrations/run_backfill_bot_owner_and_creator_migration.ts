import {BotApiKeysIndex, BotsTable} from "~/server/bots/internal/bots_table.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";

import {
    calebKnownAccountId,
    ianKnownAccountId,
    joshKnownAccountId,
} from "~/shared/accounts/known_account_ids.js";
import {BotOwnerEntity, intoBotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";
import {Context} from "~/shared/context/context.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {assertId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {alpineCompanyKnownSpaceId} from "~/shared/spaces/known_space_ids.js";

/**
 * Gives every bot that predates bot ownership its owner, from
 * `legacyBotOwnerByBotId`. Bots we have no entry for keep the `System` owner they
 * read back as, which is what they're treated as today.
 *
 * Also gives every bot an accurate `apiKeyCount`, which bots written before that
 * field existed read back as zero however many keys they actually have.
 *
 * This rewrites every bot item, not just the ones we have an owner for, because
 * bots written before the `BotsByOwner` index existed have none of the index's
 * attributes. They don't appear in the index at all until they're written again,
 * so the rewrite is what puts existing bots on the settings page.
 *
 * A bot's accounts carry a copy of its owner, so changing an owner also enqueues
 * the job that copies the new owner onto them.
 */
export async function runBackfillBotOwnerAndCreatorMigration(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    for await (const initialOldItem of BotsTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [{partitionType: "Bot", sortRangeType: "Attributes"}],
    })) {
        if (initialOldItem.partitionType !== "Bot" || initialOldItem.sortRangeType !== "Attributes")
            continue;

        const {botId} = initialOldItem;
        const legacyOwner = legacyBotOwnerByBotId.get(botId);
        const ownerEntity = legacyOwner && intoBotOwnerEntityId(legacyOwner.ownerEntity);

        await BotsTable.updateItem(
            context,
            {partitionType: "Bot", sortRangeType: "Attributes", botId},
            async item => {
                if (!item) return item;

                return {
                    ...item,
                    ownerEntity: ownerEntity ?? item.ownerEntity,
                    createdByAccount: legacyOwner?.createdByAccount ?? item.createdByAccount,
                    apiKeyCount: Math.max(
                        item.apiKeyCount,
                        await countBotApiKeysWithIndex(context, botId),
                    ),
                };
            },
            {initialItem: initialOldItem},
        );

        // The bot's accounts store their own copy of the owner for rendering and
        // filtering, so they need the new owner too. Skipped for bots we had no owner for,
        // whose accounts already agree with the bot.
        if (ownerEntity !== undefined && ownerEntity !== initialOldItem.ownerEntity) {
            await context.jobs.dangerouslySendMaintenance({
                type: "UpdateBotAccounts",
                botId,
                update: {type: "Owner"},
            });
        }
    }
}

/**
 * Counts a bot's API keys with `BotApiKeysIndex`, which is the only way to find
 * them for a bot whose `apiKeyCount` we don't trust yet.
 *
 * Called from inside the update so every retry counts again, and the caller keeps
 * whichever of the two counts is larger. Both guard against the index being
 * eventually consistent: a key write bumps the same lock version the update
 * checks, so a count that loses that race is thrown away rather than overwriting a
 * newer one, and a key the index hasn't caught up on is already in the bot's own
 * count.
 */
async function countBotApiKeysWithIndex(context: DynamoContext, botId: BotId): Promise<number> {
    const apiKeyKeys = await arrayFromAsyncIterable(
        BotApiKeysIndex.query(context, {partitionKey: {botId}, limit: "All"}),
    );

    return apiKeyKeys.length;
}

/**
 * Every bot that existed before bots had an owner, mapped to the owner it should
 * have. `runBackfillBotOwnerAndCreatorMigration()` writes these onto the bot
 * items.
 *
 * We created these bots by hand for people who couldn't create their own, so we're
 * the only ones who know who they belong to. A bot that isn't listed here keeps
 * the `System` owner it reads back as today, which means only internal users can
 * manage it — so a personal bot left out of this list is a bot its owner can't
 * reach.
 *
 * `createdByAccount` is only for auditing. Leave it undefined when we don't know
 * who created the bot and it stays null.
 *
 * TODO(#migrate-bot-owners): Fill this in with the bots in production, run the
 * migration, then delete this file along with the `.default("System")` on
 * `ownerEntity` and the nullable `createdByAccount` in `bots_table.ts`.
 */
const legacyBotOwnerByBotId: ReadonlyMap<BotId, LegacyBotOwner> = new Map<BotId, LegacyBotOwner>([
    // ChatGPT
    [
        assertId<BotId>("03stggwzcvnrq8019hkxbkxhvc"),
        {ownerEntity: {type: "System"}, createdByAccount: calebKnownAccountId},
    ],
    // Cursor
    [
        assertId<BotId>("hq05r48b2xny65myzjvbks818g"),
        {ownerEntity: {type: "System"}, createdByAccount: calebKnownAccountId},
    ],
    // Notion
    [
        assertId<BotId>("5t5fychg8fvg3b5eq55ensfaec"),
        {ownerEntity: {type: "System"}, createdByAccount: calebKnownAccountId},
    ],
    // Claude
    [
        assertId<BotId>("4j7q3n9m5v2k8x6r1c0whaetpg"),
        {ownerEntity: {type: "System"}, createdByAccount: calebKnownAccountId},
    ],

    // Paul
    [
        assertId<BotId>("6rt63yf12h88nc6b086n74cahg"),
        {
            ownerEntity: {type: "Space", spaceId: alpineCompanyKnownSpaceId},
            createdByAccount: calebKnownAccountId,
        },
    ],

    // Opensource Test
    [
        assertId<BotId>("an8mpt0ydt8jf0faahgsd5w2zw"),
        {
            ownerEntity: {type: "Space", spaceId: assertId<SpaceId>("pr2yzjwvdg6537d03mmey3yg8m")},
            createdByAccount: calebKnownAccountId,
        },
    ],

    // Ian's Bot
    [
        assertId<BotId>("ehrtcgmdtw3yeyddwmzcbdp6x4"),
        {
            ownerEntity: {
                type: "Account",
                accountId: ianKnownAccountId,
            },
            createdByAccount: ianKnownAccountId,
        },
    ],

    // Josh's Bot
    [
        assertId<BotId>("d83ty7kerfesrav65xxtczmgkr"),
        {
            ownerEntity: {type: "Space", spaceId: assertId<SpaceId>("c2pwxmpv3z7b3db19tsn6y1qfg")},
            createdByAccount: joshKnownAccountId,
        },
    ],

    // Caleb's Bot
    [
        assertId<BotId>("3ja640vregrk6g5vkcdw5s1e84"),
        {
            ownerEntity: {type: "Space", spaceId: assertId<SpaceId>("c2pwxmpv3z7b3db19tsn6y1qfg")},
            createdByAccount: calebKnownAccountId,
        },
    ],

    // Heartwood Agency
    [
        assertId<BotId>("t4avztvbgwndcgv7kab5y4ghbw"),
        {
            ownerEntity: {type: "Space", spaceId: assertId<SpaceId>("wc3rcsfgg075x3frewctpxf430")},
            createdByAccount: calebKnownAccountId,
        },
    ],

    // Cameron's Bot
    [
        assertId<BotId>("k2qv1qshg055gezv57f9s6g7xw"),
        {
            ownerEntity: {type: "Space", spaceId: assertId<SpaceId>("148j7c2jb4afztkvz5tf2e37rc")},
            createdByAccount: calebKnownAccountId,
        },
    ],

    // Gamut Limited
    [
        assertId<BotId>("25n63a2j46yzmemden9w49dv90"),
        {
            ownerEntity: {type: "Space", spaceId: assertId<SpaceId>("c4wp0a7azh9s0w3wtmsbqrfy2r")},
            createdByAccount: calebKnownAccountId,
        },
    ],

    // Crossfoot AI
    [
        assertId<BotId>("zq21gfgcktbhvcpmvnf7jh54rm"),
        {
            ownerEntity: {type: "Space", spaceId: assertId<SpaceId>("qwm5hhb3p4vf105ba2wzbevy7w")},
            createdByAccount: calebKnownAccountId,
        },
    ],

    // Bolt Foundry Bot
    [
        assertId<BotId>("gdx9ceyjrmzfxx6aer7vtzhsam"),
        {
            ownerEntity: {type: "Space", spaceId: assertId<SpaceId>("v4msyzgjb8a4q4jqkr1zbrkhcg")},
            createdByAccount: calebKnownAccountId,
        },
    ],
]);

/**
 * The owner a single legacy bot should be given by
 * `runBackfillBotOwnerAndCreatorMigration()`.
 */
type LegacyBotOwner = {ownerEntity: BotOwnerEntity; createdByAccount?: AccountId};
