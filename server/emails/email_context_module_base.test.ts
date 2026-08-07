import {NoopEmailContextModule} from "~/server/emails/noop_email_context_module.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

// Guards against the serialize and deserialize halves of the unsubscribe URL
// scheme drifting apart.
test("round-trips the unsubscribe URL account, space, and email type", async () => {
    const email = new NoopEmailContextModule();
    const accountId = generateId<AccountId>();
    const spaceId = generateId<SpaceId>();

    const url = await email.getSignedUnsubscribeUrlForAppService({
        accountId,
        spaceId,
        emailType: "NotificationDigest",
        baseUrl: "https://alpine.inc",
    });

    expect(await email.getPartsFromSignedUnsubscribeUrl(url)).toEqual({
        accountId,
        spaceId,
        emailType: "NotificationDigest",
    });
});
