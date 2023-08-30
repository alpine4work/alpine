import murmurhash from "murmurhash";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {decodeId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * The cached routes object becomes invalid after this period of time. You must
 * block while reloading the routes object. You can't use the old routes
 * object.
 */
export const taskRealtimeServiceRoutesInvalidatedMs = 1000 * 60 * 4;

/**
 * The cached routes object should be revalidated after this period of time in
 * the background. Then when the routes object is invalid we can use the fresh
 * routes object we revalidated so the user doesn't pay a cache revalidation
 * latency penalty.
 */
export const taskRealtimeServiceRoutesRevalidateMs = 1000 * 60 * 3;

/**
 * Describes the layout of our `TaskRealtimeService` fleet to allow
 * `TaskRealtimeServiceRouterBase` to correctly route requests to the right
 * HTTP server(s).
 *
 * See the documentation on `TaskRealtimeServiceRouterBase` for more.
 */
export type TaskRealtimeServiceRoutes = SchemaType<typeof TaskRealtimeServiceRoutesSchema>;

const TaskRealtimeServiceRoutesPartitionInstanceWorkerSchema = Schema.object({
    host: Schema.string,
});

const TaskRealtimeServiceRoutesPartitionInstanceSchema = Schema.object({
    workers: Schema.array(TaskRealtimeServiceRoutesPartitionInstanceWorkerSchema),
});

const TaskRealtimeServiceRoutesPartitionSchema = Schema.object({
    instances: Schema.array(TaskRealtimeServiceRoutesPartitionInstanceSchema),
});

export const TaskRealtimeServiceRoutesSchema = Schema.object({
    partitions: Schema.array(TaskRealtimeServiceRoutesPartitionSchema),
});

/**
 * `TaskRealtimeService` is a stateful service where different `SpaceId`s are
 * handled by different server instances. So when we have a request for
 * `TaskRealtimeService` we need to route that request to the correct server.
 * This class provides the logic for that routing. The service layout is:
 *
 * - We have a number of logical partitions
 * - Within each partition is at least one server instance, possibly more if
 *   we're in the middle of a deploy
 * - Each server instance has multiple workers so it can do work in parallel
 *
 * To route a request for a `SpaceId` we pick a partition (`SpaceId`s are
 * evenly balanced across partitions with a hash function) and pick an instance
 * worker. If there are multiple running instances (there may be multiple
 * instances during a deploy or an auto-scaling rule may create a new instance)
 * we randomly pick an instance. For requests like applying an action
 * transaction in `TaskRealtimeService` then we need to apply the action
 * against all instances.
 *
 * This class has a "routes" object it uses to determine where to route
 * requests. This routes object is refreshed at regular intervals. Different
 * sub-classes will load the routes object from different places.
 */
export abstract class TaskRealtimeServiceRouterBase {
    private _routesState: {
        loadTime: number;
        promise: Promise<TaskRealtimeServiceRoutes>;
        next: {
            loadTime: number;
            promise: Promise<TaskRealtimeServiceRoutes>;
        } | null;
    } | null = null;

    /**
     * Get the `TaskRealtimeService` URLs for this `SpaceId`. Will always return a
     * non-empty array. If there are multiple URLs then that means we have multiple
     * `TaskRealtimeService` instances for the space. You may choose one however
     * you'd like or send a request to all of them if you need.
     */
    public async getHosts(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        spaceId: SpaceId,
    ): Promise<Array<string>> {
        const routes = await this.getRoutes(context);
        assert(routes.partitions.length > 0);

        const hash = murmurhash.v3(decodeId(spaceId));
        const partition = routes.partitions[hash % routes.partitions.length]!;
        assert(partition.instances.length > 0);

        return partition.instances.map(instance => {
            assert(instance.workers.length > 0);
            const worker = instance.workers[hash % instance.workers.length]!;
            return worker.host;
        });
    }

    /**
     * Load the current routes object which tells us how many `TaskRealtimeService`
     * instances are running and the network address to reach them.
     *
     * This function always loads the routes object fresh. Instead you should
     * generally call `_getRoutes()` which caches the routes object for some
     * duration.
     */
    protected abstract _loadRoutes(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
    ): Promise<TaskRealtimeServiceRoutes>;

    /**
     * Get the current routes object. Calls `_loadRoutes()` and caches the result
     * for some duration.
     */
    public getRoutes(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
    ): Promise<TaskRealtimeServiceRoutes> {
        const currentTime = Date.now();

        // If our routes promise is invalidated and we have a new promise at the
        // ready, substitute it in.
        if (
            this._routesState &&
            currentTime - this._routesState.loadTime > taskRealtimeServiceRoutesInvalidatedMs &&
            this._routesState.next
        ) {
            this._routesState = {
                loadTime: this._routesState.next.loadTime,
                promise: this._routesState.next.promise,
                next: null,
            };
        }

        // This branch runs if one of the following is true:
        //
        // 1. We haven't loaded routes yet yet; OR
        // 2. We have a routes promise that's invalidated and have not started
        //    a new routes promise in the background; OR
        // 3. We had started a new routes promise in the background but enough
        //    time has passed that the background routes promise has become
        //    invalidated.
        //
        // We reach case 3 if the branch above sets the new routes promise but
        // the new routes promise is also invalidated.
        if (
            this._routesState === null ||
            currentTime - this._routesState.loadTime > taskRealtimeServiceRoutesInvalidatedMs
        ) {
            const routesPromise = this._loadRoutes(context);
            context.process.waitUntil(routesPromise);

            this._routesState = {
                loadTime: currentTime,
                promise: routesPromise,
                next: null,
            };
        }

        // If we've passed our revalidation timeout then reload routes in the
        // background. Once our current routes promise expires we can switch to
        // this one.
        if (
            currentTime - this._routesState.loadTime > taskRealtimeServiceRoutesRevalidateMs &&
            !this._routesState.next
        ) {
            const routesPromise = this._loadRoutes(context);
            context.process.waitUntil(routesPromise);

            this._routesState.next = {
                loadTime: currentTime,
                promise: routesPromise,
            };
        }

        return this._routesState.promise;
    }
}
