import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {assertId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, ChannelId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

const seedConstants = {
    adminAccountId: assertId<AccountId>("27g6s1h4ygh1zqzw5h23gqtn88"),
    adminEmailAddress: "admin@test.cyberworlds.dev" as EmailAddress,
    defaultSpaceId: assertId<SpaceId>("ywcffewdn377x442nkxd5x41r0"),
    testChannelId: assertId<ChannelId>("qk8jepk9epmb48b3fbaykw4vk0"),
    chatGptBotId: assertId<BotId>("mfkbwdhjr9bj344wrm7gfq79e0"),
    chatGptBotAccountIdForDefaultSpace: assertId<AccountId>("kfh2j418vqjtr2hx4k4xhdpqhm"),
    claudeBotId: assertId<BotId>("6t2m9q4v7k1x5r8c3j0wnhaepg"),
    claudeBotAccountIdForDefaultSpace: assertId<AccountId>("3r8v1m6q4k9t2x7c5j0wnhaepg"),
    cursorBotId: assertId<BotId>("ppjg4pyfd69st13a440sq6h7xr"),
    cursorBotAccountIdForDefaultSpace: assertId<AccountId>("5vmp7t589yz6z82g4rqsx602h0"),
    mockChatGptBotId: assertId<BotId>("c1n6d78hn6rmn7xnx8y3h4hj7c"),
};

/**
 * Get constants used in our seed data.
 *
 * You may only call this in development and test environments.
 */
export function getDynamoSeedConstants() {
    assert(process.env.NODE_ENV !== "production");
    return seedConstants;
}
