import {PermissionDeniedError} from "~/shared/error/error.js";

/**
 * HTTP header carrying the signature of a bot webhook request. The value has the
 * syntax `sha256=<hex>` where `<hex>` is the hex-encoded HMAC SHA-256 of the raw
 * request body keyed with the bot's webhook secret. The `sha256=` prefix
 * communicates the signature version so we can change the algorithm in the future
 * if need be.
 */
export const botWebhookSignatureHeader = "Alpine-Signature";

/**
 * Sign a serialized bot webhook request body with the bot's webhook secret.
 * Returns the value for the `botWebhookSignatureHeader` HTTP header.
 */
export async function signBotWebhookRequest({
    requestBodyString,
    secret,
}: {
    requestBodyString: string;
    secret: string;
}): Promise<string> {
    const textEncoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        textEncoder.encode(secret),
        {name: "HMAC", hash: "SHA-256"},
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(requestBodyString));

    return `sha256=${bytesToHex(new Uint8Array(signature))}`;
}

/**
 * Verify the `botWebhookSignatureHeader` HTTP header of a bot webhook request
 * against the raw request body. Throws if the signature doesn't match.
 */
export async function verifyBotWebhookRequestSignature({
    requestBodyString,
    signature,
    secret,
}: {
    requestBodyString: string;
    signature: string | null;
    secret: string;
}): Promise<void> {
    // If the request was not signed, then we don't need to verify the signature. Just
    // because we are able to verify signed requests doesn't mean that every request
    // _must_ be signed
    if (signature === null) return;

    const expectedSignature = await signBotWebhookRequest({requestBodyString, secret});

    if (!constantTimeEqual(signature, expectedSignature)) {
        throw new PermissionDeniedError("Invalid bot webhook signature");
    }
}

function bytesToHex(bytes: Uint8Array): string {
    return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Compare two signature strings in constant time to prevent timing attacks.
 *
 * A naive comparison (e.g. `a === b`) returns as soon as it finds the first
 * mismatched character, so how long it takes leaks how many leading characters of
 * a forged signature were correct. By measuring response latency across many
 * requests an attacker could recover a valid signature one character at a time.
 * Instead of exiting early we accumulate every character difference with bitwise
 * operations so the comparison always takes the same time regardless of where the
 * strings first differ.
 *
 * GitHub's webhook documentation (which this signature scheme is modeled after)
 * also recommends a constant time comparison:
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
function constantTimeEqual(a: string, b: string): boolean {
    let difference = a.length ^ b.length;
    const length = Math.max(a.length, b.length);

    for (let i = 0; i < length; i++) {
        difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }

    return difference === 0;
}
