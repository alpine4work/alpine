import {
    AgentWebSessionStorage,
    AgentWebSessionStorageCollection,
} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {DurableObjectStorageCollection} from "~/server/cloudflare/durable_object_storage_collection.js";
import {TemporaryDurableObjectStorage} from "~/server/cloudflare/temporary_durable_object_storage.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {
    generateOrderKeyBetween,
    initialOrderKey,
} from "~/shared/helpers/sort/order_key.open_source.js";
import {JsonStringifiableValue} from "~/shared/helpers/types/json_value.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

export function createAgentWebSessionStorageForTest(
    spaceId: SpaceId,
): AgentWebSessionStorage & {deleteAll(): Promise<void>} {
    const temporaryStorage = new TemporaryDurableObjectStorage();

    afterEach(async () => {
        await temporaryStorage.deleteAll();
    });

    let nextOrderKey = initialOrderKey;

    function createAgentWebSessionStorageCollection<
        Key extends string | readonly [string, string],
        Value extends JsonStringifiableValue,
    >(): AgentWebSessionStorageCollection<Key, Value> {
        const orderKey = nextOrderKey;
        nextOrderKey = generateOrderKeyBetween(nextOrderKey, null);

        const collection = new DurableObjectStorageCollection<string, Value>(orderKey);

        function encodeKey(key: Key): string {
            return typeof key === "string" ? key : JSON.stringify(key);
        }

        return {
            get: key => collection.get(temporaryStorage, encodeKey(key)),
            put: (key, value) => collection.put(temporaryStorage, encodeKey(key), value),
            delete: key => collection.delete(temporaryStorage, encodeKey(key)),
            list: async keyFirst => {
                const valueByEncodedKey = await collection.list(temporaryStorage, {
                    prefix: `${JSON.stringify([keyFirst]).slice(0, -1)},`,
                });

                const valueByKeySecond = new Map<any, Value>();

                for (const [encodedKey, value] of valueByEncodedKey) {
                    assert(encodedKey.startsWith("["));
                    const [, keySecond] = JSON.parse(encodedKey);
                    valueByKeySecond.set(keySecond, value);
                }

                return valueByKeySecond;
            },
        };
    }

    const storage: AgentWebSessionStorage & {deleteAll(): Promise<void>} = {
        spaceId,
        mutex: new Mutex(),
        pageStoredLinkByPathname: createAgentWebSessionStorageCollection(),
        latestPageStoredLinkPathnameByKey: createAgentWebSessionStorageCollection(),
        urlByTruncatedUrl: createAgentWebSessionStorageCollection(),
        dedupeNumberByTruncatedUrlAndUrl: createAgentWebSessionStorageCollection(),
        documentCommentThreadNumberById: createAgentWebSessionStorageCollection(),
        documentCommentThreadIdByNumber: createAgentWebSessionStorageCollection(),
        taskQueryCursorByHash: createAgentWebSessionStorageCollection(),
        tableWidthByTruncatedWidth: createAgentWebSessionStorageCollection(),
        tableColumnWidthsByTruncatedColumnWidths: createAgentWebSessionStorageCollection(),
        readResponseByPath: createAgentWebSessionStorageCollection(),
        readResponseMutexByPath: new Map(),
        deleteAll: () => temporaryStorage.deleteAll(),
    };

    return storage;
}
