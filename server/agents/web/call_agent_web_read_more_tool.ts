import {parseAgentWebBytes, printAgentWebBytes} from "~/server/agents/web/agent_web_bytes.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {agentWebReadResponseExpirationHours} from "~/server/agents/web/call_agent_web_read_tool.js";
import {binarySearchLessThanOrEqual} from "~/server/agents/web/internal/binary_search_less_than_or_equal.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";

export async function callAgentWebReadMoreTool(
    context: AgentWebContext,
    {
        path: originalPath,
        offset: offsetLine,
        limit: limitBytesString,
    }: {
        path: string;
        offset: number;
        limit: string;
    },
): Promise<string> {
    const {path} = normalizeAgentWebPath(originalPath);
    const limitBytes = parseAgentWebBytes(limitBytesString);

    // `offsetLine` is 1-indexed for the agent but it's more convenient in our code for
    // the line to be 0-indexed.
    offsetLine -= 1;

    const readResponse = await context.storage.readResponseByPath.get(path);

    if (!readResponse || readResponse.expirationTime.getTime() < Date.now()) {
        const expirationDuration = printPrettyNumber(
            defaultLocale,
            agentWebReadResponseExpirationHours,
            "hour",
            {smallNumbersAsWords: true},
        );

        throw new NotFoundError("Read response not found or expired", {
            displayMessage: errorDisplayMessage`The \`read\` tool hasn\u2019t been called recently for path \`${originalPath}\`. Please call the \`read\` tool first for the path and then call the \`read_more\` tool to see anything truncated by the \`read\` tool. You can only call the \`read_more\` tool for ${expirationDuration} after you call the \`read\` tool for a given path.`,
        });
    }

    if (
        !Number.isInteger(offsetLine) ||
        offsetLine < 0 ||
        offsetLine >= readResponse.newlineByteIndexes.length
    ) {
        throw new FailedPreconditionError("Invalid offset line number", {
            displayMessage: errorDisplayMessage`The \`offset\` line number must be between 1 and ${readResponse.newlineByteIndexes.length}. Instead the \`offset\` line number is ${offsetLine}.`,
        });
    }

    return truncateAgentWebReadResponse(readResponse, {offsetLine, limitBytes});
}

export function truncateAgentWebReadResponse(
    {
        responseBytes,
        newlineByteIndexes,
    }: {
        responseBytes: Uint8Array;
        newlineByteIndexes: ReadonlyArray<number>;
    },
    {
        offsetLine,
        limitBytes,
    }: {
        offsetLine: number;
        limitBytes: number;
    },
) {
    const decoder = new TextDecoder();
    const offsetByteIndex = offsetLine === 0 ? 0 : newlineByteIndexes[offsetLine - 1]! + 1;
    let responseString: string;

    if (responseBytes.length - offsetByteIndex <= limitBytes) {
        responseString = decoder.decode(responseBytes.subarray(offsetByteIndex));

        let truncationString = `End of file.`;

        if (offsetLine === newlineByteIndexes.length - 1) {
            truncationString += ` Showing line ${offsetLine + 1}`;
        } else {
            truncationString += ` Showing lines ${offsetLine + 1}-${newlineByteIndexes.length}`;
        }

        truncationString += ` of ${newlineByteIndexes.length}.`;

        responseString += `\n\n(${truncationString})`;
    } else {
        let newlineByteIndexResult = assertExists(
            binarySearchLessThanOrEqual(newlineByteIndexes, offsetByteIndex + limitBytes),
        );

        // Trim adjacent newline characters until we find the last non-newline byte.
        while (newlineByteIndexResult.index > 0) {
            const previousNewlineByteIndex = newlineByteIndexes[newlineByteIndexResult.index - 1]!;
            if (previousNewlineByteIndex === newlineByteIndexResult.value - 1) {
                newlineByteIndexResult = {
                    index: newlineByteIndexResult.index - 1,
                    value: previousNewlineByteIndex,
                };
            } else {
                break;
            }
        }

        let truncatedResponseBytes;
        let lastNewlineIndex;
        let isTruncatedAtNewline;

        // Only truncate to the last newline if we'll return at least half of the limit.
        // Otherwise, truncate exactly at the limit.
        if (newlineByteIndexResult.value > offsetByteIndex + limitBytes / 2) {
            truncatedResponseBytes = responseBytes.subarray(
                offsetByteIndex,
                newlineByteIndexResult.value,
            );

            lastNewlineIndex = newlineByteIndexResult.index;
            isTruncatedAtNewline = true;
        } else {
            truncatedResponseBytes = responseBytes.subarray(
                offsetByteIndex,
                offsetByteIndex + limitBytes,
            );

            lastNewlineIndex = newlineByteIndexResult.index + 1;
            isTruncatedAtNewline = false;
        }

        responseString = decoder.decode(truncatedResponseBytes);

        let truncationString = `Response truncated, ${printAgentWebBytes(responseBytes.length - offsetByteIndex - truncatedResponseBytes.length)} remaining.`;

        if (offsetLine === lastNewlineIndex) {
            truncationString += ` Showing line ${offsetLine + 1}`;
        } else {
            truncationString += ` Showing lines ${offsetLine + 1}-${lastNewlineIndex + 1}`;
        }

        truncationString += ` of ${newlineByteIndexes.length}.`;

        truncationString += ` Use the \`read_more\` tool with an \`offset\` of ${newlineByteIndexResult.index + 2}`;

        if (!isTruncatedAtNewline && offsetLine === lastNewlineIndex) {
            truncationString += ` and a higher \`limit\``;
        }

        truncationString += ` to continue.`;

        responseString += `\n\n(${truncationString})`;
    }

    return responseString;
}
