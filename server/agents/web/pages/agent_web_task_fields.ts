import {CalendarDate, parseDate} from "@internationalized/date";
import {Link, ListItem, Node, PhrasingContent, Text} from "mdast";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {curlyQuote} from "~/server/agents/web/internal/curly_quote.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {printApiMentionReferenceToMentionLinkLabel} from "~/shared/api/content/print_api_content_to_markdown.js";
import {
    ApiAccountReferenceResponse,
    ApiTaskCollectionReferenceResponse,
    ApiTaskDue,
    ApiTaskPriority,
    ApiTaskReferenceResponse,
    ApiTaskStatus,
    ApiTaskSubtasks,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

/**
 * The values of the task fields we print to a markdown unordered list (e.g.
 * `- Priority: Medium`). Task fields describe the whole page on a task page and
 * are nested under each task link on a task collection page.
 *
 * Different contexts print and parse different subsets of the fields, so every
 * field is optional. A field that's `undefined` or `null` (or empty for
 * `collections`) isn't printed.
 */
export type AgentWebTaskFields = {
    readonly status?: ApiTaskStatus | null;
    readonly parent?: ApiTaskReferenceResponse | null;
    readonly subtasks?: ApiTaskSubtasks | null;
    readonly assignee?: ApiAccountReferenceResponse | null;
    readonly collections?: ReadonlyArray<ApiTaskCollectionReferenceResponse> | null;
    readonly additionalCollectionsCount?: number | null;
    readonly priority?: ApiTaskPriority | null;
    readonly dueDateString?: string | null;
};

/** The name of a task field in `AgentWebTaskFields`. */
export type AgentWebTaskFieldName = keyof AgentWebTaskFields;

/**
 * Task fields printed with their own label (e.g. `- Priority: Medium`). Every
 * field except `additionalCollectionsCount` which prints inside the "Collections"
 * field value.
 */
type AgentWebTaskFieldNameWithLabel = Exclude<AgentWebTaskFieldName, "additionalCollectionsCount">;

/** The canonical labels we print for each task field. */
const agentWebTaskFieldLabels: {readonly [Name in AgentWebTaskFieldNameWithLabel]: string} = {
    status: "Status",
    parent: "Parent",
    subtasks: "Subtasks",
    assignee: "Assignee",
    collections: "Collections",
    priority: "Priority",
    dueDateString: "Due date",
};

/**
 * Prints task fields as markdown list items (e.g. `- Priority: Medium`) in their
 * canonical order. Fields that aren't set are skipped.
 *
 * The returned list items may be promises so the caller can resolve them
 * concurrently with other printing work.
 */
export function printAgentWebTaskFieldListItems(
    storage: AgentWebSessionStorage,
    fields: AgentWebTaskFields,
): Array<MaybePromise<ListItem>> {
    const listItemPromises: Array<MaybePromise<ListItem>> = [];

    if (fields.status) {
        const {status} = fields;

        listItemPromises.push(
            createAgentWebTaskFieldListItem([
                {
                    type: "text",
                    value: `Status: ${status.type === "Open" ? (status.isActive ? "Open (Active)" : "Open") : "Closed"}`,
                },
            ]),
        );
    }

    if (fields.parent) {
        const {parent} = fields;

        listItemPromises.push(
            (async (): Promise<ListItem> =>
                createAgentWebTaskFieldListItem([
                    {type: "text", value: "Parent: "},
                    {
                        type: "link",
                        url: await createAgentWebPageStoredLinkPathname(storage, parent),
                        children: [
                            {
                                type: "text",
                                value: printApiMentionReferenceToMentionLinkLabel(parent),
                            },
                        ],
                    },
                ]))(),
        );
    }

    if (
        fields.subtasks &&
        (fields.subtasks.openTaskCount > 0 || fields.subtasks.closedTaskCount > 0)
    ) {
        listItemPromises.push(
            createAgentWebTaskFieldListItem([
                {
                    type: "text",
                    value: `Subtasks: ${printAgentWebTaskSubtasksFieldValue(fields.subtasks)}`,
                },
            ]),
        );
    }

    if (fields.assignee) {
        const {assignee} = fields;

        listItemPromises.push(
            (async (): Promise<ListItem> =>
                createAgentWebTaskFieldListItem([
                    {type: "text", value: "Assignee: "},
                    {
                        type: "link",
                        url: await createAgentWebPageStoredLinkPathname(storage, assignee),
                        children: [
                            {
                                type: "text",
                                value: printApiMentionReferenceToMentionLinkLabel(assignee, {
                                    isAccountShortName: true,
                                }),
                            },
                        ],
                    },
                ]))(),
        );
    }

    if (fields.collections && fields.collections.length > 0) {
        const {collections} = fields;

        listItemPromises.push(
            (async (): Promise<ListItem> => {
                const collectionLinks = await runAllPromises(
                    collections.map(
                        async (collection): Promise<Link> => ({
                            type: "link",
                            url: await createAgentWebPageStoredLinkPathname(storage, collection),
                            children: [
                                {
                                    type: "text",
                                    value: printApiMentionReferenceToMentionLinkLabel(collection),
                                },
                            ],
                        }),
                    ),
                );

                const children: Array<PhrasingContent> = [
                    {type: "text", value: "Collections: "},
                    ...interleaveArray(collectionLinks, cast<Text>({type: "text", value: ", "})),
                ];

                if (
                    typeof fields.additionalCollectionsCount === "number" &&
                    fields.additionalCollectionsCount !== 0
                ) {
                    children.push({
                        type: "text",
                        value: `, and ${fields.additionalCollectionsCount} more`,
                    });
                }

                return createAgentWebTaskFieldListItem(children);
            })(),
        );
    }

    if (fields.priority) {
        listItemPromises.push(
            createAgentWebTaskFieldListItem([
                {type: "text", value: `Priority: ${fields.priority.type}`},
            ]),
        );
    }

    if (fields.dueDateString !== null && fields.dueDateString !== undefined) {
        listItemPromises.push(
            createAgentWebTaskFieldListItem([
                {type: "text", value: `Due date: ${fields.dueDateString}`},
            ]),
        );
    }

    return listItemPromises;
}

function createAgentWebTaskFieldListItem(children: Array<PhrasingContent>): ListItem {
    return {
        type: "listItem",
        spread: false,
        children: [{type: "paragraph", children}],
    };
}

/**
 * Formats a task due date into the canonical string we print for the "Due date"
 * task field. Lives here so every page prints due dates in the same format.
 */
export function formatAgentWebTaskDueDateString(
    timeZone: TimeZone,
    contextDate: CalendarDate,
    due: ApiTaskDue,
): string {
    return formatPrettyAbsoluteDateWithoutFullTimeTooltip(
        defaultLocale,
        timeZone,
        contextDate,
        parseDate(due.date).toDate(timeZone),
        {withoutTime: true, withLongMonth: true},
    );
}

/** Formats the counts printed in a task's read-only "Subtasks" field. */
export function printAgentWebTaskSubtasksFieldValue(subtasks: ApiTaskSubtasks): string {
    const counts: Array<string> = [];

    if (subtasks.openTaskCount > 0) counts.push(`${subtasks.openTaskCount} open`);
    if (subtasks.closedTaskCount > 0) counts.push(`${subtasks.closedTaskCount} closed`);

    return counts.join(", ");
}

/**
 * Parses task fields from the items of a markdown unordered list. Fields may
 * appear in any order but each field may only appear once.
 *
 * Only the `fieldNames` supported by the calling context are accepted. Any other
 * field label is rejected with an error suggesting the supported fields in the
 * order they were provided. Include `additionalCollectionsCount` in `fieldNames`
 * to also accept an "and n more" count at the end of the "Collections" field
 * value.
 */
export async function parseAgentWebTaskFieldListItems(
    storage: AgentWebSessionStorage,
    listItems: ReadonlyArray<ListItem>,
    fieldNames: ReadonlyArray<AgentWebTaskFieldName>,
): Promise<AgentWebTaskFields> {
    const allowedFieldNames = new Set(fieldNames);
    const seenFields = new Set<string>();

    let status: ApiTaskStatus | null = null;
    let parentPromise: Promise<ApiTaskReferenceResponse | null> | null = null;
    let subtasks: ApiTaskSubtasks = {openTaskCount: 0, closedTaskCount: 0};
    let assigneePromise: Promise<ApiAccountReferenceResponse | null> | null = null;
    let collectionsPromise: Promise<{
        collections: ReadonlyArray<ApiTaskCollectionReferenceResponse>;
        additionalCount: number;
    }> | null = null;
    let priority: ApiTaskPriority | null = null;
    let dueDateString: string | null = null;

    for (const item of listItems) {
        const {label, value, remaining} = parseAgentWebTaskField(item);

        let labelKey = normalizeAgentWebStaticText(label);
        if (labelKey === "due-date") labelKey = "due";

        if (seenFields.has(labelKey)) {
            throw new InvalidArgumentError("Duplicate task field", {
                displayMessage: errorDisplayMessage`Duplicate task field ${curlyQuote(label)} on line ${item.position?.start.line ?? "unknown"}. Try again with each task field only present once in the field list.`,
            });
        }

        seenFields.add(labelKey);

        const fieldName = parseAgentWebTaskFieldName(labelKey);

        if (fieldName === null || !allowedFieldNames.has(fieldName)) {
            throw new InvalidArgumentError("Unknown task field", {
                displayMessage: errorDisplayMessage`Unknown task field ${curlyQuote(label)} on line ${item.position?.start.line ?? "unknown"}. Try again with one of ${printAgentWebTaskFieldLabelList(fieldNames)}.`,
            });
        }

        // All fields, except collections, should only have a single paragraph and
        // shouldn't have any other markdown in the list item after that.
        //
        // NOCOMMIT: Test this error for all field types!
        if (remaining.length > 0 && fieldName !== "collections") {
            throw new InvalidArgumentError("Unexpected markdown nested in task field", {
                displayMessage: errorDisplayMessage`Unexpected markdown after task field ${curlyQuote(label)} on line ${remaining[0]!.position?.start.line ?? item.position?.start.line ?? "unknown"}. Try again with an unordered list item for each task field where the field name is followed by the field value with a colon in between (e.g. \`- Priority: Medium\`).`,
            });
        }

        switch (fieldName) {
            case "status": {
                status = parseAgentWebTaskStatusField(item.position, value);
                break;
            }
            case "parent": {
                parentPromise = parseAgentWebTaskParentField(storage, item.position, value);
                break;
            }
            case "subtasks": {
                subtasks = parseAgentWebTaskSubtasksField(item.position, value);
                break;
            }
            case "assignee": {
                assigneePromise = parseAgentWebTaskAssigneeField(storage, item.position, value);
                break;
            }
            case "collections": {
                collectionsPromise = parseAgentWebTaskCollectionsField(storage, {
                    itemPosition: item.position,
                    value,
                    remaining,
                    allowAdditionalCount: allowedFieldNames.has("additionalCollectionsCount"),
                });
                break;
            }
            case "priority": {
                priority = parseAgentWebTaskPriorityField(item.position, value);
                break;
            }
            case "dueDateString": {
                dueDateString = parseAgentWebTaskDueDateField(value);
                break;
            }
            default:
                throw exhaustive(fieldName);
        }
    }

    const [parent, assignee, collectionsResult] = await runAllPromises([
        parentPromise,
        assigneePromise,
        collectionsPromise,
    ]);

    return {
        status,
        parent,
        subtasks,
        assignee,
        collections: collectionsResult?.collections ?? [],
        additionalCollectionsCount: collectionsResult?.additionalCount ?? 0,
        priority,
        dueDateString,
    };
}

function parseAgentWebTaskFieldName(labelKey: string): AgentWebTaskFieldNameWithLabel | null {
    // The cases here are the field labels after `normalizeAgentWebStaticText()` which
    // stems each word (e.g. "Statuses", "statuses", and "status" all become "statu").
    switch (labelKey) {
        case "statu":
            return "status";
        case "parent":
            return "parent";
        case "subtask":
            return "subtasks";
        case "assigne":
            return "assignee";
        case "collect":
            return "collections";
        case "prioriti":
            return "priority";
        case "due":
            return "dueDateString";
        default:
            return null;
    }
}

function parseAgentWebTaskSubtasksField(
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): ApiTaskSubtasks {
    const text = printMarkdownPhrasingContentText(value).trim();
    const match = text.match(/^(?:(\d+) open(?:, (\d+) closed)?|(\d+) closed)$/i);

    if (match) {
        return {
            openTaskCount: Number(match[1] ?? 0),
            closedTaskCount: Number(match[2] ?? match[3] ?? 0),
        };
    }

    const quotedValue = curlyQuote(value);

    throw new InvalidArgumentError("Invalid task subtasks", {
        displayMessage: errorDisplayMessage`Unexpected task subtask counts ${quotedValue} on line ${value[0]?.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with open and closed task counts (e.g. \u201C3 open, 4 closed\u201D, \u201C3 open\u201D, or \u201C4 closed\u201D).`,
    });
}

function printAgentWebTaskFieldLabelList(fieldNames: ReadonlyArray<AgentWebTaskFieldName>): string {
    const labels = fieldNames
        .filter(
            (fieldName): fieldName is AgentWebTaskFieldNameWithLabel =>
                fieldName !== "additionalCollectionsCount",
        )
        .map(fieldName => `\u201C${agentWebTaskFieldLabels[fieldName]}\u201D`);

    if (labels.length === 1) return labels[0]!;
    if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;

    return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}

function parseAgentWebTaskField(item: ListItem) {
    const firstChild = item.children[0];

    const createError = () => {
        return new InvalidArgumentError("Invalid task fields", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${firstChild?.position?.start.line ?? item.position?.start.line ?? "unknown"}. Try again with an unordered list item for each task field where the field name is followed by the field value with a colon in between (e.g. \`- Priority: Medium\`).`,
        });
    };

    if (firstChild?.type !== "paragraph") throw createError();

    const firstParagraphChild = firstChild.children[0];
    if (firstParagraphChild?.type !== "text") throw createError();

    const match = firstParagraphChild.value.match(/^([A-Za-z ]*):[ \t]*/);
    if (!match) throw createError();

    const label = match[1]!;

    const rest = firstParagraphChild.value.slice(match[0].length);
    const value: Array<PhrasingContent> = [];

    if (rest.length > 0) value.push({type: "text", value: rest});
    for (const child of firstChild.children.slice(1)) value.push(child);

    return {label, value, remaining: item.children.slice(1)};
}

function parseAgentWebTaskStatusField(
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): ApiTaskStatus {
    switch (printMarkdownPhrasingContentText(value).trim().toLowerCase()) {
        case "open":
        case "open (inactive)":
            return {type: "Open", isActive: false};
        case "open (active)":
            return {type: "Open", isActive: true};
        case "closed":
            return {type: "Closed"};
        default: {
            const quotedValue = curlyQuote(value);

            throw new InvalidArgumentError("Invalid task status", {
                displayMessage: errorDisplayMessage`Unexpected task status ${quotedValue} on line ${value[0]?.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with \u201COpen\u201D, \u201COpen (Active)\u201D, or \u201CClosed\u201D.`,
            });
        }
    }
}

async function parseAgentWebTaskParentField(
    storage: AgentWebSessionStorage,
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): Promise<ApiTaskReferenceResponse | null> {
    const createError = (position: Node["position"]) => {
        const quotedValue = curlyQuote(value);

        return new InvalidArgumentError("Invalid task fields", {
            displayMessage: errorDisplayMessage`Unexpected task parent link ${quotedValue} on line ${position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a link to a task you\u2019ve seen before (e.g. \`[My Task](/task/my-task)\`).`,
        });
    };

    let link: Link | null = null;

    for (const child of value) {
        // NOCOMMIT: test that if there's a second link we should throw
        if (child.type === "link" && link === null) {
            link = child;
            continue;
        }

        if (child.type === "text" && child.value.trim().length === 0) {
            continue;
        }

        throw createError(child.position);
    }

    if (link === null) return null;

    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Task") {
        throw createError(link.position);
    }

    return pageLinkResult.pageLink;
}

async function parseAgentWebTaskAssigneeField(
    storage: AgentWebSessionStorage,
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): Promise<ApiAccountReferenceResponse | null> {
    const createError = (position: Node["position"]) => {
        const quotedValue = curlyQuote(value);

        return new InvalidArgumentError("Invalid task fields", {
            displayMessage: errorDisplayMessage`Unexpected task assignee link ${quotedValue} on line ${position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a link to a human or bot you\u2019ve seen before (e.g. \`[John](/human/john-doe)\`).`,
        });
    };

    let link: Link | null = null;

    for (const child of value) {
        // NOCOMMIT: if there's a second link we should throw
        if (child.type === "link" && link === null) {
            link = child;
            continue;
        }

        if (child.type === "text" && child.value.trim().length === 0) {
            continue;
        }

        throw createError(child.position);
    }

    if (link === null) return null;

    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Account") {
        throw createError(link.position);
    }

    return pageLinkResult.pageLink;
}

async function parseAgentWebTaskCollectionsField(
    storage: AgentWebSessionStorage,
    {
        itemPosition,
        value,
        remaining,
        allowAdditionalCount,
    }: {
        itemPosition: Node["position"];
        value: ReadonlyArray<PhrasingContent>;
        remaining: ReadonlyArray<ListItem["children"][number]>;
        allowAdditionalCount: boolean;
    },
): Promise<{
    collections: ReadonlyArray<ApiTaskCollectionReferenceResponse>;
    additionalCount: number;
}> {
    // The collections list may end with an "and n more" count summarizing collections
    // that aren't shown (e.g.
    // `- Collections: [My Collection](/task-collection/my-collection), and 2 more`).
    // Only contexts that print a truncated collections list accept the count.
    let additionalCount = 0;
    let additionalCountLine: number | "unknown" = "unknown";
    let valueNodes: ReadonlyArray<PhrasingContent> = value;

    const lastValueNode = value[value.length - 1];

    if (lastValueNode?.type === "text") {
        const additionalCountMatch = lastValueNode.value.match(
            /(?:^|[\s,])and\s+(\d+)\s+more\s*$/i,
        );

        if (additionalCountMatch) {
            additionalCount = parseInt(additionalCountMatch[1]!, 10);
            additionalCountLine =
                lastValueNode.position?.start.line ?? itemPosition?.start.line ?? "unknown";

            if (!allowAdditionalCount) {
                throw new InvalidArgumentError(
                    "Task collections \u201Cand n more\u201D count isn\u2019t supported here",
                    {
                        displayMessage: errorDisplayMessage`Can\u2019t use ${curlyQuote(`and ${additionalCount} more`)} in the \u201CCollections\u201D task field on line ${additionalCountLine} since we wouldn\u2019t know which collections those are. Try again with a link to every collection (e.g. \`- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)\`).`,
                    },
                );
            }

            const lastValueNodeRest = lastValueNode.value.slice(0, additionalCountMatch.index);

            valueNodes =
                lastValueNodeRest.length > 0
                    ? [...value.slice(0, -1), {...lastValueNode, value: lastValueNodeRest}]
                    : value.slice(0, -1);
        }
    }

    const collectionLinks: Array<Link> = [];
    let hasInlineListSyntax = false;

    for (const node of valueNodes) {
        switch (node.type) {
            case "link": {
                hasInlineListSyntax = true;
                collectionLinks.push(node);
                break;
            }

            case "text": {
                if (node.value.trim().length > 0) {
                    hasInlineListSyntax = true;
                }

                if (
                    node.value
                        .replace(/,/g, "")
                        .replace(/\band\b/gi, "")
                        .trim().length === 0
                ) {
                    break;
                }

                // Intentional fallthrough to `default` branch...
            }

            default: {
                throw new InvalidArgumentError("Invalid task collections field", {
                    displayMessage: errorDisplayMessage`Unexpected markdown for task collections field on line ${node.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a comma separated list of collection links (e.g. \`- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)\`).`,
                });
            }
        }
    }

    // If there were just inline collections, great! Otherwise we'll try to parse a
    // nested collection list.
    if (remaining.length > 0) {
        const nestedList = remaining[0];

        if (
            hasInlineListSyntax ||
            collectionLinks.length > 0 ||
            remaining.length !== 1 ||
            nestedList!.type !== "list" ||
            nestedList.ordered
        ) {
            throw new InvalidArgumentError("Invalid task collections field", {
                displayMessage: errorDisplayMessage`Unexpected markdown after task collection list on line ${remaining[0]?.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a comma separated list of collection links and nothing else after that (e.g. \`- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)\`).`,
            });
        }

        for (const nestedItem of nestedList.children) {
            const createError = () => {
                throw new InvalidArgumentError("Invalid task collections field", {
                    displayMessage: errorDisplayMessage`Unexpected markdown in task collection list item on line ${nestedItem.position?.start.line ?? "unknown"}. Try again with a single collection link (e.g. \`[My Collection](/task-collection/my-collection)\`) in each nested list item.`,
                });
            };

            const paragraph = nestedItem.children[0];

            if (nestedItem.children.length !== 1 || paragraph?.type !== "paragraph") {
                throw createError();
            }

            let link: Link | null = null;

            for (const child of paragraph.children) {
                if (child.type === "link" && link === null) {
                    link = child;
                    continue;
                }

                if (child.type === "text" && child.value.trim().length === 0) {
                    continue;
                }

                throw createError();
            }

            if (link === null) {
                throw createError();
            }

            collectionLinks.push(link);
        }
    }

    // An "and n more" count with no collection links at all is probably a mistake, so
    // we reject it instead of silently dropping the count.
    if (additionalCount > 0 && collectionLinks.length === 0) {
        throw new InvalidArgumentError(
            "Task collections field only has an \u201cand n more\u201d count",
            {
                displayMessage: errorDisplayMessage`Unexpected \u201cand ${additionalCount} more\u201d without any collection links on line ${additionalCountLine}. Try again with a comma separated list of collection links before the \u201cand ${additionalCount} more\u201d count (e.g. \`- Collections: [My Collection](/task-collection/my-collection), and 2 more\`).`,
            },
        );
    }

    const collections = await runAllPromises(
        collectionLinks.map(async link => {
            const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);

            if (!pageLinkResult || pageLinkResult.pageLink.type !== "TaskCollection") {
                const quotedValue = curlyQuote([link]);

                throw new InvalidArgumentError("Invalid task fields", {
                    displayMessage: errorDisplayMessage`Unexpected task collection link ${quotedValue} on line ${link.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a link to a task collection you\u2019ve seen before (e.g. \`[My Collection](/task-collection/my-collection)\`).`,
                });
            }

            return pageLinkResult.pageLink;
        }),
    );

    return {collections, additionalCount};
}

function parseAgentWebTaskPriorityField(
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): ApiTaskPriority | null {
    switch (printMarkdownPhrasingContentText(value).trim().toLowerCase()) {
        case "":
            return null;
        case "low":
            return {type: "Low"};
        case "medium":
            return {type: "Medium"};
        case "high":
            return {type: "High"};
        case "urgent":
            return {type: "Urgent"};
        default: {
            const quotedValue = curlyQuote(value);

            throw new InvalidArgumentError("Invalid task priority", {
                // We intentionally don't include "Urgent" in the list of valid priorities here.
                // "Urgent" is a secret priority we'll mention in skills. Very few tasks should
                // have an "Urgent" priority as urgent tasks will constantly notify the owner that
                // the task is still open.
                displayMessage: errorDisplayMessage`Unexpected task priority ${quotedValue} on line ${value[0]?.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with \u201CLow\u201D, \u201CMedium\u201D, or \u201CHigh\u201D.`,
            });
        }
    }
}

function parseAgentWebTaskDueDateField(value: ReadonlyArray<PhrasingContent>): string | null {
    const dateString = printMarkdownPhrasingContentText(value).trim();
    if (dateString.length === 0) return null;
    return dateString;
}
