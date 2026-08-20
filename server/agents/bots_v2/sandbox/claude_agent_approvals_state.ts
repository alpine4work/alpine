import {ClaudeAgentApprovalScope} from "~/server/agents/bots_v2/sandbox/claude_agent_approval_scope.js";
import {ClaudeAgentGatedToolName} from "~/server/agents/bots_v2/sandbox/claude_agent_tool_names.js";
import {
    ApiLabelContentRequest,
    ApiMessageExperimentalApprovalRequest,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {DateString} from "~/shared/helpers/date/date_string.open_source.js";

/**
 * Approvals state for a Claude agent room. Persisted in the sandbox bucket
 * `state.json` so it survives sandbox process restarts.
 *
 * Only the container reads this. The `AgentV2Service` worker decides whether an
 * approval decision is worth starting a container from the event payload alone
 * (see `run_claude_agent_webhook.ts`); it never parses this state.
 */
export type ClaudeAgentAllowedScopes = {
    readonly [scope in ClaudeAgentApprovalScope]?: {readonly expiresTime: string | null};
};

export type ClaudeAgentApprovalsState = {
    /**
     * Scopes granted by `ApprovedForSession` decisions. An `expiresTime` of `null`
     * means the grant never expires.
     *
     * Keyed by the scope union, not by `string`: decisions arrive from the API with a
     * free-form `scope.value`, so they're narrowed at the boundary with
     * `isClaudeAgentApprovalScope()` and anything unrecognized is dropped rather than
     * stored. That keeps the gate's lookup a typed read instead of a string probe.
     *
     * ## Why aren't grants scoped to the user who took the action?
     *
     * Anyone in a conversation can decide the agent's approval cards, so tying a grant
     * to its granter wouldn't buy much — the next participant can grant it again. The
     * agent acts with content everyone in the room can already see, so a grant can't
     * turn someone's private context into a write. That's the argument for accepting a
     * room-wide, cross-user grant.
     *
     * ## What that argument does NOT cover, and we're accepting anyway
     *
     * - The grant survives a new message superseding the conversation, and
     *   `expiresTime: null` is honored as "never expires". The card never offers a
     *   null duration today, so that branch only matters if `state.json` is ever
     *   written by a different code version.
     */
    readonly allowedScopes: ClaudeAgentAllowedScopes;

    /**
     * The approval requests currently awaiting user decisions. At most one batch may
     * be pending per room at a time. The batch is created right before the approvals
     * stream part is pushed and cleared when the decisions are consumed, when a new
     * message supersedes the batch, or when sandbox state is wiped after an error.
     */
    readonly pendingBatch: ClaudeAgentPendingApprovalBatch | null;

    /**
     * Fully-decided approval batches, appended in decision order. Kept only so the
     * agent debugger can interleave the user's approve/reject decisions into the
     * transcript timeline (returned by the conversation-state endpoint) — the agent
     * itself never reads it. Optional so a `state.json` written before this field
     * existed still parses.
     */
    readonly decidedBatches?: ReadonlyArray<ClaudeAgentDecidedApprovalBatch>;
};

export type ClaudeAgentPendingApprovalBatch = {
    /** The stream message whose final part is the approvals card. */
    readonly messageIndex: number;

    /**
     * One entry per approval card, in the same order as the stream part's `approvals`
     * array (so the array position is the approval index).
     */
    readonly approvals: ReadonlyArray<ClaudeAgentPendingApproval>;
};

export type ClaudeAgentPendingApproval = {
    /**
     * The `tool_use` IDs this approval covers. Usually one, but a wave of parallel
     * calls with identical input is deduplicated into a single card — and the SDK
     * still writes an aborted `tool_result` for EVERY one of those `tool_use` blocks.
     * All of them have to be resolved on resume, or the model reads a leftover "the
     * user doesn't want to proceed" for a call the user just approved.
     */
    readonly toolUseIds: ReadonlyArray<string>;

    readonly scope: ClaudeAgentApprovalScope;

    readonly toolName: ClaudeAgentGatedToolName;

    /**
     * The summary the approval card renders, built when the gate parked the call so it
     * describes the data the agent actually saw (see
     * `get_claude_agent_approval_summary_content.ts`). Carries a mention of the entity
     * a write targets where there is one, so the card shows its live title rather than
     * a raw path.
     */
    readonly summaryContent: ApiLabelContentRequest;

    /**
     * The exact options rendered on the card, used to validate webhook decisions.
     */
    readonly decisionOptions: ClaudeAgentApprovalDecisionOptions;
};

export type ClaudeAgentApprovalDecisionOptions =
    ApiMessageExperimentalApprovalRequest["decision"]["schema"]["options"];

/** A request held only in memory until its card is persisted. */
export type ClaudeAgentApprovalRequest = ClaudeAgentPendingApproval & {
    /**
     * Recovered from the transcript after the card is decided; never persisted in
     * state.
     */
    readonly input: unknown;
};

export type ClaudeAgentApprovalDecisionType = "Approved" | "ApprovedForSession" | "Rejected";

type ClaudeAgentDecidedApproval = Omit<
    ClaudeAgentPendingApproval,
    "summaryContent" | "decisionOptions"
> & {
    readonly decision: ClaudeAgentApprovalDecisionType;
};

/**
 * A fully-decided approval batch: the card's approvals plus the decision the user
 * made on each, and when the batch became fully decided.
 */
export type ClaudeAgentDecidedApprovalBatch = {
    /** The stream message the approvals card was on. */
    readonly messageIndex: number;

    /**
     * When the agent processed the batch as fully decided (ISO 8601). Every option on
     * the card had a decision by this point.
     */
    readonly decidedTime: DateString;

    readonly approvals: ReadonlyArray<ClaudeAgentDecidedApproval>;
};

export const emptyClaudeAgentApprovalsState: ClaudeAgentApprovalsState = {
    allowedScopes: {},
    pendingBatch: null,
};
