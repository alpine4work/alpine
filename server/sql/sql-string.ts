// Forked from my (Caleb's) old [`pg-sql`][1] module. Main differences include:
//
// - A more efficient implementation.
// - Symbol stamps to avoid SQL injection attacks using JSON.
//
// Also takes inspiration from Benjie's fork, [`pg-sql2`][2].
//
// [1]: https://github.com/calebmer/pg-sql
// [2]: https://github.com/graphile/pg-sql2

import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {isPlainObject} from "~/shared/helpers/object/is-plain-object";
import {isIdentifier} from "~/shared/helpers/string/is-identifier";
import {isLowerCaseIdentifier} from "~/shared/helpers/string/is-lower-case-identifier";

/**
 * Used to prevent SQL injection attacks using JSON. Only code that has access
 * to the Node.js runtime will be able to add the `sqlTag` symbol.
 */
const sqlTag = Symbol("sql");

/**
 * The type of a safe SQL string. Designed to prevent [SQL injection][1]
 * attacks.
 *
 * [1]: https://en.wikipedia.org/wiki/SQL_injection
 */
export type SqlString =
    | SqlStringTemplate
    | SqlStringValue
    | SqlStringIdentifier
    | SqlStringConcat
    | SqlStringRaw;

/**
 * A type of a SQL query created by a template string.
 */
export type SqlStringTemplate = {
    readonly _tag: typeof sqlTag;
    readonly type: "Template";
    readonly strings: ReadonlyArray<string>;
    readonly values: ReadonlyArray<SqlString>;
};

/**
 * The type of a dynamic value in a SQL query.
 */
export type SqlStringValue = {
    readonly _tag: typeof sqlTag;
    readonly type: "Value";
    readonly value: SqlValue;
};

/**
 * Values which can be serialized to a CockroachDB column.
 *
 * Does not include arrays! But you can still serialize an array to CockroachDB
 * with `sql.value()`.
 */
export type SqlValue =
    | undefined
    | null
    | boolean
    | number
    | bigint
    | string
    | Date
    | Buffer
    | ReadonlyArray<SqlValue>;

function isSqlValue(value: unknown): value is SqlValue {
    return (
        value === undefined ||
        value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string" ||
        (typeof value === "object" && value instanceof Date) ||
        (typeof value === "object" && value instanceof Buffer) ||
        (Array.isArray(value) && value.every(isSqlValue))
    );
}

/**
 * An identifier in a SQL query. Strings will be escaped and added to the query.
 * For other values we will generate a consistent alias that appears whenever
 * the value is used in the query.
 */
export type SqlStringIdentifier = {
    readonly _tag: typeof sqlTag;
    readonly type: "Identifier";
    readonly identifier: [unknown, ...Array<unknown>];
};

/**
 * Concatenates an array of SQL queries into a single query with the optional
 * joiner in between each query. Just like `String.prototype.join`.
 */
export type SqlStringConcat = {
    readonly _tag: typeof sqlTag;
    readonly type: "Concat";
    readonly strings: ReadonlyArray<SqlString>;
    readonly joiner: SqlString | undefined;
};

/**
 * Dangerously injects **raw SQL** into our query. Only use this if you are 100%
 * sure that the SQL does not contain arbitrary user input.
 */
export type SqlStringRaw = {
    readonly _tag: typeof sqlTag;
    readonly type: "Raw";
    readonly text: string;
};

/**
 * Creates a safe SQL string. Designed to prevent [SQL injection][1]
 * attacks.
 *
 * [1]: https://en.wikipedia.org/wiki/SQL_injection
 */
export function sql(
    templateStrings: TemplateStringsArray,
    ...values: Array<SqlString | SqlValue>
): SqlString {
    assert(templateStrings.length > 0);
    assert(templateStrings.length === values.length + 1);

    let queryStrings: ReadonlyArray<string> = templateStrings;

    // If our SQL query starts with a new line then we have a multiline template
    // string. We want to strip out all new lines and whitespace so that the
    // query fits on one line.
    //
    // We should be able to perform the same optimization with a Babel plugin.
    if (templateStrings[0]![0] === "\n") {
        const newStrings = Array<string>(queryStrings.length);
        for (let i = 0; i < queryStrings.length; i++) {
            const string = queryStrings[i]!;
            let newString = "";
            let j = 0;
            let k = 0;
            while (k < string.length) {
                const c = string[k];
                if (c === "\n") {
                    const isFirst = i === 0 && k === 0;
                    newString += string.slice(j, k);
                    k++;
                    while (k < string.length && string[k] === " ") {
                        k++;
                    }
                    j = k;
                    const isLast = i === queryStrings.length - 1 && k === string.length;
                    if (!isFirst && !isLast && string[k] !== "\n") {
                        newString += " ";
                    }
                } else {
                    k++;
                }
            }
            newString += string.slice(j, k);
            newStrings[i] = newString;
        }
        queryStrings = newStrings;
    }

    // Optimization: If we have no values then treat this as a raw query.
    if (values.length === 0) {
        return {
            _tag: sqlTag,
            type: "Raw",
            text: queryStrings[0]!,
        };
    }

    // Validate that all our values are either primitives or of the `Sql` type. If
    // they aren't then we either have a bug or a SQL injection attempt.
    const queryValues = values.map(value => {
        if (isSqlValue(value)) {
            return sql.value(value);
        } else if (isPlainObject(value) && value._tag === sqlTag) {
            return value;
        } else {
            throw new Error("Expected all `sql` template string values to be SQL");
        }
    });

    return {
        _tag: sqlTag,
        type: "Template",
        strings: queryStrings,
        values: queryValues,
    };
}

/**
 * Adds an arbitrary JavaScript value to a SQL query. This value will be
 * represented with a substitution in the final SQL query.
 */
sql.value = function value(value: SqlValue): SqlString {
    return {
        _tag: sqlTag,
        type: "Value",
        value,
    };
};

/**
 * Dangerously injects a **RAW SQL STRING** into your SQL query. Only use this
 * when you are 100% sure that the raw SQL string does not come from user input.
 */
sql.dangerouslyInjectRawString = function dangerouslyInjectRawString(text: string): SqlString {
    return {
        _tag: sqlTag,
        type: "Raw",
        text,
    };
};

/**
 * Joins a list of SQL queries together into one with an optional joiner query.
 */
sql.concat = function concat(strings: ReadonlyArray<SqlString>, joiner?: SqlString): SqlString {
    return {
        _tag: sqlTag,
        type: "Concat",
        strings,
        joiner,
    };
};

/**
 * Adds a SQL identifier to our query. The identifier will always be escaped in
 * the query.
 *
 * If you pass in some non-string value then we will generate a unique alias
 * for every time that reference appears in the string.
 */
sql.identifier = function identifier(
    ...identifier: [unknown, ...Array<unknown>]
): SqlStringIdentifier {
    return {
        _tag: sqlTag,
        type: "Identifier",
        identifier,
    };
};

// NOTE: We use `sql.dangerouslyInjectRawString` for constant queries because
// it has a lower memory footprint than a SQL template.

/** Empty SQL query. */
sql.empty = sql.dangerouslyInjectRawString("");

const trueNode = sql.dangerouslyInjectRawString("true");
const falseNode = sql.dangerouslyInjectRawString("false");
const nullNode = sql.dangerouslyInjectRawString("null");

/**
 * If the value is simple will inline it into the query, otherwise will defer
 * to `sql.value`.
 *
 * Ported from [Benjie's `pg-sql2`][1].
 *
 * [1]: https://github.com/graphile/pg-sql2/blob/97e5c17bcb716f70e2021b420dbd5873346074e6/src/index.ts#L232
 */
sql.literal = function literal(value: string | number | boolean | null | undefined): SqlString {
    if (typeof value === "string" && isIdentifier(value)) {
        return sql.dangerouslyInjectRawString(`'${value.replace(/'/g, "''")}'`);
    } else if (typeof value === "number") {
        if (Number.isInteger(value)) {
            return sql.dangerouslyInjectRawString(`${value}`);
        } else if (Number.isNaN(value)) {
            return sql.dangerouslyInjectRawString("float 'nan'");
        } else if (!Number.isFinite(value)) {
            return sql.dangerouslyInjectRawString(
                value < 0 ? "float '-infinity'" : "float 'infinity'",
            );
        } else {
            return sql.dangerouslyInjectRawString(`${value}`);
        }
    } else if (typeof value === "boolean") {
        return value ? trueNode : falseNode;
    } else if (value === null || value === undefined) {
        return nullNode;
    } else {
        return sql.value(value);
    }
};

/**
 * Some [reserved words][1] in PostgreSQL that are commonly used as
 * identifiers. If we see an identifier using one of these words, we'll quote
 * the identifier.
 *
 * [1]: https://www.postgresql.org/docs/current/sql-keywords-appendix.html
 */
const reservedWords = new Set(["user"]);

/**
 * Compiles `Sql` into a query object we can provide to the `pg` module.
 */
sql.compile = function compile(initialQuery: SqlString): {
    text: string;
    values: Array<unknown>;
} {
    let text = "";
    const values = new Map<unknown, number>();
    const aliases = new Map<unknown, number>();

    // Our stack will contain `Sql`s that we are processing. As long as the
    // stack is not empty we will have another `Sql` to process.
    //
    // Remember that this stack is First-In-Last-Out (FILO)! So push queries in
    // the reverse order that they should be processed.
    const stack: Array<SqlString | string> = [initialQuery];

    while (stack.length !== 0) {
        const query = stack.pop()!;

        if (typeof query === "string") {
            text += query;
            continue;
        }

        // Verify that our SQL query indeed has our private symbol. If it does not
        // then we know this module did not create the SQL query. Something or
        // someone else did.
        assert(
            query._tag === sqlTag,
            "Expected all queries to have a `_tag` property with our private SQL " +
                "query symbol. This may be a SQL injection attempt!",
        );

        switch (query.type) {
            case "Template": {
                // Loop through our template in reverse order and push our strings and
                // values to the stack. Our stack is First-in-Last-Out which is why
                // we need to iterate in reverse.
                for (let i = query.values.length - 1; i >= 0; i--) {
                    stack.push(query.strings[i + 1]!);
                    stack.push(query.values[i]!);
                }

                // Immediately add the first string in our template to our query text.
                // Skip pushing to the stack since it would be popped
                // immediately anyway.
                text += query.strings[0];

                break;
            }

            case "Value": {
                let value = values.get(query.value);
                if (value === undefined) {
                    value = values.size + 1;
                    values.set(query.value, value);
                }
                text += `$${value}`;
                break;
            }

            case "Identifier": {
                for (let j = 0; j < query.identifier.length; j++) {
                    if (j !== 0) text += ".";
                    const identifier = query.identifier[j];
                    if (typeof identifier === "string") {
                        if (isLowerCaseIdentifier(identifier) && !reservedWords.has(identifier)) {
                            text += identifier;
                        } else {
                            text += '"';
                            text += identifier.replace(/"/g, '""');
                            text += '"';
                        }
                    } else {
                        let alias = aliases.get(identifier);
                        if (alias === undefined) {
                            alias = aliases.size + 1;
                            aliases.set(identifier, alias);
                        }
                        text += `_t${alias}`;
                    }
                }
                break;
            }

            case "Concat": {
                // Loop through our queries in reverse order and push them to our stack.
                // Our stack is First-in-Last-Out which is why we need to iterate
                // in reverse.
                for (let i = query.strings.length - 1; i >= 0; i--) {
                    stack.push(query.strings[i]!);
                    if (i !== 0 && query.joiner !== undefined) {
                        stack.push(query.joiner);
                    }
                }
                break;
            }

            case "Raw": {
                text += query.text;
                break;
            }

            default:
                throw exhaustive(query);
        }
    }

    return {
        text,
        values: Array.from(values.keys()),
    };
};

/**
 * Compiles a SQL query only for i's text. Throws away any values.
 */
sql.compileText = function compileText(query: SqlString): string {
    return sql.compile(query).text;
};
