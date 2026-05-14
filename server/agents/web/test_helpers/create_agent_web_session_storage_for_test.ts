import {
    AgentWebSessionStorage,
    AgentWebSessionStorageCollection,
} from "~/server/agents/web/agent_web_session_storage.js";
import {DurableObjectStorageCollection} from "~/server/cloudflare/durable_object_storage_collection.js";
import {TemporaryDurableObjectStorage} from "~/server/cloudflare/temporary_durable_object_storage.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export function createAgentWebSessionStorageForTest(
    spaceId: SpaceId,
): AgentWebSessionStorage & {deleteAll(): Promise<void>} {
    const temporaryStorage = new TemporaryDurableObjectStorage();

    afterEach(async () => {
        await temporaryStorage.deleteAll();
    });

    let nextOrderKey = initialOrderKey;

    function createAgentWebSessionStorageCollection<
        Key extends string,
        Value,
    >(): AgentWebSessionStorageCollection<Key, Value> {
        const orderKey = nextOrderKey;
        nextOrderKey = generateOrderKeyBetween(nextOrderKey, null);

        const collection = new DurableObjectStorageCollection<Key, Value>(orderKey);

        return {
            get: collection.get.bind(collection, temporaryStorage),
            put: collection.put.bind(collection, temporaryStorage),
            delete: collection.delete.bind(collection, temporaryStorage),
            list: collection.list.bind(collection, temporaryStorage),
        };
    }

    const storage: AgentWebSessionStorage & {deleteAll(): Promise<void>} = {
        spaceId,
        mutex: new Mutex(),
        pageLinkByPathname: createAgentWebSessionStorageCollection(),
        latestPageLinkPathnameByKey: createAgentWebSessionStorageCollection(),
        urlByTruncatedUrl: createAgentWebSessionStorageCollection(),
        dedupeNumberByTruncatedUrlAndUrl: createAgentWebSessionStorageCollection(),
        documentCommentThreadNumberById: createAgentWebSessionStorageCollection(),
        documentCommentThreadIdByNumber: createAgentWebSessionStorageCollection(),
        tableWidthByTruncatedWidth: createAgentWebSessionStorageCollection(),
        tableColumnWidthsByTruncatedColumnWidths: createAgentWebSessionStorageCollection(),
        readResponseByPath: createAgentWebSessionStorageCollection(),
        readResponseMutexByPath: new Map(),
        deleteAll: () => temporaryStorage.deleteAll(),
    };

    return storage;
}
