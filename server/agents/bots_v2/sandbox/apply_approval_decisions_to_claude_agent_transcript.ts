import {SessionStoreEntry} from "@anthropic-ai/claude-agent-sdk";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

/**
 * How to resolve a single pending tool call in the transcript when its approval
 * decision arrives. Both operate on the tool's error `tool_result` — the aborted
 * result the SDK writes when we park the turn by interrupting it, since the model
 * never got a real one (see `create_claude_agent_can_use_tool.ts`):
 *
 * - `InjectResult`: replace the denied result's payload with a real result (for an
 *   Alpine tool we executed ourselves) or a rejection message. The tool call ends
 *   up looking like it simply ran.
 * - `Dangle`: delete the denied result entirely so the `tool_use` is left with no
 *   result. On resume the CLI re-drives the pending call — used for approved
 *   built-in web tools, which we can't execute ourselves.
 */
export type ClaudeAgentApprovalResolution = {
    readonly toolUseId: string;
} & (
    | {readonly type: "InjectResult"; readonly text: string; readonly isError: boolean}
    | {readonly type: "Dangle"}
);

/**
 * Rewrites a session transcript to resolve a batch of pending approvals. Applies
 * each resolution to the tool's error `tool_result`, then truncates the trailing
 * entries the park left behind — the SDK's "[Request interrupted by user for tool
 * use]" marker and the `last-prompt` record — so resume continues from a clean
 * state. (Because parking interrupts the turn, the model never narrates an "I've
 * requested approval…" line for us to strip; there's simply nothing after the tool
 * results.)
 *
 * Pure: takes the loaded transcript entries and returns new ones. The caller
 * executes any Alpine tools and rewrites the store.
 */
export function applyApprovalDecisionsToClaudeAgentTranscript(
    entries: ReadonlyArray<SessionStoreEntry>,
    resolutions: ReadonlyArray<ClaudeAgentApprovalResolution>,
): ReadonlyArray<SessionStoreEntry> {
    const resolutionByToolUseId = new Map(resolutions.map(r => [r.toolUseId, r]));

    const nextEntries: Array<SessionStoreEntry> = [];

    for (const entry of entries) {
        const content = getToolResultContent(entry);

        if (content === null) {
            nextEntries.push(entry);
            continue;
        }

        // Apply each matching resolution to this entry's tool_result blocks. The parked
        // `tool_result` block — the aborted result the SDK writes when the interrupt lands
        // on a pending tool call — looks like:
        //
        // { "type": "tool_result", "tool_use_id": "toolu_01FSjJ8etn63ALn2yFpawF3c",
        // "is_error": true, "content": "The user doesn't want to proceed with this tool
        // use. ... STOP what you are doing and wait ..." }
        //
        // `InjectResult` swaps `content` for the real result and drops `is_error`;
        // `Dangle` removes the block so the `tool_use` is left without a result.
        const keptBlocks: Array<ContentBlock> = [];
        let injectedText: string | null = null;

        for (const block of content) {
            const toolUseId = getToolResultToolUseId(block);
            const resolution =
                toolUseId === null ? undefined : resolutionByToolUseId.get(toolUseId);

            if (resolution === undefined) {
                keptBlocks.push(block);
                continue;
            }

            switch (resolution.type) {
                case "InjectResult": {
                    injectedText = resolution.text;
                    keptBlocks.push({
                        ...block,
                        content: [{type: "text", text: resolution.text}],
                        is_error: resolution.isError ? true : undefined,
                    });
                    break;
                }
                case "Dangle":
                    // Drop the block entirely so the `tool_use` is left dangling.
                    break;
                default:
                    throw exhaustive(resolution);
            }
        }

        // The whole entry's blocks were dangled away — drop the entry.
        if (keptBlocks.length === 0) continue;

        nextEntries.push(rebuildToolResultEntry(entry, keptBlocks, injectedText));
    }

    return truncateTrailingNonToolEntries(nextEntries);
}

type ContentBlock = {readonly type: string; readonly [key: string]: unknown};

/**
 * The tool_result content blocks of a `user` entry, or `null` if it has none.
 */
function getToolResultContent(entry: SessionStoreEntry): ReadonlyArray<ContentBlock> | null {
    if (entry.type !== "user") return null;

    const message = entry.message;
    if (!isObject(message) || !Array.isArray(message.content)) return null;

    const blocks = message.content.filter(
        (block): block is ContentBlock => isObject(block) && typeof block.type === "string",
    );

    return blocks.some(block => block.type === "tool_result") ? blocks : null;
}

function getToolResultToolUseId(block: ContentBlock): string | null {
    if (block.type !== "tool_result") return null;
    return typeof block.tool_use_id === "string" ? block.tool_use_id : null;
}

/**
 * Rebuilds a `user` entry from its (possibly edited) content blocks. When a result
 * was injected we also refresh the top-level `toolUseResult` mirror the transcript
 * keeps alongside the content block.
 */
function rebuildToolResultEntry(
    entry: SessionStoreEntry,
    blocks: ReadonlyArray<ContentBlock>,
    injectedText: string | null,
): SessionStoreEntry {
    const message = isObject(entry.message) ? entry.message : {};

    const rebuilt: SessionStoreEntry = {
        ...entry,
        message: {...message, content: blocks.map(dropUndefinedValues)},
    };

    if (injectedText !== null) {
        rebuilt.toolUseResult = [{type: "text", text: injectedText}];
    }

    return rebuilt;
}

/**
 * Drops the trailing entries the park left after the last tool call — the SDK's
 * "[Request interrupted by user for tool use]" marker and the `last-prompt` record
 * (and any trailing thinking) — so resume starts from the resolved tool results /
 * dangling tool calls.
 */
function truncateTrailingNonToolEntries(
    entries: ReadonlyArray<SessionStoreEntry>,
): ReadonlyArray<SessionStoreEntry> {
    let lastToolEntryIndex = -1;

    entries.forEach((entry, index) => {
        const content = isObject(entry.message) ? entry.message.content : undefined;
        if (
            Array.isArray(content) &&
            content.some(
                block =>
                    isObject(block) && (block.type === "tool_use" || block.type === "tool_result"),
            )
        ) {
            lastToolEntryIndex = index;
        }
    });

    return lastToolEntryIndex === -1 ? entries : entries.slice(0, lastToolEntryIndex + 1);
}

/** Removes keys explicitly set to `undefined` (e.g. the cleared `is_error`). */
function dropUndefinedValues(block: ContentBlock): ContentBlock {
    return Object.fromEntries(
        Object.entries(block).filter(([, value]) => value !== undefined),
    ) as ContentBlock;
}
