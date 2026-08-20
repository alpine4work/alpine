import {highlightCode} from "@lezer/highlight";
import {parser as lezerMarkdownParser} from "@lezer/markdown";
import chalk from "chalk";
import {addDays} from "date-fns";
import envPaths from "env-paths";
import {createWriteStream} from "fs";
import {mkdir, readFile, writeFile} from "fs/promises";
import {Database, open} from "lmdb";
import {join as joinPath, resolve as resolvePath} from "path";
import * as prettier from "prettier";
import * as markdownPrettierPlugin from "prettier/plugins/markdown";
import {Readable} from "stream";
import {pipeline} from "stream/promises";
import stripAnsi from "strip-ansi";
import {ApiClient, createApiClient} from "~/server/agents/api/api_client.open_source.js";
import {CliArgParser} from "~/server/agents/cli/cli_arg_parser.open_source.js";
import {createCliTracer} from "~/server/agents/cli/cli_tracer.open_source.js";
import {
    AgentWebSessionLmdbStorageKey,
    agentWebSessionLmdbStorageFilesOrderKey,
    createAgentWebSessionLmdbStorage,
} from "~/server/agents/lmdb/create_agent_web_session_lmdb_storage.open_source.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.open_source.js";
import {callAgentWebDeleteTool} from "~/server/agents/web/call_agent_web_delete_tool.open_source.js";
import {callAgentWebFindTool} from "~/server/agents/web/call_agent_web_find_tool.open_source.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.open_source.js";
import {
    callAgentWebSearchTool,
    defaultAgentWebSearchResultLimit,
} from "~/server/agents/web/call_agent_web_search_tool.open_source.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {
    agentWebBytesDefaultLimit,
    agentWebBytesFindDefaultLimit,
    agentWebBytesFindDefaultMatchLimit,
} from "~/server/agents/web/default_agent_web_bytes_limit.open_source.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.open_source.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {wrapMaybeArray} from "~/shared/helpers/array/wrap_maybe_array.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {
    DateString,
    deserializeDateString,
    serializeDateString,
} from "~/shared/helpers/date/date_string.open_source.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {lezerClassHighlighter} from "~/shared/lezer/lezer_class_highlighter.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

process.title = "alpine";
process.stdin.setEncoding("utf8");

const {dataDirectoryPath, tempDirectoryPath} = (() => {
    const paths = envPaths("Alpine", {suffix: ""});

    return {
        dataDirectoryPath: process.env.ALPINE_DATA_PATH ?? paths.data,
        tempDirectoryPath: process.env.ALPINE_TEMP_PATH ?? paths.temp,
    };
})();

const createArgParser = new CliArgParser("create", {
    requiredPositionalArgs: [{name: "type"}, {name: "content"}],
});

const readArgParser = new CliArgParser("read", {
    requiredPositionalArgs: [{name: "path"}],
    optionalNominalArgs: [{name: "limit", preview: agentWebBytesDefaultLimit}],
});

const updateArgParser = new CliArgParser("update", {
    requiredPositionalArgs: [{name: "path"}],
    requiredNominalListArgs: [
        // eslint-disable-next-line cyberworlds/string-quotes
        {name: "old", preview: '"..."'},
        // eslint-disable-next-line cyberworlds/string-quotes
        {name: "new", preview: '"..."'},
    ],
    optionalNominalFlagArgs: [
        {
            name: "replace-all",
            // We don't advertise the `update` tool's `--replace-all` arg in the command
            // syntax. If the agent tries to make an update where `--old` is repeated then we
            // share the existence of `--replace-all` along with a recommendation to prefer a
            // more specific update. We believe this is the better approach.
            hidden: true,
        },
    ],
});

const deleteArgParser = new CliArgParser("delete", {
    requiredPositionalArgs: [{name: "path"}],
});

const scrollArgParser = new CliArgParser("scroll", {
    requiredPositionalArgs: [{name: "path"}],
    requiredNominalArgs: [{name: "offset", preview: "0"}],
    optionalNominalArgs: [{name: "limit", preview: agentWebBytesDefaultLimit}],
});

const findArgParser = new CliArgParser("find", {
    requiredPositionalArgs: [{name: "path"}, {name: "pattern"}],
    optionalNominalArgs: [
        {name: "offset", preview: "0"},
        {name: "limit", preview: agentWebBytesFindDefaultLimit.toString()},
        {name: "match-limit", preview: agentWebBytesFindDefaultMatchLimit},
    ],
});

const searchArgParser = new CliArgParser("search", {
    requiredPositionalArgs: [{name: "query"}],
    optionalNominalArgs: [{name: "limit", preview: defaultAgentWebSearchResultLimit.toString()}],
});

main()
    .then(({exitCode}) => {
        process.exit(exitCode);
    })
    .catch(async error => {
        const markdown = printAgentWebError("Couldn\u2019t run command", error);
        await write(markdown);
        process.exit(1);
    })
    .catch(error => {
        // Final error handler in case something goes wrong when we try to print the error
        // using our agent web error format.

        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    });

type AgentsCliAuthJson = {
    readonly apiKey?: string;
    readonly authResponse?: {
        readonly expirationTime: DateString;
        readonly spaceId: SpaceId;
        readonly botAccount: {readonly id: AccountId; readonly bot: {readonly id: BotId}};
    };
};

async function main(): Promise<{exitCode: number}> {
    const baseUrlString = process.env.ALPINE_URL ?? "https://alpine.inc";
    let baseUrl: URL;

    try {
        baseUrl = new URL(baseUrlString);
    } catch {
        throw new InvalidArgumentError("Invalid `ALPINE_URL` environment variable", {
            displayMessage: errorDisplayMessage`\`ALPINE_URL\` environment variable ${quote(baseUrlString)} isn\u2019t a valid URL. Try again without setting the \`ALPINE_URL\` environment variable.`,
        });
    }

    const baseApiUrlString =
        process.env.ALPINE_API_URL ?? `${baseUrl.protocol}//api.${baseUrl.hostname}`;
    let baseApiUrl: URL;

    try {
        baseApiUrl = new URL(baseApiUrlString);
    } catch {
        if (typeof process.env.ALPINE_API_URL === "string") {
            throw new InvalidArgumentError("Invalid `ALPINE_API_URL` environment variable", {
                displayMessage: errorDisplayMessage`\`ALPINE_API_URL\` environment variable ${quote(baseApiUrlString)} isn\u2019t a valid URL. Try again without setting the \`ALPINE_URL\` environment variable.`,
            });
        } else {
            throw new InvalidArgumentError("Couldn\u2019t derive API URL from `ALPINE_URL`", {
                displayMessage: errorDisplayMessage`Trying to add \`api.\` to \`ALPINE_URL\` gives us ${quote(baseApiUrlString)} which isn\u2019t a valid URL. Try again but add an \`ALPINE_API_URL\` environment variable in addition to \`ALPINE_URL\`.`,
            });
        }
    }

    try {
        await mkdir(dataDirectoryPath, {recursive: true});
    } catch (error) {
        throw FailedPreconditionError.from(error, "Couldn\u2019t create data directory", {
            displayMessage: errorDisplayMessage`Couldn\u2019t create data directory at ${quote(dataDirectoryPath)}. Try changing the \`ALPINE_DATA_PATH\` environment variable to a location you can write to.`,
        });
    }

    const {tracer, flushTracer} = createCliTracer({baseUrl, dataDirectoryPath});

    try {
        let command = process.argv[2] ?? "help";
        const args = process.argv.slice(3);

        // Support standard ways to ask for help from a CLI tool.
        if (command === "--help" || command === "-h") command = "help";

        const commands = new Set([
            "help",
            "read",
            "create",
            "update",
            "delete",
            "scroll",
            "find",
            "search",
        ]);

        const handleSpanName = `CLI ${commands.has(command) ? command : "unknown"}`;

        return await tracer.withSpan(`Handle: ${handleSpanName}`, async span => {
            span.addData({context: {handler: handleSpanName}});

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

            const api = createApiClient({baseUrl: baseApiUrl.toString(), apiKey});

            let database;
            try {
                database = open<string, AgentWebSessionLmdbStorageKey>({
                    path: joinPath(dataDirectoryPath, "agents-web.db"),
                    noSubdir: true,
                });
            } catch (error) {
                throw FailedPreconditionError.from(error, "Couldn\u2019t open `agents-web.db`", {
                    displayMessage: errorDisplayMessage`Couldn\u2019t open the database in ${quote(dataDirectoryPath)}. Maybe you can\u2019t write to ${quote(dataDirectoryPath)}? Try changing the \`ALPINE_DATA_PATH\` environment variable to a location you can write to.`,
                });
            }

            let isError: boolean;
            let response: string;
            try {
                // LMDB allows only one write transaction at a time across processes. Its
                // transaction remains open while this async callback is pending, so complete CLI
                // runs execute in sequence. `AgentWebSessionStorage` assumes exclusive access to
                // the underlying storage so this is good.
                ({isError, response} = await database.transaction(async () => {
                    return await mainWithinTransaction({
                        command,
                        args,
                        span,
                        dataDirectoryPath,
                        auth,
                        baseApiUrl,
                        api,
                        database,
                    });
                }));
            } finally {
                await database.close();
            }

            await write(response);

            return {exitCode: isError ? 1 : 0};
        });
    } finally {
        flushTracer();
    }
}

async function mainWithinTransaction({
    command,
    args,
    span,
    dataDirectoryPath,
    auth,
    baseApiUrl,
    api,
    database,
}: {
    command: string;
    args: ReadonlyArray<string>;
    span: TracerSpan;
    dataDirectoryPath: string;
    auth: AgentsCliAuthJson;
    baseApiUrl: URL;
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
                displayMessage: errorDisplayMessage`Couldn\u2019t get the current bot from the API. Make sure you\u2019re online, your API key isn\u2019t revoked, and you can reach ${quote(`${new URL("/auth", baseApiUrl).toString()}`)}.`,
            });
        }

        storage = createAgentWebSessionLmdbStorage(database, data.auth.spaceId);

        authResponse = {
            expirationTime: serializeDateString(addDays(currentTime, authDataExpirationDays)),
            spaceId: data.auth.spaceId,
            botAccount: {id: data.auth.botAccount.id, bot: {id: data.auth.botAccount.bot.id}},
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

    return await runAgentsCliCommand({
        context,
        command,
        args,
        database,
    });
}

async function runAgentsCliCommand({
    context,
    command,
    args,
    database,
}: {
    context: AgentWebContext;
    command: string;
    args: ReadonlyArray<string>;
    database: Database<any, AgentWebSessionLmdbStorageKey>;
}): Promise<{isError: boolean; response: string}> {
    switch (command) {
        case "help": {
            const {isError, response} = await callAgentWebReadTool(context, {
                path: "/skill",
            });

            assert(response.type === "String");

            // We make the following changes to the `alpine` skill for the `alpine help`
            // command:
            //
            // 1. Include an h1 and CLI usage to help the agent anchor itself in CLI context.
            //
            // 2. Add a not under the areas table noting the agent can use the `read` tool to
            //    read the skill.
            //
            // 3. Add a tip explaining how to use stdin to pipe in content from a create or
            //    update.
            return {
                isError,
                response: `\
# Alpine CLI

Usage:

\`\`\`
${readArgParser.syntax}
${updateArgParser.syntax}
${createArgParser.syntax}
${deleteArgParser.syntax}
${searchArgParser.syntax}
${scrollArgParser.syntax}
${findArgParser.syntax}
\`\`\`

${response.string.replace("## Tips", "(You can call the `read` tool with the above skill links to read the skill, e.g. `alpine read /skill/documents`.)\n\n## Tips")}

### Stdin

When creating large pages, you can pass \`-\` to \`alpine create\` (e.g. \`alpine create document -\`) and pipe content to stdin instead of writing the content inline in the command.

Similarly, when adding a lot of content in an update, you can pass \`-\` to \`alpine update\` (as both the \`--old\` and \`--new\` args, e.g. \`alpine update --old - --new -\`) and pipe update(s) to stdin. Updates should be a JSON object (or an array of JSON objects) with the properties \`old\` and \`new\`.`,
            };
        }
        case "create": {
            const {type, content: contentArg} = createArgParser.parse(args);

            let content: string;

            if (contentArg.trim() !== "-") {
                content = contentArg;
            } else {
                content = "";

                for await (const chunk of process.stdin) {
                    content += chunk;
                }
            }

            return await callAgentWebCreateTool(context, {
                type,
                content,
            });
        }
        case "read": {
            const {path, limit} = readArgParser.parse(args);

            const {isError, response} = await callAgentWebReadTool(context, {
                path,
                limit,
            });

            if (response.type === "String") {
                return {isError, response: response.string};
            }

            assert(response.pathname.startsWith("/file/"));
            assert(/\.[a-z0-9]+$/.test(response.pathname));

            const filesDirectoryPath = resolvePath(
                process.env.ALPINE_FILES_PATH ?? joinPath(tempDirectoryPath, "files"),
            );

            const filePath = joinPath(filesDirectoryPath, response.pathname.slice("/file/".length));

            // We keep a record of the files we've downloaded in the LMDB database so we don't
            // have to download them again. Files are immutable, they never change. We expect
            // this is a worthwhile optimization because an agent may call the `read` tool not
            // knowing it'll output a long temp directory path and then call the `read` tool
            // again with some additional code to extract out the path.
            if (
                (await database.get([agentWebSessionLmdbStorageFilesOrderKey, filePath])) !==
                response.id
            ) {
                try {
                    await mkdir(filesDirectoryPath, {recursive: true});
                } catch (error) {
                    throw FailedPreconditionError.from(
                        error,
                        "Couldn\u2019t create files directory",
                        {
                            displayMessage: errorDisplayMessage`Couldn\u2019t create files directory at ${quote(filesDirectoryPath)}. Try changing the \`ALPINE_FILES_PATH\` environment variable to a location you can write to.`,
                        },
                    );
                }

                await response.fetch(async stream => {
                    try {
                        await pipeline(
                            Readable.fromWeb(
                                // @ts-expect-error: The global TypeScript `ReadableStream` type appears to not
                                // agree with the Node.js web `ReadableStream` type.
                                stream,
                            ),
                            createWriteStream(filePath),
                        );
                    } catch (error) {
                        throw FailedPreconditionError.from(error, "Couldn\u2019t write file", {
                            displayMessage: errorDisplayMessage`Couldn\u2019t write to file ${quote(filePath)}. Try changing the \`ALPINE_FILES_PATH\` environment variable to a location you can write to.`,
                        });
                    }
                });

                await database.put(
                    [agentWebSessionLmdbStorageFilesOrderKey, filePath],
                    response.id,
                );
            }

            // Return `filePath` directly so it's easy for the caller to chain a `read` tool
            // call for a file with some other command that does more processing on the file.
            return {isError: false, response: filePath};
        }
        case "update": {
            const {
                path,
                old: oldArgs,
                new: newArgs,
                "replace-all": replaceAll,
            } = updateArgParser.parse(args);

            if (oldArgs.length !== newArgs.length) {
                if (oldArgs.length < newArgs.length) {
                    const missingOldArgCount = newArgs.length - oldArgs.length;

                    throw new InvalidArgumentError(
                        "Nominal `--old` and `--new` args must have the same length",
                        {
                            displayMessage: errorDisplayMessage`Must provide an \`--old\` arg for every \`--new\` arg. Try again but with ${missingOldArgCount} more \`--old\` arg${missingOldArgCount !== 1 ? "s" : ""}.`,
                        },
                    );
                } else {
                    const missingNewArgCount = oldArgs.length - newArgs.length;

                    throw new InvalidArgumentError(
                        "Nominal `--old` and `--new` args must have the same length",
                        {
                            displayMessage: errorDisplayMessage`Must provide a \`--new\` arg for every \`--old\` arg. Try again but with ${missingNewArgCount} more \`--new\` arg${missingNewArgCount !== 1 ? "s" : ""}.`,
                        },
                    );
                }
            }

            if (
                oldArgs.some(arg => arg.trim() === "-") ||
                newArgs.some(arg => arg.trim() === "-")
            ) {
                if (
                    !oldArgs.every(arg => arg.trim() === "-") ||
                    !newArgs.every(arg => arg.trim() === "-")
                ) {
                    throw new InvalidArgumentError(
                        "Stdin requested for `update` tool but not all `--old` and `--new` args are `-`",
                        {
                            displayMessage: errorDisplayMessage`If one of an \`--old\` arg or \`--new\` arg is \`-\` that means updates will be read from stdin. Try again but make sure every \`--old\` arg and \`--new\` arg use \`-\` to proceed with reading updates from stdin.`,
                        },
                    );
                }

                if (replaceAll === "") {
                    throw new InvalidArgumentError(
                        "Stdin requested for `update` tool but `--replace-all` arg is provided",
                        {
                            displayMessage: errorDisplayMessage`If the \`--old\` and \`--new\` args are \`-\` that means updates will be read from stdin. Other args like \`--replace-all\` aren\u2019t allowed when reading updates from stdin. Try again but without the \`--replace-all\` arg.`,
                        },
                    );
                }

                let updates: Array<{old: string; new: string; replaceAll: boolean}> = [];

                try {
                    let updatesString = "";

                    for await (const chunk of process.stdin) {
                        updatesString += chunk;
                    }

                    const updatesUnknown: unknown = JSON.parse(updatesString);

                    updates = wrapMaybeArray(updatesUnknown).map(update => {
                        assert(isObject(update));

                        const {
                            old: updateOld,
                            new: updateNew,
                            "replace-all": updateReplaceAllAlias1,
                            replaceAll: updateReplaceAllAlias2,
                            ...updateRest
                        } = update;

                        assert(Object.keys(updateRest).length === 0);

                        assert(typeof updateOld === "string");
                        assert(typeof updateNew === "string");

                        assert(
                            updateReplaceAllAlias1 === undefined ||
                                updateReplaceAllAlias2 === undefined,
                        );

                        const updateReplaceAll = updateReplaceAllAlias1 ?? updateReplaceAllAlias2;

                        assert(
                            updateReplaceAll === undefined || typeof updateReplaceAll === "boolean",
                        );

                        return {
                            old: updateOld,
                            new: updateNew,
                            replaceAll: updateReplaceAll ?? false,
                        };
                    });
                } catch (error) {
                    throw InvalidArgumentError.from(error, "Invalid update stdin JSON", {
                        displayMessage: errorDisplayMessage`Invalid update JSON from stdin. Update JSON must be an array of objects with \`old\` and \`new\` string properties. Optionally a \`replace-all\` boolean property as well. Try again with a valid JSON array of updates written to stdin.`,
                    });
                }

                return await callAgentWebUpdateTool(context, {
                    path,
                    updates,
                });
            }

            return await callAgentWebUpdateTool(context, {
                path,
                updates: oldArgs.map((oldArg, index) => ({
                    old: oldArg,
                    new: newArgs[index]!,
                    replaceAll: replaceAll === "",
                })),
            });
        }
        case "delete": {
            const {path} = deleteArgParser.parse(args);

            return await callAgentWebDeleteTool(context, {path});
        }
        case "scroll": {
            const {path, offset, limit} = scrollArgParser.parse(args);

            return await callAgentWebScrollTool(context, {
                path,
                offset: parseNonNegativeInteger("offset", offset),
                limit,
            });
        }
        case "find": {
            const {
                path,
                pattern,
                offset,
                limit,
                "match-limit": matchLimit,
            } = findArgParser.parse(args);

            return await callAgentWebFindTool(context, {
                path,
                pattern,
                offset:
                    offset !== undefined ? parseNonNegativeInteger("offset", offset) : undefined,
                limit: limit !== undefined ? parseNonNegativeInteger("limit", limit) : undefined,
                matchLimit,
            });
        }
        case "search": {
            const {query, limit} = searchArgParser.parse(args);

            return await callAgentWebSearchTool(context, {
                query,
                limit: limit !== undefined ? parseNonNegativeInteger("limit", limit) : undefined,
            });
        }
        default: {
            throw new InvalidArgumentError(`Unknown subcommand: ${command}`, {
                // This error message doesn't include our full list of commands. Just the most
                // popular ones.
                displayMessage: errorDisplayMessage`Unknown subcommand: ${quote(command)}. Try again with one of \`read\`, \`update\`, \`create\`, or \`search\`.`,
            });
        }
    }
}

function parseNonNegativeInteger(argName: string, string: string): number {
    string = string.trim();

    const number = /^([0-9]|[1-9][0-9]*)$/.test(string) ? parseInt(string, 10) : null;

    if (number === null || !Number.isSafeInteger(number)) {
        throw new InvalidArgumentError("Invalid integer", {
            displayMessage: errorDisplayMessage`Couldn\u2019t parse non-negative integer from: ${quote(string)}. Try again with zero or a positive integer for the \`--${argName}\` arg.`,
        });
    }

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
