import {AgentWebPageKeyObject} from "~/server/agents/web/agent_web_page_key.js";
import {ApiTaskStatus} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {convertToUrlPathnameSlug} from "~/shared/helpers/string/convert_to_url_pathname_slug.js";
import {
    AccountId,
    BotId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

// NOCOMMIT: Pagination???

export type AgentWebPageLink =
    | {
          readonly type: "Account";
          readonly id: AccountId;
          readonly title: string;
          readonly botId?: BotId;
      }
    | {
          readonly type: "Channel";
          readonly id: ChannelId;
          readonly title: string;
      }
    | {
          readonly type: "ChatMessages";
          readonly id: ChatId;
          readonly preview:
              | {
                    readonly type: "Title";
                    readonly title: string;
                }
              | {
                    readonly type: "Message";
                    readonly index: number;
                    readonly authorShortName: string;
                    readonly bodySnippet: string;
                };
      }
    | {
          readonly type: "Document";
          readonly id: DocumentId;
          readonly title: string;
      }
    | {
          readonly type: "DocumentMessages";
          readonly id: DocumentId;
          readonly threadId: DocumentCommentThreadId;
          readonly preview: {
              readonly index: number;
              readonly authorShortName: string;
              readonly bodySnippet: string;
          };
      }
    | {
          readonly type: "PostMessages";
          readonly id: PostId;
          readonly preview:
              | {
                    readonly type: "Title";
                    readonly title: string;
                }
              | {
                    readonly type: "Message";
                    readonly index: number;
                    readonly authorShortName: string;
                    readonly bodySnippet: string;
                };
      }
    | {
          readonly type: "Task";
          readonly id: TaskId;
          readonly title: string;
          readonly status: ApiTaskStatus;
      }
    | {
          readonly type: "TaskMessages";
          readonly id: TaskId;
          readonly preview: {
              readonly index: number;
              readonly authorShortName: string;
              readonly bodySnippet: string;
          };
      }
    | {
          readonly type: "TaskCollection";
          readonly id: TaskCollectionId;
          readonly title: string;
      };

assertAssignableTypes<AgentWebPageLink, AgentWebPageKeyObject>();

/**
 * Prints a human readable path for an agent web page link. When a page link is
 * printed to Markdown this is the `path` part in `[label](path)`.
 * `printAgentWebPageLinkLabel(page)` prints the `label` part.
 *
 * Page paths must be unique. If two pages coincidentally have the same path then
 * we'll increment `dedupeNumber` and try to print a new path until we find a
 * unique path.
 */
export function printAgentWebPageLinkPath(link: AgentWebPageLink, dedupeNumber: number): string {
    const path = actuallyPrintAgentWebPageLinkPath(link, dedupeNumber);

    // Validation in development and tests that we actually use `dedupeNumber` to
    // create a unique path.
    if (process.env.NODE_ENV !== "production") {
        assert(
            path !== actuallyPrintAgentWebPageLinkPath(link, dedupeNumber + 1),
            "Printed agent web page path must include dedupe number",
        );
    }

    return path;
}

function actuallyPrintAgentWebPageLinkPath(link: AgentWebPageLink, dedupeNumber: number): string {
    const dedupe = dedupeNumber > 1 ? `-${dedupeNumber}` : "";

    switch (link.type) {
        case "Account": {
            if (link.botId) {
                return `/bot/${slugify(link.title)}${dedupe}`;
            } else {
                return `/human/${slugify(link.title)}${dedupe}`;
            }
        }
        case "Channel": {
            return `/channel/${slugify(link.title)}${dedupe}`;
        }
        case "ChatMessages": {
            switch (link.preview.type) {
                case "Title": {
                    return `/chat/${slugify(link.preview.title)}${dedupe}`;
                }
                case "Message": {
                    return `/chat/${slugify(link.preview.authorShortName)}-${slugify(link.preview.bodySnippet)}${dedupe}`;
                }
                default:
                    throw exhaustive(link.preview);
            }
        }
        case "Document": {
            return `/document/${slugify(link.title)}${dedupe}`;
        }
        case "DocumentMessages": {
            return `/document-thread/${slugify(link.preview.authorShortName)}-${slugify(link.preview.bodySnippet)}${dedupe}`;
        }
        case "PostMessages": {
            switch (link.preview.type) {
                case "Title": {
                    return `/post/${slugify(link.preview.title)}${dedupe}`;
                }
                case "Message": {
                    return `/post/${slugify(link.preview.authorShortName)}-${slugify(link.preview.bodySnippet)}${dedupe}`;
                }
                default:
                    throw exhaustive(link.preview);
            }
        }
        case "Task": {
            return `/task/${slugify(link.title)}${dedupe}`;
        }
        case "TaskMessages": {
            return `/task-comments/${slugify(link.preview.authorShortName)}-${slugify(link.preview.bodySnippet)}${dedupe}`;
        }
        case "TaskCollection": {
            return `/task-collection/${slugify(link.title)}${dedupe}`;
        }
        default:
            throw exhaustive(link);
    }
}

function slugify(string: string) {
    // Replace ampersands with "and" so `D&D` becomes `d-and-d` instead of `d-d`
    string = string.replaceAll("&", " and ");

    string = string.slice(0, 50);

    string = convertToUrlPathnameSlug(string);

    if (string.length === 0) {
        string = "unknown";
    }

    return string;
}

/**
 * Prints a human readable label for an agent web page link. When a page link is
 * printed to Markdown this is the `label` part in `[label](path)`.
 * `printAgentWebPageLinkPath(page)` prints the `path` part.
 */
export function printAgentWebPageLinkLabel(link: AgentWebPageLink): string {
    switch (link.type) {
        case "Account":
        case "Channel":
        case "Document":
        case "TaskCollection": {
            return link.title;
        }
        case "ChatMessages": {
            switch (link.preview.type) {
                case "Title": {
                    return link.preview.title;
                }
                case "Message": {
                    return `${link.preview.authorShortName}: ${link.preview.bodySnippet}`;
                }
                default:
                    throw exhaustive(link.preview);
            }
        }
        case "DocumentMessages": {
            return `${link.preview.authorShortName}: ${link.preview.bodySnippet}`;
        }
        case "PostMessages": {
            switch (link.preview.type) {
                case "Title": {
                    return link.preview.title;
                }
                case "Message": {
                    return `${link.preview.authorShortName}: ${link.preview.bodySnippet}`;
                }
                default:
                    throw exhaustive(link.preview);
            }
        }
        case "Task": {
            // Intentionally not including whether the task is active in this label. Keeping
            // things simple for the agent. The agent can read the task to see whether it's
            // active.
            return `${link.title} ${link.status.type === "Open" ? "(Open)" : "(Closed)"}`;
        }
        case "TaskMessages": {
            return `${link.preview.authorShortName}: ${link.preview.bodySnippet}`;
        }
        default:
            throw exhaustive(link);
    }
}
