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
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiAccountReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {lezerClassHighlighter} from "~/shared/content/code/lezer_class_highlighter.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    DateString,
    deserializeDateString,
    serializeDateString,
} from "~/shared/helpers/date/date_string.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

const tracer = TracerRoot.new({
    serviceName: "CliClient",
    jsHost: "Node",
    untrusted: true,
    // NOCOMMIT: Synchronize with Alpine clock? Like the client?
    clock: unsynchronizedSystemClock,
    sendEvent: () => {
        // NOCOMMIT: Send events to Alpine!
    },
});

// Useful for when we read stdin (e.g. when creating a new entity).
process.stdin.setEncoding("utf8");

main()
    .then(() => {
        process.exit(0);
    })
    .catch(async error => {
        const markdown = await printAgentWebError("Couldn\u2019t run command", error);
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
                displayMessage: errorDisplayMessage`Couldn\u2019t open the database in ${quote(dataDirectoryPath)}. Maybe you can\u2019t write to ${quote(dataDirectoryPath)}? Try changing the \`ALPINE_DATA_PATH\` environment variable to a location you can write to.`,
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

function parseArgs<
    const RequiredPositionalArgs extends ReadonlyArray<string> = readonly [],
    const OptionalPositionalArgs extends ReadonlyArray<string> = readonly [],
    const RequiredNominalArgs extends ReadonlyArray<string> = readonly [],
    const OptionalNominalArgs extends ReadonlyArray<string> = readonly [],
    const OptionalNominalFlagArgs extends ReadonlyArray<string> = readonly [],
    const OptionalNominalListArgs extends ReadonlyArray<string> = readonly [],
>(
    command: string,
    args: ReadonlyArray<string>,
    {
        requiredPositionalArgs,
        optionalPositionalArgs,
        requiredNominalArgs,
        optionalNominalListArgs,
        optionalNominalArgs,
        optionalNominalFlagArgs,
    }: {
        requiredPositionalArgs?: RequiredPositionalArgs;
        optionalPositionalArgs?: OptionalPositionalArgs;
        requiredNominalArgs?: RequiredNominalArgs;
        optionalNominalListArgs?: OptionalNominalListArgs;
        optionalNominalArgs?: OptionalNominalArgs;
        optionalNominalFlagArgs?: OptionalNominalFlagArgs;
    },
): {[Key in RequiredPositionalArgs[number] | RequiredNominalArgs[number]]: string} & {
    [Key in
        | OptionalPositionalArgs[number]
        | OptionalNominalArgs[number]
        | OptionalNominalFlagArgs[number]]?: string;
} & {
    [Key in OptionalNominalListArgs[number]]: Array<string>;
} & {
    createExpectedSyntax: () => ErrorDisplayMessage;
} {
    const positionalArgs: Array<string> = [];
    const nominalArgs = new Map<string, string>();
    const nominalListArgs = new Map<string, Array<string>>();

    const optionalNominalFlagArgsSet = new Set(optionalNominalFlagArgs);
    const optionalNominalListArgsSet = new Set(optionalNominalListArgs);

    const createExpectedSyntax = () => {
        let expectedSyntax = `alpine ${command}`;

        if (requiredPositionalArgs) {
            for (const requiredPositionalArgName of requiredPositionalArgs) {
                expectedSyntax += ` <${requiredPositionalArgName}>`;
            }
        }

        if (optionalPositionalArgs) {
            for (const optionalPositionalArgName of optionalPositionalArgs) {
                expectedSyntax += ` [${optionalPositionalArgName}]`;
            }
        }

        if (requiredNominalArgs) {
            for (const requiredNominalArgName of requiredNominalArgs) {
                expectedSyntax += ` --${requiredNominalArgName} <...>`;
            }
        }

        if (optionalNominalListArgs) {
            for (const optionalNominalListArgName of optionalNominalListArgs) {
                expectedSyntax += ` [--${optionalNominalListArgName} ...]`;
            }
        }

        if (optionalNominalArgs) {
            for (const optionalNominalArgName of optionalNominalArgs) {
                expectedSyntax += ` [--${optionalNominalArgName} ...]`;
            }
        }

        if (optionalNominalFlagArgs) {
            for (const optionalNominalFlagArgName of optionalNominalFlagArgs) {
                expectedSyntax += ` [--${optionalNominalFlagArgName}]`;
            }
        }

        return errorDisplayMessage`${quote(expectedSyntax)}`;
    };

    let nextIndex = 0;
    while (nextIndex < args.length) {
        const index = nextIndex;
        nextIndex++;
        const arg = args[index]!;

        const nominalArgMatch = arg.match(/^--([a-z0-9]+(?:-[a-z0-9]+)*)(?:=|$)/);

        if (nominalArgMatch === null) {
            positionalArgs.push(arg);
        } else if (nominalArgMatch[0].endsWith("=")) {
            const nominalArgValueLength = nominalArgMatch[0].length;
            const nominalArgName = arg.slice(2, nominalArgValueLength - 1);
            const nominalArgValue = arg.slice(nominalArgValueLength);

            if (optionalNominalListArgsSet.has(nominalArgName)) {
                getOrSetDefaultMapValue(nominalListArgs, nominalArgName, () => []).push(
                    nominalArgValue,
                );
            } else {
                if (nominalArgs.has(nominalArgName)) {
                    throw new InvalidArgumentError("Duplicate nominal argument", {
                        displayMessage: errorDisplayMessage`There\u2019s more than one ${quote(`--${nominalArgName}`)} args. Try again with only one ${quote(`--${nominalArgName}`)} arg. Expected syntax: ${createExpectedSyntax()}.`,
                    });
                }

                nominalArgs.set(nominalArgName, nominalArgValue);
            }
        } else {
            const nominalArgName = arg.slice(2);
            let nominalArgValue: string;

            if (optionalNominalFlagArgsSet.has(nominalArgName)) {
                nominalArgValue = "";
            } else {
                nextIndex++;
                nominalArgValue = args[index + 1] ?? "";
            }

            if (optionalNominalListArgsSet.has(nominalArgName)) {
                getOrSetDefaultMapValue(nominalListArgs, nominalArgName, () => []).push(
                    nominalArgValue,
                );
            } else {
                if (nominalArgs.has(nominalArgName)) {
                    throw new InvalidArgumentError("Duplicate nominal argument", {
                        displayMessage: errorDisplayMessage`There\u2019s more than one ${quote(`--${nominalArgName}`)} args. Try again with only one ${quote(`--${nominalArgName}`)} arg. Expected syntax: ${createExpectedSyntax()}.`,
                    });
                }

                nominalArgs.set(nominalArgName, nominalArgValue);
            }
        }
    }

    const nominalValidArgsSet = new Set(
        concatIterables(
            requiredNominalArgs ?? emptyArray,
            optionalNominalArgs ?? emptyArray,
            optionalNominalFlagArgs ?? emptyArray,
        ),
    );

    const parsedArgs: any = {};

    let positionalArgIndex = 0;

    if (requiredPositionalArgs) {
        for (const requiredPositionalArgName of requiredPositionalArgs) {
            if (positionalArgIndex >= positionalArgs.length) {
                throw new InvalidArgumentError("Missing required positional arg", {
                    displayMessage: errorDisplayMessage`Missing required ${quote(`<${requiredPositionalArgName}>`)} arg. Try again but add the ${quote(`<${requiredPositionalArgName}>`)} arg. Expected syntax: ${createExpectedSyntax()}.`,
                });
            }

            parsedArgs[requiredPositionalArgName] = positionalArgs[positionalArgIndex];
            positionalArgIndex++;
        }
    }

    if (optionalPositionalArgs) {
        for (const optionalPositionalArgName of optionalPositionalArgs) {
            if (positionalArgIndex >= positionalArgs.length) break;

            parsedArgs[optionalPositionalArgName] = positionalArgs[positionalArgIndex];
            positionalArgIndex++;
        }
    }

    if (positionalArgIndex < positionalArgs.length) {
        const unexpectedArgCount = positionalArgs.length - positionalArgIndex;

        throw new InvalidArgumentError("Extra positional args", {
            displayMessage: errorDisplayMessage`Unexpected args. Try again but remove the ${unexpectedArgCount} unused arg${unexpectedArgCount !== 1 ? "s" : ""}. Expected syntax: ${createExpectedSyntax()}.`,
        });
    }

    if (requiredNominalArgs) {
        for (const requiredNominalArgName of requiredNominalArgs) {
            if (!nominalArgs.has(requiredNominalArgName)) {
                throw new InvalidArgumentError("Missing required nominal arg", {
                    displayMessage: errorDisplayMessage`Missing required ${quote(`--${requiredNominalArgName}`)} arg. Try again but add the ${quote(`--${requiredNominalArgName}`)} arg. Expected syntax: ${createExpectedSyntax()}.`,
                });
            }
        }
    }

    for (const [nominalArgName, nominalArgValue] of nominalArgs) {
        if (nominalValidArgsSet.has(nominalArgName)) {
            parsedArgs[nominalArgName] = nominalArgValue;
        } else {
            throw new InvalidArgumentError("Unknown nominal arg", {
                displayMessage: errorDisplayMessage`Unrecognized ${quote(`--${nominalArgName}`)} arg. Try again without the ${quote(`--${nominalArgName}`)} arg. Expected syntax: ${createExpectedSyntax()}.`,
            });
        }
    }

    if (optionalNominalListArgs) {
        for (const optionalNominalListArgName of optionalNominalListArgs) {
            parsedArgs[optionalNominalListArgName] =
                nominalListArgs.get(optionalNominalListArgName) ?? [];
        }
    }

    parsedArgs.createExpectedSyntax = createExpectedSyntax;

    return parsedArgs;
}

async function runAgentsCliCommand(
    context: AgentWebContext,
    command: string,
    args: ReadonlyArray<string>,
): Promise<string> {
    switch (command) {
        case "create": {
            const {type, content: contentArg} = parseArgs(command, args, {
                requiredPositionalArgs: ["type", "content"],
            });

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
            const {path, limit} = parseArgs(command, args, {
                requiredPositionalArgs: ["path"],
                optionalNominalArgs: ["limit"],
            });

            return await callAgentWebReadTool(context, {
                path,
                limit,
            });
        }
        case "update": {
            const {
                path,
                old: oldArgs,
                new: newArgs,
                "replace-all": replaceAll,
                createExpectedSyntax,
            } = parseArgs(command, args, {
                requiredPositionalArgs: ["path"],
                optionalNominalListArgs: ["old", "new"],
                optionalNominalFlagArgs: ["replace-all"],
            });

            if (oldArgs.length === 0) {
                throw new InvalidArgumentError("Missing required nominal `--old` arg", {
                    displayMessage: errorDisplayMessage`Missing required \`--old\` arg. Try again but add the \`--old\` arg. Expected syntax: ${createExpectedSyntax()}.`,
                });
            }

            if (newArgs.length === 0) {
                throw new InvalidArgumentError("Missing required nominal `--new` arg", {
                    displayMessage: errorDisplayMessage`Missing required \`--new\` arg. Try again but add the \`--new\` arg. Expected syntax: ${createExpectedSyntax()}.`,
                });
            }

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

                let updates: Array<{old: string; new: string; replaceAll: boolean}> = [];

                try {
                    let updatesString = "";

                    for await (const chunk of process.stdin) {
                        updatesString += chunk;
                    }

                    const updatesUnknown: unknown = JSON.parse(updatesString);
                    assert(Array.isArray(updatesUnknown));

                    updates = updatesUnknown.map(update => {
                        assert(isObject(update));

                        const {
                            old: updateOld,
                            new: updateNew,
                            "replace-all": updateReplaceAll,
                            ...updateRest
                        } = update;

                        assert(Object.keys(updateRest).length === 0);
                        assert(
                            updateReplaceAll === undefined || typeof updateReplaceAll === "boolean",
                        );
                        assert(typeof updateOld === "string");
                        assert(typeof updateNew === "string");

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
        case "scroll": {
            const {path, offset, limit} = parseArgs(command, args, {
                requiredPositionalArgs: ["path"],
                requiredNominalArgs: ["offset"],
                optionalNominalArgs: ["limit"],
            });

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
            } = parseArgs(command, args, {
                requiredPositionalArgs: ["path", "pattern"],
                optionalNominalArgs: ["offset", "limit", "match-limit"],
            });

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
            const {query} = parseArgs(command, args, {
                requiredPositionalArgs: ["query"],
            });

            return await callAgentWebSearchTool(context, {query});
        }
        default: {
            throw new InvalidArgumentError(`Unknown subcommand: ${command}`, {
                // This error message doesn't include our full list of commands. Just the most
                // popular ones.
                displayMessage: errorDisplayMessage`Unknown subcommand: ${quote(command)}. Try again with one of \`create\`, \`read\`, \`update\`, or \`search\`.`,
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
