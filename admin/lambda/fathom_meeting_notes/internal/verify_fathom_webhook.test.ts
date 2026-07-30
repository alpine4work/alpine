/* eslint-disable cyberworlds/string-quotes */
import {createHmac} from "crypto";
import {
    VerifyFathomWebhookOptions,
    verifyFathomWebhook,
} from "~/admin/lambda/fathom_meeting_notes/internal/verify_fathom_webhook.js";

const secretBytes = new TextEncoder().encode("fathom webhook test secret");
const secret = `whsec_${Buffer.from(secretBytes).toString("base64")}`;
const webhookId = "msg_test";
const webhookTimestamp = "1750000000";
const rawBody = '{"title":"Tea Time"}';
const now = new Date(Number(webhookTimestamp) * 1_000);

function createSignature(
    options: Pick<VerifyFathomWebhookOptions, "rawBody" | "webhookId" | "webhookTimestamp"> = {
        rawBody,
        webhookId,
        webhookTimestamp,
    },
): string {
    const signedContent = `${options.webhookId}.${options.webhookTimestamp}.${options.rawBody}`;
    return createHmac("sha256", secretBytes).update(signedContent).digest("base64");
}

test("verifies a valid Fathom signature", () => {
    expect(
        verifyFathomWebhook({
            secret,
            webhookId,
            webhookTimestamp,
            webhookSignature: `v1,${createSignature()}`,
            rawBody,
            now,
        }),
    ).toEqual({ok: true});
});

test("accepts any matching signature from a space-separated signature list", () => {
    expect(
        verifyFathomWebhook({
            secret,
            webhookId,
            webhookTimestamp,
            webhookSignature: `v1,incorrect v2,${createSignature()}`,
            rawBody,
            now,
        }),
    ).toEqual({ok: true});
});

test("rejects a signature with a different length without throwing", () => {
    expect(
        verifyFathomWebhook({
            secret,
            webhookId,
            webhookTimestamp,
            webhookSignature: "v1,short",
            rawBody,
            now,
        }),
    ).toEqual({
        ok: false,
        statusCode: 401,
        error: "Invalid Fathom webhook signature",
    });
});

test("rejects a signature for a modified raw body", () => {
    expect(
        verifyFathomWebhook({
            secret,
            webhookId,
            webhookTimestamp,
            webhookSignature: `v1,${createSignature()}`,
            rawBody: '{"title":"Sprint Review"}',
            now,
        }),
    ).toEqual({
        ok: false,
        statusCode: 401,
        error: "Invalid Fathom webhook signature",
    });
});

test("accepts a timestamp at the five-minute tolerance boundary", () => {
    expect(
        verifyFathomWebhook({
            secret,
            webhookId,
            webhookTimestamp,
            webhookSignature: `v1,${createSignature()}`,
            rawBody,
            now: new Date((Number(webhookTimestamp) + 300) * 1_000),
        }),
    ).toEqual({ok: true});
});

test("rejects a timestamp older than five minutes", () => {
    expect(
        verifyFathomWebhook({
            secret,
            webhookId,
            webhookTimestamp,
            webhookSignature: `v1,${createSignature()}`,
            rawBody,
            now: new Date((Number(webhookTimestamp) + 301) * 1_000),
        }),
    ).toEqual({
        ok: false,
        statusCode: 401,
        error: "Fathom webhook timestamp is outside the allowed tolerance",
    });
});

test("rejects a timestamp more than five minutes in the future", () => {
    expect(
        verifyFathomWebhook({
            secret,
            webhookId,
            webhookTimestamp,
            webhookSignature: `v1,${createSignature()}`,
            rawBody,
            now: new Date((Number(webhookTimestamp) - 301) * 1_000),
        }),
    ).toEqual({
        ok: false,
        statusCode: 401,
        error: "Fathom webhook timestamp is outside the allowed tolerance",
    });
});

test("rejects malformed timestamps", () => {
    expect(
        verifyFathomWebhook({
            secret,
            webhookId,
            webhookTimestamp: "1750000000seconds",
            webhookSignature: `v1,${createSignature()}`,
            rawBody,
            now,
        }),
    ).toEqual({
        ok: false,
        statusCode: 400,
        error: "Invalid Fathom webhook timestamp",
    });
});

test("rejects missing verification headers", () => {
    expect(
        verifyFathomWebhook({
            secret,
            webhookId: undefined,
            webhookTimestamp,
            webhookSignature: undefined,
            rawBody,
            now,
        }),
    ).toEqual({
        ok: false,
        statusCode: 400,
        error: "Missing Fathom webhook verification headers",
    });
});

test("rejects secrets without the Fathom prefix", () => {
    expect(
        verifyFathomWebhook({
            secret: secret.substring("whsec_".length),
            webhookId,
            webhookTimestamp,
            webhookSignature: `v1,${createSignature()}`,
            rawBody,
            now,
        }),
    ).toEqual({
        ok: false,
        statusCode: 500,
        error: "Invalid Fathom webhook secret",
    });
});
