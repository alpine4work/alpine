import {InvalidArgumentError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
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

export type TokenPayload = SessionTokenPayload | SystemTokenPayload | AnonymousTokenPayload;

export const TokenPayloadSchema = Schema.object({
    sid: Schema.id<SessionId>().optional(),
    aid: Schema.id<AccountId>().optional(),
    // "w" stands for "workspace" since "s" is taken.
    wid: Schema.id<SpaceId>().optional(),
    ano: Schema.value(1).optional(),
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
                default:
                    throw exhaustive(payload);
            }
        },
        deserialize: payload => {
            if (payload.ano) {
                return {type: "Anonymous"};
            }

            if (payload.wid) {
                return {
                    type: "System",
                    spaceId: payload.wid,
                };
            }

            if (!payload.sid)
                throw new InvalidArgumentError("Token payload is missing required `sid` claim");

            if (!payload.aid)
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
