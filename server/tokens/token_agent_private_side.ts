import {KeyLike, SignJWT, compactDecrypt, importPKCS8} from "jose";
import {
    SessionTokenPayload,
    TokenPayload,
    TokenPayloadSchema,
} from "~/server/tokens/token_payload.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * The token agent class is responsible for RSA key cryptography between
 * services in our system. This class does tasks related to private keys.
 * `TokenAgentPublicSide` does tasks related to public keys.
 *
 * A service has only its own private key and has the public keys for every
 * other service.
 */
// TODO(calebmer, #security): We should eventually implement key rotation. No
// human should ever have access to our system's private keys.
export class TokenAgentPrivateSide {
    protected readonly _serviceName: TokenServiceName;
    protected readonly _servicePrivateKeyForRs256: KeyLike;
    protected readonly _servicePrivateKeyForRsaOaep: KeyLike;

    protected constructor({
        serviceName,
        servicePrivateKeyForRs256,
        servicePrivateKeyForRsaOaep,
    }: {
        serviceName: TokenServiceName;
        servicePrivateKeyForRs256: KeyLike;
        servicePrivateKeyForRsaOaep: KeyLike;
    }) {
        this._serviceName = serviceName;
        this._servicePrivateKeyForRs256 = servicePrivateKeyForRs256;
        this._servicePrivateKeyForRsaOaep = servicePrivateKeyForRsaOaep;
    }

    public static async new({
        serviceName,
        servicePrivateKey: servicePrivateKeyString,
    }: {
        serviceName: TokenServiceName;
        servicePrivateKey: string;
    }) {
        const [servicePrivateKeyForRs256, servicePrivateKeyForRsaOaep] = await runAllPromises([
            importPKCS8(servicePrivateKeyString, "RS256"),
            importPKCS8(servicePrivateKeyString, "RSA-OAEP"),
        ]);

        return new TokenAgentPrivateSide({
            serviceName,
            servicePrivateKeyForRs256,
            servicePrivateKeyForRsaOaep,
        });
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

export class AppServiceTokenAgentPrivateSide extends TokenAgentPrivateSide {
    protected constructor({
        servicePrivateKeyForRs256,
        servicePrivateKeyForRsaOaep,
    }: {
        servicePrivateKeyForRs256: KeyLike;
        servicePrivateKeyForRsaOaep: KeyLike;
    }) {
        super({
            serviceName: "AppService",
            servicePrivateKeyForRs256,
            servicePrivateKeyForRsaOaep,
        });
    }

    public static override async new({
        serviceName,
        servicePrivateKey: servicePrivateKeyString,
    }: {
        serviceName: TokenServiceName;
        servicePrivateKey: string;
    }) {
        assert(serviceName === "AppService");

        const [servicePrivateKeyForRs256, servicePrivateKeyForRsaOaep] = await runAllPromises([
            importPKCS8(servicePrivateKeyString, "RS256"),
            importPKCS8(servicePrivateKeyString, "RSA-OAEP"),
        ]);

        return new AppServiceTokenAgentPrivateSide({
            servicePrivateKeyForRs256,
            servicePrivateKeyForRsaOaep,
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
