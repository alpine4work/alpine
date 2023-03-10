import {EmailAddress} from "~/server/emails/email_address";
import {assert} from "~/shared/helpers/control/assert";
import {Id, isId} from "~/shared/id/id";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types";

function assertId<Value extends Id>(string: string): Value {
    assert(isId(string));
    return string as any;
}

const seedConstants = {
    adminAccountId: assertId<AccountId>("27g6s1h4ygh1zqzw5h23gqtn88"),
    adminEmailAddress: "admin@test.cyberworlds.dev" as EmailAddress,
    defaultSpaceId: assertId<SpaceId>("ywcffewdn377x442nkxd5x41r0"),
    testChannelId: assertId<ChannelId>("qk8jepk9epmb48b3fbaykw4vk0"),
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
