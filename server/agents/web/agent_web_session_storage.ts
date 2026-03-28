import {AgentWebPageKey} from "~/server/agents/web/agent_web_page_key.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";

// NOCOMMIT: Document, make sure it's clear we have exclusive access. And that we
// want to be able to write a DynamoDB implementation.
export interface AgentWebSessionStorage {
    // NOCOMMIT: Document
    readonly mutex: Mutex;

    // NOCOMMIT: Document
    readonly pageKeyByLinkPath: AgentWebSessionStorageCollection<string, AgentWebPageKey>;

    // NOCOMMIT: Document
    readonly lastPageLinkPathByKey: AgentWebSessionStorageCollection<AgentWebPageKey, string>;

    // NOCOMMIT: Document
    readonly dedupeNumberByTruncatedUrlAndUrl: AgentWebSessionStorageCollection<
        `${string} ${string}`,
        number
    >;

    // NOCOMMIT: Document
    readonly documentCommentThreadNumberById: AgentWebSessionStorageCollection<
        `${DocumentId}-${DocumentCommentThreadId}`,
        number
    >;

    // NOCOMMIT: Document
    readonly documentCommentThreadIdByNumber: AgentWebSessionStorageCollection<
        `${number}`,
        `${DocumentId}-${DocumentCommentThreadId}`
    >;

    // NOCOMMIT: Document
    readonly tableWidthByTruncatedWidth: AgentWebSessionStorageCollection<string, number>;

    // NOCOMMIT: Document
    readonly tableColumnWidthsByTruncatedColumnWidths: AgentWebSessionStorageCollection<
        string,
        ReadonlyArray<number>
    >;
}

// NOCOMMIT: Document
export interface AgentWebSessionStorageCollection<Key extends string, Value> {
    get(key: Key): Promise<Value | undefined>;
    put(key: Key, value: Value): Promise<void>;
    list(options?: {prefix?: string}): Promise<Map<Key, Value>>;
}
