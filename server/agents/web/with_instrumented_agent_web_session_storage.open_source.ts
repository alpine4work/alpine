import {
    AgentWebSessionStorage,
    AgentWebSessionStorageCollection,
} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {JsonStringifiableValue} from "~/shared/helpers/types/json_value.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export async function withInstrumentedAgentWebSessionStorage<Value>(
    span: TracerSpan,
    storage: AgentWebSessionStorage,
    action: (storage: AgentWebSessionStorage) => Promise<Value>,
): Promise<Value> {
    let state: {calls: number; startTime: number} | null = null;
    let getState: {calls: number; startTime: number} | null = null;
    let putState: {calls: number; startTime: number} | null = null;
    let deleteState: {calls: number; startTime: number} | null = null;
    let listState: {calls: number; startTime: number} | null = null;
    let totalDurationMs = 0;
    let totalGetCallCount = 0;
    let totalGetDurationMs = 0;
    let totalPutCallCount = 0;
    let totalPutDurationMs = 0;
    let totalDeleteCallCount = 0;
    let totalDeleteDurationMs = 0;
    let totalListCallCount = 0;
    let totalListDurationMs = 0;

    const instrumentedStorage: AgentWebSessionStorage = {
        spaceId: storage.spaceId,
        mutex: storage.mutex,
        pageStoredLinkByPathname: instrument(span, storage.pageStoredLinkByPathname),
        latestPageStoredLinkPathnameByKey: instrument(
            span,
            storage.latestPageStoredLinkPathnameByKey,
        ),
        urlByTruncatedUrl: instrument(span, storage.urlByTruncatedUrl),
        dedupeNumberByTruncatedUrlAndUrl: instrument(
            span,
            storage.dedupeNumberByTruncatedUrlAndUrl,
        ),
        documentCommentThreadNumberById: instrument(span, storage.documentCommentThreadNumberById),
        documentCommentThreadIdByNumber: instrument(span, storage.documentCommentThreadIdByNumber),
        taskQueryCursorByHash: instrument(span, storage.taskQueryCursorByHash),
        tableWidthByTruncatedWidth: instrument(span, storage.tableWidthByTruncatedWidth),
        tableColumnWidthsByTruncatedColumnWidths: instrument(
            span,
            storage.tableColumnWidthsByTruncatedColumnWidths,
        ),
        readResponseByPath: instrument(span, storage.readResponseByPath),
        readResponseMutexByPath: storage.readResponseMutexByPath,
    };

    const value = await action(instrumentedStorage);

    span.addData({
        agents: {
            web: {
                storage: {
                    totalDurationMs,
                    totalGetCallCount,
                    totalGetDurationMs,
                    totalPutCallCount,
                    totalPutDurationMs,
                    totalDeleteCallCount,
                    totalDeleteDurationMs,
                    totalListCallCount,
                    totalListDurationMs,
                },
            },
        },
    });

    return value;

    function instrument<
        Key extends string | readonly [string, string],
        Value extends JsonStringifiableValue,
    >(
        span: TracerSpan,
        collection: AgentWebSessionStorageCollection<Key, Value>,
    ): AgentWebSessionStorageCollection<Key, Value> {
        return {
            get: async key => {
                totalGetCallCount++;

                state ??= {calls: 0, startTime: span.clock.now()};
                state.calls++;

                getState ??= {calls: 0, startTime: span.clock.now()};
                getState.calls++;

                try {
                    return await collection.get(key);
                } finally {
                    state.calls--;
                    getState.calls--;

                    if (state.calls === 0) {
                        totalDurationMs += span.clock.now() - state.startTime;
                        state = null;
                    }

                    if (getState.calls === 0) {
                        totalGetDurationMs += span.clock.now() - getState.startTime;
                        getState = null;
                    }
                }
            },
            put: async (key, value) => {
                totalPutCallCount++;

                state ??= {calls: 0, startTime: span.clock.now()};
                state.calls++;

                putState ??= {calls: 0, startTime: span.clock.now()};
                putState.calls++;

                try {
                    return await collection.put(key, value);
                } finally {
                    state.calls--;
                    putState.calls--;

                    if (state.calls === 0) {
                        totalDurationMs += span.clock.now() - state.startTime;
                        state = null;
                    }

                    if (putState.calls === 0) {
                        totalPutDurationMs += span.clock.now() - putState.startTime;
                        putState = null;
                    }
                }
            },
            delete: async key => {
                totalDeleteCallCount++;

                state ??= {calls: 0, startTime: span.clock.now()};
                state.calls++;

                deleteState ??= {calls: 0, startTime: span.clock.now()};
                deleteState.calls++;

                try {
                    return await collection.delete(key);
                } finally {
                    state.calls--;
                    deleteState.calls--;

                    if (state.calls === 0) {
                        totalDurationMs += span.clock.now() - state.startTime;
                        state = null;
                    }

                    if (deleteState.calls === 0) {
                        totalDeleteDurationMs += span.clock.now() - deleteState.startTime;
                        deleteState = null;
                    }
                }
            },
            list: async keyFirst => {
                totalListCallCount++;

                state ??= {calls: 0, startTime: span.clock.now()};
                state.calls++;

                listState ??= {calls: 0, startTime: span.clock.now()};
                listState.calls++;

                try {
                    return await collection.list(keyFirst);
                } finally {
                    state.calls--;
                    listState.calls--;

                    if (state.calls === 0) {
                        totalDurationMs += span.clock.now() - state.startTime;
                        state = null;
                    }

                    if (listState.calls === 0) {
                        totalListDurationMs += span.clock.now() - listState.startTime;
                        listState = null;
                    }
                }
            },
        };
    }
}
