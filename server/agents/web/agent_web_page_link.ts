import {AgentWebPageRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";

/**
 * Represents a link to an `AgentWebPage`. Links are represented as URL paths in
 * Markdown sent to agents. For example `/document/onboarding` or
 * `/task/write-spec` are links to a specific document and task accordingly.
 * Multiple links may point to the same underlying `AgentWebPage` (e.g. if a
 * document is renamed).
 *
 * There are two kinds of links:
 *
 * - **Stored:** Stored links bind human-readable pathnames to a stable internal
 *   target. For example `/document/onboarding` may be bound to an internal
 *   `DocumentId`. The agent never sees the `DocumentId`, they only see the
 *   human-readable path `/document/onboarding`.
 *
 *     You need `AgentWebSessionStorage` to fully interpret a stored link. For
 *     example, when printing a a stored link to a URL path you must use
 *     `createAgentWebPageStoredLinkPathname()`. This function prints to a
 *     human-readable URL path, consults storage to see if the path already exists,
 *     if yes and the path points to the same underlying `Id` then great we can use
 *     the path! Otherwise we need to add a suffix to the path to avoid collision
 *     (typically an incrementing integer like `-2`).
 *
 *     The `AgentWebPageStoredLink` type doesn't know the exact URL path to share
 *     with the agent (must call `createAgentWebPageStoredLinkPathname()` to get
 *     the path) and the path alone doesn't know how to address the exact
 *     underlying `Id`s (must call `getAgentWebPageStoredLinkByPathname()` to get
 *     the underlying `Id`s).
 *
 * - **Routed:** Routed links use some routing logic to determine the underlying
 *   `AgentWebPage` to serve. They aren't directly stored but may be derived from a
 *   stored link.
 *
 *     For example, to view task comments for `/task/write-spec` you use
 *     `/task/write-spec/comments`. We don't store `/task/write-spec/comments`,
 *     instead we check the `TaskId` associated with the `write-spec` path and use
 *     that to show task comments.
 *
 *     Another example (planned but not implemented as of 2026-06-02), we provide
 *     documentation about the agent web Markdown format under `/skills/...` paths.
 *     These are static strings embedded in our codebase and don't need to
 *     reference storage at all to return content via the `read` tool.
 *
 *     In summary, routed links provide flexibility to define links that don't have
 *     an immediate underlying stored representation. The actual routing logic
 *     lives in `routeAgentWebPageLinkPathname()`.
 *
 * Links are specifically the `pathname` part of a URL. Links don't contain URL
 * search params or a URL hash. URL search params are used to modify what's being
 * shown within a given `AgentWebPage` (e.g. for pagination within a messaging
 * `AgentWebPage`).
 */
export type AgentWebPageLink = AgentWebPageStoredLink | AgentWebPageRoutedLink;
