import {Database} from "lmdb";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {OrderKey, assertOrderKey} from "~/shared/helpers/sort/order_key.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export type AgentWebSessionLmdbStorageKey = [OrderKey, string];

const pageStoredLinkByPathnameOrderKey = assertOrderKey("a0");
const latestPageStoredLinkPathnameByKeyOrderKey = assertOrderKey("a1");
const urlByTruncatedUrlOrderKey = assertOrderKey("a2");
const dedupeNumberByTruncatedUrlAndUrlOrderKey = assertOrderKey("a3");
const documentCommentThreadNumberByIdOrderKey = assertOrderKey("a4");
const documentCommentThreadIdByNumberOrderKey = assertOrderKey("a5");
const taskQueryCursorByHashOrderKey = assertOrderKey("a6");
const tableWidthByTruncatedWidthOrderKey = assertOrderKey("a7");
const tableColumnWidthsByTruncatedColumnWidthsOrderKey = assertOrderKey("a8");
const readResponseByPathOrderKey = assertOrderKey("a9");
const endOrderKey = assertOrderKey("aA");

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
        pageStoredLinkByPathname: createLmdbCollection(
            database,
            pageStoredLinkByPathnameOrderKey,
            latestPageStoredLinkPathnameByKeyOrderKey,
        ),
        latestPageStoredLinkPathnameByKey: createLmdbCollection(
            database,
            latestPageStoredLinkPathnameByKeyOrderKey,
            urlByTruncatedUrlOrderKey,
        ),
        urlByTruncatedUrl: createLmdbCollection(
            database,
            urlByTruncatedUrlOrderKey,
            dedupeNumberByTruncatedUrlAndUrlOrderKey,
        ),
        dedupeNumberByTruncatedUrlAndUrl: createLmdbCollection(
            database,
            dedupeNumberByTruncatedUrlAndUrlOrderKey,
            documentCommentThreadNumberByIdOrderKey,
        ),
        documentCommentThreadNumberById: createLmdbCollection(
            database,
            documentCommentThreadNumberByIdOrderKey,
            documentCommentThreadIdByNumberOrderKey,
        ),
        documentCommentThreadIdByNumber: createLmdbCollection(
            database,
            documentCommentThreadIdByNumberOrderKey,
            taskQueryCursorByHashOrderKey,
        ),
        taskQueryCursorByHash: createLmdbCollection(
            database,
            taskQueryCursorByHashOrderKey,
            tableWidthByTruncatedWidthOrderKey,
        ),
        tableWidthByTruncatedWidth: createLmdbCollection(
            database,
            tableWidthByTruncatedWidthOrderKey,
            tableColumnWidthsByTruncatedColumnWidthsOrderKey,
        ),
        tableColumnWidthsByTruncatedColumnWidths: createLmdbCollection(
            database,
            tableColumnWidthsByTruncatedColumnWidthsOrderKey,
            readResponseByPathOrderKey,
        ),
        // TODO: Add a background process that sweeps `readResponseByPath` and deletes
        // expired responses.
        readResponseByPath: createLmdbCollection(database, readResponseByPathOrderKey, endOrderKey),
        readResponseMutexByPath: new Map(),
    };
}

function createLmdbCollection(
    database: Database<any, AgentWebSessionLmdbStorageKey>,
    orderKey: OrderKey,
    nextOrderKey: OrderKey,
) {
    return {
        get: async (key: any): Promise<any> => {
            const value = database.get([orderKey, key]);
            return value === undefined ? undefined : value;
        },
        put: async (key: any, value: any): Promise<void> => {
            await database.put([orderKey, key], value);
        },
        delete: async (key: any): Promise<boolean> => {
            return await database.remove([orderKey, key]);
        },
        list: async ({prefix}: {prefix?: string} = {}): Promise<Map<any, any>> => {
            const endPrefix = prefix === undefined ? undefined : getStringPrefixEnd(prefix);
            const end: AgentWebSessionLmdbStorageKey =
                endPrefix === undefined ? [nextOrderKey, ""] : [orderKey, endPrefix];
            const valueByKey = new Map<any, any>();

            for (const {key: storedKey, value} of database.getRange({
                start: [orderKey, prefix ?? ""],
                end,
            })) {
                assert(storedKey[0] === orderKey);
                valueByKey.set(storedKey[1], value);
            }

            return valueByKey;
        },
    };
}

function getStringPrefixEnd(prefix: string): string | undefined {
    const characters = Array.from(prefix);

    for (let index = characters.length - 1; index >= 0; index--) {
        const codePoint = characters[index]!.codePointAt(0)!;
        if (codePoint === 0x10ffff) continue;

        const nextCodePoint = codePoint === 0xd7ff ? 0xe000 : codePoint + 1;
        return characters.slice(0, index).join("") + String.fromCodePoint(nextCodePoint);
    }

    return undefined;
}
