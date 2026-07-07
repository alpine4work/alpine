import {InvalidArgumentError} from "~/shared/error/error.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {assertId} from "~/shared/id/id.js";
import {ApiTaskCollectionCursor} from "~/shared/id/types/api_task_cursors.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {
    ApiTaskCollectionCursorDecoder,
    ApiTaskCollectionCursorEncoder,
} from "~/shared/tasks/model/api_task_collection_cursor_encoder.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";

const collectionId = assertId<TaskCollectionId>("ne9xp93dwgcwccj661x3ntdb9w");
const taskId = assertId<TaskId>("2hxv0y1b6zye9q87w2bt7fks3g");
const otherTaskId = assertId<TaskId>("01j2w6m8s53k9f8dxqb4m9n1mr");

test.each(
    cast<
        ReadonlyArray<{
            taskId: TaskId;
            collectionPosition: TaskPosition;
            encoded: string;
        }>
    >([
        {
            taskId,
            collectionPosition: {
                orderTime: [1_700_000_000_001, 7],
                orderKey: assertOrderKey("a42"),
            },
            encoded: "K9TUcc6n7df88ixQosvDKS4XHxeb14zUc7sW81ryew",
        },
        {
            taskId: otherTaskId,
            collectionPosition: {
                orderTime: [1_699_999_999_999, 8],
                orderKey: assertOrderKey("a0"),
            },
            encoded: "OLJZAsmRtABqNKzpsm9iiwSweyFpbTIeoZsULAZA",
        },
        {
            taskId,
            collectionPosition: {
                orderTime: [1_782_950_400_000, 13],
                orderKey: assertOrderKey("b0001"),
            },
            encoded: "mo3OjFsl96t7T9RMqggpWzw8Ro97NSsYn7n7AxNMr1M",
        },
    ]),
)("encodes and decodes `$encoded`", ({taskId, collectionPosition, encoded}) => {
    const encoder = new ApiTaskCollectionCursorEncoder(collectionId);
    const decoder = new ApiTaskCollectionCursorDecoder(collectionId);

    expect(encoder.encode({taskId, collectionPosition})).toBe(encoded);
    expect(decoder.decode(encoded as ApiTaskCollectionCursor)).toEqual({
        taskId,
        collectionPosition,
    });
});

test("throws if the cursor was encoded with a different collection", () => {
    const cursor = new ApiTaskCollectionCursorEncoder(collectionId).encode({
        taskId,
        collectionPosition: {
            orderTime: [1_700_000_000_001, 7],
            orderKey: assertOrderKey("a42"),
        },
    });

    expect(() =>
        new ApiTaskCollectionCursorDecoder(
            assertId<TaskCollectionId>("2hxv0y1b6zye9q87w2bt7fks3g"),
        ).decode(cursor),
    ).toThrow("Task collection cursor doesn\u2019t match collection");
});

test("throws for invalid cursor strings", () => {
    expect(() =>
        new ApiTaskCollectionCursorDecoder(collectionId).decode(
            "not-valid-base64!" as ApiTaskCollectionCursor,
        ),
    ).toThrow(InvalidArgumentError);
});
