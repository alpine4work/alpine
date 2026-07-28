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
import {createCliTracer} from "~/server/agents/cli/cli_tracer.js";
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
import {
    agentWebBytesDefaultLimit,
    agentWebBytesFindDefaultLimit,
    agentWebBytesFindDefaultMatchLimit,
} from "~/server/agents/web/default_agent_web_bytes_limit.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiAccountReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    DateString,
    deserializeDateString,
    serializeDateString,
} from "~/shared/helpers/date/date_string.js";
import {getCurrentTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {convertCamelCaseToKebabCase} from "~/shared/helpers/string/convert_camel_case_to_kebab_case.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {lezerClassHighlighter} from "~/shared/lezer/lezer_class_highlighter.js";

import {TracerSpan} from "~/shared/tracer/tracer_span.js";

process.title = "alpine";
process.stdin.setEncoding("utf8");

main()
    .then(() => {
        process.exit(0);
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
        readonly botAccount: ApiAccountReferenceResponse & {readonly pathname: string};
    };
};

async function main() {
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

    const dataDirectoryPath = process.env.ALPINE_DATA_PATH ?? envPaths("Alpine", {suffix: ""}).data;

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

        const commands = new Set(["help", "read", "create", "update", "scroll", "find", "search"]);

        const handleSpanName = `CLI ${commands.has(command) ? command : "unknown"}`;

        await tracer.withSpan(`Handle: ${handleSpanName}`, async span => {
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
                        baseApiUrl,
                        api,
                        database,
                    });
                });
            } finally {
                await database.close();
            }

            await write(markdown);
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
                displayMessage: errorDisplayMessage`Couldn\u2019t get the current bot from the API. Make sure you\u2019re online and can reach ${quote(`${new URL("/auth", baseApiUrl).toString()}`)}.`,
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

class ArgParser<
    const RequiredPositionalArgs extends ReadonlyArray<{name: string}> = readonly [],
    const OptionalPositionalArgs extends ReadonlyArray<{name: string}> = readonly [],
    const RequiredNominalArgs extends ReadonlyArray<{name: string; preview: string}> = readonly [],
    const OptionalNominalArgs extends ReadonlyArray<{name: string; preview: string}> = readonly [],
    const OptionalNominalListArgs extends ReadonlyArray<{name: string; preview: string}> =
        readonly [],
    const RequiredNominalListArgs extends ReadonlyArray<{name: string; preview: string}> =
        readonly [],
    const OptionalNominalFlagArgs extends ReadonlyArray<{name: string; hidden?: boolean}> =
        readonly [],
> {
    readonly #requiredPositionalArgs: RequiredPositionalArgs;
    readonly #optionalPositionalArgs: OptionalPositionalArgs;
    readonly #requiredNominalArgs: RequiredNominalArgs;
    readonly #optionalNominalListArgs: OptionalNominalListArgs;
    readonly #optionalNominalListArgNameSet: ReadonlySet<string>;
    readonly #requiredNominalListArgs: RequiredNominalListArgs;
    readonly #requiredNominalListArgNameSet: ReadonlySet<string>;
    readonly #optionalNominalArgs: OptionalNominalArgs;
    readonly #optionalNominalFlagArgs: OptionalNominalFlagArgs;
    readonly #optionalNominalFlagArgNameSet: ReadonlySet<string>;
    readonly syntax: string;

    constructor(
        command: string,
        {
            requiredPositionalArgs = [] as any,
            optionalPositionalArgs = [] as any,
            requiredNominalArgs = [] as any,
            optionalNominalListArgs = [] as any,
            requiredNominalListArgs = [] as any,
            optionalNominalArgs = [] as any,
            optionalNominalFlagArgs = [] as any,
        }: {
            requiredPositionalArgs?: RequiredPositionalArgs;
            optionalPositionalArgs?: OptionalPositionalArgs;
            requiredNominalArgs?: RequiredNominalArgs;
            optionalNominalListArgs?: OptionalNominalListArgs;
            requiredNominalListArgs?: RequiredNominalListArgs;
            optionalNominalArgs?: OptionalNominalArgs;
            optionalNominalFlagArgs?: OptionalNominalFlagArgs;
        },
    ) {
        const nameSet = (args: ReadonlyArray<{name: string}>) =>
            new Set(mapIterable(args, arg => arg.name));

        this.#requiredPositionalArgs = requiredPositionalArgs;
        this.#optionalPositionalArgs = optionalPositionalArgs;
        this.#requiredNominalArgs = requiredNominalArgs;
        this.#optionalNominalListArgs = optionalNominalListArgs;
        this.#optionalNominalListArgNameSet = nameSet(optionalNominalListArgs);
        this.#requiredNominalListArgs = requiredNominalListArgs;
        this.#requiredNominalListArgNameSet = nameSet(requiredNominalListArgs);
        this.#optionalNominalArgs = optionalNominalArgs;
        this.#optionalNominalFlagArgs = optionalNominalFlagArgs;
        this.#optionalNominalFlagArgNameSet = nameSet(optionalNominalFlagArgs);

        let syntax = `alpine ${command}`;

        for (const requiredPositionalArg of requiredPositionalArgs) {
            syntax += ` <${requiredPositionalArg.name}>`;
        }

        for (const optionalPositionalArg of optionalPositionalArgs) {
            syntax += ` [${optionalPositionalArg.name}]`;
        }

        for (const requiredNominalArg of requiredNominalArgs) {
            syntax += ` --${requiredNominalArg.name} ${requiredNominalArg.preview}`;
        }

        for (const requiredNominalListArg of requiredNominalListArgs) {
            syntax += ` --${requiredNominalListArg.name} ${requiredNominalListArg.preview}`;
        }

        for (const optionalNominalListArg of optionalNominalListArgs) {
            syntax += ` [--${optionalNominalListArg.name} ${optionalNominalListArg.preview}]`;
        }

        for (const optionalNominalArg of optionalNominalArgs) {
            syntax += ` [--${optionalNominalArg.name} ${optionalNominalArg.preview}]`;
        }

        for (const optionalNominalFlagArg of optionalNominalFlagArgs) {
            if (optionalNominalFlagArg.hidden) continue;
            syntax += ` [--${optionalNominalFlagArg.name}]`;
        }

        this.syntax = syntax;
    }

    parse(args: ReadonlyArray<string>): {
        [Key in
            | RequiredPositionalArgs[number]["name"]
            | RequiredNominalArgs[number]["name"]]: string;
    } & {
        [Key in
            | OptionalPositionalArgs[number]["name"]
            | OptionalNominalArgs[number]["name"]
            | OptionalNominalFlagArgs[number]["name"]]?: string;
    } & {
        [Key in
            | OptionalNominalListArgs[number]["name"]
            | RequiredNominalListArgs[number]["name"]]: Array<string>;
    } {
        const positionalArgs: Array<string> = [];
        const nominalArgs = new Map<string, string>();
        const nominalListArgs = new Map<string, Array<string>>();

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

                // Allow args to be passed in camelCase syntax (they're then converted to
                // kebab-case). Error messages may refer to args by their camelCase name (which is
                // idiomatic for MCP tool call args). So allow agents to repeat the exact camelCase
                // syntax they've seen in error messages.
                const nominalArgName = convertCamelCaseToKebabCase(
                    arg.slice(2, nominalArgValueLength - 1),
                );

                const nominalArgValue = arg.slice(nominalArgValueLength);

                if (
                    this.#optionalNominalListArgNameSet.has(nominalArgName) ||
                    this.#requiredNominalListArgNameSet.has(nominalArgName)
                ) {
                    getOrSetDefaultMapValue(nominalListArgs, nominalArgName, () => []).push(
                        nominalArgValue,
                    );
                } else {
                    if (nominalArgs.has(nominalArgName)) {
                        throw new InvalidArgumentError("Duplicate nominal argument", {
                            displayMessage: errorDisplayMessage`There\u2019s more than one ${quote(`--${nominalArgName}`)} args. Try again with only one ${quote(`--${nominalArgName}`)} arg. Expected syntax: ${quote(this.syntax)}.`,
                        });
                    }

                    nominalArgs.set(nominalArgName, nominalArgValue);
                }
            } else {
                // Allow args to be passed in camelCase syntax (they're then converted to
                // kebab-case). Error messages may refer to args by their camelCase name (which is
                // idiomatic for MCP tool call args). So allow agents to repeat the exact camelCase
                // syntax they've seen in error messages.
                const nominalArgName = convertCamelCaseToKebabCase(arg.slice(2));

                let nominalArgValue: string;

                if (this.#optionalNominalFlagArgNameSet.has(nominalArgName)) {
                    nominalArgValue = "";
                } else {
                    nextIndex++;
                    nominalArgValue = args[index + 1] ?? "";
                }

                if (
                    this.#optionalNominalListArgNameSet.has(nominalArgName) ||
                    this.#requiredNominalListArgNameSet.has(nominalArgName)
                ) {
                    getOrSetDefaultMapValue(nominalListArgs, nominalArgName, () => []).push(
                        nominalArgValue,
                    );
                } else {
                    if (nominalArgs.has(nominalArgName)) {
                        throw new InvalidArgumentError("Duplicate nominal argument", {
                            displayMessage: errorDisplayMessage`There\u2019s more than one ${quote(`--${nominalArgName}`)} args. Try again with only one ${quote(`--${nominalArgName}`)} arg. Expected syntax: ${quote(this.syntax)}.`,
                        });
                    }

                    nominalArgs.set(nominalArgName, nominalArgValue);
                }
            }
        }

        const nominalValidArgNameSet = new Set(
            mapIterable(
                concatIterables<{name: string}>(
                    this.#requiredNominalArgs ?? emptyArray,
                    this.#optionalNominalArgs ?? emptyArray,
                    this.#optionalNominalFlagArgs ?? emptyArray,
                ),
                arg => arg.name,
            ),
        );

        const parsedArgs: any = {};

        let positionalArgIndex = 0;

        for (const requiredPositionalArg of this.#requiredPositionalArgs) {
            if (positionalArgIndex >= positionalArgs.length) {
                throw new InvalidArgumentError("Missing required positional arg", {
                    displayMessage: errorDisplayMessage`Missing required ${quote(`<${requiredPositionalArg.name}>`)} arg. Try again but add the ${quote(`<${requiredPositionalArg.name}>`)} arg. Expected syntax: ${quote(this.syntax)}.`,
                });
            }

            parsedArgs[requiredPositionalArg.name] = positionalArgs[positionalArgIndex];
            positionalArgIndex++;
        }

        for (const optionalPositionalArg of this.#optionalPositionalArgs) {
            if (positionalArgIndex >= positionalArgs.length) break;

            parsedArgs[optionalPositionalArg.name] = positionalArgs[positionalArgIndex];
            positionalArgIndex++;
        }

        if (positionalArgIndex < positionalArgs.length) {
            const unexpectedArgCount = positionalArgs.length - positionalArgIndex;

            throw new InvalidArgumentError("Extra positional args", {
                displayMessage: errorDisplayMessage`Unexpected args. Try again but remove the ${unexpectedArgCount} unused arg${unexpectedArgCount !== 1 ? "s" : ""}. Expected syntax: ${quote(this.syntax)}.`,
            });
        }

        for (const requiredNominalArg of this.#requiredNominalArgs) {
            if (!nominalArgs.has(requiredNominalArg.name)) {
                throw new InvalidArgumentError("Missing required nominal arg", {
                    displayMessage: errorDisplayMessage`Missing required ${quote(`--${requiredNominalArg.name}`)} arg. Try again but add the ${quote(`--${requiredNominalArg.name}`)} arg. Expected syntax: ${quote(this.syntax)}.`,
                });
            }
        }

        for (const [nominalArgName, nominalArgValue] of nominalArgs) {
            if (nominalValidArgNameSet.has(nominalArgName)) {
                parsedArgs[nominalArgName] = nominalArgValue;
            } else {
                throw new InvalidArgumentError("Unknown nominal arg", {
                    displayMessage: errorDisplayMessage`Unrecognized ${quote(`--${nominalArgName}`)} arg. Try again without the ${quote(`--${nominalArgName}`)} arg. Expected syntax: ${quote(this.syntax)}.`,
                });
            }
        }

        for (const optionalNominalListArg of this.#optionalNominalListArgs) {
            parsedArgs[optionalNominalListArg.name] =
                nominalListArgs.get(optionalNominalListArg.name) ?? [];
        }

        for (const requiredNominalListArg of this.#requiredNominalListArgs) {
            const parsedListArgs = nominalListArgs.get(requiredNominalListArg.name) ?? [];

            if (parsedListArgs.length === 0) {
                throw new InvalidArgumentError("Missing required nominal arg", {
                    displayMessage: errorDisplayMessage`Missing required ${quote(`--${requiredNominalListArg.name}`)} arg. Try again but add the ${quote(`--${requiredNominalListArg.name}`)} arg. Expected syntax: ${quote(this.syntax)}.`,
                });
            }

            parsedArgs[requiredNominalListArg.name] = parsedListArgs;
        }

        return parsedArgs;
    }
}

const createArgParser = new ArgParser("create", {
    requiredPositionalArgs: [{name: "type"}, {name: "content"}],
});

const readArgParser = new ArgParser("read", {
    requiredPositionalArgs: [{name: "path"}],
    optionalNominalArgs: [{name: "limit", preview: agentWebBytesDefaultLimit}],
});

const updateArgParser = new ArgParser("update", {
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

const deleteArgParser = new ArgParser("delete", {
    requiredPositionalArgs: [{name: "path"}],
});

const scrollArgParser = new ArgParser("scroll", {
    requiredPositionalArgs: [{name: "path"}],
    requiredNominalArgs: [{name: "offset", preview: "0"}],
    optionalNominalArgs: [{name: "limit", preview: agentWebBytesDefaultLimit}],
});

const findArgParser = new ArgParser("find", {
    requiredPositionalArgs: [{name: "path"}, {name: "pattern"}],
    optionalNominalArgs: [
        {name: "offset", preview: "0"},
        {name: "limit", preview: agentWebBytesFindDefaultMatchLimit},
        {name: "match-limit", preview: agentWebBytesFindDefaultLimit.toString()},
    ],
});

const searchArgParser = new ArgParser("search", {
    requiredPositionalArgs: [{name: "query"}],
});

async function runAgentsCliCommand(
    context: AgentWebContext,
    command: string,
    args: ReadonlyArray<string>,
): Promise<string> {
    switch (command) {
        case "help": {
            const response = await callAgentWebReadTool(context, {
                path: "/skill",
            });

            // Add an h1 to the help page to ground the response when you run `alpine` without
            // any subcommand.
            return `\
# Alpine CLI

Usage:

\`\`\`
${readArgParser.syntax}
${createArgParser.syntax}
${updateArgParser.syntax}
${deleteArgParser.syntax}
${searchArgParser.syntax}
${scrollArgParser.syntax}
${findArgParser.syntax}
\`\`\`

${response}`;
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
        case "delete": {
            deleteArgParser.parse(args);

            throw new UnimplementedError("Delete tool hasn\u2019t been implemented yet", {
                displayMessage: errorDisplayMessage`The \`delete\` tool hasn\u2019t been implemented yet. Before allowing bots to delete stuff from Alpine, the Alpine team wants to build a trash feature so humans can recover anything that was accidentally deleted. Tell your human they need to manually delete things from Alpine, for now. For more information, contact ${errorDisplayMessage.supportLink}.`,
            });
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
            const {query} = searchArgParser.parse(args);

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
