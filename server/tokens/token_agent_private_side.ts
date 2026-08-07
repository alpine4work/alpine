import {KeyLike, SignJWT, compactDecrypt, importPKCS8} from "jose";
import {
    BotTokenPayload,
    SessionTokenPayload,
    TokenPayload,
    TokenPayloadSchema,
} from "~/server/tokens/token_payload.js";
import {TokenServiceName, tokenServiceShortNameByName} from "~/server/tokens/token_service_name.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {decodeBase64} from "~/shared/helpers/binary/base64.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {SchemaSerializedObjectValue} from "~/shared/schema/schema.open_source.js";

/**
 * The token agent class is responsible for RSA key cryptography between services
 * in our system. This class does tasks related to private keys.
 * `TokenAgentPublicSide` does tasks related to public keys.
 *
 * A service has only its own private key and has the public keys for every other
 * service.
 */
// TODO(calebmer, #security): We should eventually implement key rotation. No human
// should ever have access to our system's private keys.
export class TokenAgentPrivateSide {
    protected readonly _serviceName: TokenServiceName;
    protected readonly _servicePrivateKeyForRs256: KeyLike;
    protected readonly _servicePrivateKeyForRsaOaep: KeyLike;
    protected readonly _secretForHs256: Uint8Array;

    protected constructor({
        serviceName,
        servicePrivateKeyForRs256,
        servicePrivateKeyForRsaOaep,
        secretForHs256,
    }: {
        serviceName: TokenServiceName;
        servicePrivateKeyForRs256: KeyLike;
        servicePrivateKeyForRsaOaep: KeyLike;
        secretForHs256: Uint8Array;
    }) {
        this._serviceName = serviceName;
        this._servicePrivateKeyForRs256 = servicePrivateKeyForRs256;
        this._servicePrivateKeyForRsaOaep = servicePrivateKeyForRsaOaep;
        this._secretForHs256 = secretForHs256;
    }

    public static async new({
        serviceName,
        servicePrivateKey: servicePrivateKeyString,
        secret: secretString,
    }: {
        serviceName: TokenServiceName;
        servicePrivateKey: string;
        secret: string;
    }) {
        const [servicePrivateKeyForRs256, servicePrivateKeyForRsaOaep] = await runAllPromises([
            importPKCS8(servicePrivateKeyString, "RS256"),
            importPKCS8(servicePrivateKeyString, "RSA-OAEP"),
        ]);

        const secretForHs256 = decodeBase64(secretString.trim());
        assert(secretForHs256.length === 32);

        return new TokenAgentPrivateSide({
            serviceName,
            servicePrivateKeyForRs256,
            servicePrivateKeyForRsaOaep,
            secretForHs256,
        });
    }

    /**
     * Sign a token for a specific audience that only lives for a short period of time.
     * (Less than two minutes.)
     *
     * Uses RS256 as the signing algorithm. Which is an asymmetric cryptography
     * algorithm. So each service has its own private key and other services verify it
     * against their public key. If a service's private key is discovered by an
     * attacker they still wouldn't be able to create keys that let them impersonate
     * another service. (e.g. If `FileProcessorService` is compromised an attacker
     * couldn't use that access to create a session token as `AppService`.)
     *
     * This is used to authenticate the execution of a single action.
     *
     * Dangerous since if an attacker can call this function with whatever input they
     * want, then they can impersonate any account! So be careful with what you call
     * this function with.
     */
    public dangerouslySignShortLivedToken(
        audience: TokenServiceName | Array<TokenServiceName>,
        payload: TokenPayload,
        {currentTimeForTest}: {currentTimeForTest?: Date} = {},
    ): Promise<string> {
        assert(currentTimeForTest === undefined || import.meta.jest);

        const currentTime =
            currentTimeForTest !== undefined ? currentTimeForTest.getTime() : Date.now();

        // 2 minutes
        const expirationTime = Math.floor((currentTime + 1000 * 60 * 2) / 1000);

        return this._dangerouslySignToken(audience, payload, expirationTime);
    }

    protected _dangerouslySignToken(
        audience: TokenServiceName | Array<TokenServiceName>,
        payload: TokenPayload,
        expirationTime: number,
    ): Promise<string> {
        const signer = new SignJWT(
            TokenPayloadSchema.serialize(payload) as SchemaSerializedObjectValue,
        )
            .setProtectedHeader({alg: "RS256"})
            .setExpirationTime(expirationTime)
            .setIssuer(tokenServiceShortNameByName[this._serviceName])
            .setAudience(
                typeof audience === "string"
                    ? tokenServiceShortNameByName[audience]
                    : audience.map(audience => tokenServiceShortNameByName[audience]),
            );

        return signer.sign(this._servicePrivateKeyForRs256);
    }

    /**
     * Sign a URL for a specific audience that only lives for a short period of time.
     * (Less than two minutes by default.) We only sign the `pathname` and `search`
     * part of the URL.
     *
     * Uses HS256 as the signing algorithm. Unlike RS256 (used by
     * `dangerouslySignUrl()`) HS256 is a symmetric signing algorithm. This means all
     * instances of `TokenAgent` across all our services have the same HS256 secret
     * key. To learn more about these two algorithms read "[RS256 vs HS256: What's The
     * Difference?][1]". If an attacker gets access to `FileProcessorService` than
     * they'll be able to sign URLs same as `AppService` since they have the secret
     * key.
     *
     * So HS256 is a little less secure than RS256 (but not by much, practically). We
     * use it because it generates much shorter signatures (2.5x smaller!). Which is
     * useful if you're signing a bunch of URLs and sending them all to the client.
     * Like we do for file URLs.
     *
     * Useful if you need to make a `GET` request and the data you need to sign is all
     * in the URL. We use this for signing file URLs (e.g. images) that the client
     * needs to download with a separate HTTP request to `EdgeService`. By providing
     * the client a signed URL, `EdgeService` doesn't have to reauthorize the client's
     * access to a file.
     *
     * The signed URL has all the same behaviors as a JWT. The URL expires, can only be
     * verified by an audience, and includes the issuer so we know which public key to
     * verify with. We add a `sig` parameter which is a detached JWT. Taking
     * inspiration from the [detached JWS format][2] which is
     * `${protected}..${signature}` instead of `${protected}.${payload}.${signature}`.
     *
     * [1]: https://auth0.com/blog/rs256-vs-hs256-whats-the-difference/
     * [2]: https://datatracker.ietf.org/doc/html/rfc7797#section-4.2
     */
    public async dangerouslySignUrl(
        audience: TokenServiceName | Array<TokenServiceName>,
        originalUrl: URL,
        {
            currentTimeForTest,
            expirationMinutes,
        }: {
            currentTimeForTest?: Date;
            expirationMinutes?: number;
        } = {},
    ): Promise<URL> {
        assert(currentTimeForTest === undefined || import.meta.jest);

        if (originalUrl.searchParams.has("exp"))
            throw new InvalidArgumentError("URL already has `exp` search param");
        if (originalUrl.searchParams.has("iss"))
            throw new InvalidArgumentError("URL already has `iss` search param");
        if (originalUrl.searchParams.has("aud"))
            throw new InvalidArgumentError("URL already has `aud` search param");
        if (originalUrl.searchParams.has("sig"))
            throw new InvalidArgumentError("URL already has `sig` search param");

        const currentTime =
            currentTimeForTest !== undefined ? currentTimeForTest.getTime() : Date.now();

        const expirationTime = Math.floor(
            (currentTime + 1000 * 60 * (expirationMinutes ?? 2)) / 1000,
        );
        const issuer = tokenServiceShortNameByName[this._serviceName];
        const actualAudience =
            typeof audience === "string"
                ? tokenServiceShortNameByName[audience]
                : audience.map(audience => tokenServiceShortNameByName[audience]);

        const signer = new SignJWT({url: `${originalUrl.pathname}${originalUrl.search}`})
            .setProtectedHeader({alg: "HS256"})
            .setExpirationTime(expirationTime)
            .setIssuer(issuer)
            .setAudience(actualAudience);

        const token = await signer.sign(this._secretForHs256);
        const tokenParts = token.split(".", 3);
        tokenParts[1] = "";
        const detachedToken = tokenParts.join(".");

        const url = new URL(originalUrl);

        url.searchParams.set("exp", String(expirationTime));
        url.searchParams.set("iss", issuer);
        url.searchParams.set(
            "aud",
            typeof actualAudience === "string" ? actualAudience : actualAudience.join(","),
        );
        url.searchParams.set("sig", detachedToken);

        return url;
    }

    /**
     * Decrypt some sensitive data that was encrypted with `encrypt()` (a JWE string)
     * with our token agent's private key.
     */
    public async decrypt(encryptedPayload: string): Promise<string> {
        const {plaintext} = await compactDecrypt(
            encryptedPayload,
            this._servicePrivateKeyForRsaOaep,
        );
        return new TextDecoder().decode(plaintext);
    }
}

export class TokenAgentAppServicePrivateSide extends TokenAgentPrivateSide {
    protected constructor({
        servicePrivateKeyForRs256,
        servicePrivateKeyForRsaOaep,
        secretForHs256,
    }: {
        servicePrivateKeyForRs256: KeyLike;
        servicePrivateKeyForRsaOaep: KeyLike;
        secretForHs256: Uint8Array;
    }) {
        super({
            serviceName: "AppService",
            servicePrivateKeyForRs256,
            servicePrivateKeyForRsaOaep,
            secretForHs256,
        });
    }

    public static override async new({
        serviceName,
        servicePrivateKey: servicePrivateKeyString,
        secret: secretString,
    }: {
        serviceName: TokenServiceName;
        servicePrivateKey: string;
        secret: string;
    }) {
        assert(serviceName === "AppService");

        const [servicePrivateKeyForRs256, servicePrivateKeyForRsaOaep] = await runAllPromises([
            importPKCS8(servicePrivateKeyString, "RS256"),
            importPKCS8(servicePrivateKeyString, "RSA-OAEP"),
        ]);

        const secretForHs256 = decodeBase64(secretString.trim());
        assert(secretForHs256.length === 32);

        return new TokenAgentAppServicePrivateSide({
            servicePrivateKeyForRs256,
            servicePrivateKeyForRsaOaep,
            secretForHs256,
        });
    }

    /**
     * Sign a token that will live forever as a session cookie. Given having access to
     * an eternal session can be dangerous, we take the following extra precautions:
     *
     * - Only `AppService` can sign these tokens
     * - They must be `Session` tokens (no `System` tokens)
     * - Only `AppService` and `EdgeService` may verify these tokens
     * - You may invalidate a session at any time by deleting its `SessionId` from the
     *   database
     *
     * Dangerous since if an attacker can call this function with whatever input they
     * want, then they can impersonate any account! So be careful with what you call
     * this function with.
     *
     * Also dangerous in that if this token leaks an attacker can use it for however
     * long they please! Generally you should be using
     * `dangerouslySignShortLivedToken()` unless for user experience reasons you want
     * the token to be valid for a while.
     */
    public async dangerouslySignEternalSessionToken(payload: SessionTokenPayload): Promise<string> {
        assert(payload.type === "Session");

        const signer = new SignJWT(
            TokenPayloadSchema.serialize(payload) as SchemaSerializedObjectValue,
        )
            .setProtectedHeader({alg: "RS256"})
            .setIssuedAt()
            .setIssuer(tokenServiceShortNameByName[this._serviceName])
            .setAudience([
                tokenServiceShortNameByName.AppService,
                tokenServiceShortNameByName.EdgeService,
            ]);

        return await signer.sign(this._servicePrivateKeyForRs256);
    }

    /**
     * Sign a bot token for `AgentService` to pass through to `ApiService`. The token
     * expires after 2 minutes, which should leave plenty of time for the bot to
     * receive the request and make its api.alpine.inc request
     *
     * Uses RS256 as the signing algorithm. Which is an asymmetric cryptography
     * algorithm. So each service has its own private key and other services verify it
     * against their public key. If a service's private key is discovered by an
     * attacker they still wouldn't be able to create keys that let them impersonate
     * another service. (e.g. If `FileProcessorService` is compromised an attacker
     * couldn't use that access to create a session token as `AppService`.)
     *
     * Dangerous since if an attacker can call this function with whatever input they
     * want, then they can impersonate any account! So be careful with what you call
     * this function with.
     */
    public dangerouslySignShortLivedTokenForBotConversationState(payload: BotTokenPayload) {
        // Double check this is a bot token.
        assert(payload.type === "Bot");

        const currentTime = Date.now();

        // 2 minutes
        const expirationTime = Math.floor((currentTime + 1000 * 60 * 2) / 1000);

        return this._dangerouslySignToken("ApiService", payload, expirationTime);
    }
}

export class TokenAgentJobQueueServicePrivateSide extends TokenAgentPrivateSide {
    protected constructor({
        servicePrivateKeyForRs256,
        servicePrivateKeyForRsaOaep,
        secretForHs256,
    }: {
        servicePrivateKeyForRs256: KeyLike;
        servicePrivateKeyForRsaOaep: KeyLike;
        secretForHs256: Uint8Array;
    }) {
        super({
            serviceName: "JobQueueService",
            servicePrivateKeyForRs256,
            servicePrivateKeyForRsaOaep,
            secretForHs256,
        });
    }

    public static override async new({
        serviceName,
        servicePrivateKey: servicePrivateKeyString,
        secret: secretString,
    }: {
        serviceName: TokenServiceName;
        servicePrivateKey: string;
        secret: string;
    }) {
        assert(serviceName === "JobQueueService");

        const [servicePrivateKeyForRs256, servicePrivateKeyForRsaOaep] = await runAllPromises([
            importPKCS8(servicePrivateKeyString, "RS256"),
            importPKCS8(servicePrivateKeyString, "RSA-OAEP"),
        ]);

        const secretForHs256 = decodeBase64(secretString.trim());
        assert(secretForHs256.length === 32);

        return new TokenAgentJobQueueServicePrivateSide({
            servicePrivateKeyForRs256,
            servicePrivateKeyForRsaOaep,
            secretForHs256,
        });
    }

    /**
     * Sign a bot token for `ApiService`. The token expires after 8 hours. Which lets
     * the bot cook for a while in response to the webhook in case it's entering a deep
     * research style flow.
     *
     * If you need to immediately revoke the bot's access you can remove the bot from
     * your space.
     *
     * If a bot needs to run for more than 8 hours then we should maybe consider an
     * access token + refresh token setup. Extending the timeout may be fine too. Need
     * to think through the cancellation model (e.g. should you be able to cancel an
     * individual "token" or just remove a bad bot from the space immediately revoking
     * access?)
     *
     * Uses RS256 as the signing algorithm. Which is an asymmetric cryptography
     * algorithm. So each service has its own private key and other services verify it
     * against their public key. If a service's private key is discovered by an
     * attacker they still wouldn't be able to create keys that let them impersonate
     * another service. (e.g. If `FileProcessorService` is compromised an attacker
     * couldn't use that access to create a session token as `AppService`.)
     *
     * Dangerous since if an attacker can call this function with whatever input they
     * want, then they can impersonate any account! So be careful with what you call
     * this function with.
     */
    public dangerouslySignLongLivedTokenForBotWebhook(payload: BotTokenPayload) {
        // Double check this is a bot token.
        assert(payload.type === "Bot");

        const currentTime = Date.now();

        // 8 hours
        const expirationTime = Math.floor((currentTime + 1000 * 60 * 60 * 8) / 1000);

        return this._dangerouslySignToken("ApiService", payload, expirationTime);
    }
}
