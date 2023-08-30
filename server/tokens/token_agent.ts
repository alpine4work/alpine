import {
    CompactEncrypt,
    JWTPayload,
    KeyLike,
    SignJWT,
    compactDecrypt,
    decodeJwt,
    importPKCS8,
    importSPKI,
    jwtVerify,
} from "jose";
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

const tokenServiceNames = [
    "AppService",
    "TaskRealtimeService",
    ...tokenEdgeServiceFamilyNames,
] as const;

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
// TODO(calebmer, #security): We should eventually implement key rotation. No
// human should ever have access to our system's private keys.
export abstract class TokenAgentBase {
    protected readonly _appServicePublicKeyForRs256: KeyLike;
    protected readonly _appServicePublicKeyForRsaOaep: KeyLike;
    protected readonly _edgeServiceFamilyPublicKeyForRs256: KeyLike;
    protected readonly _edgeServiceFamilyPublicKeyForRsaOaep: KeyLike;
    protected readonly _taskRealtimeServicePublicKeyForRs256: KeyLike;
    protected readonly _taskRealtimeServicePublicKeyForRsaOaep: KeyLike;

    protected abstract readonly _serviceName: TokenServiceName;
    protected abstract readonly _servicePrivateKeyForRs256: KeyLike;
    protected abstract readonly _servicePrivateKeyForRsaOaep: KeyLike;

    protected constructor({
        appServicePublicKeyForRs256,
        appServicePublicKeyForRsaOaep,
        edgeServiceFamilyPublicKeyForRs256,
        edgeServiceFamilyPublicKeyForRsaOaep,
        taskRealtimeServicePublicKeyForRs256,
        taskRealtimeServicePublicKeyForRsaOaep,
    }: {
        appServicePublicKeyForRs256: KeyLike;
        appServicePublicKeyForRsaOaep: KeyLike;
        edgeServiceFamilyPublicKeyForRs256: KeyLike;
        edgeServiceFamilyPublicKeyForRsaOaep: KeyLike;
        taskRealtimeServicePublicKeyForRs256: KeyLike;
        taskRealtimeServicePublicKeyForRsaOaep: KeyLike;
    }) {
        this._appServicePublicKeyForRs256 = appServicePublicKeyForRs256;
        this._appServicePublicKeyForRsaOaep = appServicePublicKeyForRsaOaep;
        this._edgeServiceFamilyPublicKeyForRs256 = edgeServiceFamilyPublicKeyForRs256;
        this._edgeServiceFamilyPublicKeyForRsaOaep = edgeServiceFamilyPublicKeyForRsaOaep;
        this._taskRealtimeServicePublicKeyForRs256 = taskRealtimeServicePublicKeyForRs256;
        this._taskRealtimeServicePublicKeyForRsaOaep = taskRealtimeServicePublicKeyForRsaOaep;
    }

    protected _getServicePublicKeyForRs256(serviceName: TokenServiceName): KeyLike {
        switch (serviceName) {
            case "AppService":
                return this._appServicePublicKeyForRs256;
            case "EdgeService":
            case "DocumentCollaborationService":
            case "PostRealtimeService":
            case "ChatRealtimeService":
            case "MyAccountService":
                return this._edgeServiceFamilyPublicKeyForRs256;
            case "TaskRealtimeService":
                return this._taskRealtimeServicePublicKeyForRs256;
            default:
                throw exhaustive(serviceName);
        }
    }

    protected _getServicePublicKeyForRsaOaep(serviceName: TokenServiceName): KeyLike {
        switch (serviceName) {
            case "AppService":
                return this._appServicePublicKeyForRsaOaep;
            case "EdgeService":
            case "DocumentCollaborationService":
            case "PostRealtimeService":
            case "ChatRealtimeService":
            case "MyAccountService":
                return this._edgeServiceFamilyPublicKeyForRsaOaep;
            case "TaskRealtimeService":
                return this._taskRealtimeServicePublicKeyForRsaOaep;
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
        const publicKey = this._getServicePublicKeyForRs256(serviceName);

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

        return signer.sign(this._servicePrivateKeyForRs256);
    }

    /**
     * Encrypt some sensitive data for the provided audience. Generates a compact
     * JWE string. See [this explainer][1] for more information on JWE.
     *
     * [1]: https://www.scottbrady91.com/jose/json-web-encryption
     */
    public encrypt(audience: TokenServiceName, payload: string): Promise<string> {
        const audiencePublicKey = this._getServicePublicKeyForRsaOaep(audience);

        const encrypter = new CompactEncrypt(new TextEncoder().encode(payload))
            // Algorithm taken from:
            // https://www.scottbrady91.com/jose/json-web-encryption
            .setProtectedHeader({alg: "RSA-OAEP", enc: "A256CBC-HS512"});

        return encrypter.encrypt(audiencePublicKey);
    }

    /**
     * Decrypt some sensitive data that was encrypted with `encrypt()` (a JWE
     * string) with our token agent's private key.
     */
    public async decrypt(encryptedPayload: string): Promise<string> {
        const {plaintext} = await compactDecrypt(
            encryptedPayload,
            this._servicePrivateKeyForRsaOaep,
        );
        return new TextDecoder().decode(plaintext);
    }
}

export class AppServiceTokenAgent extends TokenAgentBase {
    protected override readonly _serviceName: TokenServiceName;
    protected override readonly _servicePrivateKeyForRs256: KeyLike;
    protected override readonly _servicePrivateKeyForRsaOaep: KeyLike;

    private constructor({
        appServicePublicKeyForRs256,
        appServicePublicKeyForRsaOaep,
        edgeServiceFamilyPublicKeyForRs256,
        edgeServiceFamilyPublicKeyForRsaOaep,
        taskRealtimeServicePublicKeyForRs256,
        taskRealtimeServicePublicKeyForRsaOaep,
        appServicePrivateKeyForRs256,
        appServicePrivateKeyForRsaOaep,
    }: {
        appServicePublicKeyForRs256: KeyLike;
        appServicePublicKeyForRsaOaep: KeyLike;
        edgeServiceFamilyPublicKeyForRs256: KeyLike;
        edgeServiceFamilyPublicKeyForRsaOaep: KeyLike;
        taskRealtimeServicePublicKeyForRs256: KeyLike;
        taskRealtimeServicePublicKeyForRsaOaep: KeyLike;
        appServicePrivateKeyForRs256: KeyLike;
        appServicePrivateKeyForRsaOaep: KeyLike;
    }) {
        super({
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
        });
        this._serviceName = "AppService";
        this._servicePrivateKeyForRs256 = appServicePrivateKeyForRs256;
        this._servicePrivateKeyForRsaOaep = appServicePrivateKeyForRsaOaep;
    }

    public static async new({
        appServicePublicKey: appServicePublicKeyString,
        edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyString,
        taskRealtimeServicePublicKey: taskRealtimeServicePublicKeyString,
        appServicePrivateKey: appServicePrivateKeyString,
    }: {
        appServicePublicKey: string;
        edgeServiceFamilyPublicKey: string;
        taskRealtimeServicePublicKey: string;
        appServicePrivateKey: string;
    }) {
        const [
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
            appServicePrivateKeyForRs256,
            appServicePrivateKeyForRsaOaep,
        ] = await runAllPromises([
            importSPKI(appServicePublicKeyString, "RS256"),
            importSPKI(appServicePublicKeyString, "RSA-OAEP"),
            importSPKI(edgeServiceFamilyPublicKeyString, "RS256"),
            importSPKI(edgeServiceFamilyPublicKeyString, "RSA-OAEP"),
            importSPKI(taskRealtimeServicePublicKeyString, "RS256"),
            importSPKI(taskRealtimeServicePublicKeyString, "RSA-OAEP"),
            importPKCS8(appServicePrivateKeyString, "RS256"),
            importPKCS8(appServicePrivateKeyString, "RSA-OAEP"),
        ]);

        return new AppServiceTokenAgent({
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
            appServicePrivateKeyForRs256,
            appServicePrivateKeyForRsaOaep,
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

        return signer.sign(this._servicePrivateKeyForRs256);
    }
}

export class EdgeServiceFamilyTokenAgent extends TokenAgentBase {
    protected override readonly _serviceName: TokenServiceName;
    protected override readonly _servicePrivateKeyForRs256: KeyLike;
    protected override readonly _servicePrivateKeyForRsaOaep: KeyLike;

    private constructor({
        serviceName,
        appServicePublicKeyForRs256,
        appServicePublicKeyForRsaOaep,
        edgeServiceFamilyPublicKeyForRs256,
        edgeServiceFamilyPublicKeyForRsaOaep,
        taskRealtimeServicePublicKeyForRs256,
        taskRealtimeServicePublicKeyForRsaOaep,
        edgeServiceFamilyPrivateKeyForRs256,
        edgeServiceFamilyPrivateKeyForRsaOaep,
    }: {
        serviceName: TokenEdgeServiceFamilyName;
        appServicePublicKeyForRs256: KeyLike;
        appServicePublicKeyForRsaOaep: KeyLike;
        edgeServiceFamilyPublicKeyForRs256: KeyLike;
        edgeServiceFamilyPublicKeyForRsaOaep: KeyLike;
        taskRealtimeServicePublicKeyForRs256: KeyLike;
        taskRealtimeServicePublicKeyForRsaOaep: KeyLike;
        edgeServiceFamilyPrivateKeyForRs256: KeyLike;
        edgeServiceFamilyPrivateKeyForRsaOaep: KeyLike;
    }) {
        super({
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
        });
        this._serviceName = serviceName;
        this._servicePrivateKeyForRs256 = edgeServiceFamilyPrivateKeyForRs256;
        this._servicePrivateKeyForRsaOaep = edgeServiceFamilyPrivateKeyForRsaOaep;
    }

    public static async new({
        serviceName,
        appServicePublicKey: appServicePublicKeyString,
        edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyString,
        taskRealtimeServicePublicKey: taskRealtimeServicePublicKeyString,
        edgeServiceFamilyPrivateKey: edgeServiceFamilyPrivateKeyString,
    }: {
        serviceName: TokenEdgeServiceFamilyName;
        appServicePublicKey: string;
        edgeServiceFamilyPublicKey: string;
        taskRealtimeServicePublicKey: string;
        edgeServiceFamilyPrivateKey: string;
    }) {
        const [
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
            edgeServiceFamilyPrivateKeyForRs256,
            edgeServiceFamilyPrivateKeyForRsaOaep,
        ] = await runAllPromises([
            importSPKI(appServicePublicKeyString, "RS256"),
            importSPKI(appServicePublicKeyString, "RSA-OAEP"),
            importSPKI(edgeServiceFamilyPublicKeyString, "RS256"),
            importSPKI(edgeServiceFamilyPublicKeyString, "RSA-OAEP"),
            importSPKI(taskRealtimeServicePublicKeyString, "RS256"),
            importSPKI(taskRealtimeServicePublicKeyString, "RSA-OAEP"),
            importPKCS8(edgeServiceFamilyPrivateKeyString, "RS256"),
            importPKCS8(edgeServiceFamilyPrivateKeyString, "RSA-OAEP"),
        ]);

        return new EdgeServiceFamilyTokenAgent({
            serviceName,
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
            edgeServiceFamilyPrivateKeyForRs256,
            edgeServiceFamilyPrivateKeyForRsaOaep,
        });
    }
}

export class TaskRealtimeServiceTokenAgent extends TokenAgentBase {
    protected override readonly _serviceName: TokenServiceName;
    protected override readonly _servicePrivateKeyForRs256: KeyLike;
    protected override readonly _servicePrivateKeyForRsaOaep: KeyLike;

    private constructor({
        appServicePublicKeyForRs256,
        appServicePublicKeyForRsaOaep,
        edgeServiceFamilyPublicKeyForRs256,
        edgeServiceFamilyPublicKeyForRsaOaep,
        taskRealtimeServicePublicKeyForRs256,
        taskRealtimeServicePublicKeyForRsaOaep,
        taskRealtimeServicePrivateKeyForRs256,
        taskRealtimeServicePrivateKeyForRsaOaep,
    }: {
        appServicePublicKeyForRs256: KeyLike;
        appServicePublicKeyForRsaOaep: KeyLike;
        edgeServiceFamilyPublicKeyForRs256: KeyLike;
        edgeServiceFamilyPublicKeyForRsaOaep: KeyLike;
        taskRealtimeServicePublicKeyForRs256: KeyLike;
        taskRealtimeServicePublicKeyForRsaOaep: KeyLike;
        taskRealtimeServicePrivateKeyForRs256: KeyLike;
        taskRealtimeServicePrivateKeyForRsaOaep: KeyLike;
    }) {
        super({
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
        });
        this._serviceName = "TaskRealtimeService";
        this._servicePrivateKeyForRs256 = taskRealtimeServicePrivateKeyForRs256;
        this._servicePrivateKeyForRsaOaep = taskRealtimeServicePrivateKeyForRsaOaep;
    }

    public static async new({
        appServicePublicKey: appServicePublicKeyString,
        edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyString,
        taskRealtimeServicePublicKey: taskRealtimeServicePublicKeyString,
        taskRealtimeServicePrivateKey: taskRealtimeServicePrivateKeyString,
    }: {
        appServicePublicKey: string;
        edgeServiceFamilyPublicKey: string;
        taskRealtimeServicePublicKey: string;
        taskRealtimeServicePrivateKey: string;
    }) {
        const [
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
            taskRealtimeServicePrivateKeyForRs256,
            taskRealtimeServicePrivateKeyForRsaOaep,
        ] = await runAllPromises([
            importSPKI(appServicePublicKeyString, "RS256"),
            importSPKI(appServicePublicKeyString, "RSA-OAEP"),
            importSPKI(edgeServiceFamilyPublicKeyString, "RS256"),
            importSPKI(edgeServiceFamilyPublicKeyString, "RSA-OAEP"),
            importSPKI(taskRealtimeServicePublicKeyString, "RS256"),
            importSPKI(taskRealtimeServicePublicKeyString, "RSA-OAEP"),
            importPKCS8(taskRealtimeServicePrivateKeyString, "RS256"),
            importPKCS8(taskRealtimeServicePrivateKeyString, "RSA-OAEP"),
        ]);

        return new TaskRealtimeServiceTokenAgent({
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
            taskRealtimeServicePrivateKeyForRs256,
            taskRealtimeServicePrivateKeyForRsaOaep,
        });
    }
}
