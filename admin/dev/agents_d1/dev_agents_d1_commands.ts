/* eslint-disable no-console */

import {join as joinPath} from "path";
import util from "util";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runProcessWithInheritedStdio} from "~/server/helpers/node/run_process_with_inherited_stdio.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {InvalidArgumentError, UnknownError} from "~/shared/error/error.js";
import {convertCamelCaseToSnakeCase} from "~/shared/helpers/string/convert_camel_case_to_snake_case.js";

// Shortcuts for common queries to be used with the "d1 run" command
const namedQueries = new Map<string, string>([
    ["reset-agent-usage", "DELETE FROM agent_usage_windows; DELETE FROM agent_requests;"],
    [
        "get-agent-usage-windows",
        "SELECT * FROM agent_usage_windows ORDER BY started_time DESC LIMIT 10;",
    ],
    ["get-agent-requests", "SELECT * FROM agent_requests ORDER BY created_time DESC LIMIT 10;"],
    [
        "max-last-request-used",
        "UPDATE agent_requests SET used_millicents = 9999999999999999 WHERE created_time = (SELECT MAX(created_time) FROM agent_requests);",
    ],
    [
        "set-last-request-used-80-percent",
        // Dynamic limit is currently $1 (see agent_usage_limits.ts). 80% of $1 is $0.80,
        // then converted to millicents
        `UPDATE agent_requests SET used_millicents = ${
            1 * 0.8 * 100 * 1000
        } WHERE created_time = (SELECT MAX(created_time) FROM agent_requests);`,
    ],
    [
        "expire-dynamic-window-30-seconds",
        `UPDATE agent_usage_windows SET started_time = ${
            Date.now() - 8 * 60 * 60 * 1000 + 30 * 1000
        };`,
    ],
    ["get-account-entitlements", "SELECT * FROM account_entitlements;"],
    ["reset-account-entitlements", "DELETE FROM account_entitlements;"],
]);

async function runDevAgentsD1Process(
    args: Array<string>,
    {consumeOutput}: {consumeOutput: true},
): Promise<string>;
async function runDevAgentsD1Process(
    args: Array<string>,
    options?: {consumeOutput?: false},
): Promise<null>;
async function runDevAgentsD1Process(
    args: Array<string>,
    {consumeOutput}: {consumeOutput?: boolean} = {},
): Promise<string | null> {
    const dbPath = joinPath(devEnvPaths.data, "agents/d1");
    const wranglerPath = joinPath(runfilesPath, "cyberworlds/server/agents/wrangler_dev.sh");

    const wranglerArguments = ["d1", ...args, "--persist-to", dbPath];

    const options = {
        cwd: joinPath(runfilesPath, "cyberworlds"),
        env: {...process.env, BAZEL_BINDIR: runfilesPath},
    };

    try {
        if (consumeOutput) {
            // TODO: Re-enable `@typescript-eslint/return-await` after deciding whether this
            // `try`/`catch` should handle async process failures.
            // eslint-disable-next-line @typescript-eslint/return-await
            return runProcess(wranglerPath, wranglerArguments, options);
        } else {
            await runProcessWithInheritedStdio(wranglerPath, wranglerArguments, options);
            return null;
        }
    } catch (error) {
        // Extract and display ERROR messages from the error
        const errorMessage = String(error);
        const lines = errorMessage.split("\n");
        const errorLines = lines.filter(line => line.includes("ERROR"));

        if (errorLines.length > 0) {
            console.error(errorLines.join("\n"));
        } else {
            console.error("Command failed:", error);
        }
        throw error;
    }
}

export async function runDevAgentsD1ExecuteCommand({
    command,
    ignoreOutput,
}: {
    command: string;
    ignoreOutput?: boolean;
}): Promise<Array<any>> {
    const namedQuery = namedQueries.get(command);
    if (namedQuery) {
        command = namedQuery;
    }

    const stdout = await runDevAgentsD1Process(
        ["execute", "agent-usage", "--local", "--json", "--command", command],
        {consumeOutput: true},
    );

    // Parse JSON and format as a readable table
    if (stdout.trim()) {
        try {
            // Extract JSON from stdout (it starts with [)
            const jsonStart = stdout.indexOf("[");
            const jsonContent = stdout.substring(jsonStart);
            const result = JSON.parse(jsonContent);

            if (!ignoreOutput) {
                console.log(util.inspect(result, {depth: Infinity, colors: true}));
            }

            return result;
        } catch {
            // If JSON parsing fails, fall back to showing the raw output
            throw new UnknownError(`Failed to parse D1 output as JSON: \n${stdout}`);
        }
    }

    return [];
}

export async function runDevAgentsD1ApplyCommand() {
    await runDevAgentsD1Process(["migrations", "apply", "agent-usage", "--local"]);
}

export async function runDevAgentsD1StatusCommand({quiet = false}: {quiet?: boolean} = {}): Promise<
    "NoMigrations" | "CommittedMigrations" | "UncommittedMigrations"
> {
    // Check if there are pending migrations using migrations list
    const stdout = await runDevAgentsD1Process(["migrations", "list", "agent-usage", "--local"], {
        consumeOutput: true,
    });

    // Parse the output to check for pending migrations
    const hasPendingMigrations = !stdout.includes("No migrations to apply!");

    if (!hasPendingMigrations) {
        if (!quiet) console.log("No migrations to apply");
        return "NoMigrations";
    }

    // Check git status for local changes in migration files
    const workspacePath = getWorkspacePath();
    const gitStatus = await runProcess("git", ["status", "server/agents/internal/d1/migrations/"], {
        cwd: workspacePath,
        env: process.env,
    });

    if (gitStatus.includes("nothing to commit")) {
        if (!quiet) console.log("Committed migration which hasn\u2019t been applied");
        return "CommittedMigrations";
    } else {
        if (!quiet) console.log("Uncommitted migration which hasn\u2019t been applied");
        return "UncommittedMigrations";
    }
}

export async function runDevAgentsD1ResetCommand() {
    // First, get all table names (excluding only system tables)
    const tablesResult = await runDevAgentsD1ExecuteCommand({
        // eslint-disable-next-line cyberworlds/string-quotes
        command: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
        ignoreOutput: true,
    });

    const tables = tablesResult[0]?.results || [];

    if (tables.length === 0) {
        console.log("No tables to drop");
        return;
    }

    // Build DROP statements for all tables
    const dropStatements = tables.map(
        (table: {name: string}) => `DROP TABLE IF EXISTS ${table.name}`,
    );
    const dropCommand = dropStatements.join("; ");

    // Log the tables that will be dropped
    console.log(
        `Dropping ${tables.length} tables: ${tables
            .map((table: {name: string}) => table.name)
            .join(", ")}`,
    );

    await runDevAgentsD1ExecuteCommand({
        command: dropCommand,
        ignoreOutput: true,
    });

    console.log("Database reset complete");
}

export async function runDevAgentsD1GenerateCommand({
    name,
    custom,
}: {
    name: string;
    custom?: boolean;
}): Promise<void> {
    // Trim and validate the name
    const trimmedName = name.trim();
    if (!trimmedName) {
        throw new InvalidArgumentError("Migration name cannot be empty");
    }

    // Check for at least one alpha character
    if (!/[a-zA-Z]/.test(trimmedName)) {
        throw new InvalidArgumentError(
            "Migration name must contain at least one alphabetic character",
        );
    }

    // Convert to snake_case
    const snakeCaseName = convertCamelCaseToSnakeCase(trimmedName)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");

    const workspacePath = getWorkspacePath();

    const drizzleArgs = [
        "generate",
        "--config",
        joinPath(
            runfilesPath,
            "cyberworlds/server/agents/internal/d1/agent_usage_drizzle.config.cjs",
        ),
        "--name",
        snakeCaseName,
    ];
    if (custom) {
        drizzleArgs.push("--custom");
    }

    await runProcessWithInheritedStdio(
        joinPath(runfilesPath, "cyberworlds/server/agents/drizzle_kit.sh"),
        drizzleArgs,
        {
            cwd: workspacePath,
            env: {...process.env, BAZEL_BINDIR: "."},
        },
    );
}
