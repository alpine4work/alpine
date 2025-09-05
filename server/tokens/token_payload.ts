import {InvalidArgumentError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChatId,
    DocumentId,
    PostId,
    SessionId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export type SessionTokenPayload = {
    readonly type: "Session";
    readonly sessionId: SessionId;
    // Though we could load the `AccountId` from the database item for our
    // `SessionId`, it saves us database roundtrips to include it in the token
    // given the `AccountId` for a session will never change.
    //
    // When verifying the session still exists, we also need to verify the
    // `AccountId` for the session is correct.
    readonly accountId: AccountId;
};

export type SystemTokenPayload = {
    readonly type: "System";
    readonly spaceId: SpaceId;
};

export type AnonymousTokenPayload = {
    readonly type: "Anonymous";
};

export type BotTokenPayload = {
    readonly type: "Bot";
    readonly spaceId: SpaceId;
    readonly accountId: AccountId;
    readonly scope: BotTokenPayloadScope;
};

// TODO(calebmer, #api): Don't allow bots to be added to `AccessPolicy`'s
// `accountGrantById`. Bots get access to stuff in different ways.
export type BotTokenPayloadScope =
    // The bot has access to everything this account has access to.
    //
    // Theoretically, this is the same as `Chat` for a 1:1 chat between just the
    // bot and the account.
    | {readonly type: "Account"; readonly accountId: AccountId}
    // The bot has access to everything that everyone with view access to these
    // entities has access to.
    | {readonly type: "Chat"; readonly chatId: ChatId}
    | {readonly type: "Document"; readonly documentId: DocumentId}
    | {readonly type: "Post"; readonly postId: PostId}
    | {readonly type: "Task"; readonly taskId: TaskId}
    // The bot has access to only things that are shared with everyone in the
    // space. So only what's been shared with `AccessPolicy`'s `defaultGrant`.
    | {readonly type: "Space"};

export type TokenPayload =
    | SessionTokenPayload
    | SystemTokenPayload
    | AnonymousTokenPayload
    | BotTokenPayload;

export const TokenPayloadSchema = Schema.object({
    sid: Schema.id<SessionId>().optional(),
    aid: Schema.id<AccountId>().optional(),
    // "w" stands for "workspace" since "s" for "space" is taken.
    wid: Schema.id<SpaceId>().optional(),
    ano: Schema.value(1).optional(),
    sco: Schema.string.optional(),
})
    .transform<TokenPayload>({
        serialize: payload => {
            switch (payload.type) {
                case "Session":
                    return {sid: payload.sessionId, aid: payload.accountId};
                case "System":
                    return {wid: payload.spaceId};
                case "Anonymous":
                    return {ano: 1};
                case "Bot": {
                    return {
                        wid: payload.spaceId,
                        aid: payload.accountId,
                        sco: serializeBotTokenPayloadScope(payload.scope),
                    };
                }
                default:
                    throw exhaustive(payload);
            }
        },
        deserialize: payload => {
            if (payload.ano !== undefined) {
                return {type: "Anonymous"};
            }

            if (payload.sco !== undefined) {
                if (payload.wid === undefined)
                    throw new InvalidArgumentError("Token payload is missing required `wid` claim");

                if (payload.aid === undefined)
                    throw new InvalidArgumentError("Token payload is missing required `aid` claim");

                const scope = deserializeBotTokenPayloadScope(payload.sco);
                if (!scope) throw new InvalidArgumentError("Invalid bot token payload scope");

                return {
                    type: "Bot",
                    spaceId: payload.wid,
                    accountId: payload.aid,
                    scope,
                };
            }

            if (payload.wid !== undefined) {
                // Defend against session or bot tokens being treated as system tokens.
                if (payload.aid !== undefined)
                    throw new InvalidArgumentError("Token payload has unexpected `aid` claim");

                return {
                    type: "System",
                    spaceId: payload.wid,
                };
            }

            if (payload.sid === undefined)
                throw new InvalidArgumentError("Token payload is missing required `sid` claim");

            if (payload.aid === undefined)
                throw new InvalidArgumentError("Token payload is missing required `aid` claim");

            return {
                type: "Session",
                sessionId: payload.sid,
                accountId: payload.aid,
            };
        },
    })
    .migration({
        serialize: payload => payload,
        deserialize: payload => {
            // NOTE(calebmer, 2024-09-24): Support token payloads created before this date.
            // When all current tokens expire we should be able to use our new format
            // exclusively and we can remove this migration.
            if (isObject(payload) && typeof payload.type === "string") {
                if (payload.type === "Session") {
                    return {sid: payload.sessionId, aid: payload.accountId};
                } else if (payload.type === "System") {
                    return {wid: payload.spaceId};
                }
            }
            return payload;
        },
    });

function serializeBotTokenPayloadScope(scope: BotTokenPayloadScope): string {
    switch (scope.type) {
        case "Account":
            return `a-${scope.accountId}`;
        case "Chat":
            return `c-${scope.chatId}`;
        case "Document":
            return `d-${scope.documentId}`;
        case "Post":
            return `p-${scope.postId}`;
        case "Task":
            return `t-${scope.taskId}`;
        case "Space":
            return "s";
        default:
            throw exhaustive(scope);
    }
}

function deserializeBotTokenPayloadScope(scope: string): BotTokenPayloadScope | null {
    if (scope === "s") {
        return {type: "Space"};
    } else {
        const [type = "", id = ""] = scope.split("-", 2);
        switch (type) {
            case "a": {
                if (isId<AccountId>(id)) return {type: "Account", accountId: id};
                break;
            }
            case "c": {
                if (isId<ChatId>(id)) return {type: "Chat", chatId: id};
                break;
            }
            case "d": {
                if (isId<DocumentId>(id)) return {type: "Document", documentId: id};
                break;
            }
            case "p": {
                if (isId<PostId>(id)) return {type: "Post", postId: id};
            }
            case "t": {
                if (isId<TaskId>(id)) return {type: "Task", taskId: id};
                break;
            }
        }
    }

    return null;
}
