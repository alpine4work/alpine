/* eslint-disable cyberworlds/string-quotes */
/* eslint-disable no-console */

import {AlertSource} from "~/admin/lambda/send_alert/internal/alert_source.js";
import {
    AlertSourceAuthorizationResult,
    SendAlertResult,
} from "~/admin/lambda/send_alert/internal/alert_source_types.js";
import {createHeaderElements} from "~/admin/lambda/send_alert/internal/create_header_elements.js";
import {createUserElement} from "~/admin/lambda/send_alert/internal/create_user_element.js";
import {
    HoneycombEventPayload,
    HoneycombResultGroup,
    HoneycombTaskPayload,
} from "~/admin/lambda/send_alert/internal/honeycomb_alert_source_types.js";
import {
    SendAlertAvailableChannel,
    sendAlertAvailableChannels,
} from "~/admin/lambda/send_alert/internal/send_alert_available_channels.js";
import {
    SendAlertAvailableTaskCollection,
    sendAlertAvailableTaskCollections,
} from "~/admin/lambda/send_alert/internal/send_alert_available_task_collections.js";
import {nameToAlpineId} from "~/admin/lambda/send_alert/internal/send_alert_user_mappings.js";
import {
    ApiContent,
    ApiGetMessageResponse,
    ApiGetTaskWithNotesResponse,
    ApiPatchTaskResponse,
    ApiTaskPriority,
    ApiTaskResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import type {TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";

type ApiContentElement = ApiContent["elements"][number];
type HoneycombPayloadType = NonNullable<HoneycombEventPayload["type"]>;
type ApiGetTaskCollectionResponse =
    ApiSpecification.paths["/task-collections/{id}"]["get"]["responses"]["200"]["content"]["application/json"];
type ApiTaskCollectionTasksResponse =
    ApiSpecification.paths["/task-collections/{id}/tasks"]["get"]["responses"]["200"]["content"]["application/json"];
type ApiCreateTaskRequestBody =
    ApiSpecification.paths["/tasks"]["post"]["requestBody"]["content"]["application/json"];
type ApiUpdateTaskRequestBody =
    ApiSpecification.paths["/tasks/{id}"]["patch"]["requestBody"]["content"]["application/json"];
type ApiCreateTaskMessageRequestBody =
    ApiSpecification.components["requestBodies"]["CreateMessage"]["content"]["application/json"];
type ApiGetTaskMessagesResponse =
    ApiSpecification.paths["/tasks/{id}/messages"]["get"]["responses"]["200"]["content"]["application/json"];
type ApiTaskPriorityType = ApiTaskPriority["type"];
type SendAlertErrorResult = Extract<SendAlertResult, {ok: false}>;

// Keep in sync with `taskTitleMaxLength` from `shared/tasks/title/task_title.ts`.
// Importing that module would pull the ProseMirror title model into this Lambda.
const honeycombTaskTitleMaxLength = 512;
const honeycombTaskOccurrenceCommentPrefix = "This happened again";
const honeycombTaskPriorityByCurrentPriority = new Map<ApiTaskPriorityType, ApiTaskPriorityType>([
    ["Low", "Medium"],
    ["Medium", "High"],
    ["High", "Urgent"],
    ["Urgent", "Urgent"],
]);
const honeycombTaskPriorityByPayloadPriority = new Map<string, ApiTaskPriorityType>([
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
    ["urgent", "Urgent"],
]);

export class HoneycombAlertSource extends AlertSource {
    override validateAuthorization(): AlertSourceAuthorizationResult {
        const honeycombWebhookSecret = process.env.HONEYCOMB_WEBHOOK_SECRET;
        if (!honeycombWebhookSecret) {
            return {
                ok: false,
                statusCode: 500,
                error: "HONEYCOMB_WEBHOOK_SECRET environment variable is not set",
            };
        }

        if (this.request.headers["x-honeycomb-webhook-token"] !== honeycombWebhookSecret) {
            return {
                ok: false,
                statusCode: 401,
                error: "Invalid token",
            };
        }

        return {ok: true};
    }

    override async handlePayload(payload: unknown): Promise<SendAlertResult> {
        const data = payload as HoneycombEventPayload;
        const payloadType = getHoneycombPayloadType(data);
        if (!payloadType.ok) {
            return payloadType;
        }

        console.log("Received Honeycomb event");
        console.debug(JSON.stringify(data, null, 2));

        const status = data.alert.status.toLowerCase();

        if (payloadType.type === "task") {
            if (status === "ok") {
                console.debug("Ignoring resolved Honeycomb task alert with status 'ok'");
                return {ok: true};
            }

            return await this.handleTaskPayload(data as HoneycombTaskPayload);
        }

        return await this.handleChannelPayload(data, payloadType.type, status);
    }

    private async handleChannelPayload(
        data: HoneycombEventPayload,
        payloadType: Exclude<HoneycombPayloadType, "task">,
        status: string,
    ): Promise<SendAlertResult> {
        const channel: SendAlertAvailableChannel =
            data.channel && data.channel in sendAlertAvailableChannels
                ? (data.channel as SendAlertAvailableChannel)
                : "honeycomb";

        const statusEmojiMap = {
            triggered: "🚨",
            ok: "✅",
        };

        if (status === "ok" && payloadType === "event") {
            console.debug("Ignoring Honeycomb event alert with status 'ok'");
            return {ok: true};
        }

        let emoji = "ℹ️";
        if (payloadType === "event") {
            if (data.emoji?.trim().length) {
                emoji = data.emoji.trim();
            }
        } else if (status in statusEmojiMap) {
            emoji = statusEmojiMap[status as keyof typeof statusEmojiMap];
        }

        const header = `${emoji} ${payloadType === "event" ? "Event" : "Trigger"}: ${data.name}`;
        const elements: Array<ApiContentElement> = createHeaderElements(header, [
            {label: "View Result", url: data.links.result},
        ]);

        if (data.description) {
            elements.push({
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: data.description,
                        marks: [
                            {
                                type: "Italic",
                            },
                        ],
                    },
                ],
            });
        }

        if (status === "ok") {
            elements.push({
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "Measurement has returned to normal status.",
                        marks: [
                            {
                                type: "Bold",
                            },
                        ],
                    },
                ],
            });
        }

        if (data.environment !== "production") {
            elements.push({
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: "Environment: ",
                    },
                    {
                        type: "Text",
                        text: data.environment,
                    },
                ],
            });
        }

        if (status !== "ok") {
            addTriggeredGroupsToElements(data, elements);
        }

        return await this.postAlertToAlpine(channel, {elements});
    }

    private async handleTaskPayload(data: HoneycombTaskPayload): Promise<SendAlertResult> {
        const previewChannel = getTaskPreviewChannel(data);
        if (!previewChannel.ok) {
            return previewChannel;
        }

        const collectionName = data.collection;
        if (!collectionName || !(collectionName in sendAlertAvailableTaskCollections)) {
            return {
                ok: false,
                statusCode: 400,
                error: `Unknown Honeycomb task collection: ${collectionName ?? ""}`,
            };
        }

        const collectionId =
            sendAlertAvailableTaskCollections[collectionName as SendAlertAvailableTaskCollection];
        if (!collectionId) {
            return {
                ok: false,
                statusCode: 500,
                error: `Task collection '${collectionName}' is not configured`,
            };
        }

        const collection = await this.fetchAlpineApi<ApiGetTaskCollectionResponse>(
            `/task-collections/${collectionId}`,
            {
                method: "GET",
            },
        );
        if (!collection.ok) {
            return collection;
        }

        const openTasks = await this.listOpenTasks(collectionId);
        if (!openTasks.ok) {
            return openTasks;
        }

        const openTasksByTitle = new Map(openTasks.tasks.map(task => [task.title, task]));
        const occurrencesByTitle = getTaskOccurrencesByTitle(data);

        for (const occurrence of occurrencesByTitle.values()) {
            const existingTask = openTasksByTitle.get(occurrence.title);
            if (existingTask) {
                const comment = await this.createTaskOccurrenceComment(
                    existingTask,
                    occurrence.count,
                    data.links.result,
                    occurrence.row,
                );
                if (!comment.ok) {
                    return comment;
                }

                const priority = await this.updateTaskPriorityIfNeeded(existingTask, data);
                if (!priority.ok) {
                    return priority;
                }
                if (priority.updatedPriority && previewChannel.channel) {
                    const priorityPreview = await this.postTaskPriorityBumpToChannel(
                        previewChannel.channel,
                        existingTask,
                        priority.updatedPriority,
                        data,
                    );
                    if (!priorityPreview.ok) {
                        return priorityPreview;
                    }
                }
                continue;
            }

            const task = await this.createTask(
                collection.value.spaceId,
                collectionId,
                occurrence.title,
                createHoneycombTaskContent(data, occurrence.row),
                getHoneycombTaskInitialPriority(data.priority),
            );
            if (!task.ok) {
                return task;
            }

            openTasksByTitle.set(occurrence.title, task.task);

            if (previewChannel.channel) {
                const previewResult = await this.postTaskPreviewToChannel(
                    previewChannel.channel,
                    task.task,
                    data,
                );
                if (!previewResult.ok) {
                    return previewResult;
                }
            }
        }

        return {ok: true};
    }

    private async listOpenTasks(collectionId: TaskCollectionId): Promise<
        | {
              ok: true;
              tasks: Array<ApiTaskResponse>;
          }
        | SendAlertErrorResult
    > {
        const tasks: Array<ApiTaskResponse> = [];
        let cursor: ApiTaskCollectionTasksResponse["nextCursor"] = null;

        do {
            const searchParams = new URLSearchParams({
                limit: "100",
                status: "Open",
            });
            if (cursor) {
                searchParams.set("cursor", cursor);
            }

            const result = await this.fetchAlpineApi<ApiTaskCollectionTasksResponse>(
                `/task-collections/${collectionId}/tasks?${searchParams.toString()}`,
                {
                    method: "GET",
                },
            );
            if (!result.ok) {
                return result;
            }

            tasks.push(...result.value.tasks.map(({task}) => task));
            cursor = result.value.nextCursor;
        } while (cursor);

        return {ok: true, tasks};
    }

    private async createTask(
        spaceId: ApiGetTaskCollectionResponse["spaceId"],
        collectionId: TaskCollectionId,
        title: string,
        content: ApiContent,
        priority: ApiTaskPriority,
    ): Promise<{ok: true; task: ApiTaskResponse} | SendAlertErrorResult> {
        const body = {
            spaceId,
            task: {
                title,
                notes: {content},
                priority,
            },
        } satisfies ApiCreateTaskRequestBody;

        console.log(`Creating Honeycomb task: ${title}`);
        const createResult = await this.fetchAlpineApi<ApiGetTaskWithNotesResponse>("/tasks", {
            method: "POST",
            body,
        });
        if (!createResult.ok) {
            return createResult;
        }

        const patchBody = {
            patches: [
                {
                    type: "AddCollection",
                    item: {collection: {id: collectionId}},
                },
            ],
        } satisfies ApiUpdateTaskRequestBody;
        const patchResult = await this.fetchAlpineApi<ApiPatchTaskResponse>(
            `/tasks/${createResult.value.task.id}`,
            {
                method: "PATCH",
                body: patchBody,
            },
        );
        if (!patchResult.ok) {
            return patchResult;
        }

        return {ok: true, task: patchResult.value.task};
    }

    private async updateTaskPriorityIfNeeded(
        task: ApiTaskResponse,
        data: HoneycombTaskPayload,
    ): Promise<{ok: true; updatedPriority: ApiTaskPriority | null} | SendAlertErrorResult> {
        const occurrenceCommentCount = await this.countTaskOccurrenceComments(task.id);
        if (!occurrenceCommentCount.ok) {
            return occurrenceCommentCount;
        }

        const currentPriority = task.priority ?? {type: "Low"};
        const recurrencePriority =
            occurrenceCommentCount.count > 0 && occurrenceCommentCount.count % 5 === 0
                ? {
                      type:
                          honeycombTaskPriorityByCurrentPriority.get(currentPriority.type) ??
                          currentPriority.type,
                  }
                : currentPriority;
        const payloadPriority = getHoneycombTaskInitialPriority(data.priority);
        const nextPriority = getHigherHoneycombTaskPriority(recurrencePriority, payloadPriority);
        if (nextPriority.type === currentPriority.type) {
            return {ok: true, updatedPriority: null};
        }

        console.log(`Updating Honeycomb task priority: ${task.title} (${nextPriority.type})`);
        const result = await this.fetchAlpineApi<ApiPatchTaskResponse>(`/tasks/${task.id}`, {
            method: "PATCH",
            body: {
                patches: [
                    {
                        type: "SetPriority",
                        priority: nextPriority,
                    },
                ],
            } satisfies ApiUpdateTaskRequestBody,
        });
        if (!result.ok) {
            return result;
        }

        return {ok: true, updatedPriority: nextPriority};
    }

    private async countTaskOccurrenceComments(
        taskId: ApiTaskResponse["id"],
    ): Promise<{ok: true; count: number} | SendAlertErrorResult> {
        let cursor: number | null = null;
        let count = 0;

        do {
            const searchParams = new URLSearchParams({limit: "100"});
            if (cursor !== null) {
                searchParams.set("cursor", cursor.toString());
            }

            const result = await this.fetchAlpineApi<ApiGetTaskMessagesResponse>(
                `/tasks/${taskId}/messages?${searchParams.toString()}`,
                {
                    method: "GET",
                },
            );
            if (!result.ok) {
                return result;
            }

            for (const message of result.value.messages) {
                if (
                    message.payload.type === "Content" &&
                    contentStartsWith(message.payload.content, honeycombTaskOccurrenceCommentPrefix)
                ) {
                    count += 1;
                }
            }

            cursor = result.value.nextCursor;
        } while (cursor !== null);

        return {ok: true, count};
    }

    private async postTaskPreviewToChannel(
        channel: SendAlertAvailableChannel,
        task: ApiTaskResponse,
        data: HoneycombTaskPayload,
    ): Promise<SendAlertResult> {
        return await this.postAlertToAlpine(channel, {
            elements: [
                ...createHoneycombTaskChannelHeaderElements(
                    data,
                    getHoneycombTaskPriorityIcon(getHoneycombTaskInitialPriority(data.priority)),
                ),
                {
                    type: "Preview",
                    reference: {
                        type: "Task",
                        id: task.id,
                        title: task.title,
                    },
                },
            ],
        });
    }

    private async postTaskPriorityBumpToChannel(
        channel: SendAlertAvailableChannel,
        task: ApiTaskResponse,
        priority: ApiTaskPriority,
        data: HoneycombTaskPayload,
    ): Promise<SendAlertResult> {
        return await this.postAlertToAlpine(channel, {
            elements: [
                ...createHoneycombTaskChannelHeaderElements(
                    data,
                    getHoneycombTaskPriorityIcon(priority),
                ),
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "Bumped priority to ",
                        },
                        {
                            type: "Text",
                            text: priority.type,
                            marks: [{type: "Bold"}],
                        },
                    ],
                },
                {
                    type: "Preview",
                    reference: {
                        type: "Task",
                        id: task.id,
                        title: task.title,
                    },
                },
            ],
        });
    }

    private async createTaskOccurrenceComment(
        task: ApiTaskResponse,
        count: number,
        resultUrl: string,
        row: HoneycombResultGroup,
    ): Promise<SendAlertResult> {
        const body = {
            content: {
                elements: [
                    {
                        type: "Heading",
                        level: 3,
                        elements: [
                            {
                                type: "Text",
                                text: "This happened again ",
                            },
                            {
                                type: "Text",
                                text: `${count} ${count === 1 ? "time" : "times"}`,
                                marks: [
                                    {
                                        type: "Link",
                                        url: resultUrl,
                                    },
                                ],
                            },
                        ],
                    },
                    ...createHoneycombResultGroupFieldElements(row),
                ],
            },
        } satisfies ApiCreateTaskMessageRequestBody;

        console.log(`Commenting on existing Honeycomb task: ${task.title}`);
        const result = await this.fetchAlpineApi<ApiGetMessageResponse>(
            `/tasks/${task.id}/messages`,
            {
                method: "POST",
                body,
            },
        );
        if (!result.ok) {
            return result;
        }

        return {ok: true};
    }
}

function getHoneycombPayloadType(
    data: HoneycombEventPayload,
): {ok: true; type: HoneycombPayloadType} | SendAlertErrorResult {
    switch (data.type) {
        case "trigger":
        case "event":
        case "task":
            return {ok: true, type: data.type};
        case undefined:
            return {ok: true, type: getLegacyHoneycombPayloadType(data)};
        default:
            return {
                ok: false,
                statusCode: 400,
                error: `Unknown Honeycomb payload type: ${
                    (data as {readonly type?: unknown}).type as string
                }`,
            };
    }
}

function getLegacyHoneycombPayloadType(data: HoneycombEventPayload): "trigger" | "event" {
    const isEvent = data.isEvent?.toLowerCase() === "true" || data.isEvent === "1";
    return isEvent ? "event" : "trigger";
}

function getHoneycombTaskInitialPriority(priority: string | undefined): ApiTaskPriority {
    return {
        type:
            honeycombTaskPriorityByPayloadPriority.get(priority?.trim().toLowerCase() ?? "") ??
            "Low",
    };
}

function getHoneycombTaskPriorityIcon(priority: ApiTaskPriority): string {
    if (isHoneycombTaskAlertPriority(priority)) {
        return "🚨";
    }

    return "⚠️";
}

function getHigherHoneycombTaskPriority(
    priorityA: ApiTaskPriority,
    priorityB: ApiTaskPriority,
): ApiTaskPriority {
    return getHoneycombTaskPriorityRank(priorityA) >= getHoneycombTaskPriorityRank(priorityB)
        ? priorityA
        : priorityB;
}

function getHoneycombTaskPriorityRank(priority: ApiTaskPriority): number {
    const priorityType = priority.type;

    switch (priorityType) {
        case "Low":
            return 0;
        case "Medium":
            return 1;
        case "High":
            return 2;
        case "Urgent":
            return 3;
        default:
            throw exhaustive(priorityType);
    }
}

function isHoneycombTaskAlertPriority(priority: ApiTaskPriority): boolean {
    const priorityType = priority.type;

    switch (priorityType) {
        case "Low":
        case "Medium":
            return false;
        case "High":
        case "Urgent":
            return true;
        default:
            throw exhaustive(priorityType);
    }
}

function createHoneycombTaskChannelHeaderElements(
    data: HoneycombTaskPayload,
    icon: string,
): Array<ApiContentElement> {
    return createHeaderElements(`${icon} ${data.name}`, [
        {label: "View Result", url: data.links.result},
    ]);
}

function contentStartsWith(content: {readonly elements: ReadonlyArray<unknown>}, prefix: string) {
    return getFirstTextFromElements(content.elements).startsWith(prefix);
}

function getFirstTextFromElements(elements: ReadonlyArray<unknown>): string {
    for (const element of elements) {
        if (!isObjectRecord(element)) {
            continue;
        }

        if (element.type === "Text" && typeof element.text === "string") {
            return element.text;
        }

        if (Array.isArray(element.elements)) {
            const text = getFirstTextFromElements(element.elements);
            if (text.length > 0) {
                return text;
            }
        }
    }

    return "";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getTaskPreviewChannel(
    data: HoneycombEventPayload,
): {ok: true; channel: SendAlertAvailableChannel | null} | SendAlertErrorResult {
    if (!data.channel) {
        return {ok: true, channel: null};
    }

    if (data.channel in sendAlertAvailableChannels) {
        return {ok: true, channel: data.channel as SendAlertAvailableChannel};
    }

    return {
        ok: false,
        statusCode: 400,
        error: `Unknown Honeycomb task preview channel: ${data.channel}`,
    };
}

function addTriggeredGroupsToElements(
    data: HoneycombEventPayload,
    elements: Array<ApiContentElement>,
): void {
    const groupsTriggered = data.groupsTriggered;

    if (!groupsTriggered || groupsTriggered.length === 0) {
        return;
    }

    const allColumnKeys = groupsTriggered[0]!.group.map(col => col.key);
    const hasUserColumn = allColumnKeys.includes("context.known_account.name");

    const userNames = new Set<string>();
    if (hasUserColumn) {
        for (const row of groupsTriggered) {
            const userCol = row.group.find(col => col.key === "context.known_account.name");
            if (userCol?.value && nameToAlpineId[userCol.value.toLowerCase()]) {
                userNames.add(userCol.value);
            }
        }
    }

    const tableColumnKeys = allColumnKeys.filter(k => k !== "context.known_account.name");

    if (tableColumnKeys.length === 0) {
        if (userNames.size > 0) {
            elements.push({
                type: "Paragraph",
                elements: createUserMentionElements(userNames),
            });
        }
        return;
    }

    const aggregatedRows = new Map<string, number>();
    for (const row of groupsTriggered) {
        const keyValues = row.group
            .filter(col => col.key !== "context.known_account.name")
            .map(col => col.value)
            .join("\0");
        aggregatedRows.set(keyValues, (aggregatedRows.get(keyValues) || 0) + row.result);
    }

    const maxResults = 5;
    const allRows = Array.from(aggregatedRows.entries());
    const displayRows = allRows.slice(0, maxResults);
    const remainingCount = allRows.length - maxResults;
    const columnCount = tableColumnKeys.length + 1;

    const headerRow = {
        cells: [
            ...tableColumnKeys.map(key => ({
                elements: [
                    {
                        type: "Paragraph" as const,
                        elements: [{type: "Text" as const, text: key}],
                    },
                ],
            })),
            {
                elements: [
                    {
                        type: "Paragraph" as const,
                        elements: [{type: "Text" as const, text: "Count"}],
                    },
                ],
            },
        ],
    };

    const dataRows = displayRows.map(([keyValues, count]) => {
        const values = keyValues.split("\0");
        return {
            cells: [
                ...values.map((value, index) => ({
                    elements: [
                        {
                            type: "Paragraph" as const,
                            elements: [
                                {
                                    type: "Text" as const,
                                    text: value || "null",
                                    ...(tableColumnKeys[index]?.startsWith("exception.") && {
                                        marks: [{type: "Code" as const}],
                                    }),
                                },
                            ],
                        },
                    ],
                })),
                {
                    elements: [
                        {
                            type: "Paragraph" as const,
                            elements: [{type: "Text" as const, text: String(count)}],
                        },
                    ],
                },
            ],
        };
    });

    elements.push({
        type: "Table",
        width: 1,
        hasHeaderRow: true,
        columns: [...Array(columnCount - 1).fill({width: 1}), {width: 0.000001}],
        rows: [headerRow, ...dataRows],
    });

    if (remainingCount > 0) {
        elements.push({
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: `(${remainingCount} more result${remainingCount === 1 ? "" : "s"}...)`,
                    marks: [{type: "Italic"}],
                },
            ],
        });
    }

    if (userNames.size > 0) {
        elements.push({
            type: "Paragraph",
            elements: createUserMentionElements(userNames),
        });
    }
}

function createUserMentionElements(
    userNames: ReadonlySet<string>,
): Array<ApiSpecification.components["schemas"]["ContentInlineElement"]> {
    const userElements: Array<ApiSpecification.components["schemas"]["ContentInlineElement"]> = [];
    Array.from(userNames).forEach((userName, index) => {
        if (index > 0) {
            userElements.push({type: "Text", text: " "});
        }
        userElements.push(createUserElement(userName, "", userName));
    });
    return userElements;
}

function getTaskOccurrencesByTitle(
    data: HoneycombEventPayload,
): Map<string, {title: string; count: number; row: HoneycombResultGroup}> {
    const occurrencesByTitle = new Map<
        string,
        {title: string; count: number; row: HoneycombResultGroup}
    >();

    for (const row of data.groupsTriggered ?? []) {
        const title = getTaskTitleForHoneycombResultGroup(row);
        const existing = occurrencesByTitle.get(title);
        if (existing) {
            occurrencesByTitle.set(title, {
                ...existing,
                count: existing.count + row.result,
            });
            continue;
        }

        occurrencesByTitle.set(title, {
            title,
            count: row.result,
            row,
        });
    }

    return occurrencesByTitle;
}

function getTaskTitleForHoneycombResultGroup(row: HoneycombResultGroup): string {
    const route = getHoneycombResultGroupValue(row, "context.route");
    const exceptionType =
        getHoneycombResultGroupValue(row, "exception.cause.type") ??
        getHoneycombResultGroupValue(row, "exception.type");
    const exceptionMessage = getHoneycombResultGroupValue(row, "exception.message");
    const causeMessage = getHoneycombResultGroupValue(row, "exception.cause.message");
    const title = createHoneycombTaskTitle({
        route,
        exceptionType,
        exceptionMessage: causeMessage ?? exceptionMessage,
    });
    if (title) {
        return truncateHoneycombTaskTitle(title);
    }

    const fallbackTitle = row.group
        .filter(col => col.key.toLowerCase() !== "count")
        .map(col => (col.value ?? "").trim())
        .filter(value => value.length > 0)
        .join(" ");
    return truncateHoneycombTaskTitle(fallbackTitle || "Honeycomb alert");
}

function createHoneycombTaskTitle({
    route,
    exceptionType,
    exceptionMessage,
}: {
    route: string | null;
    exceptionType: string | null;
    exceptionMessage: string | null;
}): string | null {
    const errorTitle = [exceptionType, exceptionMessage].filter(Boolean).join(": ");
    const title = [route && `[${route}]`, errorTitle].filter(Boolean).join(" ");
    return title || null;
}

function getHoneycombResultGroupValue(row: HoneycombResultGroup, key: string): string | null {
    const value = row.group.find(col => col.key === key)?.value?.trim();
    return value && value.length > 0 ? value : null;
}

function truncateHoneycombTaskTitle(title: string): string {
    if (title.length <= honeycombTaskTitleMaxLength) {
        return title;
    }

    return `${title.slice(0, honeycombTaskTitleMaxLength - 3).trimEnd()}...`;
}

function createHoneycombTaskContent(
    data: HoneycombEventPayload,
    row: HoneycombResultGroup,
): ApiContent {
    const elements: Array<ApiContentElement> = createHeaderElements(`Honeycomb: ${data.name}`, [
        {label: "View Result", url: data.links.result},
    ]);

    if (data.description) {
        elements.push({
            type: "Paragraph",
            elements: [
                {
                    type: "Text",
                    text: data.description,
                    marks: [{type: "Italic"}],
                },
            ],
        });
    }

    elements.push({
        type: "Paragraph",
        elements: [
            {type: "Text", text: "Occurrences: "},
            {type: "Text", text: String(row.result)},
        ],
    });

    if (data.environment !== "production") {
        elements.push({
            type: "Paragraph",
            elements: [
                {type: "Text", text: "Environment: "},
                {type: "Text", text: data.environment},
            ],
        });
    }

    elements.push(...createHoneycombResultGroupFieldElements(row));

    return {elements};
}

function createHoneycombResultGroupFieldElements(
    row: HoneycombResultGroup,
): Array<ApiContentElement> {
    return row.group.flatMap(col => {
        const value = col.value?.trim();
        if (!value) {
            return [];
        }

        return [
            {
                type: "Paragraph",
                elements: [
                    {
                        type: "Text",
                        text: `${col.key}: `,
                        marks: [{type: "Bold"}],
                    },
                    {
                        type: "Text",
                        text: value,
                        ...(col.key.startsWith("exception.") && {
                            marks: [{type: "Code"}],
                        }),
                    },
                ],
            },
        ];
    });
}
