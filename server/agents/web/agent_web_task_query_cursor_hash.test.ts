import {
    createAgentWebTaskQueryCursorHash,
    getAgentWebTaskQueryCursorForHashIfExists,
} from "~/server/agents/web/agent_web_task_query_cursor_hash.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {generateId} from "~/shared/id/id.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();
const collectionId = generateId<TaskCollectionId>();
const queryId = `TaskCollection:${collectionId}` as const;
const storage = createAgentWebSessionStorageForTest(spaceId);

const cursor = "task-cursor-0" as ApiTaskQueryCursor;
const otherCursor = "task-cursor-1" as ApiTaskQueryCursor;

test("creates the hash of the cursor", async () => {
    await expect(createAgentWebTaskQueryCursorHash(storage, queryId, cursor)).resolves.toEqual(
        "f55706",
    );
});

test("returns the same hash for the same cursor", async () => {
    const firstHash = await createAgentWebTaskQueryCursorHash(storage, queryId, cursor);
    const secondHash = await createAgentWebTaskQueryCursorHash(storage, queryId, cursor);

    expect(secondHash).toEqual(firstHash);
});

test("increments the hash when a different cursor claims the same hash", async () => {
    await storage.taskQueryCursorByHash.put(`${queryId}-f55706`, otherCursor);

    await expect(createAgentWebTaskQueryCursorHash(storage, queryId, cursor)).resolves.toEqual(
        "f55707",
    );
});

test("gets the full cursor for a hash", async () => {
    await createAgentWebTaskQueryCursorHash(storage, queryId, cursor);

    await expect(
        getAgentWebTaskQueryCursorForHashIfExists(storage, queryId, "f55706"),
    ).resolves.toEqual(cursor);
});

test("gets the full cursor for an uppercase hash", async () => {
    await createAgentWebTaskQueryCursorHash(storage, queryId, cursor);

    await expect(
        getAgentWebTaskQueryCursorForHashIfExists(storage, queryId, "F55706"),
    ).resolves.toEqual(cursor);
});

test("returns undefined for a hash that was never created", async () => {
    await expect(
        getAgentWebTaskQueryCursorForHashIfExists(storage, queryId, "a1b2c3"),
    ).resolves.toBeUndefined();
});

test("scopes hashes to a single task collection", async () => {
    await createAgentWebTaskQueryCursorHash(storage, queryId, cursor);

    await expect(
        getAgentWebTaskQueryCursorForHashIfExists(
            storage,
            `TaskCollection:${generateId<TaskCollectionId>()}`,
            "f55706",
        ),
    ).resolves.toBeUndefined();
});
