import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type SessionTokenPayload = SchemaType<typeof SessionTokenPayloadSchema>;
export type SystemTokenPayload = SchemaType<typeof SystemTokenPayloadSchema>;
export type TokenPayload = SchemaType<typeof TokenPayloadSchema>;

export const SessionTokenPayloadSchema = Schema.object({
    type: Schema.value("Session"),
    sessionId: Schema.id<SessionId>(),
    // Though we could load the `AccountId` from the database item for our
    // `SessionId`, it saves us database roundtrips to include it in the token
    // given the `AccountId` for a session will never change.
    //
    // When verifying the session still exists, we also need to verify the
    // `AccountId` for the session is correct.
    accountId: Schema.id<AccountId>(),
});

export const SystemTokenPayloadSchema = Schema.object({
    type: Schema.value("System"),
    spaceId: Schema.id<SpaceId>(),
});

export const TokenPayloadSchema = Schema.union({
    Session: SessionTokenPayloadSchema,
    System: SystemTokenPayloadSchema,
});
