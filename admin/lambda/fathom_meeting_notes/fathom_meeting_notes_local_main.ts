/* eslint-disable no-console */

import type {APIGatewayProxyEventV2} from "aws-lambda";
import {createHmac} from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";
import {shiftFathomMeetingNotesFixtureDate} from "~/admin/lambda/fathom_meeting_notes/local/shift_fathom_meeting_notes_fixture_date.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

type LambdaFunctionUrlResult = {
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
    isBase64Encoded?: boolean;
};

const defaultFathomWebhookSecret = "whsec_ZmF0aG9tLWxvY2FsLXdlYmhvb2stc2VjcmV0";

async function main() {
    const [fixtureKey, dateArgument, ...extraArguments] = process.argv.slice(2);

    if (!fixtureKey) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    if (extraArguments.length) {
        console.error(`Unexpected argument: ${extraArguments[0]}`);
        printUsage();
        process.exitCode = 1;
        return;
    }

    const fixturePath = getFixturePath(fixtureKey);
    if (!fs.existsSync(fixturePath)) {
        console.error(`Unknown Fathom fixture: ${fixtureKey}`);
        console.error(`Expected fixture at ${fixturePath}`);
        printAvailableFixtures();
        process.exitCode = 1;
        return;
    }

    loadDotenv();

    if (!configureEnvironment()) {
        process.exitCode = 1;
        return;
    }

    const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as FathomWebhookPayload;
    const shiftedPayloadResult = shiftFathomMeetingNotesFixtureDate({
        payload,
        dateArgument,
    });
    if (!shiftedPayloadResult.ok) {
        console.error(shiftedPayloadResult.error);
        process.exitCode = 1;
        return;
    }

    const body = JSON.stringify(shiftedPayloadResult.payload);
    const request = createRequest({
        fixtureKey,
        targetDate: shiftedPayloadResult.targetDate,
        body,
    });

    console.log(`Fixture: ${fixturePath}`);
    console.log(`Meeting date: ${shiftedPayloadResult.targetDate}`);
    console.log(`Creating Alpine meeting notes through: ${process.env.EDGE_SERVICE_URL}`);

    const {handler} =
        await import("~/admin/lambda/fathom_meeting_notes/fathom_meeting_notes_lambda.js");
    const result = (await handler(request, {} as any, () => undefined)) as LambdaFunctionUrlResult;
    console.log(JSON.stringify(result, null, 2));

    if (result.statusCode < 200 || result.statusCode >= 300) {
        process.exitCode = 1;
    }
}

function configureEnvironment(): boolean {
    process.env.EDGE_SERVICE_URL ||= "http://localhost:3000";
    process.env.FATHOM_WEBHOOK_SECRET ||= defaultFathomWebhookSecret;

    if (!process.env.FATHOM_WEBHOOK_SECRET.startsWith("whsec_")) {
        console.error("FATHOM_WEBHOOK_SECRET must start with whsec_");
        return false;
    }

    if (!process.env.ALPINE_API_KEY) {
        console.error(
            "ALPINE_API_KEY must be set to a local bot/account API key that can create meeting notes",
        );
        return false;
    }

    return true;
}

function loadDotenv() {
    const env = Object.assign(
        {},
        loadDotenvFile(path.join(runfilesPath, "cyberworlds/.env")),
        loadDotenvFile(path.join(runfilesPath, "cyberworlds/.env.development")),
        process.env.BUILD_WORKSPACE_DIRECTORY
            ? loadDotenvFile(
                  path.join(process.env.BUILD_WORKSPACE_DIRECTORY, ".env.development.local"),
              )
            : {},
    );

    for (const [name, value] of Object.entries(env)) {
        process.env[name] ??= value;
    }
}

function loadDotenvFile(filePath: string): dotenv.DotenvParseOutput {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    return dotenv.parse(fs.readFileSync(filePath, "utf8"));
}

function createRequest({
    fixtureKey,
    targetDate,
    body,
}: {
    fixtureKey: string;
    targetDate: string;
    body: string;
}): APIGatewayProxyEventV2 {
    const timeEpoch = Date.now();
    const webhookTimestamp = Math.floor(timeEpoch / 1_000).toString();
    const webhookId = `msg_local_${fixtureKey}_${targetDate}`;

    return {
        version: "2.0",
        routeKey: "$default",
        rawPath: "/",
        rawQueryString: "",
        headers: {
            "content-type": "application/json",
            "webhook-id": webhookId,
            "webhook-timestamp": webhookTimestamp,
            "webhook-signature": createSignature({
                webhookId,
                webhookTimestamp,
                body,
            }),
        },
        requestContext: {
            accountId: "anonymous",
            apiId: "fathom-meeting-notes-local",
            domainName: "localhost",
            domainPrefix: "localhost",
            http: {
                method: "POST",
                path: "/",
                protocol: "HTTP/1.1",
                sourceIp: "127.0.0.1",
                userAgent: "fathom-meeting-notes-local",
            },
            requestId: webhookId,
            routeKey: "$default",
            stage: "$default",
            time: new Date(timeEpoch).toISOString(),
            timeEpoch,
        },
        body,
        isBase64Encoded: false,
    };
}

function createSignature({
    webhookId,
    webhookTimestamp,
    body,
}: {
    webhookId: string;
    webhookTimestamp: string;
    body: string;
}): string {
    const webhookSecret = process.env.FATHOM_WEBHOOK_SECRET!;
    const decodedWebhookSecret = Buffer.from(webhookSecret.slice("whsec_".length), "base64");
    const webhookSecretBytes = new Uint8Array(decodedWebhookSecret.length);
    webhookSecretBytes.set(decodedWebhookSecret);
    const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;
    const signature = createHmac("sha256", webhookSecretBytes)
        .update(signedContent)
        .digest("base64");
    return `v1,${signature}`;
}

function getFixturePath(fixtureKey: string): string {
    return path.join(
        runfilesPath,
        "cyberworlds/admin/lambda/fathom_meeting_notes/fixtures",
        `${fixtureKey}.json`,
    );
}

function printUsage() {
    console.error(
        [
            "Usage:",
            "  bazel run //admin/lambda/fathom_meeting_notes:fathom_meeting_notes_local -- <fixture> [<date>]",
            "",
            "Date:",
            "  YYYY-MM-DD  Use an absolute meeting date",
            "  T-<days>    Use a date relative to today, such as T-1 or T-3",
            "  omitted     Use today",
            "",
            "Examples:",
            "  bazel run //admin/lambda/fathom_meeting_notes:fathom_meeting_notes_local -- tea_time_public",
            "  bazel run //admin/lambda/fathom_meeting_notes:fathom_meeting_notes_local -- tea_time_public T-1",
            "  bazel run //admin/lambda/fathom_meeting_notes:fathom_meeting_notes_local -- customer_meeting_private_next_month 2026-08-01",
            "",
            "Optional overrides:",
            "  EDGE_SERVICE_URL=http://localhost:3000",
            "  FATHOM_WEBHOOK_SECRET=whsec_<base64-secret>",
            "  FATHOM_MEETING_NOTES_CREATOR_ACCOUNT_ID=<account-id>",
            "  FATHOM_MEETING_NOTES_PARENT_DOCUMENT_ID=<document-id>",
        ].join("\n"),
    );
}

function printAvailableFixtures() {
    const fixtureDirectoryPath = path.dirname(getFixturePath("unused"));
    if (!fs.existsSync(fixtureDirectoryPath)) {
        return;
    }

    const fixtures = fs
        .readdirSync(fixtureDirectoryPath)
        .filter(fileName => fileName.endsWith(".json"))
        .map(fileName => path.basename(fileName, ".json"))
        .sort();

    if (fixtures.length) {
        console.error(`Available Fathom fixtures: ${fixtures.join(", ")}`);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
