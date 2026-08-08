import {OpensearchIndexTypeFlattenedKeysType} from "~/server/opensearch/opensearch_index_type.js";
import {
    OpensearchSortClause,
    OpensearchSortClauseItem,
} from "~/server/opensearch/opensearch_sort_clause.js";
import {TaskIndexDocType} from "~/server/tasks/data/task_index_doc.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {JsonScalarValue} from "~/shared/helpers/types/json_value.open_source.js";
import {isId} from "~/shared/id/id.open_source.js";
import {serializeHybridLogicalTime} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    TaskQuerySortCursorValue,
} from "~/shared/tasks/task_query_sort_cursor.js";

type TaskIndexFlattenedKeys = OpensearchIndexTypeFlattenedKeysType<typeof TaskIndexDocType>;

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
                case "Layout":
                    return [{"layout.value": item}];
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
                case "ParentPosition": {
                    return [
                        {"parent.position.value.orderTime": item},
                        {"parent.position.value.orderKey": item},
                    ];
                }
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
                                    // eslint-disable-next-line cyberworlds/string-quotes
                                    source: `for (def position : doc["collections.positions"]) { if (position.startsWith(params.collectionId)) { return position.substring(params.collectionId.length() + 1); } } return "${missingValue}";`,
                                    params: {collectionId: sort.collectionId},
                                },
                                order: item.order,
                            },
                        },
                    ];
                }
                case "AssigneePosition": {
                    return [
                        {"assigneePosition.orderTime": item},
                        {"assigneePosition.orderKey": item},
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

const maxInt32 = 2 ** 31 - 1;
const minInt32 = -(2 ** 31);
const maxInt64 = 2n ** 63n - 1n;
const minInt64 = -(2n ** 63n);

/**
 * Converts a `TaskQuerySortCursor` to a cursor we can use with the [OpenSearch
 * `search_after` pagination parameter][1].
 *
 * This function returns a cursor with `bigint`s which must be stringified with
 * `json-bigint` because OpenSearch can parse large number literals into `long`s.
 *
 * The implementation of this function is highly dependent on the implementation of
 * both `getTaskQueryNormalizedSortCursorValueFromIndexDoc()` and
 * `getTaskQueryNormalizedSortsOpensearchSortClause()`!
 *
 * - `getTaskQueryNormalizedSortCursorValueFromIndexDoc()` is what creates our
 *   `TaskQuerySortCursor`s on the server which we're taking as input to this
 *   function. The type it chooses to use for every sort item is very relevant.
 *
 * - `getTaskQueryNormalizedSortsOpensearchSortClause()` is what creates our sort
 *   definition for OpenSearch. Sometimes it uses odd formats to satisfy OpenSearch
 *   (e.g. for `CollectionPosition`) or uses multiple values for one sort item
 *   (e.g. for `AssigneePosition`).
 *
 * You need to look at both functions when implementing this one to produce the
 * right value.
 *
 * Why can't we use the `sort` property returned by the OpenSearch search API you
 * might ask? Well, it includes `long`s as integer literals which will be cast to
 * 64-bit floats when JavaScript parses them losing precision. Also, we need to get
 * cursors for `TaskIndexDoc`s we didn't use the search API to load (e.g. when we
 * add newly visible tasks to a query).
 *
 * So we construct our `TaskQuerySortCursor` from a parsed `TaskIndexDoc` and need
 * to convert it back to the lower-level format before sending back to OpenSearch.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/search-plugins/searching-data/paginate/#the-search_after-parameter
 */
export function convertTaskQuerySortCursorToOpensearchCursor(
    sorts: ReadonlyArray<TaskQueryNormalizedSort>,
    cursor: TaskQuerySortCursor,
) {
    const newCursor: Array<JsonScalarValue | bigint> = [];

    let i = 0;
    for (; i < sorts.length; i++) {
        const sort = sorts[i]!;
        const sortValue = cursor[i] as TaskQuerySortCursorValue;

        switch (sort.type) {
            case "DisplayStatus": {
                assert(typeof sortValue === "number");
                newCursor.push(sortValue);
                break;
            }
            case "Priority": {
                if (sortValue === null) {
                    // OpenSearch returns the max/min value for a numeric type in the cursor when it's
                    // missing instead of null.
                    newCursor.push(
                        (sort.direction === "Descending" && sort.missing === "Last") ||
                            (sort.direction === "Ascending" && sort.missing === "First")
                            ? minInt32
                            : maxInt32,
                    );
                } else {
                    assert(typeof sortValue === "number");
                    newCursor.push(sortValue);
                }
                break;
            }
            case "Layout": {
                if (sortValue === null) {
                    // OpenSearch returns the max/min value for a numeric type in the cursor when it's
                    // missing instead of null.
                    newCursor.push(
                        (sort.direction === "Descending" && sort.missing === "Last") ||
                            (sort.direction === "Ascending" && sort.missing === "First")
                            ? minInt32
                            : maxInt32,
                    );
                } else {
                    assert(typeof sortValue === "number");
                    newCursor.push(sortValue);
                }
                break;
            }
            case "Creator": {
                assert(typeof sortValue === "string");
                newCursor.push(sortValue);
                break;
            }
            case "Assignee":
            case "Assigner": {
                assert(typeof sortValue === "string" || sortValue === null);
                newCursor.push(sortValue);
                break;
            }
            case "DueDate": {
                if (sortValue === null) {
                    // OpenSearch returns the max/min value for a numeric type in the cursor when it's
                    // missing instead of null.
                    newCursor.push(
                        (sort.direction === "Descending" && sort.missing === "Last") ||
                            (sort.direction === "Ascending" && sort.missing === "First")
                            ? minInt64
                            : maxInt64,
                    );
                } else {
                    // `getTaskQueryNormalizedSortCursorValueFromIndexDoc()` converts due date to
                    // timestamp in UTC which is also OpenSearch's internal format.
                    assert(typeof sortValue === "number");
                    newCursor.push(sortValue);
                }
                break;
            }
            case "CreatedTime":
            case "AssignedTime":
            case "ClosedTime":
            case "ActivatedTime": {
                if (sortValue === null) {
                    // OpenSearch returns the max/min value for a numeric type in the cursor when it's
                    // missing instead of null.
                    newCursor.push(
                        (sort.direction === "Descending" && sort.missing === "Last") ||
                            (sort.direction === "Ascending" && sort.missing === "First")
                            ? minInt64
                            : maxInt64,
                    );
                } else {
                    // When sending this to OpenSearch we'll need to use a special JSON stringifier
                    // that works with bigints.
                    assert(Array.isArray(sortValue));
                    assert(typeof sortValue[0] === "number" && typeof sortValue[1] === "number");
                    newCursor.push(serializeHybridLogicalTime([sortValue[0], sortValue[1]]));
                }
                break;
            }
            case "ParentPosition": {
                if (sortValue === null) {
                    // OpenSearch returns the max/min value for a numeric type in the cursor when it's
                    // missing instead of null.
                    newCursor.push(
                        (sort.direction === "Descending" && sort.missing === "Last") ||
                            (sort.direction === "Ascending" && sort.missing === "First")
                            ? minInt64
                            : maxInt64,
                    );
                    newCursor.push(null);
                } else {
                    assert(Array.isArray(sortValue));
                    assert(
                        typeof sortValue[0] === "number" &&
                            typeof sortValue[1] === "number" &&
                            typeof sortValue[2] === "string",
                    );
                    // When sending this to OpenSearch we'll need to use a special JSON stringifier
                    // that works with bigints.
                    newCursor.push(serializeHybridLogicalTime([sortValue[0], sortValue[1]]));
                    newCursor.push(sortValue[2]);
                }
                break;
            }
            case "CollectionPosition": {
                if (sortValue === null) {
                    // The missing value for `CollectionPosition` is one of these symbols according to
                    // `getTaskQueryNormalizedSortsOpensearchSortClause()`.
                    //
                    // We use a script for this sort which can't return a null value.
                    newCursor.push(
                        sort.direction === "Ascending"
                            ? sort.missing === "Last"
                                ? "~"
                                : "#"
                            : sort.missing === "Last"
                              ? "#"
                              : "~",
                    );
                } else {
                    // This sort item is sorted by `getTaskQueryNormalizedSortsOpensearchSortClause()`
                    // a script that concatenates a `HybridLogicalTime` and an `OrderKey` together.
                    //
                    // The cursor for this sort item is an array with three items created by
                    // `getTaskQueryNormalizedSortCursorValueFromIndexDoc()`.
                    assert(Array.isArray(sortValue));
                    assert(
                        typeof sortValue[0] === "number" &&
                            typeof sortValue[1] === "number" &&
                            typeof sortValue[2] === "string",
                    );
                    newCursor.push(
                        `${serializeHybridLogicalTime([sortValue[0], sortValue[1]])
                            .toString()
                            .padStart(20, "0")}-${sortValue[2]}`,
                    );
                }
                break;
            }
            case "AssigneePosition": {
                if (sortValue === null) {
                    // OpenSearch returns the max/min value for a numeric type in the cursor when it's
                    // missing instead of null.
                    newCursor.push(
                        (sort.direction === "Descending" && sort.missing === "Last") ||
                            (sort.direction === "Ascending" && sort.missing === "First")
                            ? minInt64
                            : maxInt64,
                    );
                    newCursor.push(null);
                } else {
                    assert(Array.isArray(sortValue));
                    assert(
                        typeof sortValue[0] === "number" &&
                            typeof sortValue[1] === "number" &&
                            typeof sortValue[2] === "string",
                    );
                    // When sending this to OpenSearch we'll need to use a special JSON stringifier
                    // that works with bigints.
                    newCursor.push(serializeHybridLogicalTime([sortValue[0], sortValue[1]]));
                    newCursor.push(sortValue[2]);
                }
                break;
            }
            default:
                throw exhaustive(sort);
        }
    }

    const taskId = cursor[i]!;
    assert(typeof taskId === "string" && isId(taskId));
    newCursor.push(taskId);

    return newCursor;
}
