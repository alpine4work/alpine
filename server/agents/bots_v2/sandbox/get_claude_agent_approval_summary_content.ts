import {ClaudeAgentGatedToolName} from "~/server/agents/bots_v2/sandbox/claude_agent_tool_names.js";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {createAgentWebPageLinkUrl} from "~/server/agents/web/create_agent_web_page_link_url.open_source.js";
import {normalizeAgentWebPath} from "~/server/agents/web/normalize_agent_web_path.open_source.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.open_source.js";
import {
    ApiLabelContent,
    ApiMentionReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

export type ClaudeAgentApprovalSummaryContentResult =
    /**
     * Only `update`/`delete` reach this: the input is malformed, the path hasn't been
     * read recently, or it no longer routes to anything. The tools themselves refuse
     * such paths, so asking for approval would show the user a card for an action
     * that's guaranteed to fail. Deny and send the agent back to `read` instead.
     */
    {readonly ok: false} | {readonly ok: true; readonly summaryContent: ApiLabelContent};

/**
 * The summary rendered on the approval card, which the client prefixes with "Allow
 * {agent} to:". Built once when the gate parks the call, so the card describes the
 * data as it was when the agent proposed the action.
 *
 * For `update`/`delete` the path is routed to the entity it targets so the summary
 * can name it precisely — "Update comments on {Todos}" rather than "Update
 * /task/todos/comments" — as a mention, which the card resolves to the entity's
 * live title. Paths that route to something unnameable (a skill, a file, the
 * agent's own account) fall back to the plain-text summary, as do the tools that
 * carry no path at all.
 *
 * Reads only the agent's session storage — the same records the read tool
 * maintains — and never the API.
 */
export async function getClaudeAgentApprovalSummaryContent(
    storage: AgentWebSessionStorage,
    {toolName, input}: {toolName: ClaudeAgentGatedToolName; input: unknown},
): Promise<ClaudeAgentApprovalSummaryContentResult> {
    const summaryTextContent = (): ApiLabelContent => ({
        elements: [{type: "Text", text: getClaudeAgentApprovalSummaryText({toolName, input})}],
    });

    if (toolName !== "mcp__alpine__update" && toolName !== "mcp__alpine__delete") {
        return {ok: true, summaryContent: summaryTextContent()};
    }

    if (!isObject(input) || typeof input.path !== "string" || input.path.length === 0) {
        return {ok: false};
    }

    const {path, pathname} = normalizeAgentWebPath(input.path);

    const readResponse = await storage.readResponseByPath.get(path);

    if (readResponse === undefined || readResponse.expirationTime < Date.now()) {
        return {ok: false};
    }

    // NOTE(ifitzsimmons, 2026-08-17): You may be asking why we can't just use the
    // `readResponse` to construct the summary content. The read response answers "is
    // this fresh", routing answers "what is it". `pageMetadata` on the response is
    // _page_ metadata - the `pageMetadata for `/task/todos/comments/7`is`{type:
    // "TaskMessageList", id: <task>}` (no comment index). Post, chat, and document
    // messages collapse onto their room the same way. So if we want the approval to
    // say something like "The agent wants to update [this comment](link-to-comment)",
    // we need to use the routing logic to find the exact comment.
    const routed = await routeAgentWebPageLinkPathname(storage, pathname);

    // We should always have a link for an entity that we are trying to update or
    // delete. How could the agent act on something it never saw? The freshness check
    // above is the stronger condition — `read` only records a response once routing
    // this pathname succeeded unredirected, `create` records one for a pathname it
    // just stored a link for, and stored links are never deleted (a rename resolves
    // through `latestPathname` instead). So reaching here means storage disagrees with
    // itself, and the agent doesn't get to write against a target we can't identify.
    if (routed === null) return {ok: false};

    const verb = toolName === "mcp__alpine__update" ? "Update" : "Delete";

    return {
        ok: true,
        summaryContent: intoApprovalTargetContent(verb, routed.pageLink) ?? summaryTextContent(),
    };
}

/**
 * Names what a write targets, in the imperative the approval card asks in. Mirrors
 * the past-tense phrasing `intoApiMessageStreamToolCallPart()` uses once the write
 * has actually run.
 *
 * `null` for the page links a write can't meaningfully name, so the caller falls
 * back to the plain-text summary.
 *
 * A target that addresses something narrower than a whole entity — one comment,
 * one thread — is linked as well as named, so the reader can open exactly what
 * they're being asked to approve. The card doesn't render those links yet: it
 * flattens the summary through `getMessageApprovalContentText()`
 * (`message_stream_view_approvals.tsx`) into a single text line, which resolves
 * mentions to live titles and drops marks. The content is correct either way, so
 * the links light up when that card renders `LabelContent` directly.
 */
function intoApprovalTargetContent(
    verb: string,
    pageLink: AgentWebPageLink,
): ApiLabelContent | null {
    switch (pageLink.type) {
        case "Account":
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "Site":
        case "Task":
        case "TaskCollection":
            return {
                elements: [
                    {type: "Text", text: `${verb} `},
                    {type: "Mention", reference: pageLink},
                ],
            };
        case "TaskSubtasks":
            return intoLinkedApprovalTargetContent(verb, {
                label: "subtasks",
                preposition: "for",
                reference: pageLink.task,
                url: createAgentWebPageLinkUrl(pageLink),
            });
        case "TaskMessage":
            return intoLinkedApprovalTargetContent(verb, {
                label: "a comment",
                preposition: "on",
                reference: {type: "Task", id: pageLink.id},
                url: createAgentWebPageLinkUrl(pageLink),
            });
        case "PostMessage":
            return intoLinkedApprovalTargetContent(verb, {
                label: "a comment",
                preposition: "on",
                reference: {type: "Post", id: pageLink.id},
                url: createAgentWebPageLinkUrl(pageLink),
            });
        case "ChatMessage":
            return intoLinkedApprovalTargetContent(verb, {
                label: "a message",
                preposition: "in",
                reference: {type: "Chat", id: pageLink.id},
                url: createAgentWebPageLinkUrl(pageLink),
            });
        case "DocumentThread":
            return intoLinkedApprovalTargetContent(verb, {
                label: "a comment thread",
                preposition: "on",
                reference: pageLink.document,
                url: createAgentWebPageLinkUrl(pageLink),
            });
        case "DocumentMessage":
            return intoLinkedApprovalTargetContent(verb, {
                label: "a comment",
                preposition: "on",
                reference: pageLink.document,
                url: createAgentWebPageLinkUrl(pageLink),
            });
        // No URL of their own: a task's comments and an inbox are only addressable through
        // the entity the mention already points at.
        case "TaskMessageList":
            return intoNamedApprovalTargetContent(verb, "comments on", pageLink.task);
        case "Inbox":
            return intoNamedApprovalTargetContent(verb, "the inbox for", pageLink.account);
        // Nothing to name: the plain-text summary carries the path instead.
        case "File":
        case "MyAccount":
        case "Space":
        case "Skill":
        case "TaskView":
            return null;
        default:
            throw exhaustive(pageLink);
    }
}

/**
 * Names a target that has its own URL, linking the words that describe it: "Update
 * **a comment** on {Doc}". Mirrors `intoLinkedReadContent()`, which does the same
 * for the tool-call part once the write has run.
 */
function intoLinkedApprovalTargetContent(
    verb: string,
    {
        label,
        preposition,
        reference,
        url,
    }: {
        readonly label: string;
        readonly preposition: string;
        readonly reference: ApiMentionReference;
        readonly url: string;
    },
): ApiLabelContent {
    return {
        elements: [
            {type: "Text", text: `${verb} `},
            {type: "Text", text: label, marks: [{type: "Link", url}]},
            {type: "Text", text: ` ${preposition} `},
            {type: "Mention", reference},
        ],
    };
}

/**
 * Names a target that has no URL of its own, so only the entity is a reference.
 */
function intoNamedApprovalTargetContent(
    verb: string,
    target: string,
    reference: ApiMentionReference,
): ApiLabelContent {
    return {
        elements: [
            {type: "Text", text: `${verb} ${target} `},
            {type: "Mention", reference},
        ],
    };
}

/**
 * A short human-readable summary of the action a pending approval is asking for
 * (e.g. `Update /doc/hello-world`). Shown on the approval card and used to refer
 * back to the action when steering the agent after a decision.
 */
function getClaudeAgentApprovalSummaryText({
    toolName,
    input,
}: {
    toolName: ClaudeAgentGatedToolName;
    input: unknown;
}): string {
    const inputString = (key: string): string | null => {
        if (!isObject(input)) return null;
        const value = input[key];
        return typeof value === "string" && value.length > 0 ? value : null;
    };

    switch (toolName) {
        // `update`/`delete` normally render as a mention of the entity they target — this
        // text is the fallback for a path that routes to something that isn't mentionable.
        case "mcp__alpine__update": {
            const path = inputString("path");
            return path === null ? "Update a page" : `Update ${path}`;
        }
        case "mcp__alpine__delete": {
            const path = inputString("path");
            return path === null ? "Delete a page" : `Delete ${path}`;
        }
        case "mcp__alpine__create": {
            const type = inputString("type") ?? "page";
            const title = getMarkdownTitle(inputString("content"));
            return title === null
                ? `Create a new ${type}`
                : `Create a new ${type} \u201C${title}\u201D`;
        }
        case "WebFetch": {
            const url = inputString("url");
            return url === null ? "Fetch a web page" : `Fetch ${url}`;
        }
        case "WebSearch": {
            const query = inputString("query");
            return query === null ? "Search the web" : `Search the web for \u201C${query}\u201D`;
        }
        default:
            throw exhaustive(toolName);
    }
}

/**
 * The title of a markdown document: the text of the first heading, as long as it's
 * the first non-blank line (a heading later in the document is a section title,
 * not the page title).
 */
function getMarkdownTitle(markdown: string | null): string | null {
    if (markdown === null) return null;

    const firstLine = markdown
        .split("\n")
        .find(line => line.trim().length > 0)
        ?.trim();

    const title = firstLine?.match(/^#{1,6}\s+(.*)$/)?.[1]?.trim();

    return title === undefined || title.length === 0 ? null : title;
}
