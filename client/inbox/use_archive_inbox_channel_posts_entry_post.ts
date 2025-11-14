import {Memo, useCallback} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {useReporter} from "~/client/design/reporter.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {InboxChannelPostsEntryModel, InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {
    archiveInboxChannelPostsEntryPost,
    unarchiveInboxChannelPostsEntryPost,
} from "~/shared/rpc/notifications_rpc_definitions.js";

const archiveInboxChannelPostsEntryPostOptimisticallyEmitter =
    new EventEmitter<ArchiveInboxChannelPostsEntryPostOptimisticallyEvent>();

export type ArchiveInboxChannelPostsEntryPostOptimisticallyEvent = {
    readonly promise: Promise<unknown>;
    readonly entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
    readonly withAnimation: boolean;
    readonly postId: PostId;
};

export function subscribeToArchiveInboxChannelPostsEntryPostOptimistically(
    listener: (event: ArchiveInboxChannelPostsEntryPostOptimisticallyEvent) => void,
) {
    return archiveInboxChannelPostsEntryPostOptimisticallyEmitter.subscribe(listener);
}

export function useArchiveInboxChannelPostsEntryPost(): Memo<
    (options: {
        entry: DynamoGeneralRealtimeItem<InboxChannelPostsEntryModel>;
        withAnimation: boolean;
        postId: PostId;
    }) => void
> {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const reporter = useReporter();

    return useCallback(
        ({entry, withAnimation, postId}) => {
            const promise = archiveInboxChannelPostsEntryPost(context, {
                spaceId: space.id,
                channelId: entry.model.getChannelId(),
                bucketGeneration: entry.model.bucketGeneration,
                postId,
            });

            promise.catch(error => {
                reporter.displayError("Couldn’t dismiss notification", error);
            });

            archiveInboxChannelPostsEntryPostOptimisticallyEmitter.emit({
                promise,
                entry,
                withAnimation,
                postId,
            });
        },
        [context, reporter, space.id],
    );
}

export function archiveInboxChannelPostsEntryPostOptimistically(
    event: ArchiveInboxChannelPostsEntryPostOptimisticallyEvent,
) {
    archiveInboxChannelPostsEntryPostOptimisticallyEmitter.emit(event);
}

const unarchiveInboxChannelPostsEntryPostOptimisticallyEmitter =
    new EventEmitter<UnarchiveInboxChannelPostsEntryPostOptimisticallyEvent>();

export type UnarchiveInboxChannelPostsEntryPostOptimisticallyEvent = {
    readonly promise: Promise<unknown>;
    readonly entry: DynamoGeneralRealtimeItem<InboxEntryModel>;
    readonly withAnimation: boolean;
    readonly postId: PostId;
};

export function subscribeToUnarchiveInboxChannelPostsEntryPostOptimistically(
    listener: (event: UnarchiveInboxChannelPostsEntryPostOptimisticallyEvent) => void,
) {
    return unarchiveInboxChannelPostsEntryPostOptimisticallyEmitter.subscribe(listener);
}

export function useUnarchiveInboxChannelPostsEntryPost(): Memo<
    (options: {
        entry: DynamoGeneralRealtimeItem<InboxChannelPostsEntryModel>;
        withAnimation: boolean;
        postId: PostId;
    }) => void
> {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const reporter = useReporter();

    return useCallback(
        ({entry, withAnimation, postId}) => {
            const promise = unarchiveInboxChannelPostsEntryPost(context, {
                spaceId: space.id,
                channelId: entry.model.getChannelId(),
                bucketGeneration: entry.model.bucketGeneration,
                postId,
            });

            promise.catch(error => {
                reporter.displayError("Couldn’t move notification to new", error);
            });

            unarchiveInboxChannelPostsEntryPostOptimisticallyEmitter.emit({
                promise,
                entry,
                withAnimation,
                postId,
            });
        },
        [context, reporter, space.id],
    );
}
