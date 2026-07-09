import {AgentWebPageStoredLinkKeyObject} from "~/server/agents/web/agent_web_page_stored_link_key.js";
import {ApiMentionReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    FileContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {convertToUrlPathnameSlug} from "~/shared/helpers/string/convert_to_url_pathname_slug.js";
import {
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    PostId,
    TaskId,
} from "~/shared/id/types/id_types.js";

/**
 * A human-readable link to some stable internal target where the exact path is
 * stored in `AgentWebSessionStorage`. See the detailed documentation comment on
 * `AgentWebPageLink` for more information.
 *
 * This type contains extra "hydrated" non-canonical data. For example in
 * `{type: "Document", id: DocumentId, title: string}` `title` is the document
 * title and considered hydrated non-canonical data because the document title can
 * change over time.
 *
 * For a canonical stored link key that always points to the same underlying data
 * see `AgentWebPageStoredLinkKey`.
 */
export type AgentWebPageStoredLink =
    | ApiMentionReferenceResponse
    | {
          readonly type: "ChatMessage";
          readonly id: ChatId;
          readonly index: number;
          readonly authorShortName: string;
          readonly preview: string;
      }
    | {
          readonly type: "DocumentMessage";
          readonly id: DocumentId;
          readonly threadId: DocumentCommentThreadId;
          readonly index: number;
          readonly authorShortName: string;
          readonly preview: string;
      }
    | {
          readonly type: "PostMessage";
          readonly id: PostId;
          readonly index: number;
          readonly authorShortName: string;
          readonly preview: string;
      }
    | {
          readonly type: "TaskMessage";
          readonly id: TaskId;
          readonly index: number;
          readonly authorShortName: string;
          readonly preview: string;
      }
    | {
          readonly type: "File";
          readonly id: FileId;
          readonly contentType: FileContentType;
          readonly contentLength: number;
      };

assertAssignableTypes<AgentWebPageStoredLink, AgentWebPageStoredLinkKeyObject>();

/**
 * Prints a human readable path for an agent web page link. When a page link is
 * printed to Markdown this is the `path` part in `[label](path)`.
 * `printAgentWebPageStoredLinkLabel(page)` prints the `label` part.
 *
 * Page paths must be unique. If two pages coincidentally have the same path then
 * we'll increment `dedupeNumber` and try to print a new path until we find a
 * unique path.
 */
export function printAgentWebPageStoredLinkPathname(
    link: AgentWebPageStoredLink,
    dedupeNumber: number,
): string {
    const path = actuallyPrintAgentWebPageStoredLinkPathname(link, dedupeNumber);

    // Validation in development and tests that we actually use `dedupeNumber` to
    // create a unique path.
    if (process.env.NODE_ENV !== "production") {
        // The printed string should look like a URL pathname! Without search params and
        // without a hash.
        assert(path.startsWith("/"));
        assert(!path.includes("?"));
        assert(!path.includes("#"));

        assert(
            path !== actuallyPrintAgentWebPageStoredLinkPathname(link, dedupeNumber + 1),
            "Printed agent web page path must include dedupe number",
        );
    }

    return path;
}

function actuallyPrintAgentWebPageStoredLinkPathname(
    link: AgentWebPageStoredLink,
    dedupeNumber: number,
): string {
    const dedupe = dedupeNumber > 1 ? `-${dedupeNumber}` : "";

    switch (link.type) {
        case "Account": {
            // Account pathnames are labeled `/human/` or `/bot/` for the agent but they're
            // stored under a single `/account/` namespace so that a human and a bot with the
            // same name can't share a pathname, see
            // `normalizeAgentWebPageStoredLinkPathname()`.
            if (link.bot) {
                return `/bot/${slugify(link.title)}${dedupe}`;
            } else {
                return `/human/${slugify(link.title)}${dedupe}`;
            }
        }
        case "Channel": {
            return `/channel/${slugify(link.title)}${dedupe}`;
        }
        case "Chat": {
            return `/chat/${slugify(link.title)}${dedupe}`;
        }
        case "ChatMessage": {
            return `/chat-message/${slugify(link.authorShortName)}-${slugify(link.preview)}${dedupe}`;
        }
        case "Document": {
            return `/document/${slugify(link.title)}${dedupe}`;
        }
        case "DocumentMessage": {
            return `/document-comment/${slugify(link.authorShortName)}-${slugify(link.preview)}${dedupe}`;
        }
        case "Post": {
            return `/post/${slugify(link.title)}${dedupe}`;
        }
        case "PostMessage": {
            return `/post-comment/${slugify(link.authorShortName)}-${slugify(link.preview)}${dedupe}`;
        }
        case "Task": {
            return `/task/${slugify(link.title)}${dedupe}`;
        }
        case "TaskMessage": {
            return `/task-comment/${slugify(link.authorShortName)}-${slugify(link.preview)}${dedupe}`;
        }
        case "TaskCollection": {
            return `/task-collection/${slugify(link.title)}${dedupe}`;
        }
        case "Site": {
            return `/site/${slugify(link.title)}${dedupe}`;
        }
        case "File": {
            return `/file/${slugify(getFileContentTypeNoun(link.contentType))}${dedupe}.${getFileContentTypePreferredExtension(link.contentType)}`;
        }
        default:
            throw exhaustive(link);
    }
}

function slugify(string: string) {
    string = convertToUrlPathnameSlug(string, "-", {limitLength: 50});

    if (string.length === 0) {
        string = "unknown";
    }

    return string;
}

/**
 * Prints a human readable label for a mentionable agent web page link. When a page
 * link is printed to Markdown this is the `label` part in `[label](path)`.
 * `printAgentWebPageStoredLinkPath(page)` prints the `path` part.
 */
export function printAgentWebPageStoredLinkLabel(link: ApiMentionReferenceResponse): string {
    switch (link.type) {
        case "Account":
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "TaskCollection":
        case "Site": {
            return link.title;
        }
        case "Task": {
            // Intentionally not including whether the task is active in this label. Keeping
            // things simple for the agent. The agent can read the task to see whether it's
            // active.
            return `${link.title} ${link.status.type === "Open" ? "(Open)" : "(Closed)"}`;
        }
        default:
            throw exhaustive(link);
    }
}
