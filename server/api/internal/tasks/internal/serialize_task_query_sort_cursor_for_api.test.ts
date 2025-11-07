import {
    deserializeTaskQuerySortCursorForApi,
    serializeTaskQuerySortCursorForApi,
} from "~/server/api/internal/tasks/internal/serialize_task_query_sort_cursor_for_api.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";

describe("encodeTaskCursor / decodeTaskCursor", () => {
    describe("round-trip encoding", () => {
        test("encodes and decodes a simple cursor with CollectionPosition sort", () => {
            const cursor: TaskQuerySortCursor = [
                1234567890, // orderTime[0]
                123, // orderTime[1]
                "some-order-key", // orderKey
                generateId<TaskId>(), // taskId
            ];

            const encoded = serializeTaskQuerySortCursorForApi(cursor);
            const decoded = deserializeTaskQuerySortCursorForApi(encoded);

            expect(decoded).toEqual(cursor);
        });

        test("encodes and decodes a cursor with null values", () => {
            const cursor: TaskQuerySortCursor = [
                null, // e.g., missing priority
                generateId<TaskId>(),
            ];

            const encoded = serializeTaskQuerySortCursorForApi(cursor);
            const decoded = deserializeTaskQuerySortCursorForApi(encoded);

            expect(decoded).toEqual(cursor);
        });

        test("encodes and decodes a cursor with string values", () => {
            const cursor: TaskQuerySortCursor = [
                "assignee-name", // e.g., Assignee sort
                generateId<TaskId>(),
            ];

            const encoded = serializeTaskQuerySortCursorForApi(cursor);
            const decoded = deserializeTaskQuerySortCursorForApi(encoded);

            expect(decoded).toEqual(cursor);
        });

        test("encodes and decodes a cursor with mixed types", () => {
            const cursor: TaskQuerySortCursor = [
                1, // DisplayStatus (number)
                null, // Priority (null)
                "Alice", // Assignee (string)
                1699999999999, // CreatedTime (number)
                generateId<TaskId>(),
            ];

            const encoded = serializeTaskQuerySortCursorForApi(cursor);
            const decoded = deserializeTaskQuerySortCursorForApi(encoded);

            expect(decoded).toEqual(cursor);
        });

        test("encodes and decodes a cursor with array values (ParentPosition)", () => {
            const cursor: TaskQuerySortCursor = [
                [1234567890, 123, "parent-order-key"], // ParentPosition
                generateId<TaskId>(),
            ];

            const encoded = serializeTaskQuerySortCursorForApi(cursor);
            const decoded = deserializeTaskQuerySortCursorForApi(encoded);

            expect(decoded).toEqual(cursor);
        });

        test("encodes and decodes a complex multi-sort cursor", () => {
            const cursor: TaskQuerySortCursor = [
                1, // DisplayStatus
                2, // Priority
                [1234567890, 123, "collection-order-key"], // CollectionPosition
                "Bob", // Creator
                null, // DueDate
                generateId<TaskId>(),
            ];

            const encoded = serializeTaskQuerySortCursorForApi(cursor);
            const decoded = deserializeTaskQuerySortCursorForApi(encoded);

            expect(decoded).toEqual(cursor);
        });
    });

    describe("encoding produces valid base64", () => {
        test("produces a URL-safe base64 string", () => {
            const cursor: TaskQuerySortCursor = [1234567890, 123, "key", generateId<TaskId>()];
            const encoded = serializeTaskQuerySortCursorForApi(cursor);

            // Should not contain URL-unsafe characters like +, /, =
            expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        test("produces consistent output for the same input", () => {
            const cursor: TaskQuerySortCursor = [1234567890, 123, "key", generateId<TaskId>()];

            const encoded1 = serializeTaskQuerySortCursorForApi(cursor);
            const encoded2 = serializeTaskQuerySortCursorForApi(cursor);

            expect(encoded1).toBe(encoded2);
        });
    });

    describe("decoding validation", () => {
        test("throws InvalidArgumentError for invalid base64", () => {
            expect(() => {
                deserializeTaskQuerySortCursorForApi("not-valid-base64!@#$");
            }).toThrow(InvalidArgumentError);
        });

        test("throws InvalidArgumentError for non-array JSON", () => {
            const invalidJson = serializeTaskQuerySortCursorForApi(
                JSON.stringify({not: "an array"}) as any,
            );

            expect(() => {
                deserializeTaskQuerySortCursorForApi(invalidJson);
            }).toThrow("Cursor must be a non-empty array");
        });

        test("throws InvalidArgumentError if last element is not a TaskId", () => {
            // Create a cursor with a number as the last element instead of a TaskId
            const invalidCursor = [1234567890, 123, "osdamflkn"];
            const encoded = serializeTaskQuerySortCursorForApi(invalidCursor as any);

            expect(() => {
                deserializeTaskQuerySortCursorForApi(encoded);
            }).toThrow("Last element of cursor must be a TaskId");
        });

        test("throws InvalidArgumentError for empty array", () => {
            const encoded = serializeTaskQuerySortCursorForApi([] as any);

            expect(() => {
                deserializeTaskQuerySortCursorForApi(encoded);
            }).toThrow("Cursor must be a non-empty array");
        });
    });

    describe("edge cases", () => {
        test("handles cursor with only taskId", () => {
            const cursor: TaskQuerySortCursor = [generateId<TaskId>()];

            const encoded = serializeTaskQuerySortCursorForApi(cursor);
            const decoded = deserializeTaskQuerySortCursorForApi(encoded);

            expect(decoded).toEqual(cursor);
        });

        test("handles cursor with very large numbers", () => {
            const cursor: TaskQuerySortCursor = [
                Number.MAX_SAFE_INTEGER,
                Number.MIN_SAFE_INTEGER,
                generateId<TaskId>(),
            ];

            const encoded = serializeTaskQuerySortCursorForApi(cursor);
            const decoded = deserializeTaskQuerySortCursorForApi(encoded);

            expect(decoded).toEqual(cursor);
        });

        test("handles cursor with special characters in strings", () => {
            const cursor: TaskQuerySortCursor = [
                "name with spaces",
                "name-with-dashes",
                "name_with_underscores",
                "name.with.dots",
                generateId<TaskId>(),
            ];

            const encoded = serializeTaskQuerySortCursorForApi(cursor);
            const decoded = deserializeTaskQuerySortCursorForApi(encoded);

            expect(decoded).toEqual(cursor);
        });

        test("handles cursor with unicode characters", () => {
            const cursor: TaskQuerySortCursor = [
                "name with émojis 🎉",
                "中文名字",
                generateId<TaskId>(),
            ];

            const encoded = serializeTaskQuerySortCursorForApi(cursor);
            const decoded = deserializeTaskQuerySortCursorForApi(encoded);

            expect(decoded).toEqual(cursor);
        });
    });
});
