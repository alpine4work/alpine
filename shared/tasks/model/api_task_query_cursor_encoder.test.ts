import {InvalidArgumentError} from "~/shared/error/error.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {assertId} from "~/shared/id/id.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {
    decodeApiTaskQueryCursor,
    encodeApiTaskQueryCursor,
} from "~/shared/tasks/model/api_task_query_cursor_encoder.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";

const taskId = assertId<TaskId>("2hxv0y1b6zye9q87w2bt7fks3g");
const collectionId = assertId<TaskCollectionId>("ne9xp93dwgcwccj661x3ntdb9w");

test.each([
    {
        sorts: [{type: "CreatedTime", direction: "Ascending", missing: "Last"}],
        cursor: [[1_699_999_999_999, 7], taskId] as TaskQuerySortCursor,
        encoded: "q1GJhUGIePdN8VnW20R-lZoINYivd78gcA",
    },
    {
        sorts: [
            {
                type: "CollectionPosition",
                collectionId,
                direction: "Ascending",
                missing: "Last",
            },
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ],
        cursor: [
            [1_700_000_000_001, 7, assertOrderKey("a42")],
            [1_699_999_999_999, 8],
            taskId,
        ] as TaskQuerySortCursor,
        encoded: "UOC8q18IP7L71mY6ZRyw_tU3F69w6u5Hh1wd5n_Rs-hoNY5L8ejhVsw",
    },
    {
        sorts: [
            {type: "Assignee", direction: "Ascending", missing: "First"},
            {type: "Priority", direction: "Descending", missing: "Last"},
            {type: "DueDate", direction: "Ascending", missing: "Last"},
            {type: "CreatedTime", direction: "Ascending", missing: "Last"},
        ],
        cursor: [
            "Ada Lovelace",
            null,
            1_782_950_400_000,
            [1_699_999_999_999, 9],
            taskId,
        ] as TaskQuerySortCursor,
        encoded: "kB6VUlZWZgwdZ82O4Rk1x1GxqiP4x8NhACJeA1MCD0Vr2WSkYCTDPOhvaBjfvmg",
    },
] satisfies ReadonlyArray<{
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    cursor: TaskQuerySortCursor;
    encoded: string;
}>)("encodes and decodes `$encoded`", ({sorts, cursor, encoded}) => {
    expect(encodeApiTaskQueryCursor(sorts, cursor)).toBe(encoded);
    expect(decodeApiTaskQueryCursor(sorts, encoded as ApiTaskQueryCursor)).toEqual(cursor);
});

test("throws if the cursor was encoded with different sorts", () => {
    const cursor = encodeApiTaskQueryCursor(
        [{type: "CreatedTime", direction: "Ascending", missing: "Last"}],
        [[1_699_999_999_999, 7], taskId],
    );

    expect(() =>
        decodeApiTaskQueryCursor(
            [{type: "CreatedTime", direction: "Descending", missing: "Last"}],
            cursor,
        ),
    ).toThrow("Task query cursor doesn\u2019t match sorts");
});

test("throws if the cursor was encoded with a different collection sort", () => {
    const cursor = encodeApiTaskQueryCursor(
        [
            {
                type: "CollectionPosition",
                collectionId,
                direction: "Ascending",
                missing: "Last",
            },
        ],
        [[1_700_000_000_001, 7, assertOrderKey("a42")], taskId],
    );

    expect(() =>
        decodeApiTaskQueryCursor(
            [
                {
                    type: "CollectionPosition",
                    collectionId: assertId<TaskCollectionId>("2hxv0y1b6zye9q87w2bt7fks3g"),
                    direction: "Ascending",
                    missing: "Last",
                },
            ],
            cursor,
        ),
    ).toThrow("Task query cursor doesn\u2019t match sorts");
});

test("throws for invalid cursor strings", () => {
    expect(() =>
        decodeApiTaskQueryCursor(
            [{type: "CreatedTime", direction: "Ascending", missing: "Last"}],
            "not-valid-base64!" as ApiTaskQueryCursor,
        ),
    ).toThrow(InvalidArgumentError);
});
