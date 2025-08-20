import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {
    TaskRealtimeProcessContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {TaskRealtimeStoreCollectionEntry} from "~/server/tasks/realtime/task_realtime_store.js";
import {
    TaskRealtimeUnsubscribeUpdateEventBuilder,
    TaskRealtimeUpdateEventBuilderBase,
} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {InternalError} from "~/shared/error/error.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";

export type TaskRealtimeCollectionSubscriptionCallbacks = {
    /**
     * An unexpected internal server error has occurred which has caused the
     * subscription to disconnect. The subscription will receive no more events
     * after this. Subscribers should present an error to users or attempt to
     * reconnect.
     */
    onFatalError(context: TaskRealtimeProcessContext, error: InternalError): void;

    /**
     * When we first subscribe to a collection, this function is called so the
     * subscriber gets the initial collection.
     */
    onCollectionSubscribe(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newCollection: TaskCollectionIndexDoc,
    ): void;

    /**
     * Called whenever the collection we're subscribed to updates.
     */
    onCollectionUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        collectionId: TaskCollectionId,
        oldCollection: TaskCollectionIndexDoc,
        newCollection: TaskCollectionIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ): void;

    /**
     * When we have unsubscribed from a collection, this function is called so the
     * subscriber can cleanup any references to the collection.
     */
    onCollectionUnsubscribe(
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldCollection: TaskCollectionIndexDoc,
    ): void;
};

/**
 * A subscription to a single collection.
 */
export class TaskRealtimeCollectionSubscription {
    private readonly _internal: TaskRealtimeCollectionSubscriptionInternal;

    constructor(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        collectionEntry: TaskRealtimeStoreCollectionEntry,
        callbacks: TaskRealtimeCollectionSubscriptionCallbacks,
    ) {
        this._internal = new TaskRealtimeCollectionSubscriptionInternal(
            context,
            eventBuilder,
            collectionEntry,
            callbacks,
        );
    }

    public getCollectionId(): TaskCollectionId {
        return this._internal.collectionEntry.collection.id;
    }

    public unsubscribe(): Promise<void> {
        return this._internal.unsubscribe();
    }
}

export class TaskRealtimeCollectionSubscriptionInternal {
    public readonly collectionEntry: TaskRealtimeStoreCollectionEntry;
    private readonly _callbacks: TaskRealtimeCollectionSubscriptionCallbacks;
    private _isSubscribed = true;

    constructor(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        collectionEntry: TaskRealtimeStoreCollectionEntry,
        callbacks: TaskRealtimeCollectionSubscriptionCallbacks,
    ) {
        this.collectionEntry = collectionEntry;
        this._callbacks = callbacks;
        this.collectionEntry.addCollectionSubscriptionDependent(this);

        const newCollection = collectionEntry.collection;
        this._callbacks.onCollectionSubscribe(context, eventBuilder, newCollection);
    }

    public unsubscribe() {
        assert(this._isSubscribed);
        this._isSubscribed = false;
        this.collectionEntry.removeCollectionSubscriptionDependent(this);

        // We construct an event builder just so we can wait out `waitUntil()`
        // promises.
        const eventBuilder = new TaskRealtimeUnsubscribeUpdateEventBuilder(
            this.collectionEntry.store.spaceId,
        );

        const oldCollection = this.collectionEntry.collection;
        this._callbacks.onCollectionUnsubscribe(eventBuilder, oldCollection);

        return eventBuilder.finishAndIgnoreEvents();
    }

    public onCollectionUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        collectionId: TaskCollectionId,
        oldCollection: TaskCollectionIndexDoc,
        newCollection: TaskCollectionIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        assert(this._isSubscribed);

        this._callbacks.onCollectionUpdate(
            context,
            eventBuilder,
            collectionId,
            oldCollection,
            newCollection,
            actions,
        );
    }

    public onFatalError(context: TaskRealtimeProcessContext, error: InternalError) {
        try {
            this._callbacks.onFatalError(context, error);
        } catch (error) {
            // Treat errors from our error callback as uncaught exceptions.
            scheduleUncaughtError(error);
        }
    }
}
