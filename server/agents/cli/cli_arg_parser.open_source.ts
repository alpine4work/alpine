import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {convertCamelCaseToKebabCase} from "~/shared/helpers/string/convert_camel_case_to_kebab_case.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

export class CliArgParser<
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

            const nominalArgMatch = arg.match(/^--([a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*)(?:=|$)/);

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
