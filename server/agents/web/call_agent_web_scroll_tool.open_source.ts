import {
    parseAgentWebBytes,
    printAgentWebBytes,
} from "~/server/agents/web/agent_web_bytes.open_source.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {agentWebBytesDefaultLimit} from "~/server/agents/web/default_agent_web_bytes_limit.open_source.js";
import {binarySearchLessThanOrEqual} from "~/server/agents/web/internal/binary_search_less_than_or_equal.open_source.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.open_source.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.open_source.js";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

export async function callAgentWebScrollTool(
    context: AgentWebContext,
    options: {
        path: string;
        offset: number;
        limit?: string;
    },
): Promise<{isError: boolean; response: string}> {
    return await context.span.withSpan("Call agent web scroll tool", async span => {
        try {
            return {
                isError: false,
                response: await actuallyCallAgentWebScrollTool({...context, span}, options),
            };
        } catch (error) {
            span.addException(error);

            return {
                isError: true,
                response: printAgentWebError(`Couldn\u2019t scroll ${quote(options.path)}`, error),
            };
        }
    });
}

async function actuallyCallAgentWebScrollTool(
    context: AgentWebContext,
    {
        path: originalPath,
        offset: offsetNewline,
        limit: limitBytesString = agentWebBytesDefaultLimit,
    }: {
        path: string;
        offset: number;
        limit?: string;
    },
): Promise<string> {
    const {path} = normalizeAgentWebPath(originalPath);

    // The agent gives us a limit in bytes (which conventionally is understood as UTF-8
    // code units) but for convenience we treat it as UTF-16 code units since that's
    // how JavaScript strings are represented. This means in extreme cases we may
    // return a string up to 2x longer in UTF-8 code units than the requested byte
    // limit.
    const limitLength = parseAgentWebBytes(limitBytesString);

    const readResponse = await context.storage.readResponseByPath.get(path);

    if (!readResponse || readResponse.expirationTime < Date.now()) {
        throw new NotFoundError("Read response not found or expired", {
            displayMessage: errorDisplayMessage`Can\u2019t call the \`scroll\` tool for a path that hasn\u2019t been read recently. Call the \`read\` tool with the path ${quote(originalPath)} then call the \`scroll\` tool again.`,
        });
    }

    if (
        !Number.isInteger(offsetNewline) ||
        offsetNewline < 0 ||
        offsetNewline > readResponse.newlineIndexes.length - 1
    ) {
        throw new FailedPreconditionError("Invalid offset line number", {
            displayMessage: errorDisplayMessage`The \`offset\` line number must be between 0 and ${readResponse.newlineIndexes.length - 1}. Instead \`offset\` is ${offsetNewline}.`,
        });
    }

    return truncateAgentWebReadResponse(readResponse, {
        offsetNewline,
        limitLength,
        isScrollTool: true,
    });
}

/**
 * Truncates the agent's read response with the specified offset (line number) and
 * limit (number of bytes).
 *
 * JavaScript strings are represented as UTF-16. Ideally `limitLength` would
 * represent the number of UTF-8 bytes we're returning. However, practically that
 * requires a lot of encoding/decoding from JavaScript strings to `Uint8Array`s. So
 * instead we pretend that each JavaScript character is 1 byte (instead of 2). This
 * is true for all ASCII strings but breaks down for more complicated Unicode code
 * points (e.g. emojis).
 *
 * So there are some JavaScript characters that take two bytes in UTF-8. So in the
 * worst case (text that is ONLY such characters) we may return 2x what
 * `limitLength` requested. We're ok with this tradeoff since in practice we don't
 * expect degenerate strings like this to occur and even if they do exceeding the
 * limit requested by an agent by 2x isn't that bad an outcome.
 */
export function truncateAgentWebReadResponse(
    {
        response,
        newlineIndexes,
    }: {
        response: string;
        newlineIndexes: ReadonlyArray<number>;
    },
    {
        offsetNewline,
        limitLength,
        isScrollTool,
    }: {
        offsetNewline: number;
        limitLength: number;
        isScrollTool: boolean;
    },
) {
    const offsetIndex = offsetNewline === 0 ? 0 : newlineIndexes[offsetNewline - 1]! + 1;
    let truncatedResponse: string;

    if (response.length - offsetIndex <= limitLength) {
        truncatedResponse = response.slice(offsetIndex);

        let truncationString = `End of file.`;

        if (offsetNewline === newlineIndexes.length - 1) {
            truncationString += ` Showing line ${offsetNewline + 1}`;
        } else {
            truncationString += ` Showing lines ${offsetNewline + 1}-${newlineIndexes.length}`;
        }

        truncationString += ` of ${newlineIndexes.length}.`;

        truncatedResponse += `\n\n(${truncationString})`;
    } else {
        let newlineIndexResult = assertExists(
            binarySearchLessThanOrEqual(newlineIndexes, offsetIndex + limitLength),
        );

        // Consume newline characters until we find the last non-newline character.
        while (newlineIndexResult.index < newlineIndexes.length) {
            const previousNewlineByteIndex = newlineIndexes[newlineIndexResult.index + 1]!;
            if (previousNewlineByteIndex === newlineIndexResult.value + 1) {
                newlineIndexResult = {
                    index: newlineIndexResult.index + 1,
                    value: previousNewlineByteIndex,
                };
            } else {
                break;
            }
        }

        let lastNewline;
        let isTruncatedAtNewline;

        // Only truncate to the last newline if we'll return at least half of the limit.
        // Otherwise, truncate exactly at the limit.
        if (newlineIndexResult.value > offsetIndex + limitLength / 2) {
            truncatedResponse = response.slice(offsetIndex, newlineIndexResult.value + 1);

            lastNewline = newlineIndexResult.index;
            isTruncatedAtNewline = true;
        } else {
            truncatedResponse = response.slice(offsetIndex, offsetIndex + limitLength);

            lastNewline = newlineIndexResult.index + 1;
            isTruncatedAtNewline = false;
        }

        let truncationString = `Page truncated, ${printAgentWebBytes(response.length - offsetIndex - truncatedResponse.length)} remaining.`;

        if (offsetNewline === lastNewline) {
            truncationString += ` Showing line ${offsetNewline + 1}`;
        } else {
            truncationString += ` Showing lines ${offsetNewline + 1}-${lastNewline + 1}`;
        }

        truncationString += ` of ${newlineIndexes.length}.`;

        const offsetHint =
            !isTruncatedAtNewline && offsetNewline === lastNewline ? lastNewline : lastNewline + 1;

        if (!isScrollTool) {
            truncationString += ` Call the \`scroll\` tool with an \`offset\` of ${offsetHint}`;
        } else {
            truncationString += ` Use \`offset\` of ${offsetHint}`;
        }

        if (!isTruncatedAtNewline && offsetNewline === lastNewline) {
            truncationString += ` and a higher \`limit\``;
        }

        truncationString += ` to continue.`;

        truncatedResponse += `(${truncationString})`;
    }

    return truncatedResponse;
}
