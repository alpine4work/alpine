import fc from "fast-check";
import {
    AgentWebSessionStorage,
    AgentWebSessionStorageCollection,
} from "~/server/agents/web/agent_web_session_storage.js";
import {parseApiContentFromAgentWebMarkdown} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdown} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {DurableObjectStorageCollection} from "~/server/cloudflare/durable_object_storage_collection.js";
import {TemporaryDurableObjectStorage} from "~/server/cloudflare/temporary_durable_object_storage.js";
import {normalizeApiContent} from "~/shared/api/markdown/normalize_api_content.js";
import {
    ApiContentResponseArbitrary,
    apiContentArbitrarySpaceId,
} from "~/shared/api/markdown/test_helpers/api_content_arbitrary.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const temporaryStorage = new TemporaryDurableObjectStorage();

afterEach(async () => {
    await temporaryStorage.deleteAll();
});

import.meta.jest.setTimeout(30 * 1000);

fc.configureGlobal({
    interruptAfterTimeLimit: 20 * 1000,
    asyncAfterEach: async () => {
        await temporaryStorage.deleteAll();
    },
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
        list: collection.list.bind(collection, temporaryStorage),
    };
}

const storage: AgentWebSessionStorage = {
    mutex: new Mutex(),
    pageLinkByPath: createAgentWebSessionStorageCollection(),
    lastPageLinkPathByKey: createAgentWebSessionStorageCollection(),
    urlByTruncatedUrl: createAgentWebSessionStorageCollection(),
    dedupeNumberByTruncatedUrlAndUrl: createAgentWebSessionStorageCollection(),
    documentCommentThreadNumberById: createAgentWebSessionStorageCollection(),
    documentCommentThreadIdByNumber: createAgentWebSessionStorageCollection(),
    tableWidthByTruncatedWidth: createAgentWebSessionStorageCollection(),
    tableColumnWidthsByTruncatedColumnWidths: createAgentWebSessionStorageCollection(),
};

test("can parse exact same content that was printed", async () => {
    await fc.assert(
        fc.asyncProperty(ApiContentResponseArbitrary, async content => {
            const documentId = generateId<DocumentId>();

            const markdown = await printApiContentToAgentWebMarkdown(storage, content, {
                spaceId: apiContentArbitrarySpaceId,
                documentId,
            });

            expect(
                // Unlike `parseApiContentFromMarkdown()`, we don't expect
                // `parseApiContentFromAgentWebMarkdown()` to return normalized content.
                normalizeApiContent(
                    await parseApiContentFromAgentWebMarkdown(storage, markdown, {
                        spaceId: apiContentArbitrarySpaceId,
                        documentId,
                    }),
                ),
            ).toEqual(normalizeApiContent(content));
        }),
        {
            // Run until we reach our 10s timeout.
            numRuns: Infinity,
        },
    );
});
