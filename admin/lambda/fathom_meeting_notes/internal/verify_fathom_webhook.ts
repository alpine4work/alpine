import {createHmac, timingSafeEqual} from "crypto";

const fathomWebhookTimestampToleranceSeconds = 5 * 60;

export type VerifyFathomWebhookResult =
    | {readonly ok: true}
    | {
          readonly ok: false;
          readonly statusCode: number;
          readonly error: string;
      };

export interface VerifyFathomWebhookOptions {
    readonly secret: string;
    readonly webhookId: string | null | undefined;
    readonly webhookTimestamp: string | null | undefined;
    readonly webhookSignature: string | null | undefined;
    readonly rawBody: string;
    readonly now?: Date;
}

/**
 * Verifies a Fathom webhook without depending on Fathom's SDK.
 *
 * Fathom signs `${id}.${timestamp}.${rawBody}` with HMAC-SHA256 using the
 * Base64-decoded portion of its `whsec_` secret.
 */
export function verifyFathomWebhook({
    secret,
    webhookId,
    webhookTimestamp,
    webhookSignature,
    rawBody,
    now = new Date(),
}: VerifyFathomWebhookOptions): VerifyFathomWebhookResult {
    if (!webhookId || !webhookTimestamp || !webhookSignature) {
        return {
            ok: false,
            statusCode: 400,
            error: "Missing Fathom webhook verification headers",
        };
    }

    if (!/^\d+$/.test(webhookTimestamp)) {
        return {
            ok: false,
            statusCode: 400,
            error: "Invalid Fathom webhook timestamp",
        };
    }

    const timestampSeconds = Number(webhookTimestamp);
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    if (
        !Number.isSafeInteger(timestampSeconds) ||
        Math.abs(nowSeconds - timestampSeconds) > fathomWebhookTimestampToleranceSeconds
    ) {
        return {
            ok: false,
            statusCode: 401,
            error: "Fathom webhook timestamp is outside the allowed tolerance",
        };
    }

    const encodedSecret = secret.startsWith("whsec_") ? secret.substring("whsec_".length) : "";
    if (!encodedSecret || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encodedSecret)) {
        return {
            ok: false,
            statusCode: 500,
            error: "Invalid Fathom webhook secret",
        };
    }

    const decodedSecret = Buffer.from(encodedSecret, "base64");
    if (decodedSecret.length === 0) {
        return {
            ok: false,
            statusCode: 500,
            error: "Invalid Fathom webhook secret",
        };
    }
    const secretBytes = new Uint8Array(decodedSecret.length);
    secretBytes.set(decodedSecret);

    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const expectedSignature = createHmac("sha256", secretBytes)
        .update(signedContent)
        .digest("base64");
    const expectedSignatureBytes = new TextEncoder().encode(expectedSignature);

    const isValid = webhookSignature.split(/\s+/).some(versionedSignature => {
        const commaIndex = versionedSignature.indexOf(",");
        const signature =
            commaIndex === -1 ? versionedSignature : versionedSignature.substring(commaIndex + 1);
        const signatureBytes = new TextEncoder().encode(signature);

        return (
            signatureBytes.length === expectedSignatureBytes.length &&
            timingSafeEqual(signatureBytes, expectedSignatureBytes)
        );
    });

    if (!isValid) {
        return {
            ok: false,
            statusCode: 401,
            error: "Invalid Fathom webhook signature",
        };
    }

    return {ok: true};
}
