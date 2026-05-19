import {parseAgentWebBytes} from "~/server/agents/web/agent_web_bytes.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {binarySearchGreaterThanOrEqual} from "~/server/agents/web/internal/binary_search_greater_than_or_equal.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export async function callAgentWebFindTool(
    context: AgentWebContext,
    {
        path: originalPath,
        pattern: patternString,
        offset: offsetMatchIndex,
        limit: limitMatchLength,
        matchLimit: matchLimitBytesString,
    }: {
        path: string;
        pattern: string;
        offset: number;
        limit: number;
        matchLimit: string;
    },
): Promise<string> {
    const {path} = normalizeAgentWebPath(originalPath);
    const matchLimitBytes = parseAgentWebBytes(matchLimitBytesString);

    const readResponse = await context.storage.readResponseByPath.get(path);

    if (!readResponse || readResponse.expirationTime.getTime() < Date.now()) {
        throw new NotFoundError("Read response not found or expired", {
            displayMessage: errorDisplayMessage`Can\u2019t call the \`find\` tool for a path that hasn\u2019t been read recently. Call the \`read\` tool with the path \`${originalPath}\` then call the \`find\` tool again. Or call the \`search\` tool if you don\u2019t know the exact path where the content you\u2019re looking for is.`,
        });
    }

    const pattern = new RegExp(patternString, "gmsv");
    const matches = Array.from(readResponse.response.matchAll(pattern));

    if (
        !Number.isInteger(offsetMatchIndex) ||
        offsetMatchIndex < 0 ||
        (matches.length > 0 && offsetMatchIndex > matches.length - 1)
    ) {
        throw new FailedPreconditionError("Invalid offset match index", {
            displayMessage: errorDisplayMessage`Found ${matches.length} ${matches.length === 1 ? "match" : "matches"} so \`offset\` must be between 0 and ${matches.length - 1}. Instead \`offset\` is ${offsetMatchIndex}.`,
        });
    }

    if (!Number.isInteger(limitMatchLength) || limitMatchLength <= 0) {
        throw new FailedPreconditionError("Invalid limit match length", {
            displayMessage: errorDisplayMessage`\`limit\` must be greater than 0. Instead \`limit\` is ${limitMatchLength}.`,
        });
    }

    const matchesSlice = matches.slice(offsetMatchIndex, offsetMatchIndex + limitMatchLength);

    let output = `Found ${matches.length} ${matches.length === 1 ? "match" : "matches"}`;

    if (matches.length > matchesSlice.length)
        output += ` (showing ${matchesSlice.length} ${matchesSlice.length === 1 ? "match" : "matches"})`;

    output += ".\n";

    for (const match of matchesSlice) {
        const {matchPreview, startNewline, endNewline} = previewAgentWebFindMatch({
            response: readResponse.response,
            newlineIndexes: readResponse.newlineIndexes,
            matchStartIndex: match.index,
            matchEndIndex: match.index + match[0].length,
            limitBytes: matchLimitBytes,
        });

        output += "\n<match>\n\n";

        output += matchPreview;
        output += "\n\n";

        if (startNewline === endNewline) {
            output += `(Showing line ${startNewline + 1}.)`;
        } else {
            output += `(Showing lines ${startNewline + 1}-${endNewline + 1}.)`;
        }

        output += "\n\n</match>\n";
    }

    if (
        matches.length > matchesSlice.length &&
        offsetMatchIndex + limitMatchLength < matches.length
    ) {
        output += `\n(Use \`offset\` of ${offsetMatchIndex + limitMatchLength} to continue.)\n`;
    }

    return output;
}

function previewAgentWebFindMatch({
    response,
    newlineIndexes,
    matchStartIndex,
    matchEndIndex,
    limitBytes,
}: {
    response: string;
    newlineIndexes: ReadonlyArray<number>;
    matchStartIndex: number;
    matchEndIndex: number;
    limitBytes: number;
}): {
    matchPreview: string;
    startNewline: number;
    endNewline: number;
} {
    const matchStartNewlineIndexResult = assertExists(
        binarySearchGreaterThanOrEqual(newlineIndexes, matchStartIndex),
    );

    const matchEndNewlineIndexResult = assertExists(
        binarySearchGreaterThanOrEqual(newlineIndexes, matchEndIndex),
    );

    {
        let matchPreviewStartIndex =
            matchStartNewlineIndexResult.index === 0
                ? 0
                : newlineIndexes[matchStartNewlineIndexResult.index - 1]! + 1;

        let matchPreviewEndIndex = matchEndNewlineIndexResult.value;
        const matchPreviewLength = matchPreviewEndIndex - matchPreviewStartIndex;

        // If the match exceeds the limit then truncate within the lines shown. This may
        // include truncating some of the actual match! Hopefully it's pretty rare for the
        // match to be greater than the limit.
        if (matchPreviewLength >= limitBytes) {
            const overageBytes = matchPreviewLength - limitBytes;

            const lengthToMatchStartIndex = matchStartIndex - matchPreviewStartIndex;
            const lengthToMatchEndIndex = matchPreviewEndIndex - matchEndIndex;

            const matchStartOverageBytes =
                lengthToMatchStartIndex === 0 && lengthToMatchEndIndex === 0
                    ? 0
                    : Math.round(
                          overageBytes *
                              (lengthToMatchStartIndex /
                                  (lengthToMatchStartIndex + lengthToMatchEndIndex)),
                      );

            const matchEndOverageBytes = overageBytes - matchStartOverageBytes;

            matchPreviewStartIndex += matchStartOverageBytes;
            matchPreviewEndIndex -= matchEndOverageBytes;

            // We always want to include the start of our match in the match preview. If we
            // need to truncate from the match then truncated from the end not the start.
            if (matchPreviewStartIndex > matchStartIndex) {
                matchPreviewEndIndex -= matchPreviewStartIndex - matchStartIndex;
                matchPreviewStartIndex = matchStartIndex;
            }

            return {
                matchPreview: response.slice(matchPreviewStartIndex, matchPreviewEndIndex),
                startNewline: assertExists(
                    binarySearchGreaterThanOrEqual(newlineIndexes, matchPreviewStartIndex),
                ).index,
                endNewline: assertExists(
                    binarySearchGreaterThanOrEqual(newlineIndexes, matchPreviewEndIndex),
                ).index,
            };
        }

        // Subtract the bytes occupied by the match preview from the limit.
        limitBytes -= matchPreviewLength;
    }

    // Allow half of the remaining limit after the match preview above and below. Next
    // we'll iterate through lines in the response until we have enough content to
    // satisfy our limit.
    let matchBeforeLimitBytes = limitBytes / 2;
    let matchAfterLimitBytes = limitBytes / 2;

    let matchBeforeNewlineIndexResult = matchStartNewlineIndexResult;
    let matchAfterNewlineIndexResult = matchEndNewlineIndexResult;

    while (true) {
        if (matchBeforeNewlineIndexResult.index <= 0) break;

        const nextMatchBeforeNewline = matchBeforeNewlineIndexResult.index - 1;
        const nextMatchBeforeNewlineIndex = newlineIndexes[nextMatchBeforeNewline]!;

        const lengthToNextMatchBeforeNewlineIndex =
            matchBeforeNewlineIndexResult.value - nextMatchBeforeNewlineIndex;

        if (lengthToNextMatchBeforeNewlineIndex > matchBeforeLimitBytes) break;

        matchBeforeLimitBytes -= lengthToNextMatchBeforeNewlineIndex;

        matchBeforeNewlineIndexResult = {
            index: nextMatchBeforeNewline,
            value: nextMatchBeforeNewlineIndex,
        };
    }

    // Any unused before limit bytes become after limit bytes. In case that lets us
    // return additional content.
    matchAfterLimitBytes += matchBeforeLimitBytes;

    while (true) {
        if (matchAfterNewlineIndexResult.index === newlineIndexes.length - 1) break;

        const nextMatchAfterNewline = matchAfterNewlineIndexResult.index + 1;
        const nextMatchAfterNewlineIndex = newlineIndexes[nextMatchAfterNewline]!;

        const lengthToNextMatchAfterNewlineIndex =
            nextMatchAfterNewlineIndex - matchAfterNewlineIndexResult.value;

        if (lengthToNextMatchAfterNewlineIndex > matchAfterLimitBytes) break;

        matchAfterLimitBytes -= lengthToNextMatchAfterNewlineIndex;

        matchAfterNewlineIndexResult = {
            index: nextMatchAfterNewline,
            value: nextMatchAfterNewlineIndex,
        };
    }

    // Remove any empty newlines from the start of the match.
    while (
        matchBeforeNewlineIndexResult.index < newlineIndexes.length &&
        matchBeforeNewlineIndexResult.index > 0 &&
        matchBeforeNewlineIndexResult.index < matchAfterNewlineIndexResult.index &&
        matchBeforeNewlineIndexResult.value - 1 ===
            newlineIndexes[matchBeforeNewlineIndexResult.index - 1]
    ) {
        matchBeforeNewlineIndexResult = {
            index: matchBeforeNewlineIndexResult.index + 1,
            value: newlineIndexes[matchBeforeNewlineIndexResult.index + 1]!,
        };
    }

    // Remove any empty newlines from the end of the match.
    while (
        matchAfterNewlineIndexResult.index > 0 &&
        matchAfterNewlineIndexResult.index > matchBeforeNewlineIndexResult.index &&
        matchAfterNewlineIndexResult.value - 1 ===
            newlineIndexes[matchAfterNewlineIndexResult.index - 1]
    ) {
        matchAfterNewlineIndexResult = {
            index: matchAfterNewlineIndexResult.index - 1,
            value: matchAfterNewlineIndexResult.value - 1,
        };
    }

    return {
        matchPreview: response.slice(
            matchBeforeNewlineIndexResult.index === 0
                ? 0
                : newlineIndexes[matchBeforeNewlineIndexResult.index - 1]! + 1,
            matchAfterNewlineIndexResult.value,
        ),
        startNewline: matchBeforeNewlineIndexResult.index,
        endNewline: matchAfterNewlineIndexResult.index,
    };
}
