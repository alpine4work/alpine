import {Fragment, ReactNode, useMemo, useState} from "react";
import {usePress} from "react-aria";
import {AgentConversationDebugView} from "~/client/web/debug/shared/agent_conversation_debug_view.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {
    ClaudeAgentDebugState,
    ClaudeConversationDebugData,
    ClaudeConversationItem,
    ClaudeConversationItemContentBlock,
    ClaudeConversationItemMessage,
} from "~/shared/debug/claude/claude_conversation_item.js";
import {Color} from "~/shared/design/core/colors.js";

// The exact string our approvals harness injects as a tool result when the user
// rejects a gated call. Matched precisely so we can annotate it distinctly from a
// parked/aborted call.
const claudeInjectedRejectionText = "The user rejected this action. Do not retry it.";

// Gated tools require user approval before they run. Read-only tools always run.
const claudeGatedToolNames = new Set([
    "WebFetch",
    "WebSearch",
    "mcp__alpine__update",
    "mcp__alpine__create",
    "mcp__alpine__delete",
]);
const claudeReadOnlyToolNames = new Set([
    "Skill",
    "mcp__alpine__read",
    "mcp__alpine__search",
    "mcp__alpine__scroll",
    "mcp__alpine__find",
]);
const claudeWebToolNames = new Set(["WebFetch", "WebSearch"]);

// Semantic gate colors ported from the reference design. `fg` is the accent color,
// `bg` a matching tint. Every value is a design-system token so it inverts in dark
// mode automatically.
const claudeGateColors = {
    park: {fg: "orange-50", bg: "orange-10"},
    approve: {fg: "green-50", bg: "green-10"},
    reject: {fg: "red-50", bg: "red-10"},
    redrive: {fg: "blue-50", bg: "blue-10"},
    dangle: {fg: "purple-50", bg: "purple-10"},
} satisfies {[key: string]: {fg: Color; bg: Color}};

type ClaudeToolResultTone = "injected-rejection" | "parked" | "error" | "ok";

// `conversation` is the conversation as the model sees it (rendered the same way
// as the ChatGPT debugger), `annotated` and `raw` are views of the session
// transcript the conversation is derived from.
const claudeDebugViewNames = ["conversation", "annotated", "raw"] as const;

type ClaudeDebugViewName = (typeof claudeDebugViewNames)[number];

const claudeDebugViewLabel = {
    conversation: "Conversation",
    annotated: "Annotated",
    raw: "Raw",
} satisfies {[key in ClaudeDebugViewName]: string};

export function ClaudeDebugView({data}: {data: ClaudeConversationDebugData}) {
    const [view, setView] = useState<ClaudeDebugViewName>("conversation");

    return (
        <Box userSelect="text" fontSize="75" paddingY="6">
            {/* The conversation view lays itself out in its own monospace column, so it
                renders outside the column the rest of the debugger uses. */}
            <Box marginX="center" paddingX="4" style={{maxWidth: "80ch"}}>
                <ClaudeDebugHeader data={data} />

                <ClaudeStatePanel data={data} />

                <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    flexWrap="wrap"
                    gap="3"
                    marginTop="6"
                    marginBottom="3"
                >
                    <Box fontStyle="code-semi-bold" fontSize="50" color="grey-50">
                        {view === "conversation" ? (
                            <>
                                {data.conversationItems.length} conversation item
                                {data.conversationItems.length === 1 ? "" : "s"}
                            </>
                        ) : (
                            <>
                                {data.items.length} session item
                                {data.items.length === 1 ? "" : "s"}
                            </>
                        )}
                    </Box>
                    <ClaudeViewToggle view={view} onChange={setView} />
                </Box>

                {view !== "conversation" &&
                    (data.items.length === 0 ? (
                        <Box
                            color="grey-50"
                            border="grey-10"
                            borderRadius="3"
                            paddingX="4"
                            paddingY="4"
                        >
                            No session transcript yet. Send Claude a message in this conversation,
                            then reload this page to see the Claude Agent SDK transcript.
                        </Box>
                    ) : view === "annotated" ? (
                        <ClaudeAnnotatedItems items={data.items} />
                    ) : (
                        <ClaudeRawItems items={data.items} />
                    ))}
            </Box>

            {view === "conversation" && (
                <AgentConversationDebugView
                    items={data.conversationItems}
                    emptyText={
                        "No Claude conversation state yet. Send Claude a message in this " +
                        "conversation, then reload this page to see the conversation the model sees."
                    }
                />
            )}
        </Box>
    );
}

function ClaudeDebugHeader({data}: {data: ClaudeConversationDebugData}) {
    return (
        <Box marginBottom="5">
            <Box
                fontStyle="code-semi-bold"
                fontSize="50"
                color="indigo-50"
                marginBottom="1"
                style={{letterSpacing: "0.14em", textTransform: "uppercase"}}
            >
                Claude agent · bots_v2
            </Box>
            <Box fontStyle="bold" fontSize="300" marginBottom="3">
                Session transcript
            </Box>
            <Box display="flex" flexWrap="wrap" gap="2">
                <ClaudeMetaChip label="bot" value={data.botAccountId} />
                <ClaudeMetaChip label="sandbox" value={data.sandboxId} />
                <ClaudeMetaChip label="session" value={data.sessionId} />
                <ClaudeMetaChip label="project" value={data.projectKey} />
            </Box>
        </Box>
    );
}

function ClaudeMetaChip({label, value}: {label: string; value: string | null}) {
    return (
        <Box
            display="flex"
            gap="2"
            fontStyle="code"
            fontSize="50"
            backgroundColor="grey-0"
            border="grey-10"
            borderRadius="4"
            paddingX="3"
            paddingY="1"
            minWidth="flex-fit"
        >
            <Box color="grey-50" flexShrink="0">
                {label}
            </Box>
            <Box color={value === null ? "grey-40" : "grey-90"} style={{wordBreak: "break-all"}}>
                {value ?? "—"}
            </Box>
        </Box>
    );
}

function ClaudeViewToggle({
    view,
    onChange,
}: {
    view: ClaudeDebugViewName;
    onChange: (view: ClaudeDebugViewName) => void;
}) {
    return (
        <Box
            display="flex"
            border="grey-10"
            borderRadius="4"
            overflow="hidden"
            fontStyle="code-semi-bold"
            fontSize="50"
        >
            {claudeDebugViewNames.map(name => (
                <ClaudeViewToggleOption
                    key={name}
                    isSelected={view === name}
                    onPress={() => onChange(name)}
                >
                    {claudeDebugViewLabel[name]}
                </ClaudeViewToggleOption>
            ))}
        </Box>
    );
}

function ClaudeViewToggleOption({
    isSelected,
    onPress,
    children,
}: {
    isSelected: boolean;
    onPress: () => void;
    children: ReactNode;
}) {
    const {pressProps, isPressed} = usePress({onPress});

    return (
        <FocusRing>
            <Box
                {...pressProps}
                tabIndex={0}
                cursor="pointer"
                userSelect="none"
                paddingX="3"
                paddingY="1"
                backgroundColor={isSelected ? "indigo-50" : "grey-0"}
                color={isSelected ? "grey-0" : "grey-50"}
                opacity={isPressed ? "60" : undefined}
            >
                {children}
            </Box>
        </FocusRing>
    );
}

function ClaudeStatePanel({data}: {data: ClaudeConversationDebugData}) {
    const {state} = data;

    return (
        <Box border="grey-10" borderRadius="3" backgroundColor="grey-0" overflow="hidden">
            <Box
                backgroundColor="grey-5"
                borderBottom="grey-10"
                paddingX="4"
                paddingY="2"
                fontStyle="code-semi-bold"
                fontSize="50"
                color="grey-50"
                style={{letterSpacing: "0.08em", textTransform: "uppercase"}}
            >
                state.json
            </Box>
            <Box paddingX="4" paddingY="3">
                {state === null ? (
                    <Box color="grey-50">
                        {data.botAccountId === null
                            ? "The Claude bot is not instantiated in this space."
                            : "No persisted state for this conversation yet."}
                    </Box>
                ) : (
                    <ClaudeStateBody state={state} />
                )}
            </Box>
        </Box>
    );
}

function ClaudeStateBody({state}: {state: ClaudeAgentDebugState}) {
    const room = state.room ?? null;

    return (
        <Box display="flex" flexDirection="column" gap="3">
            <ClaudeStateRow label="Session id" value={state.sessionId ?? "—"} />

            {room !== null && (
                <Box display="flex" flexDirection="column" gap="1">
                    <ClaudeStateRow label="Time zone" value={room.timeZone ?? "—"} />
                    <ClaudeStateRow label="Page link" value={room.pageLinkKey ?? "—"} />
                    <ClaudeStateRow
                        label="Last message"
                        value={
                            room.lastMessageIndex === undefined ? "—" : `${room.lastMessageIndex}`
                        }
                    />
                </Box>
            )}
        </Box>
    );
}

function ClaudeStateRow({label, value}: {label: string; value: string}) {
    return (
        <Box display="flex" gap="3" fontSize="50" flexWrap="wrap">
            <Box color="grey-50" flexShrink="0" style={{minWidth: "12ch"}}>
                {label}
            </Box>
            <Box fontStyle="code" color="grey-90" style={{wordBreak: "break-all"}}>
                {value}
            </Box>
        </Box>
    );
}

function ClaudeRawItems({items}: {items: ReadonlyArray<ClaudeConversationItem>}) {
    return (
        <Box display="flex" flexDirection="column" gap="3">
            {items.map((item, index) => (
                <Box
                    key={index}
                    border="grey-10"
                    borderRadius="3"
                    backgroundColor="grey-0"
                    overflow="hidden"
                >
                    <Box
                        display="flex"
                        gap="2"
                        backgroundColor="grey-5"
                        borderBottom="grey-10"
                        paddingX="3"
                        paddingY="1"
                        fontStyle="code"
                        fontSize="50"
                        color="grey-50"
                    >
                        <Box color="grey-40">{index}</Box>
                        <Box color="grey-90">{item.type}</Box>
                    </Box>
                    <Box paddingX="3" paddingY="2">
                        <ClaudeScrollableContent text={formatClaudeJson(item)} maxLines={16} />
                    </Box>
                </Box>
            ))}
        </Box>
    );
}

function ClaudeAnnotatedItems({items}: {items: ReadonlyArray<ClaudeConversationItem>}) {
    // A couple of transcript-wide passes drive the tool-call annotations: which
    // `tool_use` calls got a result, and which web calls repeat an earlier input (a
    // re-drive).
    const {resolvedToolUseIds, redriveToolUseIds, skillToolUseIds} = useMemo(() => {
        const resolvedToolUseIds = new Set<string>();
        const redriveToolUseIds = new Set<string>();
        // The `tool_use` ids of `Skill` calls, so we can collapse their (verbose) results
        // (see `getClaudeSkillItemDisplay`).
        const skillToolUseIds = new Set<string>();
        const seenWebToolInputs = new Set<string>();

        for (const item of items) {
            for (const block of getClaudeContentBlocks(item.message)) {
                if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
                    resolvedToolUseIds.add(block.tool_use_id);
                }

                if (
                    block.type === "tool_use" &&
                    typeof block.id === "string" &&
                    block.name === "Skill"
                ) {
                    skillToolUseIds.add(block.id);
                }

                if (
                    block.type === "tool_use" &&
                    typeof block.id === "string" &&
                    typeof block.name === "string" &&
                    claudeWebToolNames.has(block.name)
                ) {
                    // `\u0000` can't appear in a tool name or in `JSON.stringify()` output, so no two
                    // different calls can build the same key.
                    const signature = `${block.name}\u0000${formatClaudeJson(block.input)}`;
                    if (seenWebToolInputs.has(signature)) {
                        redriveToolUseIds.add(block.id);
                    } else {
                        seenWebToolInputs.add(signature);
                    }
                }
            }
        }

        return {resolvedToolUseIds, redriveToolUseIds, skillToolUseIds};
    }, [items]);

    return (
        <Box display="flex" flexDirection="column" gap="2">
            {items.map((item, index) => {
                // Skill calls flood the transcript: a `Skill` tool_use, its "Launching skill…"
                // result, and a multi-KB block of injected instructions. Collapse them — the
                // tool_use renders as a compact skill line (see `ClaudeContentBlockView`), its
                // result is hidden, and the instructions become a one-line note (the Raw view
                // still has the full text).
                const skillDisplay = getClaudeSkillItemDisplay(item, skillToolUseIds);

                const itemNode =
                    skillDisplay === "hidden" ? null : skillDisplay === "instructions" ? (
                        <ClaudeMetaRow label="skill" value="instructions (see Raw)" />
                    ) : (
                        <ClaudeAnnotatedItem
                            item={item}
                            resolvedToolUseIds={resolvedToolUseIds}
                            redriveToolUseIds={redriveToolUseIds}
                        />
                    );

                if (itemNode === null) return null;

                return <Fragment key={index}>{itemNode}</Fragment>;
            })}
        </Box>
    );
}

function ClaudeAnnotatedItem({
    item,
    resolvedToolUseIds,
    redriveToolUseIds,
}: {
    item: ClaudeConversationItem;
    resolvedToolUseIds: ReadonlySet<string>;
    redriveToolUseIds: ReadonlySet<string>;
}) {
    // Bookkeeping items (queue-operation, ai-title, last-prompt, mode, attachment) and
    // harness resume nudges render as compact meta lines, not full turns.
    const metaLine = getClaudeMetaLine(item);
    if (metaLine !== null) {
        return <ClaudeMetaRow label={metaLine.label} value={metaLine.value} />;
    }

    const blocks = getClaudeContentBlocks(item.message);
    const isSynthetic = item.message?.model === "<synthetic>";
    const role = getClaudeItemRole(item, blocks);

    return (
        <Box display="flex" gap="3" paddingY="2" borderTop="grey-5">
            <Box flexShrink="0" style={{width: "9ch"}}>
                <Box
                    fontStyle="code-semi-bold"
                    fontSize="50"
                    color={claudeRoleColor[role]}
                    style={{letterSpacing: "0.06em", textTransform: "uppercase"}}
                >
                    {role}
                </Box>
                {isSynthetic && (
                    <Box fontStyle="code" fontSize="50" color="grey-40">
                        synthetic
                    </Box>
                )}
            </Box>

            <Box flexGrow="1" minWidth="flex-fit" display="flex" flexDirection="column" gap="2">
                {typeof item.message?.content === "string" ? (
                    <ClaudePreWrap>{item.message.content}</ClaudePreWrap>
                ) : (
                    blocks.map((block, index) => (
                        <ClaudeContentBlockView
                            key={index}
                            item={item}
                            block={block}
                            resolvedToolUseIds={resolvedToolUseIds}
                            redriveToolUseIds={redriveToolUseIds}
                        />
                    ))
                )}
            </Box>
        </Box>
    );
}

function ClaudeContentBlockView({
    item,
    block,
    resolvedToolUseIds,
    redriveToolUseIds,
}: {
    item: ClaudeConversationItem;
    block: ClaudeConversationItemContentBlock;
    resolvedToolUseIds: ReadonlySet<string>;
    redriveToolUseIds: ReadonlySet<string>;
}) {
    switch (block.type) {
        case "text":
            return <ClaudePreWrap>{block.text ?? ""}</ClaudePreWrap>;

        case "thinking":
            return <ClaudeThinkingBlock block={block} />;

        case "tool_use":
            // A `Skill` call collapses to a compact line (skill name + any args) instead of
            // the full tool-call block; its result and instructions are collapsed too (see
            // `ClaudeAnnotatedItems`).
            if (block.name === "Skill") {
                return <ClaudeSkillLine block={block} />;
            }

            return (
                <ClaudeToolCallBlock
                    block={block}
                    resolvedToolUseIds={resolvedToolUseIds}
                    redriveToolUseIds={redriveToolUseIds}
                />
            );

        case "tool_result":
            return <ClaudeToolResultBlock item={item} block={block} />;

        default:
            return <ClaudeScrollableContent text={formatClaudeJson(block)} maxLines={10} />;
    }
}

function ClaudeThinkingBlock({block}: {block: ClaudeConversationItemContentBlock}) {
    const hasText = typeof block.thinking === "string" && block.thinking.length > 0;

    return (
        <Box
            borderLeft="purple-50"
            borderWidth="thick"
            paddingLeft="3"
            color="grey-50"
            fontStyle="code"
            fontSize="50"
        >
            <Box color="purple-50" fontStyle="code-semi-bold" marginBottom="1">
                thinking
            </Box>
            {hasText ? (
                <ClaudePreWrap mono>{block.thinking ?? ""}</ClaudePreWrap>
            ) : (
                <Box color="grey-40">summarized while streaming, not persisted</Box>
            )}
        </Box>
    );
}

function ClaudeToolCallBlock({
    block,
    resolvedToolUseIds,
    redriveToolUseIds,
}: {
    block: ClaudeConversationItemContentBlock;
    resolvedToolUseIds: ReadonlySet<string>;
    redriveToolUseIds: ReadonlySet<string>;
}) {
    const name = block.name ?? "tool";
    const id = typeof block.id === "string" ? block.id : null;

    const isGated = claudeGatedToolNames.has(name);
    const isReadOnly = claudeReadOnlyToolNames.has(name);
    const isWeb = claudeWebToolNames.has(name);
    const isRedrive = id !== null && redriveToolUseIds.has(id);
    const isDangling = isWeb && id !== null && !resolvedToolUseIds.has(id);

    const pill = isRedrive
        ? {label: "re-drive", ...claudeGateColors.redrive}
        : isDangling
          ? {label: "dangling", ...claudeGateColors.dangle}
          : isGated
            ? {label: "gated", ...claudeGateColors.park}
            : isReadOnly
              ? {label: "allowed", fg: "grey-50" as Color, bg: "grey-5" as Color}
              : null;

    return (
        <Box border="grey-10" borderRadius="2" overflow="hidden">
            <Box
                display="flex"
                alignItems="center"
                gap="2"
                flexWrap="wrap"
                backgroundColor="grey-5"
                borderBottom="grey-10"
                paddingX="3"
                paddingY="1"
                fontSize="50"
            >
                <Box fontStyle="code" color="grey-50">
                    call
                </Box>
                <Box fontStyle="code-semi-bold" color="grey-90">
                    {prettyClaudeToolName(name)}
                </Box>
                {pill !== null && (
                    <Box
                        fontStyle="code-semi-bold"
                        color={pill.fg}
                        backgroundColor={pill.bg}
                        borderRadius="1"
                        paddingX="2"
                    >
                        {pill.label}
                    </Box>
                )}
                {id !== null && (
                    <Box fontStyle="code" color="grey-40" marginLeft="auto">
                        #{id.slice(-4)}
                    </Box>
                )}
            </Box>
            <Box paddingX="3" paddingY="2">
                <ClaudeScrollableContent text={formatClaudeJson(block.input)} maxLines={12} />
            </Box>
        </Box>
    );
}

function ClaudeSkillLine({block}: {block: ClaudeConversationItemContentBlock}) {
    const {skill, args} = getClaudeSkillLabel(block.input);

    return (
        <Box display="flex" alignItems="center" gap="2" flexWrap="wrap" fontSize="50" paddingY="1">
            <Box
                fontStyle="code-semi-bold"
                color="indigo-50"
                backgroundColor="indigo-10"
                borderRadius="1"
                paddingX="2"
                flexShrink="0"
                style={{letterSpacing: "0.05em", textTransform: "uppercase"}}
            >
                skill
            </Box>
            <Box fontStyle="code-semi-bold" color="grey-90">
                {skill ?? "list skills"}
            </Box>
            {args !== null && (
                <Box fontStyle="code" color="grey-50" style={{wordBreak: "break-word"}}>
                    {args}
                </Box>
            )}
        </Box>
    );
}

function ClaudeToolResultBlock({
    item,
    block,
}: {
    item: ClaudeConversationItem;
    block: ClaudeConversationItemContentBlock;
}) {
    const text = getClaudeToolResultText(block.content);
    const tone = classifyClaudeToolResult(item, block, text);

    const toneColor: {[key in ClaudeToolResultTone]: {label: string; fg: Color; bg: Color}} = {
        "injected-rejection": {label: "injected rejection", ...claudeGateColors.approve},
        parked: {label: "parked · aborted", ...claudeGateColors.park},
        error: {label: "error", ...claudeGateColors.reject},
        ok: {label: "tool result", fg: "grey-50", bg: "grey-5"},
    };

    const {label, fg, bg} = toneColor[tone];

    return (
        <Box borderLeft={fg} borderWidth="thick" backgroundColor={bg} borderRadius="2">
            <Box
                fontStyle="code-semi-bold"
                fontSize="50"
                color={fg}
                paddingX="3"
                paddingTop="1"
                style={{letterSpacing: "0.05em", textTransform: "uppercase"}}
            >
                {label}
            </Box>
            <Box paddingX="3" paddingBottom="2" paddingTop="1">
                <ClaudeScrollableContent text={text} maxLines={12} />
            </Box>
        </Box>
    );
}

function ClaudeMetaRow({label, value}: {label: string; value: string}) {
    return (
        <Box
            display="flex"
            gap="2"
            fontStyle="code"
            fontSize="50"
            color="grey-40"
            paddingY="1"
            flexWrap="wrap"
        >
            <Box flexShrink="0">{label}</Box>
            <Box color="grey-50" style={{wordBreak: "break-word"}}>
                {value}
            </Box>
        </Box>
    );
}

function ClaudePreWrap({children, mono}: {children: string; mono?: boolean}) {
    return (
        <Box fontStyle={mono ? "code" : "normal"} fontSize={mono ? "50" : "75"} color="grey-90">
            <div style={{margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word"}}>
                {children}
            </div>
        </Box>
    );
}

function ClaudeScrollableContent({text, maxLines}: {text: string; maxLines: number}) {
    const lineCount = useMemo(() => text.split("\n").length, [text]);
    const isLong = lineCount > maxLines || text.length > maxLines * 80;

    const [isExpanded, setIsExpanded] = useState(false);
    const {pressProps, isPressed} = usePress({onPress: () => setIsExpanded(value => !value)});

    return (
        <Box>
            <Box
                data-scrollbar="false"
                overflowX="auto"
                overflowY="auto"
                fontStyle="code"
                fontSize="50"
                color="grey-90"
                style={{maxHeight: isExpanded || !isLong ? undefined : `${maxLines}lh`}}
            >
                <pre style={{margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word"}}>
                    {text}
                </pre>
            </Box>
            {isLong && (
                <FocusRing>
                    <Box
                        {...pressProps}
                        tabIndex={0}
                        cursor="pointer"
                        userSelect="none"
                        fontStyle="code-semi-bold"
                        fontSize="50"
                        color="indigo-50"
                        marginTop="1"
                        opacity={isPressed ? "60" : undefined}
                    >
                        {isExpanded ? "Show less" : "Show more"}
                    </Box>
                </FocusRing>
            )}
        </Box>
    );
}

const claudeRoleColor = {
    Human: "cyan-50",
    Claude: "indigo-50",
    Tool: "grey-50",
    Gate: "orange-50",
} satisfies {[key: string]: Color};

type ClaudeItemRole = keyof typeof claudeRoleColor;

function getClaudeItemRole(
    item: ClaudeConversationItem,
    blocks: ReadonlyArray<ClaudeConversationItemContentBlock>,
): ClaudeItemRole {
    if (item.type === "assistant") return "Claude";

    if (item.type === "user") {
        const hasToolResult = blocks.some(block => block.type === "tool_result");
        if (hasToolResult) {
            return item.toolDenialKind === "user-rejected" ? "Gate" : "Tool";
        }
        return "Human";
    }

    return "Tool";
}

function getClaudeContentBlocks(
    message: ClaudeConversationItemMessage | undefined,
): ReadonlyArray<ClaudeConversationItemContentBlock> {
    if (message === undefined) return [];
    if (typeof message.content === "string") return [];
    return message.content ?? [];
}

// The prefix of the multi-KB instructions block the Skill tool injects after a
// skill loads. Matched so the annotated view can collapse it (the Raw view keeps
// the full text).
const claudeSkillInstructionsPrefix = "Base directory for this skill:";

// Whether a whole transcript item should collapse because it's Skill noise:
// `"hidden"` for a turn that only carries skill tool_results (the compact skill
// line already conveys it), `"instructions"` for the injected skill instructions,
// or `null` to render the item normally.
function getClaudeSkillItemDisplay(
    item: ClaudeConversationItem,
    skillToolUseIds: ReadonlySet<string>,
): "hidden" | "instructions" | null {
    const blocks = getClaudeContentBlocks(item.message);

    if (
        blocks.length > 0 &&
        blocks.every(
            block =>
                block.type === "tool_result" &&
                typeof block.tool_use_id === "string" &&
                skillToolUseIds.has(block.tool_use_id),
        )
    ) {
        return "hidden";
    }

    const text = getClaudeSingleText(item);
    if (text !== null && text.startsWith(claudeSkillInstructionsPrefix)) {
        return "instructions";
    }

    return null;
}

// The item's text when its content is a plain string or entirely text blocks,
// otherwise `null`.
function getClaudeSingleText(item: ClaudeConversationItem): string | null {
    const content = item.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return null;

    const textBlocks = content.filter(block => block.type === "text");
    if (textBlocks.length === 0 || textBlocks.length !== content.length) return null;

    return textBlocks.map(block => block.text ?? "").join("");
}

// The skill name and any remaining args from a `Skill` tool call's input.
function getClaudeSkillLabel(input: unknown): {skill: string | null; args: string | null} {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return {skill: null, args: input === undefined ? null : formatClaudeJson(input)};
    }

    const record = input as {[key: string]: unknown};
    const skill = typeof record.skill === "string" ? record.skill : null;
    const otherEntries = Object.entries(record).filter(([key]) => key !== "skill");

    return {
        skill,
        args: otherEntries.length === 0 ? null : formatClaudeJson(Object.fromEntries(otherEntries)),
    };
}

function getClaudeMetaLine(item: ClaudeConversationItem): {label: string; value: string} | null {
    switch (item.type) {
        case "queue-operation":
            return {
                label: "queue",
                value: typeof item.operation === "string" ? item.operation : "",
            };
        case "ai-title":
            return {label: "ai title", value: typeof item.aiTitle === "string" ? item.aiTitle : ""};
        case "last-prompt":
            return {
                label: "resume prompt",
                value: typeof item.lastPrompt === "string" ? item.lastPrompt : "",
            };
        case "mode":
            return {label: "mode", value: typeof item.mode === "string" ? item.mode : ""};
        case "attachment":
            return {
                label: "attachment",
                value:
                    item.attachment !== undefined && typeof item.attachment.type === "string"
                        ? item.attachment.type
                        : "",
            };
        default:
            return null;
    }
}

function classifyClaudeToolResult(
    item: ClaudeConversationItem,
    block: ClaudeConversationItemContentBlock,
    text: string,
): ClaudeToolResultTone {
    if (text.trim() === claudeInjectedRejectionText) return "injected-rejection";

    if (item.toolDenialKind === "user-rejected" || /want to proceed|\bSTOP\b/.test(text)) {
        return "parked";
    }

    if (block.is_error === true) return "error";

    return "ok";
}

function getClaudeToolResultText(content: ClaudeConversationItemContentBlock["content"]): string {
    if (content === undefined) return "";
    if (typeof content === "string") return content;

    return content
        .map(block => (typeof block.text === "string" ? block.text : formatClaudeJson(block)))
        .join("\n");
}

function prettyClaudeToolName(name: string): string {
    if (name.startsWith("mcp__alpine__")) return name.slice("mcp__alpine__".length);
    if (name.startsWith("mcp__")) return name.slice("mcp__".length).replaceAll("__", " · ");
    return name;
}

function formatClaudeJson(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined) return "";
    // Session items are parsed from JSON, so they're always serializable.
    return JSON.stringify(value, null, 2);
}
