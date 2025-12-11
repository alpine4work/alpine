import {jest} from "@jest/globals";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {BrowserId} from "~/shared/id/types/id_types.js";

const deregisterWebPushSubscriptionWithoutAuthorizationMock = jest.fn();

jest.unstable_mockModule(
    "../internal/push/deregister_web_push_subscription_without_authorization.js",
    () => ({
        deregisterWebPushSubscriptionWithoutAuthorization:
            deregisterWebPushSubscriptionWithoutAuthorizationMock,
    }),
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const deregisterWebPushSubscriptionWithoutAuthorizationModule = await import(
    "../internal/push/deregister_web_push_subscription_without_authorization.js"
);
const {deregisterAccountWebPushSubscription} = await import(
    "~/server/notifications/data/push/deregister_account_web_push_subscription.js"
);

const context = createTestContext();

describe("deregisterAccountWebPushSubscription", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test("Session actor allows deregistering own account’s web push subscription", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        await deregisterAccountWebPushSubscription(session.action(), {
            accountId: session.account.id,
            browserId,
        });

        expect(deregisterWebPushSubscriptionWithoutAuthorizationMock).toHaveBeenCalledWith(
            expect.objectContaining({
                actor: expect.objectContaining({
                    type: "Session",
                }),
            }),
            {
                accountId: session.account.id,
                browserId,
            },
        );
    });

    test("Session actor throws PermissionDeniedError when deregistering a different account’s subscription", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await Promise.all([
            space.createSession(),
            space.createSession(),
        ]);
        const browserId = generateId<BrowserId>();

        await expect(
            deregisterAccountWebPushSubscription(session1.action(), {
                accountId: session2.account.id,
                browserId,
            }),
        ).rejects.toThrow(PermissionDeniedError);
        expect(deregisterWebPushSubscriptionWithoutAuthorizationMock).not.toHaveBeenCalled();
    });

    test("ImpersonatedAccount actor allows deregistering the impersonated account’s web push subscription", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        await deregisterAccountWebPushSubscription(
            context.impersonatedAccountAction(space.id, session.account.id),
            {
                accountId: session.account.id,
                browserId,
            },
        );

        expect(deregisterWebPushSubscriptionWithoutAuthorizationMock).toHaveBeenCalledWith(
            expect.objectContaining({
                actor: expect.objectContaining({
                    type: "ImpersonatedAccount",
                }),
            }),
            {
                accountId: session.account.id,
                browserId,
            },
        );
    });

    test("ImpersonatedAccount actor throws PermissionDeniedError when deregistering a different account’s subscription", async () => {
        const space = await TestSpace.create(context);
        const [session1, session2] = await Promise.all([
            space.createSession(),
            space.createSession(),
        ]);
        const browserId = generateId<BrowserId>();

        await expect(
            deregisterAccountWebPushSubscription(
                context.impersonatedAccountAction(space.id, session1.account.id),
                {
                    accountId: session2.account.id,
                    browserId,
                },
            ),
        ).rejects.toThrow(PermissionDeniedError);
        expect(deregisterWebPushSubscriptionWithoutAuthorizationMock).not.toHaveBeenCalled();
    });

    test("System actor allows deregistering any account’s web push subscription", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        await deregisterAccountWebPushSubscription(space.systemAction(), {
            accountId: session.account.id,
            browserId,
        });

        expect(deregisterWebPushSubscriptionWithoutAuthorizationMock).toHaveBeenCalledWith(
            expect.objectContaining({
                actor: expect.objectContaining({
                    type: "System",
                }),
            }),
            {
                accountId: session.account.id,
                browserId,
            },
        );
    });

    test("Anonymous actor throws UnauthenticatedError", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const browserId = generateId<BrowserId>();

        await expect(
            deregisterAccountWebPushSubscription(context.anonymousAction(), {
                accountId: session.account.id,
                browserId,
            }),
        ).rejects.toThrow(UnauthenticatedError);
        expect(deregisterWebPushSubscriptionWithoutAuthorizationMock).not.toHaveBeenCalled();
    });

    test("Bot actor throws PermissionDeniedError", async () => {
        const space = await TestSpace.create(context);
        const adminSession = await space.createSession({role: "Admin"});
        const botAccount = await TestBot.createAndInstantiate(adminSession);
        const browserId = generateId<BrowserId>();

        await expect(
            deregisterAccountWebPushSubscription(botAccount.action(), {
                accountId: adminSession.account.id,
                browserId,
            }),
        ).rejects.toThrow(PermissionDeniedError);
        expect(deregisterWebPushSubscriptionWithoutAuthorizationMock).not.toHaveBeenCalled();
    });
});
