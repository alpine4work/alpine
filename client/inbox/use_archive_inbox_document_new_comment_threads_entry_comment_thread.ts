import {Memo, useCallback} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {useReporter} from "~/client/design/reporter.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {
    InboxDocumentNewCommentThreadsEntryModel,
    InboxEntryModel,
} from "~/shared/notifications/inbox_model.js";
import {
    archiveInboxDocumentNewCommentThreadsEntryCommentThread,
    unarchiveInboxDocumentNewCommentThreadsEntryCommentThread,
} from "~/shared/rpc/notifications_rpc_definitions.js";

const archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEmitter =
    new EventEmitter<ArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent>();

export type ArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent = {
    readonly promise: Promise<unknown>;
    readonly entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
    readonly withAnimation: boolean;
    readonly commentThreadId: DocumentCommentThreadId;
};

export function subscribeToArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically(
    listener: (
        event: ArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent,
    ) => void,
) {
    return archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEmitter.subscribe(
        listener,
    );
}

export function useArchiveInboxDocumentNewCommentThreadsEntryCommentThread(): Memo<
    (options: {
        entry: DynamoGeneralRealtimeItem<InboxDocumentNewCommentThreadsEntryModel>;
        withAnimation: boolean;
        commentThreadId: DocumentCommentThreadId;
    }) => void
> {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const reporter = useReporter();

    return useCallback(
        ({entry, withAnimation, commentThreadId}) => {
            const promise = archiveInboxDocumentNewCommentThreadsEntryCommentThread(context, {
                spaceId: space.id,
                documentId: entry.model.getDocumentId(),
                bucketGeneration: entry.model.bucketGeneration,
                commentThreadId,
            });

            promise.catch(error => {
                reporter.displayError("Couldn’t dismiss notification", error);
            });

            archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEmitter.emit({
                promise,
                entry,
                withAnimation,
                commentThreadId,
            });
        },
        [context, reporter, space.id],
    );
}

export function archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically(
    event: ArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent,
) {
    archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEmitter.emit(event);
}

const unarchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEmitter =
    new EventEmitter<UnarchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent>();

export type UnarchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent = {
    readonly promise: Promise<unknown>;
    readonly entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
    readonly withAnimation: boolean;
    readonly commentThreadId: DocumentCommentThreadId;
};

export function subscribeToUnarchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically(
    listener: (
        event: UnarchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent,
    ) => void,
) {
    return unarchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEmitter.subscribe(
        listener,
    );
}

export function useUnarchiveInboxDocumentNewCommentThreadsEntryCommentThread(): Memo<
    (options: {
        entry: DynamoGeneralRealtimeItem<InboxDocumentNewCommentThreadsEntryModel>;
        withAnimation: boolean;
        commentThreadId: DocumentCommentThreadId;
    }) => void
> {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const reporter = useReporter();

    return useCallback(
        ({entry, withAnimation, commentThreadId}) => {
            const promise = unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(context, {
                spaceId: space.id,
                documentId: entry.model.getDocumentId(),
                bucketGeneration: entry.model.bucketGeneration,
                commentThreadId,
            });

            promise.catch(error => {
                reporter.displayError("Couldn’t move notification to new", error);
            });

            unarchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEmitter.emit({
                promise,
                entry,
                withAnimation,
                commentThreadId,
            });
        },
        [context, reporter, space.id],
    );
}
