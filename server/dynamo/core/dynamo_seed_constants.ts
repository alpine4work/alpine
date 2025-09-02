import {EmailAddress} from "~/server/emails/email_address.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId, BotId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";

const seedConstants = {
    adminAccountId: assertId<AccountId>("27g6s1h4ygh1zqzw5h23gqtn88"),
    adminEmailAddress: "admin@test.cyberworlds.dev" as EmailAddress,
    defaultSpaceId: assertId<SpaceId>("ywcffewdn377x442nkxd5x41r0"),
    testChannelId: assertId<ChannelId>("qk8jepk9epmb48b3fbaykw4vk0"),
    chatGptBotId: assertId<BotId>("mfkbwdhjr9bj344wrm7gfq79e0"),
    chatGptBotAccountIdForDefaultSpace: assertId<AccountId>("kfh2j418vqjtr2hx4k4xhdpqhm"),
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
