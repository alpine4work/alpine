import {useCallback, useMemo, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {RynamoQuery} from "~/client/web/dynamo/rynamo_query.js";
import {useRynamoQueryBase} from "~/client/web/dynamo/use_rynamo_query.js";
import {
    TaskActivityFeedCreation,
    TaskActivityFeedItem,
    TaskActivityFeedWindow,
    deriveTaskActivityFeed,
} from "~/client/web/tasks/internal/derive_task_activity_feed.js";
import {RynamoEvent, RynamoQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";
import {backfillTaskActivity, getTaskActivityEntries} from "~/shared/rpc/tasks_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    TaskActivityActor,
    TaskActivityFeedDiscreteEntryModel,
    TaskActivityFeedWindowChunkModel,
    TaskActivityModel,
} from "~/shared/tasks/task_activity.js";
import {
    TaskActivityWindowForActor,
    decodeTaskActivityWindows,
} from "~/shared/tasks/task_activity_window_chunk.js";
import {TaskCreator} from "~/shared/tasks/task_creator.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

export type TaskActivityFeedTaskCreation = Omit<TaskActivityFeedCreation, "actor"> & {
    readonly actor: TaskCreator & {readonly workingAccountName: string};
};

// A realtime event replaces exactly one chunk model, but `handleEvents()` returns
// a whole new query object, so the extraction memo below re-walks every loaded
// item. Caching decodes per model instance means only the replaced chunk actually
// re-decodes — the unchanged chunks keep their model identity across events.
const decodedWindowsByChunkModel = new WeakMap<
    TaskActivityFeedWindowChunkModel,
    Array<TaskActivityWindowForActor<TaskActivityActor>>
>();

/**
 * A task's activity as loaded by the task route's loader, seeding the query so
 * activity renders in the initial paint instead of shifting the interleaved
 * comments when it arrives after mount.
 */
export type TaskActivityFeedInitialData = {
    readonly entriesResult: RynamoQueryResult<TaskActivityModel>;
};

/**
 * The task's activity feed, loaded in full and kept up-to-date in realtime by a
 * `useRynamoQueryBase()` query. Raw entries and decoded title/notes windows are
 * derived once here whenever the realtime query changes; timeline rows only slice
 * the already-derived result between comments.
 *
 * Activity logs are small (entries are a few hundred bytes and tasks rarely
 * accumulate more than a few hundred), so the whole log loads up front — the
 * loader usually has all of it and the server pages only as a runaway safeguard —
 * and all sorting, filtering, and aggregation happens on the client.
 *
 * GHOST TASKS: a ghost task (`?create`) doesn't exist on the server yet, so the
 * loader seeds an empty result and `isTaskCommitted` holds back everything that
 * would talk to the server about it. Backfills and reloads would throw a not-found
 * error, and pongs would advance the query's checkpoint even though the server
 * isn't sending this task's activity events yet — a backfill starting from that
 * checkpoint would skip the activity written as the task was created. Once the
 * task commits, the backfill runs from the seed checkpoint (which predates
 * creation) and picks up everything. The route remounts for every other task
 * change, and the ghost's id survives creation, so `taskId` never changes in
 * place.
 */
export function useTaskActivityFeed(
    taskId: TaskId,
    initialActivity: TaskActivityFeedInitialData,
    {
        creation,
        isConnected,
        subscribeToPongs: subscribeToNotesPongs,
        subscribeToTaskActivityEvents,
    }: {
        creation: TaskActivityFeedTaskCreation | null;
        /**
         * Realtime plumbing from the task's `TaskNotesCollaborationService` connection
         * (see `useTaskDetailNotesContentEditorWebSocketClient()`). Connecting to that
         * durable object is the whole activity subscription, so `isConnected` alone says
         * when it's safe to backfill.
         */
        isConnected: boolean;
        subscribeToPongs: (subscriber: (message: WebSocketPongMessage) => void) => () => void;
        subscribeToTaskActivityEvents: (
            subscriber: (events: ReadonlyArray<RynamoEvent<TaskActivityModel>>) => void,
        ) => () => void;
    },
): ReadonlyArray<TaskActivityFeedItem> {
    const context = useAppContext();

    // NOTE(ifitzsimmons, 2026-08-03): We don't bother with optimistic updates for
    // activity feed items. They should appear in the feed relatively quickly.
    const [entriesQuery, setEntriesQuery] = useState(() =>
        RynamoQuery.new(initialActivity.entriesResult),
    );

    useRynamoQueryBase(
        {query: entriesQuery, onUpdateQuery: setEntriesQuery},
        {
            isConnected,
            subscribeToPongs: useCallback(
                (subscriber: (message: WebSocketPongMessage) => void) =>
                    subscribeToNotesPongs(subscriber),
                [subscribeToNotesPongs],
            ),
            subscribeToEvents: useCallback(
                (subscriber: (events: ReadonlyArray<RynamoEvent<unknown>>) => void) =>
                    subscribeToTaskActivityEvents(events => subscriber(events)),
                [subscribeToTaskActivityEvents],
            ),
            backfillQuery: useCallback(
                async (checkpoint: ServerSynchronizationCheckpoint) => {
                    const {result} = await backfillTaskActivity(context, {taskId, checkpoint});
                    return result;
                },
                [context, taskId],
            ),
            reloadQuery: useCallback(async () => {
                const {entriesResult} = await getTaskActivityEntries(context, {
                    taskId,
                    afterItemKey: null,
                });
                return entriesResult;
            }, [context, taskId]),
        },
    );

    const {entries, windows} = useMemo(() => {
        const entries: Array<TaskActivityFeedDiscreteEntryModel> = [];
        const windows: Array<TaskActivityFeedWindow> = [];

        const itemCount = entriesQuery.getItemCount();
        for (let index = 0; index < itemCount; index++) {
            const queryItem = entriesQuery.getItem(index);
            if (queryItem.type !== "Loaded") continue;

            const model = queryItem.item.model;
            if (model instanceof TaskActivityFeedDiscreteEntryModel) {
                entries.push(model);
            } else if (model instanceof TaskActivityFeedWindowChunkModel) {
                // Entries never update: changed chunk content always arrives as a NEW model
                // instance (the realtime event deserializes a fresh model, and unchanged items
                // keep their identity through the query's structural sharing), so a cache hit is
                // always current — and the WeakMap drops entries once the query releases old
                // instances.
                let decodedWindows = decodedWindowsByChunkModel.get(model);
                if (decodedWindows === undefined) {
                    decodedWindows = decodeTaskActivityWindows(model);
                    decodedWindowsByChunkModel.set(model, decodedWindows);
                }
                for (const window of decodedWindows) {
                    windows.push({...window, contentField: model.contentField});
                }
            }
        }
        return {entries, windows};
    }, [entriesQuery]);

    const activityCreation = useMemo<TaskActivityFeedCreation | null>(() => {
        if (creation === null) return null;

        return {
            taskId: creation.taskId,
            actionTime: creation.actionTime,
            actor: {
                account: new AccountModel({
                    ...AccountModel.getUnknownData(),
                    id: creation.actor.accountId,
                    name: creation.actor.workingAccountName,
                }),
                from:
                    creation.actor.from === null
                        ? null
                        : new AccountModel({
                              ...AccountModel.getUnknownData(),
                              id: creation.actor.from.accountId,
                          }),
            },
        };
    }, [creation]);

    const feedItems = useMemo(
        () => deriveTaskActivityFeed({entries, windows, creation: activityCreation}),
        [activityCreation, entries, windows],
    );

    return feedItems;
}
