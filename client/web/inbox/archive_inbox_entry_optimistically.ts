import {Memo, useCallback} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {
    archiveInboxEntry,
    unarchiveInboxEntry,
} from "~/shared/rpc/notifications_rpc_definitions.js";

const archiveInboxEntryOptimisticallyEmitter =
    new EventEmitter<ArchiveInboxEntryOptimisticallyEvent>();

export type ArchiveInboxEntryOptimisticallyEvent = {
    readonly promise: Promise<unknown>;
    readonly entry: RynamoItem<InboxEntryModel>;
    readonly withAnimation: boolean;
};

export function subscribeToArchiveInboxEntryOptimistically(
    listener: (event: ArchiveInboxEntryOptimisticallyEvent) => void,
) {
    return archiveInboxEntryOptimisticallyEmitter.subscribe(listener);
}

export function useArchiveInboxEntry(): Memo<
    (options: {entry: RynamoItem<InboxEntryModel>; withAnimation: boolean}) => void
> {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const reporter = useReporter();

    return useCallback(
        ({entry, withAnimation}) => {
            const promise = archiveInboxEntry(context, {
                spaceId: space.id,
                key: entry.model.getKey(),
            });

            promise.catch(error => {
                reporter.displayError("Couldn\u2019t dismiss notification", error);
            });

            archiveInboxEntryOptimisticallyEmitter.emit({
                promise,
                entry,
                withAnimation,
            });
        },
        [context, reporter, space.id],
    );
}

export function archiveInboxEntryOptimistically(event: ArchiveInboxEntryOptimisticallyEvent) {
    archiveInboxEntryOptimisticallyEmitter.emit(event);
}

const unarchiveInboxEntryOptimisticallyEmitter =
    new EventEmitter<UnarchiveInboxEntryOptimisticallyEvent>();

export type UnarchiveInboxEntryOptimisticallyEvent = {
    readonly promise: Promise<unknown>;
    readonly entry: RynamoItem<InboxEntryModel>;
    readonly withAnimation: boolean;
};

export function subscribeToUnarchiveInboxEntryOptimistically(
    listener: (event: UnarchiveInboxEntryOptimisticallyEvent) => void,
) {
    return unarchiveInboxEntryOptimisticallyEmitter.subscribe(listener);
}

export function useUnarchiveInboxEntry(): Memo<
    (options: {entry: RynamoItem<InboxEntryModel>; withAnimation: boolean}) => void
> {
    const context = useAppContext();
    const {space} = useSpaceContext();
    const reporter = useReporter();

    return useCallback(
        ({entry, withAnimation}) => {
            const promise = unarchiveInboxEntry(context, {
                spaceId: space.id,
                key: entry.model.getKey(),
            });

            promise.catch(error => {
                reporter.displayError("Couldn\u2019t move notification to new", error);
            });

            unarchiveInboxEntryOptimisticallyEmitter.emit({
                promise,
                entry,
                withAnimation,
            });
        },
        [context, reporter, space.id],
    );
}
