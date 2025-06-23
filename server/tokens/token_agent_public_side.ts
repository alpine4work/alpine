import {CompactEncrypt, JWTPayload, KeyLike, decodeJwt, importSPKI, jwtVerify} from "jose";
import {TokenPayload, TokenPayloadSchema} from "~/server/tokens/token_payload.js";
import {
    TokenServiceName,
    TokenServiceNameSchema,
    tokenServiceShortNameByName,
} from "~/server/tokens/token_service_name.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * The token agent class is responsible for RSA key cryptography between
 * services in our system. This class does tasks related to public keys.
 * `TokenAgentPrivateSide` does tasks related to private keys.
 *
 * A service has only its own private key and has the public keys for every
 * other service.
 */
// TODO(calebmer, #security): We should eventually implement key rotation. No
// human should ever have access to our system's private keys.
//
// TODO(calebmer): When I first wrote this class it only did JWT token signing.
// Now it also has encryption/decryption methods which means it's a more
// general purpose RSA cryptography class. Should it be renamed?
export class TokenAgentPublicSide {
    private readonly _serviceName: TokenServiceName;

    private readonly _appServicePublicKeyForRs256: KeyLike;
    private readonly _appServicePublicKeyForRsaOaep: KeyLike;
    private readonly _edgeServiceFamilyPublicKeyForRs256: KeyLike;
    private readonly _edgeServiceFamilyPublicKeyForRsaOaep: KeyLike;
    private readonly _taskRealtimeServicePublicKeyForRs256: KeyLike;
    private readonly _taskRealtimeServicePublicKeyForRsaOaep: KeyLike;
    private readonly _jobQueueServicePublicKeyForRs256: KeyLike;
    private readonly _jobQueueServicePublicKeyForRsaOaep: KeyLike;
    private readonly _fileProcessorServicePublicKeyForRs256: KeyLike;
    private readonly _fileProcessorServicePublicKeyForRsaOaep: KeyLike;
    private readonly _secretForHs256: Uint8Array;

    private constructor({
        serviceName,
        appServicePublicKeyForRs256,
        appServicePublicKeyForRsaOaep,
        edgeServiceFamilyPublicKeyForRs256,
        edgeServiceFamilyPublicKeyForRsaOaep,
        taskRealtimeServicePublicKeyForRs256,
        taskRealtimeServicePublicKeyForRsaOaep,
        jobQueueServicePublicKeyForRs256,
        jobQueueServicePublicKeyForRsaOaep,
        fileProcessorServicePublicKeyForRs256,
        fileProcessorServicePublicKeyForRsaOaep,
        secretForHs256,
    }: {
        serviceName: TokenServiceName;
        appServicePublicKeyForRs256: KeyLike;
        appServicePublicKeyForRsaOaep: KeyLike;
        edgeServiceFamilyPublicKeyForRs256: KeyLike;
        edgeServiceFamilyPublicKeyForRsaOaep: KeyLike;
        taskRealtimeServicePublicKeyForRs256: KeyLike;
        taskRealtimeServicePublicKeyForRsaOaep: KeyLike;
        jobQueueServicePublicKeyForRs256: KeyLike;
        jobQueueServicePublicKeyForRsaOaep: KeyLike;
        fileProcessorServicePublicKeyForRs256: KeyLike;
        fileProcessorServicePublicKeyForRsaOaep: KeyLike;
        secretForHs256: Uint8Array;
    }) {
        this._serviceName = serviceName;
        this._appServicePublicKeyForRs256 = appServicePublicKeyForRs256;
        this._appServicePublicKeyForRsaOaep = appServicePublicKeyForRsaOaep;
        this._edgeServiceFamilyPublicKeyForRs256 = edgeServiceFamilyPublicKeyForRs256;
        this._edgeServiceFamilyPublicKeyForRsaOaep = edgeServiceFamilyPublicKeyForRsaOaep;
        this._taskRealtimeServicePublicKeyForRs256 = taskRealtimeServicePublicKeyForRs256;
        this._taskRealtimeServicePublicKeyForRsaOaep = taskRealtimeServicePublicKeyForRsaOaep;
        this._jobQueueServicePublicKeyForRs256 = jobQueueServicePublicKeyForRs256;
        this._jobQueueServicePublicKeyForRsaOaep = jobQueueServicePublicKeyForRsaOaep;
        this._fileProcessorServicePublicKeyForRs256 = fileProcessorServicePublicKeyForRs256;
        this._fileProcessorServicePublicKeyForRsaOaep = fileProcessorServicePublicKeyForRsaOaep;
        this._secretForHs256 = secretForHs256;
    }

    public static async new({
        serviceName,
        appServicePublicKey: appServicePublicKeyString,
        edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyString,
        taskRealtimeServicePublicKey: taskRealtimeServicePublicKeyString,
        jobQueueServicePublicKey: jobQueueServicePublicKeyString,
        fileProcessorServicePublicKey: fileProcessorServicePublicKeyString,
        secret: secretString,
    }: {
        serviceName: TokenServiceName;
        appServicePublicKey: string;
        edgeServiceFamilyPublicKey: string;
        taskRealtimeServicePublicKey: string;
        jobQueueServicePublicKey: string;
        fileProcessorServicePublicKey: string;
        secret: string;
    }) {
        const [
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
            jobQueueServicePublicKeyForRs256,
            jobQueueServicePublicKeyForRsaOaep,
            fileProcessorServicePublicKeyForRs256,
            fileProcessorServicePublicKeyForRsaOaep,
        ] = await runAllPromises([
            importSPKI(appServicePublicKeyString, "RS256"),
            importSPKI(appServicePublicKeyString, "RSA-OAEP"),
            importSPKI(edgeServiceFamilyPublicKeyString, "RS256"),
            importSPKI(edgeServiceFamilyPublicKeyString, "RSA-OAEP"),
            importSPKI(taskRealtimeServicePublicKeyString, "RS256"),
            importSPKI(taskRealtimeServicePublicKeyString, "RSA-OAEP"),
            importSPKI(jobQueueServicePublicKeyString, "RS256"),
            importSPKI(jobQueueServicePublicKeyString, "RSA-OAEP"),
            importSPKI(fileProcessorServicePublicKeyString, "RS256"),
            importSPKI(fileProcessorServicePublicKeyString, "RSA-OAEP"),
        ]);

        const secretForHs256 = decodeBase64(secretString.trim());
        assert(secretForHs256.length === 32);

        return new TokenAgentPublicSide({
            serviceName,
            appServicePublicKeyForRs256,
            appServicePublicKeyForRsaOaep,
            edgeServiceFamilyPublicKeyForRs256,
            edgeServiceFamilyPublicKeyForRsaOaep,
            taskRealtimeServicePublicKeyForRs256,
            taskRealtimeServicePublicKeyForRsaOaep,
            jobQueueServicePublicKeyForRs256,
            jobQueueServicePublicKeyForRsaOaep,
            fileProcessorServicePublicKeyForRs256,
            fileProcessorServicePublicKeyForRsaOaep,
            secretForHs256,
        });
    }

    protected _getServicePublicKeyForRs256(serviceName: TokenServiceName): KeyLike {
        switch (serviceName) {
            case "AppService":
                return this._appServicePublicKeyForRs256;
            case "EdgeService":
            case "DocumentCollaborationService":
            case "PostRealtimeService":
            case "ChannelRealtimeService":
            case "ChatRealtimeService":
            case "MyAccountService":
            case "TaskNotesCollaborationService":
                return this._edgeServiceFamilyPublicKeyForRs256;
            case "TaskRealtimeService":
                return this._taskRealtimeServicePublicKeyForRs256;
            case "JobQueueService":
                return this._jobQueueServicePublicKeyForRs256;
            case "FileProcessorService":
                return this._fileProcessorServicePublicKeyForRs256;
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
            case "ChannelRealtimeService":
            case "ChatRealtimeService":
            case "MyAccountService":
            case "TaskNotesCollaborationService":
                return this._edgeServiceFamilyPublicKeyForRsaOaep;
            case "TaskRealtimeService":
                return this._taskRealtimeServicePublicKeyForRsaOaep;
            case "JobQueueService":
                return this._jobQueueServicePublicKeyForRsaOaep;
            case "FileProcessorService":
                return this._fileProcessorServicePublicKeyForRsaOaep;
            default:
                throw exhaustive(serviceName);
        }
    }

    /**
     * Verifies a token produced by any instance of `TokenAgentPrivateSide` and
     * returns the payload associated with the token when we don't know the token
     * issuer. Throws an error if the signed token is invalid.
     *
     * `verifyTokenFromIssuer()` is slightly more efficient when you know the
     * issuer up-front.
     */
    public async verifyToken(token: string): Promise<{
        serviceName: TokenServiceName;
        payload: TokenPayload;
    }> {
        const {iss: issClaim} = decodeJwt(token);
        const serviceName = TokenServiceNameSchema.deserialize(issClaim ?? null);
        const payload = await this.verifyTokenFromService(serviceName, token);
        return {serviceName, payload};
    }

    /**
     * Verifies a token produced by any instance of `TokenAgentPrivateSide` and
     * returns the payload associated with the token. Throws an error if the signed
     * token is invalid.
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
                issuer: [
                    tokenServiceShortNameByName[serviceName],
                    // NOTE(calebmer, 2024-09-24): Support token payloads created before this date.
                    // When all current tokens expire we should be able to use our new format
                    // exclusively and we can remove this migration.
                    serviceName,
                ],
                audience: [
                    tokenServiceShortNameByName[this._serviceName],
                    // NOTE(calebmer, 2024-09-24): Support token payloads created before this date.
                    // When all current tokens expire we should be able to use our new format
                    // exclusively and we can remove this migration.
                    this._serviceName,
                ],
            }));
        } catch (error) {
            throw new PermissionDeniedError(error instanceof Error ? error.message : String(error));
        }

        return TokenPayloadSchema.deserialize(serializedPayload as SchemaSerializedValue);
    }

    private _getUrlToken(url: URL): string {
        const expirationTimeString = url.searchParams.get("exp");
        const expirationTime = expirationTimeString ? parseInt(expirationTimeString, 10) : null;
        const issuer = url.searchParams.get("iss");
        let audience: Array<string> | string | null = url.searchParams.get("aud");
        if (audience?.includes(",")) audience = audience.split(",");

        const signature = url.searchParams.get("sig");
        const signatureParts = signature?.split(".", 3);
        if (signatureParts?.length !== 3)
            throw new InvalidArgumentError("URL `sig` search param is invalid");

        const originalUrl = new URL(url);
        originalUrl.searchParams.delete("exp");
        originalUrl.searchParams.delete("iss");
        originalUrl.searchParams.delete("aud");
        originalUrl.searchParams.delete("sig");

        signatureParts[1] = encodeBase64(
            new TextEncoder().encode(
                JSON.stringify({
                    url: `${originalUrl.pathname}${originalUrl.search}`,
                    exp: expirationTime ?? undefined,
                    iss: issuer ?? undefined,
                    aud: audience ?? undefined,
                }),
            ),
            "Rfc4648Url",
        );

        return signatureParts.join(".");
    }

    /**
     * Verifies a URL produced by any instance of `TokenAgentPrivateSide` when we
     * don't know the token issuer. Throws an error if the signed URL is invalid.
     */
    public async verifyUrl(url: URL): Promise<{
        serviceName: TokenServiceName;
    }> {
        const issuer = url.searchParams.get("iss");
        const serviceName = TokenServiceNameSchema.deserialize(issuer);
        await this.verifyUrlFromService(serviceName, url);
        return {serviceName};
    }

    /**
     * Verifies a URL produced by any instance of `TokenAgentPrivateSide`. Throws
     * an error if the signed URL is invalid.
     */
    public async verifyUrlFromService(serviceName: TokenServiceName, url: URL): Promise<void> {
        const token = this._getUrlToken(url);

        try {
            await jwtVerify(token, this._secretForHs256, {
                algorithms: ["HS256"],
                issuer: tokenServiceShortNameByName[serviceName],
                audience: tokenServiceShortNameByName[this._serviceName],
            });
        } catch (error) {
            throw new PermissionDeniedError(error instanceof Error ? error.message : String(error));
        }
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
}
