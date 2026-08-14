import {Database} from "lmdb";
import {MAXIMUM_KEY} from "ordered-binary";
import {
    AgentWebSessionStorage,
    AgentWebSessionStorageCollection,
} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {OrderKey, assertOrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {JsonStringifiableValue} from "~/shared/helpers/types/json_value.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

export type AgentWebSessionLmdbStorageKey = [OrderKey, ...NonEmptyReadonlyArray<string>];

/**
 * Creates agent web session storage backed by an open LMDB database.
 *
 * The caller must hold a write transaction for the lifetime of the returned
 * storage object.
 */
export function createAgentWebSessionLmdbStorage(
    database: Database<any, AgentWebSessionLmdbStorageKey>,
    spaceId: SpaceId,
): AgentWebSessionStorage {
    return {
        spaceId,
        mutex: new Mutex(),
        pageStoredLinkByPathname: createLmdbCollection(database, assertOrderKey("a0")),
        latestPageStoredLinkPathnameByKey: createLmdbCollection(database, assertOrderKey("a1")),
        urlByTruncatedUrl: createLmdbCollection(database, assertOrderKey("a2")),
        dedupeNumberByTruncatedUrlAndUrl: createLmdbCollection(database, assertOrderKey("a3")),
        documentCommentThreadNumberById: createLmdbCollection(database, assertOrderKey("a4")),
        documentCommentThreadIdByNumber: createLmdbCollection(database, assertOrderKey("a5")),
        taskQueryCursorByHash: createLmdbCollection(database, assertOrderKey("a6")),
        tableWidthByTruncatedWidth: createLmdbCollection(database, assertOrderKey("a7")),
        tableColumnWidthsByTruncatedColumnWidths: createLmdbCollection(
            database,
            assertOrderKey("a8"),
        ),
        // TODO: Add a background process that sweeps `readResponseByPath` and deletes
        // expired responses.
        readResponseByPath: createLmdbCollection(database, assertOrderKey("a9")),
        readResponseMutexByPath: new Map(),
    };
}

function createLmdbCollection<
    Key extends string | readonly [string, string],
    Value extends JsonStringifiableValue,
>(
    database: Database<any, AgentWebSessionLmdbStorageKey>,
    orderKey: OrderKey,
): AgentWebSessionStorageCollection<Key, Value> {
    function createFullKey(key: Key): AgentWebSessionLmdbStorageKey {
        return typeof key === "string"
            ? [orderKey, key]
            : ([orderKey, ...key] as AgentWebSessionLmdbStorageKey);
    }

    return {
        get: async key => {
            const value = database.get(createFullKey(key)) as Value | undefined;
            return value === undefined ? undefined : value;
        },
        put: async (key, value) => {
            await database.put(createFullKey(key), value);
        },
        delete: async key => {
            return await database.remove(createFullKey(key));
        },
        list: async (keyFirst): Promise<Map<any, any>> => {
            const valueByKeySecond = new Map<any, any>();

            for (const {key: storedKey, value} of database.getRange({
                start: [orderKey, keyFirst],
                // From the `ordered-binary` package which `lmdb` uses internally for encoding
                // keys.
                end: [orderKey, keyFirst, MAXIMUM_KEY],
            })) {
                assert(storedKey[0] === orderKey);
                assert(storedKey[1] === keyFirst);
                valueByKeySecond.set(storedKey[2], value);
            }

            return valueByKeySecond;
        },
    };
}
