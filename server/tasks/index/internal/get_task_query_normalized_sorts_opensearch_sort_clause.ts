import {OpensearchIndexFlattenedKeysType} from "~/server/opensearch/opensearch_index_type.js";
import {
    OpensearchSortClause,
    OpensearchSortClauseItem,
} from "~/server/opensearch/opensearch_sort_clause.js";
import {TaskIndexDocType} from "~/server/tasks/index/task_index_doc.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";

type TaskIndexFlattenedKeys = OpensearchIndexFlattenedKeysType<typeof TaskIndexDocType>;

export function getTaskQueryNormalizedSortsOpensearchSortClause(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
): OpensearchSortClause<TaskIndexFlattenedKeys> {
    const sortClause = sorts.flatMap(
        (sort): Array<OpensearchSortClauseItem<TaskIndexFlattenedKeys>> => {
            const item = {
                order: sort.direction === "Ascending" ? "asc" : "desc",
                missing: sort.missing === "Last" ? "_last" : "_first",
            } as const;

            switch (sort.type) {
                case "DisplayStatus":
                    return [{displayStatus: item}];
                case "Priority":
                    return [{"priority.value": item}];
                case "Assignee":
                    return [{"assignee.value.assignee.workingAccountName": item}];
                case "Creator":
                    return [{"creator.workingAccountName": item}];
                case "Assigner":
                    return [{"assignee.value.assigner.workingAccountName": item}];
                case "DueDate":
                    return [{"dueDate.value": item}];
                case "CreatedTime":
                    return [{"createdTime.absoluteTime": item}];
                case "AssignedTime":
                    return [{"assignee.value.assignedTime.absoluteTime": item}];
                case "ClosedTime":
                    return [{"status.value.closedTime.absoluteTime": item}];
                case "ActivatedTime":
                    return [{"assigneeStatus.value.activatedTime.absoluteTime": item}];
                case "CollectionPosition": {
                    const missingValue =
                        sort.direction === "Ascending"
                            ? sort.missing === "Last"
                                ? "~"
                                : "#"
                            : sort.missing === "Last"
                            ? "#"
                            : "~";

                    return [
                        {
                            _script: {
                                type: "string",
                                script: {
                                    lang: "painless",
                                    // Implementation notes:
                                    //
                                    // - If the task isn't present in the collection we're sorting by, we return
                                    //   the string `missingValue`. It's either `#` (which has a low ASCII
                                    //   value) or `~` (which has a high ASCII value).
                                    // - The `number` sort context expects that a `double` is returned and doesn't
                                    //   support `long`s. So we use a string sort context and pad our 64-bit
                                    //   unsigned `long` with 0s so it sorts properly.
                                    // - Because we are using a string context we can also append the order key.
                                    //   Otherwise we'd need two sort contexts, one for the `orderTime` number and one
                                    //   for the `orderKey` string.
                                    source: `int index = doc["collections.ids"].indexOf(params.collectionId); return index < 0 ? "${missingValue}" : String.format("%020d-%s", new def[] {doc["collections.positionOrderTimes"].get(index), doc["collections.positionOrderKeys"].get(index)});`,
                                    params: {collectionId: sort.collectionId},
                                },
                                order: item.order,
                            },
                        },
                    ];
                }
                case "NotepadPagePosition": {
                    const missingValue =
                        sort.direction === "Ascending"
                            ? sort.missing === "Last"
                                ? "~"
                                : "#"
                            : sort.missing === "Last"
                            ? "#"
                            : "~";

                    return [
                        {
                            _script: {
                                type: "string",
                                script: {
                                    lang: "painless",
                                    // Implementation notes:
                                    //
                                    // - If the task isn't present in the collection we're sorting by, we return
                                    //   the string `missingValue`. It's either `#` (which has a low ASCII
                                    //   value) or `~` (which has a high ASCII value).
                                    // - The `number` sort context expects that a `double` is returned and doesn't
                                    //   support `long`s. So we use a string sort context and pad our 64-bit
                                    //   unsigned `long` with 0s so it sorts properly.
                                    // - Because we are using a string context we can also append the order key.
                                    //   Otherwise we'd need two sort contexts, one for the `orderTime` number and one
                                    //   for the `orderKey` string.
                                    source: `int index = doc["notepadPages.ids"].indexOf(params.accountIdAndNotepadPageId); return index < 0 ? "${missingValue}" : String.format("%020d-%s", new def[] {doc["notepadPages.positionOrderTimes"].get(index), doc["notepadPages.positionOrderKeys"].get(index)});`,
                                    params: {
                                        accountIdAndNotepadPageId: `${sort.accountId}-${sort.notepadPageId}`,
                                    },
                                },
                                order: item.order,
                            },
                        },
                    ];
                }
                case "AssigneeStatusActivePosition": {
                    return [
                        {"assigneeStatus.value.position.orderTime": item},
                        {"assigneeStatus.value.position.orderKey": item},
                    ];
                }
                default:
                    throw exhaustive(sort);
            }
        },
    );

    sortClause.push({_id: {order: "asc"}});

    return sortClause;
}
