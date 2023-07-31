import {JWTPayload, KeyLike, SignJWT, decodeJwt, importPKCS8, importSPKI, jwtVerify} from "jose";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaSerializedValue, SchemaType} from "~/shared/schema/schema.js";
import {DurableObjectServiceName, TracerServiceName} from "~/shared/tracer/tracer_root.js";

export type SessionTokenPayload = SchemaType<typeof SessionTokenPayloadSchema>;
export type SystemTokenPayload = SchemaType<typeof SystemTokenPayloadSchema>;
export type TokenPayload = SchemaType<typeof TokenPayloadSchema>;

const SessionTokenPayloadSchema = Schema.object({
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

const SystemTokenPayloadSchema = Schema.object({
    type: Schema.value("System"),
    spaceId: Schema.id<SpaceId>(),
});

const TokenPayloadSchema = Schema.union({
    Session: SessionTokenPayloadSchema,
    System: SystemTokenPayloadSchema,
});

const tokenEdgeServiceFamilyNames = [
    "EdgeService",
    "DocumentCollaborationService",
    "PostRealtimeService",
    "ChatRealtimeService",
    "MyAccountService",
] as const;

const tokenServiceNames = ["AppService", ...tokenEdgeServiceFamilyNames] as const;

export type TokenEdgeServiceFamilyName = (typeof tokenEdgeServiceFamilyNames)[number];
export type TokenServiceName = (typeof tokenServiceNames)[number];

const TokenServiceSchema = Schema.enum<TokenServiceName>(tokenServiceNames);

// All `TokenServiceName`s are also services.
assertAssignableTypes<TokenServiceName, TracerServiceName>();

// All durable object services are also `TokenEdgeServiceFamilyName`s.
assertAssignableTypes<DurableObjectServiceName, TokenEdgeServiceFamilyName>();

/**
 * The token agent helps sign and verify JWTs from across our services.
 */
export abstract class TokenAgentBase {
    protected readonly _appServicePublicKey: KeyLike;
    protected readonly _edgeServiceFamilyPublicKey: KeyLike;

    protected abstract readonly _serviceName: TokenServiceName;
    protected abstract readonly _servicePrivateKey: KeyLike;

    protected constructor({
        appServicePublicKey,
        edgeServiceFamilyPublicKey,
    }: {
        appServicePublicKey: KeyLike;
        edgeServiceFamilyPublicKey: KeyLike;
    }) {
        this._appServicePublicKey = appServicePublicKey;
        this._edgeServiceFamilyPublicKey = edgeServiceFamilyPublicKey;
    }

    protected _getServicePublicKeyByName(serviceName: TokenServiceName): KeyLike {
        switch (serviceName) {
            case "AppService":
                return this._appServicePublicKey;
            case "EdgeService":
            case "DocumentCollaborationService":
            case "PostRealtimeService":
            case "ChatRealtimeService":
            case "MyAccountService":
                return this._edgeServiceFamilyPublicKey;
            default:
                throw exhaustive(serviceName);
        }
    }

    /**
     * Verifies a token produced by any instance of `TokenAgentBase` and returns
     * the payload associated with the token when we don't know the token issuer.
     *
     * `verifyTokenFromIssuer()` is slightly more efficient when you know the
     * issuer up-front.
     */
    public async verifyToken(token: string): Promise<{
        serviceName: TokenServiceName;
        payload: TokenPayload;
    }> {
        const {iss: issClaim} = decodeJwt(token);
        const serviceName = TokenServiceSchema.deserialize(issClaim ?? null);
        const payload = await this.verifyTokenFromService(serviceName, token);
        return {serviceName, payload};
    }

    /**
     * Verifies a token produced by any instance of `TokenAgentBase` and returns
     * the payload associated with the token.
     */
    public async verifyTokenFromService(
        serviceName: TokenServiceName,
        token: string,
    ): Promise<TokenPayload> {
        const publicKey = this._getServicePublicKeyByName(serviceName);

        let serializedPayload: JWTPayload;
        try {
            ({payload: serializedPayload} = await jwtVerify(token, publicKey, {
                algorithms: ["RS256"],
                issuer: serviceName,
                audience: this._serviceName,
            }));
        } catch (error) {
            throw PermissionDeniedError.from(error);
        }

        return TokenPayloadSchema.deserialize(serializedPayload as SchemaSerializedValue);
    }

    /**
     * Sign a token for a specific audience that only lives for a short period of
     * time. (Less than ten minutes.)
     *
     * This is used to authenticate the execution of a single action.
     *
     * Dangerous since if an attacker can call this function with whatever input
     * they want, then they can impersonate any account! So be careful with what
     * you call this function with.
     */
    public dangerouslySignShortLivedToken(
        audience: TokenServiceName | Array<TokenServiceName>,
        payload: TokenPayload,
        {currentTimeForTest}: {currentTimeForTest?: Date} = {},
    ): Promise<string> {
        assert(currentTimeForTest === undefined || import.meta.jest);

        const currentTime =
            currentTimeForTest !== undefined ? currentTimeForTest.getTime() : Date.now();

        const signer = new SignJWT(TokenPayloadSchema.serialize(payload))
            .setProtectedHeader({alg: "RS256"})
            .setExpirationTime(Math.floor((currentTime + 1000 * 60 * 2) / 1000))
            .setIssuer(this._serviceName)
            .setAudience(audience);

        return signer.sign(this._servicePrivateKey);
    }
}

export class AppServiceTokenAgent extends TokenAgentBase {
    protected override readonly _serviceName: TokenServiceName;
    protected override readonly _servicePrivateKey: KeyLike;

    private constructor({
        appServicePublicKey,
        edgeServiceFamilyPublicKey,
        appServicePrivateKey,
    }: {
        appServicePublicKey: KeyLike;
        edgeServiceFamilyPublicKey: KeyLike;
        appServicePrivateKey: KeyLike;
    }) {
        super({appServicePublicKey, edgeServiceFamilyPublicKey});
        this._serviceName = "AppService";
        this._servicePrivateKey = appServicePrivateKey;
    }

    public static async new({
        appServicePublicKey: appServicePublicKeyString,
        edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyString,
        appServicePrivateKey: appServicePrivateKeyString,
    }: {
        appServicePublicKey: string;
        edgeServiceFamilyPublicKey: string;
        appServicePrivateKey: string;
    }) {
        const [appServicePublicKey, edgeServiceFamilyPublicKey, appServicePrivateKey] =
            await runAllPromises([
                importSPKI(appServicePublicKeyString, "RS256"),
                importSPKI(edgeServiceFamilyPublicKeyString, "RS256"),
                importPKCS8(appServicePrivateKeyString, "RS256"),
            ]);

        return new AppServiceTokenAgent({
            appServicePublicKey,
            edgeServiceFamilyPublicKey,
            appServicePrivateKey,
        });
    }

    /**
     * Sign a token that will live forever as a session cookie. Given having access
     * to an eternal session can be dangerous, we take the following extra
     * precautions:
     *
     * - Only `AppService` can sign these tokens
     * - They must be `Session` tokens (no `System` tokens)
     * - Only `AppService` and `EdgeService` may verify these tokens
     * - You may invalidate a session at any time by deleting its `SessionId` from
     *   the database
     *
     * Dangerous since if an attacker can call this function with whatever input
     * they want, then they can impersonate any account! So be careful with what
     * you call this function with.
     *
     * Also dangerous in that if this token leaks an attacker can use it for
     * however long they please! Generally you should be using
     * `dangerouslySignShortLivedToken()` unless for user experience reasons you
     * want the token to be valid for a while.
     */
    public async dangerouslySignEternalSessionToken(payload: SessionTokenPayload): Promise<string> {
        assert(payload.type === "Session");

        const signer = new SignJWT(TokenPayloadSchema.serialize(payload))
            .setProtectedHeader({alg: "RS256"})
            .setIssuedAt()
            .setIssuer(this._serviceName)
            .setAudience(["AppService", "EdgeService"]);

        return signer.sign(this._servicePrivateKey);
    }
}

export class EdgeServiceFamilyTokenAgent extends TokenAgentBase {
    protected override readonly _serviceName: TokenServiceName;
    protected override readonly _servicePrivateKey: KeyLike;

    private constructor({
        serviceName,
        appServicePublicKey,
        edgeServiceFamilyPublicKey,
        edgeServiceFamilyPrivateKey,
    }: {
        serviceName: TokenEdgeServiceFamilyName;
        appServicePublicKey: KeyLike;
        edgeServiceFamilyPublicKey: KeyLike;
        edgeServiceFamilyPrivateKey: KeyLike;
    }) {
        super({appServicePublicKey, edgeServiceFamilyPublicKey});
        this._serviceName = serviceName;
        this._servicePrivateKey = edgeServiceFamilyPrivateKey;
    }

    public static async new({
        serviceName,
        appServicePublicKey: appServicePublicKeyString,
        edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyString,
        edgeServiceFamilyPrivateKey: edgeServiceFamilyPrivateKeyString,
    }: {
        serviceName: TokenEdgeServiceFamilyName;
        appServicePublicKey: string;
        edgeServiceFamilyPublicKey: string;
        edgeServiceFamilyPrivateKey: string;
    }) {
        const [appServicePublicKey, edgeServiceFamilyPublicKey, edgeServiceFamilyPrivateKey] =
            await runAllPromises([
                importSPKI(appServicePublicKeyString, "RS256"),
                importSPKI(edgeServiceFamilyPublicKeyString, "RS256"),
                importPKCS8(edgeServiceFamilyPrivateKeyString, "RS256"),
            ]);

        return new EdgeServiceFamilyTokenAgent({
            serviceName,
            appServicePublicKey,
            edgeServiceFamilyPublicKey,
            edgeServiceFamilyPrivateKey,
        });
    }
}
