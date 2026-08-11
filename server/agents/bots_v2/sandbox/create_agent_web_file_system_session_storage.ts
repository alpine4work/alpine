import fsSync from "fs";
import fs from "fs/promises";
import {dirname} from "path";
import {
    AgentWebSessionStorage,
    AgentWebSessionStorageCollection,
} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {JsonStringifiableValue} from "~/shared/helpers/types/json_value.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

export function createAgentWebFileSystemSessionStorage(spaceId: SpaceId): AgentWebSessionStorage {
    return {
        spaceId,
        mutex: new Mutex(),
        pageStoredLinkByPathname: createAgentWebFileSystemSessionStorageCollection("a0"),
        latestPageStoredLinkPathnameByKey: createAgentWebFileSystemSessionStorageCollection("a1"),
        urlByTruncatedUrl: createAgentWebFileSystemSessionStorageCollection("a2"),
        dedupeNumberByTruncatedUrlAndUrl: createAgentWebFileSystemSessionStorageCollection("a3"),
        documentCommentThreadNumberById: createAgentWebFileSystemSessionStorageCollection("a4"),
        documentCommentThreadIdByNumber: createAgentWebFileSystemSessionStorageCollection("a5"),
        taskQueryCursorByHash: createAgentWebFileSystemSessionStorageCollection("a6"),
        tableWidthByTruncatedWidth: createAgentWebFileSystemSessionStorageCollection("a7"),
        tableColumnWidthsByTruncatedColumnWidths:
            createAgentWebFileSystemSessionStorageCollection("a8"),
        // TODO: Add a background process that sweeps `readResponseByPath` and deletes
        // expired responses.
        readResponseByPath: createAgentWebFileSystemSessionStorageCollection("a9"),
        readResponseMutexByPath: new Map(),
    };
}

function createAgentWebFileSystemSessionStorageCollection<
    Key extends string | readonly [string, string],
    Value extends JsonStringifiableValue,
>(name: string): AgentWebSessionStorageCollection<Key, Value> {
    // Make sure the name is already in its escaped form.
    assert(name === encodeURIComponent(name));

    // We assume paths in the Ubuntu image we're running in are case sensitive. Let's
    // verify that fact with a quick test. If the file system is case insensitive (like
    // MacOS) then our `encodeURIComponent()` scheme won't be sufficient for encoding
    // keys.
    fsSync.writeFileSync("/tmp/case-sensitivity-test-a", "1\n");
    fsSync.writeFileSync("/tmp/case-sensitivity-test-A", "2\n");
    assert(fsSync.readFileSync("/tmp/case-sensitivity-test-a", "utf8").trim() === "1");
    assert(fsSync.readFileSync("/tmp/case-sensitivity-test-A", "utf8").trim() === "2");
    fsSync.unlinkSync("/tmp/case-sensitivity-test-a");
    fsSync.unlinkSync("/tmp/case-sensitivity-test-A");

    function encodeKey(key: Key) {
        if (isReadonlyArray(key)) {
            const [keyFirst, keySecond] = key;

            return `${encodeURIComponent(keyFirst)}/${encodeURIComponent(keySecond)}`;
        }

        return encodeURIComponent(key);
    }

    // We read everything into an in-memory cache for fast subsequent reads. This works
    // since a given session storage instance is expected to have exclusive access to
    // the underlying storage. So there won't be anyone concurrent reads/writes that
    // would invalidate our cache.
    const cache = new Map<string, {value: Value | undefined}>();

    const get = async (key: Key): Promise<Value | undefined> => {
        const encodedKey = encodeKey(key);
        const cacheEntry = cache.get(encodedKey);

        if (cacheEntry !== undefined) {
            return cacheEntry.value;
        }

        const value = await fs
            .readFile(`/workspace/bucket/agent-web/${name}/${encodedKey}.json`, "utf8")
            .then(
                valueString => JSON.parse(valueString) as Value,
                error => {
                    if (!(isObject(error) && error.code === "ENOENT")) {
                        throw error;
                    }

                    // If we got an `ENOENT` error then that's because the file didn't exist in the
                    // first place.
                    return undefined;
                },
            );

        cache.set(encodedKey, {value});
        return value;
    };

    return {
        get,
        put: async (key, value) => {
            const encodedKey = encodeKey(key);
            cache.set(encodedKey, {value});

            const path = `/workspace/bucket/agent-web/${name}/${encodedKey}.json`;
            const valueString = JSON.stringify(value);

            await fs.writeFile(path, valueString).catch(async error => {
                // If we got an `ENOENT` error then the most likely reason is because the directory
                // doesn't exist. So create the directory first and then try writing the file
                // again.
                if (!(isObject(error) && error.code === "ENOENT")) {
                    throw error;
                }

                await fs.mkdir(dirname(path), {recursive: true});
                await fs.writeFile(path, valueString);
            });
        },
        delete: async key => {
            const encodedKey = encodeKey(key);
            cache.delete(encodedKey);

            const path = `/workspace/bucket/agent-web/${name}/${encodedKey}.json`;

            await fs.unlink(path).catch(error => {
                if (!(isObject(error) && error.code === "ENOENT")) {
                    throw error;
                }

                // If we got an `ENOENT` error then that's because the file didn't exist in the
                // first place.
                return false;
            });

            return true;
        },
        list: async keyFirst => {
            const path = `/workspace/bucket/agent-web/${name}/${encodeURIComponent(keyFirst)}`;

            const keySeconds = await fs.readdir(path).catch(error => {
                if (!(isObject(error) && error.code === "ENOENT")) {
                    throw error;
                }

                // If we got an `ENOENT` error then that's because the directory didn't exist in
                // the first place.
                return [];
            });

            const valueByKeySecond: Array<[any, Value]> = [];

            await runAllPromises(
                keySeconds.map(async keySecond => {
                    const value = await get([keyFirst, keySecond] as any);
                    if (value !== undefined) valueByKeySecond.push([keySecond, value]);
                }),
            );

            // Make sure we return the entries in sorted order.
            valueByKeySecond.sort((a, b) => defaultCompareStrings(a[0], b[0]));

            return new Map(valueByKeySecond);
        },
    };
}
