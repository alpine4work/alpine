import {highlightCode} from "@lezer/highlight";
import {parser as lezerMarkdownParser} from "@lezer/markdown";
import chalk from "chalk";
import {addDays} from "date-fns";
import envPaths from "env-paths";
import {mkdir, readFile, writeFile} from "fs/promises";
import {Database, open} from "lmdb";
import {join as joinPath} from "path";
import * as prettier from "prettier";
import * as markdownPrettierPlugin from "prettier/plugins/markdown";
import stripAnsi from "strip-ansi";
import {parseArgs} from "util";
import {ApiClient, createApiClient} from "~/server/agents/api/api_client.js";
import {
    AgentWebSessionLmdbStorageKey,
    createAgentWebSessionLmdbStorage,
} from "~/server/agents/cli/create_agent_web_session_lmdb_storage.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {callAgentWebFindTool} from "~/server/agents/web/call_agent_web_find_tool.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.js";
import {callAgentWebSearchTool} from "~/server/agents/web/call_agent_web_search_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/create_agent_web_page_link_pathname.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiAccountReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {lezerClassHighlighter} from "~/shared/content/code/lezer_class_highlighter.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    DateString,
    deserializeDateString,
    serializeDateString,
} from "~/shared/helpers/date/date_string.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

const tracer = TracerRoot.new({
    serviceName: "AgentWebCli",
    jsHost: "Node",
    untrusted: true,
    // NOCOMMIT: Synchronize with Alpine clock? Like the client?
    clock: unsynchronizedSystemClock,
    sendEvent: () => {
        // NOCOMMIT: Send events to Alpine!
    },
});

main().then(
    () => {
        process.exit(0);
    },
    error => {
        // NOCOMMIT: Print the error display message.
        void error;
        process.exit(1);
    },
);

type AgentsCliAuthJson = {
    readonly apiUrl?: string;
    readonly apiKey?: string;
    readonly authResponse?: {
        readonly expirationTime: DateString;
        readonly spaceId: SpaceId;
        readonly botAccount: ApiAccountReferenceResponse & {readonly pathname: string};
    };
};

// NOCOMMIT: Make sure we have a nice error message when offline
async function main() {
    const [command = "", ...args] = process.argv.slice(2);

    const commands = new Set(["read", "create", "update", "scroll", "find", "search"]);

    const handleSpanName = `CLI ${commands.has(command) ? command : "unknown"}`;

    return await tracer.withSpan(`Handle: ${handleSpanName}`, async span => {
        span.addData({context: {handler: handleSpanName}});

        const dataDirectoryPath =
            process.env.ALPINE_DATA_PATH ?? envPaths("Alpine", {suffix: ""}).data;

        try {
            await mkdir(dataDirectoryPath, {recursive: true});
        } catch (error) {
            throw FailedPreconditionError.from(error, "Couldn\u2019t create data directory", {
                displayMessage: errorDisplayMessage`Couldn\u2019t create data directory at ${quote(dataDirectoryPath)}. Try changing the \`ALPINE_DATA_PATH\` environment variable to a location you can write to.`,
            });
        }

        let auth: AgentsCliAuthJson;

        try {
            auth = JSON.parse(await readFile(joinPath(dataDirectoryPath, "auth.json"), "utf8"));
        } catch (error) {
            throw FailedPreconditionError.from(error, "Couldn\u2019t read `auth.json`", {
                // TODO(#public-api-blocking): Once Rachel adds a login setup for the API we should
                // update this message to be "Try running `alpine auth`" again or whatever the
                // command is.
                //
                // What happens if this file doesn't exist??
                displayMessage: errorDisplayMessage`Couldn\u2019t read \`auth.json\` from ${quote(dataDirectoryPath)}.`,
            });
        }

        const apiKey = process.env.ALPINE_API_KEY ?? auth.apiKey;

        if (apiKey === undefined) {
            throw new FailedPreconditionError("Missing `apiKey` in `auth.json`", {
                // TODO(#public-api-blocking): Once Rachel adds a login setup for the API we should
                // update this message to be "Try running `alpine auth`" again or whatever the
                // command is.
                displayMessage: errorDisplayMessage`Couldn\u2019t find an \`apiKey\` property in \`auth.json\`.`,
            });
        }

        const apiBaseUrl = process.env.ALPINE_API_URL ?? auth.apiUrl ?? "https://api.alpine.inc";

        const api = createApiClient({baseUrl: apiBaseUrl, apiKey});

        let database;
        try {
            database = open<string, AgentWebSessionLmdbStorageKey>({
                path: joinPath(dataDirectoryPath, "agents-web.db"),
                noSubdir: true,
            });
        } catch (error) {
            throw FailedPreconditionError.from(error, "Couldn\u2019t open `agents-web.db`", {
                displayMessage: errorDisplayMessage`Couldn\u2019t open the CLI data file in ${quote(dataDirectoryPath)}. Maybe you can\u2019t write to ${quote(dataDirectoryPath)}? Try changing the \`ALPINE_DATA_PATH\` environment variable to a location you can write to.`,
            });
        }

        let markdown: string;
        try {
            // LMDB allows only one write transaction at a time across processes. Its
            // transaction remains open while this async callback is pending, so complete CLI
            // runs execute in sequence. `AgentWebSessionStorage` assumes exclusive access to
            // the underlying storage so this is good.
            markdown = await database.transaction(async () => {
                return await mainWithinTransaction({
                    command,
                    args,
                    span,
                    dataDirectoryPath,
                    auth,
                    apiBaseUrl,
                    api,
                    database,
                });
            });
        } finally {
            await database.close();
        }

        await write(markdown);
    });
}

async function mainWithinTransaction({
    command,
    args,
    span,
    dataDirectoryPath,
    auth,
    apiBaseUrl,
    api,
    database,
}: {
    command: string;
    args: ReadonlyArray<string>;
    span: TracerSpan;
    dataDirectoryPath: string;
    auth: AgentsCliAuthJson;
    apiBaseUrl: string;
    api: ApiClient;
    database: Database<any, AgentWebSessionLmdbStorageKey>;
}) {
    const currentTime = new Date();
    const authDataExpirationDays = 1;

    let storage: AgentWebSessionStorage;
    let authResponse = auth.authResponse;

    // Get information about the current bot account from the API. We refresh this
    // information once every day.
    if (
        authResponse !== undefined &&
        currentTime.getTime() <=
            addDays(
                deserializeDateString(authResponse.expirationTime),
                authDataExpirationDays,
            ).getTime()
    ) {
        storage = createAgentWebSessionLmdbStorage(database, authResponse.spaceId);
    } else {
        let data;
        try {
            ({data} = await api.get(span, "/auth", {}));
        } catch (error) {
            throw FailedPreconditionError.from(error, "Couldn\u2019t load `/auth`", {
                // TODO(#public-api-blocking): Once Rachel adds a login setup for the API we should
                // update this message to be "Try running `alpine auth`" again or whatever the
                // command is.
                displayMessage: errorDisplayMessage`Couldn\u2019t get the current bot from the API. Make sure you\u2019re online and can reach ${quote(`${apiBaseUrl}/auth`)}.`,
            });
        }

        storage = createAgentWebSessionLmdbStorage(database, data.auth.spaceId);

        const botAccountReference = intoApiAccountReference(data.auth.botAccount);

        const botAccountPathname = await createAgentWebPageLinkPathname(
            storage,
            botAccountReference,
        );

        authResponse = {
            expirationTime: serializeDateString(addDays(currentTime, authDataExpirationDays)),
            spaceId: data.auth.spaceId,
            botAccount: {...botAccountReference, pathname: botAccountPathname},
        };

        try {
            await writeFile(
                joinPath(dataDirectoryPath, "auth.json"),
                JSON.stringify({...auth, authResponse}),
            );
        } catch (error) {
            throw FailedPreconditionError.from(error, "Couldn\u2019t write `auth.json`", {
                displayMessage: errorDisplayMessage`Couldn\u2019t write \`auth.json\` to ${quote(dataDirectoryPath)}. Try again after confirming the user running this CLI is allowed to write to ${quote(dataDirectoryPath)}.`,
            });
        }
    }

    const context: AgentWebContext = {
        spaceId: authResponse.spaceId,
        api,
        storage,
        span,
        timeZone: getCurrentTimeZone(),
        botAccount: authResponse.botAccount,
    };

    return await runAgentsCliCommand(context, command, args);
}

// NOCOMMIT: Review CLI parsing! I'll probably want to hand write the parsing.
async function runAgentsCliCommand(
    context: AgentWebContext,
    command: string,
    args: ReadonlyArray<string>,
): Promise<string> {
    switch (command) {
        case "read": {
            const {positionals, values} = parseArgs({
                args,
                allowPositionals: true,
                options: {limit: {type: "string", default: "10kb"}},
            });
            assert(positionals.length === 1);
            return await callAgentWebReadTool(context, {
                path: positionals[0]!,
                limit: values.limit,
            });
        }
        case "update": {
            const {positionals, values} = parseArgs({
                args,
                allowPositionals: true,
                options: {
                    "replace-all": {type: "boolean", default: false},
                },
            });
            assert(positionals.length === 3);
            return await callAgentWebUpdateTool(context, {
                path: positionals[0]!,
                updates: [
                    {
                        old: positionals[1]!,
                        new: positionals[2]!,
                        replaceAll: values["replace-all"],
                    },
                ],
            });
        }
        case "create": {
            const {positionals} = parseArgs({args, allowPositionals: true});
            assert(positionals.length >= 2);
            return await callAgentWebCreateTool(context, {
                type: positionals[0]!,
                content: positionals.slice(1).join(" "),
            });
        }
        case "scroll": {
            const {positionals, values} = parseArgs({
                args,
                allowPositionals: true,
                options: {limit: {type: "string", default: "10kb"}},
            });
            assert(positionals.length === 2);
            return await callAgentWebScrollTool(context, {
                path: positionals[0]!,
                offset: parseInteger(positionals[1]!),
                limit: values.limit,
            });
        }
        case "find": {
            const {positionals, values} = parseArgs({
                args,
                allowPositionals: true,
                options: {
                    offset: {type: "string", default: "0"},
                    limit: {type: "string", default: "10"},
                    "match-limit": {type: "string", default: "1kb"},
                },
            });
            assert(positionals.length === 2);
            return await callAgentWebFindTool(context, {
                path: positionals[0]!,
                pattern: positionals[1]!,
                offset: parseInteger(values.offset),
                limit: parseInteger(values.limit),
                matchLimit: values["match-limit"],
            });
        }
        case "search": {
            const {positionals} = parseArgs({args, allowPositionals: true});
            assert(positionals.length > 0);
            return await callAgentWebSearchTool(context, {query: positionals.join(" ")});
        }
        default:
            // NOCOMMIT: Decide what to print for an unknown or missing subcommand.
            // `displayMessage`
            throw new InvalidArgumentError(`Unknown command: ${command}`);
    }
}

function parseInteger(value: string): number {
    const number = Number(value);
    assert(Number.isInteger(number));
    return number;
}

async function write(markdown: string) {
    // Make sure we always end with exactly one trailing newline.
    markdown = markdown.trimEnd() + "\n";

    if (!process.stdout.isTTY || !chalk.supportsColor) {
        process.stdout.write(markdown);
        return;
    }

    markdown = await prettier.format(stripAnsi(markdown.trim()), {
        parser: "markdown",
        endOfLine: "lf",
        printWidth: Math.min(80, Math.max(40, process.stdout.columns)),
        tabWidth: 2,
        proseWrap: "always",
        plugins: [markdownPrettierPlugin],
    });

    let highlightedMarkdown = "";
    highlightCode(
        markdown,
        lezerMarkdownParser.parse(markdown),
        lezerClassHighlighter.get(),
        (text: string, classes: string) => {
            highlightedMarkdown += highlightTerminalText(text, classes);
        },
        () => {
            highlightedMarkdown += "\n";
        },
    );

    process.stdout.write(highlightedMarkdown);
}

function highlightTerminalText(text: string, classes: string): string {
    const classSet = new Set(classes.split(" "));

    if (classSet.has("tok-heading") || classSet.has("tok-strong"))
        return chalk.blueBright.bold(text);
    if (classSet.has("tok-emphasis")) return chalk.cyan(text);
    if (classSet.has("tok-link") || classSet.has("tok-string")) return chalk.green(text);
    if (classSet.has("tok-url")) return chalk.green.underline(text);
    if (classSet.has("tok-monospace")) return chalk.yellow(text);
    if (classSet.has("tok-number") || classSet.has("tok-literal")) return chalk.yellow(text);
    if (classSet.has("tok-keyword") || classSet.has("tok-atom"))
        return chalk.magentaBright.bold(text);
    if (classSet.has("tok-inserted")) return chalk.greenBright(text);
    if (classSet.has("tok-deleted") || classSet.has("tok-invalid")) return chalk.red(text);
    if (classSet.has("tok-comment") || classSet.has("tok-meta")) return chalk.gray(text);
    return text;
}
