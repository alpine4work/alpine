/* eslint-disable no-console */

import {createHmac} from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import type {AlertSourceRequest} from "~/admin/lambda/send_alert/internal/alert_source_request_types.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {InvalidArgumentError} from "~/shared/error/error.js";

type AlertSourceName = "github" | "honeycomb" | "pagerduty";

type LambdaFunctionUrlResult = {
    statusCode: number;
    headers?: Record<string, string>;
    body: string;
    isBase64Encoded?: boolean;
};

const defaultWebhookSecrets = {
    github: "test-github-secret",
    honeycomb: "test-honeycomb-secret",
    pagerduty: "test-pagerduty-secret",
};

const supportedSources = new Set<AlertSourceName>(["github", "honeycomb", "pagerduty"]);

async function main() {
    const [sourceArg, fixtureKey] = process.argv.slice(2);

    if (!sourceArg || !fixtureKey) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    if (!supportedSources.has(sourceArg as AlertSourceName)) {
        console.error(`Unsupported alert source: ${sourceArg}`);
        printUsage();
        process.exitCode = 1;
        return;
    }

    const source = sourceArg as AlertSourceName;
    const fixturePath = getFixturePath(source, fixtureKey);
    if (!fs.existsSync(fixturePath)) {
        console.error(`Unknown ${source} fixture: ${fixtureKey}`);
        console.error(`Expected fixture at ${fixturePath}`);
        printAvailableFixtures(source);
        process.exitCode = 1;
        return;
    }

    loadDotenv();

    if (!configureEnvironment()) {
        process.exitCode = 1;
        return;
    }

    const body = fs.readFileSync(fixturePath, "utf8");
    const request = createRequest(source, body);
    const apiUrl = process.env.EDGE_SERVICE_URL!.replace("://", "://api.") + "/posts";

    console.log(`Source: ${source}`);
    console.log(`Fixture: ${fixturePath}`);
    console.log(`Posting Alpine alert through: ${apiUrl}`);

    const {handler} = await import("~/admin/lambda/send_alert/send_alert_lambda.js");
    const result = (await handler(request, {} as any, () => undefined)) as LambdaFunctionUrlResult;
    console.log(JSON.stringify(result, null, 2));

    if (result.statusCode < 200 || result.statusCode >= 300) {
        process.exitCode = 1;
    }
}

function configureEnvironment(): boolean {
    process.env.EDGE_SERVICE_URL ||= "http://localhost:3000";
    process.env.HONEYCOMB_WEBHOOK_SECRET ||= defaultWebhookSecrets.honeycomb;
    process.env.GITHUB_ACTIONS_WEBHOOK_SECRET ||= defaultWebhookSecrets.github;
    process.env.PAGERDUTY_WEBHOOK_SECRET ||= defaultWebhookSecrets.pagerduty;

    if (!process.env.ALPINE_API_KEY) {
        console.error(
            "ALPINE_API_KEY must be set to a local bot/account API key that can post alerts",
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

function createRequest(source: AlertSourceName, body: string): AlertSourceRequest {
    return {
        body,
        headers: createHeaders(source, body),
        httpMethod: "POST",
        isBase64Encoded: false,
        requestContext: {
            http: {
                method: "POST",
                path: "/",
                sourceIp: "127.0.0.1",
            },
        },
    };
}

function createHeaders(source: AlertSourceName, body: string): Record<string, string> {
    switch (source) {
        case "github":
            return {
                "x-github-event": getGitHubEventType(body),
                "x-hub-signature-256": createGitHubSignature(body),
            };
        case "honeycomb":
            return {
                "x-honeycomb-webhook-token": process.env.HONEYCOMB_WEBHOOK_SECRET!,
            };
        case "pagerduty":
            return {
                "x-pagerduty-signature": createPagerDutySignature(body),
            };
        default:
            throw new InvalidArgumentError(`Unhandled alert source: ${source satisfies never}`);
    }
}

function createGitHubSignature(body: string): string {
    const hmac = createHmac("sha256", process.env.GITHUB_ACTIONS_WEBHOOK_SECRET!);
    hmac.update(body);
    return `sha256=${hmac.digest("hex")}`;
}

function createPagerDutySignature(body: string): string {
    const hmac = createHmac("sha256", process.env.PAGERDUTY_WEBHOOK_SECRET!);
    hmac.update(body);
    return `v1=${hmac.digest("hex")}`;
}

function getGitHubEventType(body: string): string {
    const payload = JSON.parse(body) as Record<string, unknown>;
    if ("workflow_run" in payload) {
        return "workflow_run";
    }

    if ("commits" in payload || "ref" in payload) {
        return "push";
    }

    throw new InvalidArgumentError(
        "Could not infer GitHub event type from fixture. Add workflow_run, commits, or ref.",
    );
}

function getFixturePath(source: AlertSourceName, fixtureKey: string): string {
    return path.join(
        runfilesPath,
        "cyberworlds/admin/lambda/send_alert/fixtures",
        source,
        `${fixtureKey}.json`,
    );
}

function printUsage() {
    console.error(
        [
            "Usage:",
            "  bazel run //admin/lambda/send_alert:send_alert_local -- <source> <fixture>",
            "",
            "Examples:",
            "  ALPINE_API_KEY=<key> bazel run //admin/lambda/send_alert:send_alert_local -- honeycomb unknown_ui_error_1",
            "  ALPINE_API_KEY=<key> bazel run //admin/lambda/send_alert:send_alert_local -- github main_push_1",
            "  ALPINE_API_KEY=<key> bazel run //admin/lambda/send_alert:send_alert_local -- pagerduty incident_triggered_1",
            "",
            "Optional overrides:",
            "  EDGE_SERVICE_URL=http://localhost:3000",
            "  HONEYCOMB_WEBHOOK_SECRET=<secret>",
            "  GITHUB_ACTIONS_WEBHOOK_SECRET=<secret>",
            "  PAGERDUTY_WEBHOOK_SECRET=<secret>",
        ].join("\n"),
    );
}

function printAvailableFixtures(source: AlertSourceName) {
    const fixtureDirectoryPath = path.dirname(getFixturePath(source, "unused"));
    if (!fs.existsSync(fixtureDirectoryPath)) {
        return;
    }

    const fixtures = fs
        .readdirSync(fixtureDirectoryPath)
        .filter(fileName => fileName.endsWith(".json"))
        .map(fileName => path.basename(fileName, ".json"));

    if (fixtures.length) {
        console.error(`Available ${source} fixtures: ${fixtures.join(", ")}`);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
