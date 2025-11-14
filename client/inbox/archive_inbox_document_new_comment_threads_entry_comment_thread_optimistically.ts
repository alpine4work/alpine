import {DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

export type ArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent = {
    readonly promise: Promise<unknown>;
    readonly entryKey: DynamoItemKey;
    readonly commentThreadId: DocumentCommentThreadId;
};

const archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEmitter =
    new EventEmitter<ArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent>();

export function archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically(
    event: ArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent,
) {
    archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEmitter.emit(event);
}

export function subscribeToArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimistically(
    listener: (
        event: ArchiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEvent,
    ) => void,
) {
    return archiveInboxDocumentNewCommentThreadsEntryCommentThreadOptimisticallyEmitter.subscribe(
        listener,
    );
}
