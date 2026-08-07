import {DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";
import {PostId} from "~/shared/id/types/id_types.open_source.js";

export type ArchiveInboxChannelPostsEntryPostOptimisticallyEvent = {
    readonly promise: Promise<unknown>;
    readonly entryKey: DynamoItemKey;
    readonly postId: PostId;
};

const archiveInboxChannelPostsEntryPostOptimisticallyEmitter =
    new EventEmitter<ArchiveInboxChannelPostsEntryPostOptimisticallyEvent>();

export function archiveInboxChannelPostsEntryPostOptimistically(
    event: ArchiveInboxChannelPostsEntryPostOptimisticallyEvent,
) {
    archiveInboxChannelPostsEntryPostOptimisticallyEmitter.emit(event);
}

export function subscribeToArchiveInboxChannelPostsEntryPostOptimistically(
    listener: (event: ArchiveInboxChannelPostsEntryPostOptimisticallyEvent) => void,
) {
    return archiveInboxChannelPostsEntryPostOptimisticallyEmitter.subscribe(listener);
}
