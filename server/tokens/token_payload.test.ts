import {TokenPayload, TokenPayloadSchema} from "~/server/tokens/token_payload.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SessionId} from "~/shared/id/types/id_types.js";
import {
    AccountId,
    ChatId,
    DocumentId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

describe("TokenPayloadSchema deserialization", () => {
    describe("anonymous claims", () => {
        test("anonymous claims deserialize to anonymous payload", () => {
            expect(TokenPayloadSchema.deserialize({ano: 1})).toEqual({type: "Anonymous"});
        });
    });

    describe("bot claims", () => {
        const spaceId = generateId<SpaceId>();
        const accountId = generateId<AccountId>();

        test("valid bot claims deserialize to bot payload", () => {
            expect(
                TokenPayloadSchema.deserialize({wid: spaceId, aid: accountId, sco: "s"}),
            ).toEqual({
                type: "Bot",
                spaceId,
                accountId,
                scope: {type: "Space"},
            });
        });

        test("bot claims require valid `sco`", () => {
            expect(() =>
                TokenPayloadSchema.deserialize({
                    wid: spaceId,
                    aid: accountId,
                    sco: "not-a-real-scope",
                }),
            ).toThrow("Invalid bot token payload scope");
        });

        test("bot claims require `wid`", () => {
            expect(() =>
                TokenPayloadSchema.deserialize({
                    aid: accountId,
                    sco: "s",
                }),
            ).toThrow("Token payload is missing required `wid` claim");
        });

        test("bot claims require `aid`", () => {
            expect(() =>
                TokenPayloadSchema.deserialize({
                    wid: spaceId,
                    sco: "s",
                }),
            ).toThrow("Token payload is missing required `aid` claim");
        });
    });

    describe("impersonated account claims", () => {
        test("valid impersonated account claims deserialize to impersonated account payload", () => {
            const spaceId = generateId<SpaceId>();
            const accountId = generateId<AccountId>();

            expect(TokenPayloadSchema.deserialize({wid: spaceId, iid: accountId})).toEqual({
                type: "ImpersonatedAccount",
                spaceId,
                accountId,
            });
        });

        test("impersonated account claims require `wid`", () => {
            const accountId = generateId<AccountId>();

            expect(() => TokenPayloadSchema.deserialize({iid: accountId})).toThrow(
                "Token payload is missing required `wid` claim",
            );
        });

        test("rejects `wid` + `iid` + `aid` so a session or bot-shaped claim cannot become an impersonated account token", () => {
            const spaceId = generateId<SpaceId>();
            const accountId = generateId<AccountId>();

            expect(() =>
                TokenPayloadSchema.deserialize({wid: spaceId, iid: accountId, aid: accountId}),
            ).toThrow("Token payload has unexpected `aid` claim");
        });
    });

    describe("system claims", () => {
        test("valid system claims deserialize to system payload", () => {
            const spaceId = generateId<SpaceId>();

            expect(TokenPayloadSchema.deserialize({wid: spaceId})).toEqual({
                type: "System",
                spaceId,
            });
        });

        test("rejects `wid` plus `aid` so a session or bot-shaped claim cannot become a system token", () => {
            const spaceId = generateId<SpaceId>();
            const accountId = generateId<AccountId>();

            expect(() => TokenPayloadSchema.deserialize({wid: spaceId, aid: accountId})).toThrow(
                "Token payload has unexpected `aid` claim",
            );
        });
    });

    describe("session claims", () => {
        test("valid session claims deserialize to session payload", () => {
            const sessionId = generateId<SessionId>();
            const accountId = generateId<AccountId>();

            expect(TokenPayloadSchema.deserialize({sid: sessionId, aid: accountId})).toEqual({
                type: "Session",
                sessionId,
                accountId,
            });
        });

        test("session claims require `aid` claim", () => {
            const sessionId = generateId<SessionId>();

            expect(() => TokenPayloadSchema.deserialize({sid: sessionId})).toThrow(
                "Token payload is missing required `aid` claim",
            );
        });

        test("session claims require `sid` claim", () => {
            const accountId = generateId<AccountId>();

            expect(() => TokenPayloadSchema.deserialize({aid: accountId})).toThrow(
                "Token payload is missing required `sid` claim",
            );
        });
    });
});

describe("TokenPayloadSchema serialize/deserialize round trips", () => {
    test("Session", () => {
        const payload: TokenPayload = {
            type: "Session",
            sessionId: generateId<SessionId>(),
            accountId: generateId<AccountId>(),
        };
        expect(TokenPayloadSchema.deserialize(TokenPayloadSchema.serialize(payload))).toEqual(
            payload,
        );
    });

    test("System", () => {
        const payload: TokenPayload = {
            type: "System",
            spaceId: generateId<SpaceId>(),
        };
        expect(TokenPayloadSchema.deserialize(TokenPayloadSchema.serialize(payload))).toEqual(
            payload,
        );
    });

    test("ImpersonatedAccount", () => {
        const payload: TokenPayload = {
            type: "ImpersonatedAccount",
            accountId: generateId<AccountId>(),
            spaceId: generateId<SpaceId>(),
        };
        expect(TokenPayloadSchema.deserialize(TokenPayloadSchema.serialize(payload))).toEqual(
            payload,
        );
    });

    test("Anonymous", () => {
        const payload: TokenPayload = {type: "Anonymous"};
        expect(TokenPayloadSchema.deserialize(TokenPayloadSchema.serialize(payload))).toEqual(
            payload,
        );
    });

    test.each([
        ["Space", {type: "Space" as const}],
        ["Account", {type: "Account" as const, accountId: generateId<AccountId>()}],
        ["Chat", {type: "Chat" as const, chatId: generateId<ChatId>()}],
        ["Document", {type: "Document" as const, documentId: generateId<DocumentId>()}],
        ["Post", {type: "Post" as const, postId: generateId<PostId>()}],
        ["Task", {type: "Task" as const, taskId: generateId<TaskId>()}],
    ])("Bot round trip (%s scope)", (_label, scope) => {
        const payload: Extract<TokenPayload, {type: "Bot"}> = {
            type: "Bot",
            spaceId: generateId<SpaceId>(),
            accountId: generateId<AccountId>(),
            scope,
        };
        expect(TokenPayloadSchema.deserialize(TokenPayloadSchema.serialize(payload))).toEqual(
            payload,
        );
    });
});
