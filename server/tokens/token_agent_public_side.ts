import {CompactEncrypt, JWTPayload, KeyLike, decodeJwt, importSPKI, jwtVerify} from "jose";
import {TokenPayload, TokenPayloadSchema} from "~/server/tokens/token_payload.js";
import {TokenServiceName, TokenServiceNameSchema} from "~/server/tokens/token_service_name.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
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
    private readonly _fileUploadServicePublicKeyForRs256: KeyLike;
    private readonly _fileUploadServicePublicKeyForRsaOaep: KeyLike;

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
        fileUploadServicePublicKeyForRs256,
        fileUploadServicePublicKeyForRsaOaep,
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
        fileUploadServicePublicKeyForRs256: KeyLike;
        fileUploadServicePublicKeyForRsaOaep: KeyLike;
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
        this._fileUploadServicePublicKeyForRs256 = fileUploadServicePublicKeyForRs256;
        this._fileUploadServicePublicKeyForRsaOaep = fileUploadServicePublicKeyForRsaOaep;
    }

    public static async new({
        serviceName,
        appServicePublicKey: appServicePublicKeyString,
        edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyString,
        taskRealtimeServicePublicKey: taskRealtimeServicePublicKeyString,
        jobQueueServicePublicKey: jobQueueServicePublicKeyString,
        fileUploadServicePublicKey: fileUploadServicePublicKeyString,
    }: {
        serviceName: TokenServiceName;
        appServicePublicKey: string;
        edgeServiceFamilyPublicKey: string;
        taskRealtimeServicePublicKey: string;
        jobQueueServicePublicKey: string;
        fileUploadServicePublicKey: string;
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
            fileUploadServicePublicKeyForRs256,
            fileUploadServicePublicKeyForRsaOaep,
        ] = await runAllPromises([
            importSPKI(appServicePublicKeyString, "RS256"),
            importSPKI(appServicePublicKeyString, "RSA-OAEP"),
            importSPKI(edgeServiceFamilyPublicKeyString, "RS256"),
            importSPKI(edgeServiceFamilyPublicKeyString, "RSA-OAEP"),
            importSPKI(taskRealtimeServicePublicKeyString, "RS256"),
            importSPKI(taskRealtimeServicePublicKeyString, "RSA-OAEP"),
            importSPKI(jobQueueServicePublicKeyString, "RS256"),
            importSPKI(jobQueueServicePublicKeyString, "RSA-OAEP"),
            importSPKI(fileUploadServicePublicKeyString, "RS256"),
            importSPKI(fileUploadServicePublicKeyString, "RSA-OAEP"),
        ]);

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
            fileUploadServicePublicKeyForRs256,
            fileUploadServicePublicKeyForRsaOaep,
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
            case "FileUploadService":
                return this._fileUploadServicePublicKeyForRs256;
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
            case "FileUploadService":
                return this._fileUploadServicePublicKeyForRsaOaep;
            default:
                throw exhaustive(serviceName);
        }
    }

    /**
     * Verifies a token produced by any instance of `TokenAgentPrivateSide` and
     * returns the payload associated with the token when we don't know the token
     * issuer.
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
     * returns the payload associated with the token.
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
