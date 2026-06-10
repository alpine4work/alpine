import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    AnonymousActorContextModule,
    BotActorContextModule,
    ImpersonatedAccountActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {
    createActorContextModuleFromAuthorizationHeader,
    createDynamoActorSessionContextModule,
} from "~/server/spaces/create_actor_context_module_from_authorization_header.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

const context = createTestContext({spacesInjection});

function createMockTokenAgent(verifyToken: TokenAgent["publicSide"]["verifyToken"]): TokenAgent {
    return {
        publicSide: {
            verifyToken,
        },
    } as unknown as TokenAgent;
}

describe("createActorContextModuleFromAuthorizationHeader", () => {
    test("returns system actor for valid system token payload", async () => {
        const space = await TestSpace.create(context);
        const verifyToken = import.meta.jest.fn().mockResolvedValue({
            serviceName: "TaskRealtimeService",
            payload: {type: "System" as const, spaceId: space.id},
        });

        const actor = await createActorContextModuleFromAuthorizationHeader(
            space.systemAction(),
            new Headers({authorization: "Bearer x"}),
            createMockTokenAgent(verifyToken),
            space.id,
        );

        expect(actor).toBeInstanceOf(SystemActorContextModule);

        assert(actor instanceof SystemActorContextModule);
        expect(actor.getSpaceId()).toBe(space.id);
    });

    test("returns impersonated account actor for valid impersonated account token payload", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const verifyToken = import.meta.jest.fn().mockResolvedValue({
            serviceName: "JobQueueService",
            payload: {
                type: "ImpersonatedAccount" as const,
                spaceId: space.id,
                accountId: session.account.id,
            },
        });

        const actor = await createActorContextModuleFromAuthorizationHeader(
            space.systemAction(),
            new Headers({authorization: "Bearer x"}),
            createMockTokenAgent(verifyToken),
            space.id,
        );

        expect(actor).toBeInstanceOf(ImpersonatedAccountActorContextModule);

        assert(actor instanceof ImpersonatedAccountActorContextModule);
        expect(`${actor.getSpaceId()}:${actor.getAccountId()}`).toBe(
            `${space.id}:${session.account.id}`,
        );
    });

    test("returns bot actor for valid bot token payload", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const verifyToken = import.meta.jest.fn().mockResolvedValue({
            serviceName: "ApiService",
            payload: {
                type: "Bot" as const,
                spaceId: space.id,
                accountId: session.account.id,
                scope: {type: "Space" as const},
            },
        });

        const actor = await createActorContextModuleFromAuthorizationHeader(
            space.systemAction(),
            new Headers({authorization: "Bearer x"}),
            createMockTokenAgent(verifyToken),
            space.id,
        );

        expect(actor).toBeInstanceOf(BotActorContextModule);
    });

    test("returns anonymous actor for valid anonymous token payload", async () => {
        const space = await TestSpace.create(context);
        const verifyToken = import.meta.jest.fn().mockResolvedValue({
            serviceName: "ApiService",
            payload: {
                type: "Anonymous" as const,
            },
        });

        const actor = await createActorContextModuleFromAuthorizationHeader(
            space.systemAction(),
            new Headers({authorization: "Bearer x"}),
            createMockTokenAgent(verifyToken),
            space.id,
        );

        expect(actor).toBeInstanceOf(AnonymousActorContextModule);
    });

    test("rejects system token when route space does not match token space", async () => {
        const space = await TestSpace.create(context);
        const otherSpaceId = generateId<SpaceId>();
        const verifyToken = import.meta.jest.fn().mockResolvedValue({
            serviceName: "TaskRealtimeService",
            payload: {type: "System" as const, spaceId: space.id},
        });

        await expect(
            createActorContextModuleFromAuthorizationHeader(
                space.systemAction(),
                new Headers({authorization: "Bearer x"}),
                createMockTokenAgent(verifyToken),
                otherSpaceId,
            ),
        ).rejects.toThrow("System actor doesn\u2019t have access to space");
    });

    test("rejects impersonated token when route space does not match token space", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSpaceId = generateId<SpaceId>();
        const verifyToken = import.meta.jest.fn().mockResolvedValue({
            serviceName: "JobQueueService",
            payload: {
                type: "ImpersonatedAccount" as const,
                spaceId: space.id,
                accountId: session.account.id,
            },
        });

        await expect(
            createActorContextModuleFromAuthorizationHeader(
                space.systemAction(),
                new Headers({authorization: "Bearer x"}),
                createMockTokenAgent(verifyToken),
                otherSpaceId,
            ),
        ).rejects.toThrow("Impersonated account actor doesn\u2019t have access to space");
    });

    test("rejects impersonated token when account is not a space member", async () => {
        const space = await TestSpace.create(context);
        const outsiderAccountId = generateId<AccountId>();
        const verifyToken = import.meta.jest.fn().mockResolvedValue({
            serviceName: "JobQueueService",
            payload: {
                type: "ImpersonatedAccount" as const,
                spaceId: space.id,
                accountId: outsiderAccountId,
            },
        });

        await expect(
            createActorContextModuleFromAuthorizationHeader(
                space.systemAction(),
                new Headers({authorization: "Bearer x"}),
                createMockTokenAgent(verifyToken),
                space.id,
            ),
        ).rejects.toThrow("Impersonated account isn\u2019t a member of space");
    });

    test("rejects missing Authorization header", async () => {
        const space = await TestSpace.create(context);

        await expect(
            createActorContextModuleFromAuthorizationHeader(
                space.systemAction(),
                new Headers(),
                createMockTokenAgent(import.meta.jest.fn()),
                space.id,
            ),
        ).rejects.toThrow("Expected an `Authorization` header");
    });

    test("rejects non-Bearer Authorization scheme", async () => {
        const space = await TestSpace.create(context);

        await expect(
            createActorContextModuleFromAuthorizationHeader(
                space.systemAction(),
                new Headers({authorization: "Basic abc"}),
                createMockTokenAgent(import.meta.jest.fn()),
                space.id,
            ),
        ).rejects.toThrow("Expected `Authorization` header to have `Bearer` authentication scheme");
    });
});

describe("createDynamoActorSessionContextModule", () => {
    test("returns session actor when session exists and matches token account id", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const actor = await createDynamoActorSessionContextModule(
            space.systemAction(),
            new Headers(),
            createMockTokenAgent(import.meta.jest.fn()),
            {
                serviceName: "AppService",
                authorizationHeaderPayload: {
                    type: "Session",
                    sessionId: session.id,
                    accountId: session.account.id,
                },
            },
        );

        expect(actor).toBeInstanceOf(SessionActorContextModule);
        expect(actor.getAccountId()).toBe(session.account.id);
    });

    test("rejects when session is unknown", async () => {
        const space = await TestSpace.create(context);

        await expect(
            createDynamoActorSessionContextModule(
                space.systemAction(),
                new Headers(),
                createMockTokenAgent(import.meta.jest.fn()),
                {
                    serviceName: "AppService",
                    authorizationHeaderPayload: {
                        type: "Session",
                        sessionId: generateId<SessionId>(),
                        accountId: generateId<AccountId>(),
                    },
                },
            ),
        ).rejects.toThrow("Session not found");
    });

    test("rejects when token account id does not match stored session", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const wrongAccountId = generateId<AccountId>();

        await expect(
            createDynamoActorSessionContextModule(
                space.systemAction(),
                new Headers(),
                createMockTokenAgent(import.meta.jest.fn()),
                {
                    serviceName: "AppService",
                    authorizationHeaderPayload: {
                        type: "Session",
                        sessionId: session.id,
                        accountId: wrongAccountId,
                    },
                },
            ),
        ).rejects.toThrow(
            "`Authorization` header `AccountId` doesn\u2019t match session `AccountId`",
        );
    });

    test("rejects non-session token when building session actor", async () => {
        const space = await TestSpace.create(context);

        await expect(
            createDynamoActorSessionContextModule(
                space.systemAction(),
                new Headers(),
                createMockTokenAgent(import.meta.jest.fn()),
                {
                    serviceName: "AppService",
                    authorizationHeaderPayload: {
                        type: "System",
                        spaceId: space.id,
                    } as unknown as SessionTokenPayload,
                },
            ),
        ).rejects.toThrow("Cannot create session actor from non-session token: `System`");
    });
});
