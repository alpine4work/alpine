import murmurhash from "murmurhash";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {decodeId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * The cached routes object becomes invalid after this period of time. You must
 * block while reloading the routes object. You can't use the old routes
 * object.
 */
export const taskRealtimeServiceRoutesInvalidatedMs = 1000 * 60 * 2;

/**
 * The cached routes object should be revalidated after this period of time in
 * the background. Then when the routes object becomes invalid we can use the
 * fresh routes object we prefetched so the user doesn't pay a cache
 * revalidation latency penalty.
 */
export const taskRealtimeServiceRoutesRevalidateMs =
    taskRealtimeServiceRoutesInvalidatedMs - 1000 * 5;

/**
 * The time `TaskRealtimeService` waits before it considers itself to be
 * healthy. It's very important that `TaskRealtimeService` sees every new
 * committed `TaskAction`. If `TaskRealtimeService` misses a `TaskAction`
 * related to permissions then users may be allowed to view data they're not
 * supposed until, worst case, the `TaskRealtimeService` instance restarts.
 *
 * We can't consider `TaskRealtimeService` to be healthy until all of our other
 * services discover it. Until then we need to keep running our old
 * `TaskRealtimeService` nodes.
 *
 * To be safe, we wait TWO route invalidations among our services. Our
 * `TaskRealtimeService` should be discovered after only one invalidation but
 * we wait two in case the ECS API calls we make are eventually consistent.
 *
 * Deployment speed is bounded by this time! So we need to balance the wait
 * time being relatively quick while also not overloading ECS APIs.
 */
// NOTE(calebmer): I know "service discovery" is an area of distributed systems
// but I'm unfamiliar with it. Maybe there are better ways to implement
// discovery for `TaskRealtimeService`?
//
// I'd also love some protections/monitors that make sure `TaskRealtimeService`
// does indeed see every `TaskAction`.
export const taskRealtimeServiceDiscoveryWaitMs = taskRealtimeServiceRoutesInvalidatedMs * 2;

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
    isHealthy: Schema.boolean,
    workers: Schema.array(TaskRealtimeServiceRoutesPartitionInstanceWorkerSchema),
});

const TaskRealtimeServiceRoutesPartitionSchema = Schema.object({
    instances: Schema.array(TaskRealtimeServiceRoutesPartitionInstanceSchema),
});

const TaskRealtimeServiceRoutesPartitionPlaneSchema = Schema.object({
    partitions: Schema.array(TaskRealtimeServiceRoutesPartitionSchema),
});

export const TaskRealtimeServiceRoutesSchema = Schema.object({
    // During a deployment where we increase the number of `TaskRealtimeService`
    // partitions we have, we may have the old set of partitions and the new set of
    // partitions running at once.
    //
    // To make sure we route requests properly these "planes" (segmented by
    // partition count) need to be considered separately. Randomly picking a
    // partition for a space across partitions with different partition counts may
    // end up with an unexpected distribution of spaces.
    partitionPlanes: Schema.array(TaskRealtimeServiceRoutesPartitionPlaneSchema),
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

    private readonly _stableRandom = new StableRandom("TaskRealtimeServiceRouter");

    /**
     * Get the `TaskRealtimeService` hosts for this `SpaceId` (combination of
     * `hostname` and `port`).
     *
     * If there are multiple URLs then that means we have multiple
     * `TaskRealtimeService` instances for the space. You may choose one however
     * you'd like or send a request to all of them if you need.
     *
     * If there are no hosts something bad has happened while deploying! We should
     * always have at least one host per `SpaceId`.
     */
    public async getHosts(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        spaceId: SpaceId,
    ): Promise<Array<{isHealthy: boolean; host: string}>> {
        const routes = await this.getRoutes(context);

        const hash = murmurhash.v3(decodeId(spaceId));
        const hosts: Array<{isHealthy: boolean; host: string}> = [];

        for (const partitionPlane of routes.partitionPlanes) {
            if (partitionPlane.partitions.length === 0) continue;

            const partition = partitionPlane.partitions[hash % partitionPlane.partitions.length]!;

            for (const instance of partition.instances) {
                if (instance.workers.length === 0) continue;

                const worker = instance.workers[hash % instance.workers.length]!;
                hosts.push({
                    isHealthy: instance.isHealthy,
                    host: worker.host,
                });
            }
        }

        return hosts;
    }

    /**
     * If an account wants to connect to `TaskRealtimeService` then we
     * consistently pick a single, healthy, host.
     */
    public async getStickyAccountHost(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        spaceId: SpaceId,
        accountId: AccountId,
    ): Promise<string> {
        const allHosts = await this.getHosts(context, spaceId);

        const healthyHosts = filterMapArray(allHosts, ({isHealthy, host}) =>
            isHealthy ? host : undefined,
        );

        if (healthyHosts.length === 0) {
            throw new InternalError(
                "No healthy `TaskRealtimeService` instance found for this space",
            );
        }

        if (healthyHosts.length === 1) {
            return healthyHosts[0]!;
        }

        // The order of hosts is not specified. Since we want to route a `SessionId` to
        // the same host over, sort the host list so our choice is stable if the host
        // list doesn't change.
        healthyHosts.sort();

        const hostIndex = this._stableRandom.randomInteger(accountId, 0, healthyHosts.length);

        return healthyHosts[hostIndex]!;
    }

    /**
     * Get a random host for connecting to `TaskRealtimeService`. May return a
     * different host every call.
     */
    public async getRandomHost(
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>,
        spaceId: SpaceId,
    ): Promise<string> {
        const allHosts = await this.getHosts(context, spaceId);

        const healthyHosts = filterMapArray(allHosts, ({isHealthy, host}) =>
            isHealthy ? host : undefined,
        );

        if (healthyHosts.length === 0) {
            throw new InternalError(
                "No healthy `TaskRealtimeService` instance found for this space",
            );
        }

        if (healthyHosts.length === 1) {
            return healthyHosts[0]!;
        }

        // The order of hosts is not specified. Since we want to route a `SessionId` to
        // the same host over, sort the host list so our choice is stable if the host
        // list doesn't change.
        healthyHosts.sort();

        const hostIndex = randomInteger(healthyHosts.length);

        return healthyHosts[hostIndex]!;
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
        {isBlocking}: {isBlocking: boolean},
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
            const routesPromise = this._loadRoutes(context, {isBlocking: true});
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
            const routesPromise = this._loadRoutes(context, {isBlocking: false});
            context.process.waitUntil(routesPromise);

            this._routesState.next = {
                loadTime: currentTime,
                promise: routesPromise,
            };
        }

        return this._routesState.promise;
    }
}
