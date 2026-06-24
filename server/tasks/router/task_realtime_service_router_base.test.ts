import {
    TaskRealtimeServiceRouterBase,
    TaskRealtimeServiceRoutes,
    taskRealtimeServiceRoutesInvalidatedMs,
    taskRealtimeServiceRoutesRevalidateMs,
} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

import.meta.jest.useFakeTimers();

afterEach(() => {
    import.meta.jest.clearAllTimers();
});

const processContext = Context.new({
    process: ProcessContextModule.test({afterEach}),
    tracer: new TracerContextModule(testTracer),
});

// A router whose loaded routes change every time so we can tell refreshes apart by
// the host (`host-1` on the first load, `host-2` on the second, and so on).
class CountingTaskRealtimeServiceRouter extends TaskRealtimeServiceRouterBase {
    public loadCount = 0;

    protected override async _loadRoutes(): Promise<TaskRealtimeServiceRoutes> {
        this.loadCount += 1;
        return createRoutes(`host-${this.loadCount}`);
    }

    public static async new({
        context,
        registerShutdown,
    }: {
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>;
        registerShutdown: (cleanup: () => void) => void;
    }): Promise<CountingTaskRealtimeServiceRouter> {
        const router = new CountingTaskRealtimeServiceRouter();

        await router._getRoutesAndStartRefreshInterval(context, {registerShutdown});

        return router;
    }
}

class SlowStartupTaskRealtimeServiceRouter extends TaskRealtimeServiceRouterBase {
    public loadCount = 0;

    private readonly _loadResolvers: Array<PromiseResolver<TaskRealtimeServiceRoutes>> = [];

    protected override _loadRoutes(): Promise<TaskRealtimeServiceRoutes> {
        this.loadCount += 1;

        const loadResolver = createPromiseResolver<TaskRealtimeServiceRoutes>();
        this._loadResolvers.push(loadResolver);

        return loadResolver.promise;
    }

    public resolveLoad(loadIndex: number, host: string) {
        this._loadResolvers[loadIndex]!.resolve(createRoutes(host));
    }

    public static start({
        context,
        registerShutdown,
    }: {
        context: Context<{process: ProcessContextModule; tracer: TracerContextModule}>;
        registerShutdown: (cleanup: () => void) => void;
    }): {
        router: SlowStartupTaskRealtimeServiceRouter;
        startupPromise: Promise<void>;
    } {
        const router = new SlowStartupTaskRealtimeServiceRouter();

        const startupPromise = router._getRoutesAndStartRefreshInterval(context, {
            registerShutdown,
        });

        return {router, startupPromise};
    }
}

test("loads routes before `new()` resolves and refreshes them on an interval", async () => {
    const cleanups: Array<() => void> = [];

    const router = await CountingTaskRealtimeServiceRouter.new({
        context: processContext,
        registerShutdown: cleanup => cleanups.push(cleanup),
    });

    // `new()` already awaited the first load, so routes are ready with no further
    // work.
    const initialRoutes = await router.getRoutes(processContext);

    // Advance past the revalidate interval. The loop should refresh on its own without
    // another `getRoutes()` call driving it.
    import.meta.jest.advanceTimersByTime(taskRealtimeServiceRoutesRevalidateMs);
    await ProcessContextModule.waitForTestTasks();
    const refreshedRoutes = await router.getRoutes(processContext);

    cleanups.forEach(cleanup => cleanup());

    expect({initialRoutes, refreshedRoutes}).toMatchObject({
        initialRoutes: {
            partitionPlanes: [{partitions: [{instances: [{workers: [{host: "host-1"}]}]}]}],
        },
        refreshedRoutes: {
            partitionPlanes: [{partitions: [{instances: [{workers: [{host: "host-2"}]}]}]}],
        },
    });
});

test("starts the refresh interval before startup route loading finishes", async () => {
    const cleanups: Array<() => void> = [];
    const {router, startupPromise} = SlowStartupTaskRealtimeServiceRouter.start({
        context: processContext,
        registerShutdown: cleanup => cleanups.push(cleanup),
    });

    import.meta.jest.advanceTimersByTime(1000);
    router.resolveLoad(0, "host-1");
    await startupPromise;

    import.meta.jest.advanceTimersByTime(taskRealtimeServiceRoutesRevalidateMs - 1000);
    expect(router.loadCount).toBe(2);

    router.resolveLoad(1, "host-2");
    await ProcessContextModule.waitForTestTasks();
    cleanups.forEach(cleanup => cleanup());
});

test("does not reuse an in-flight refresh after its load time is invalidated", async () => {
    const context = Context.new({
        process: new ProcessContextModule({waitUntil: () => {}}),
        tracer: new TracerContextModule(testTracer),
    });
    const cleanups: Array<() => void> = [];
    const {router, startupPromise} = SlowStartupTaskRealtimeServiceRouter.start({
        context,
        registerShutdown: cleanup => cleanups.push(cleanup),
    });

    router.resolveLoad(0, "host-1");
    await startupPromise;

    import.meta.jest.advanceTimersByTime(taskRealtimeServiceRoutesRevalidateMs);
    expect(router.loadCount).toBe(2);

    import.meta.jest.advanceTimersByTime(taskRealtimeServiceRoutesInvalidatedMs + 1);
    const routesPromise = router.getRoutes(context);
    expect(router.loadCount).toBe(3);

    router.resolveLoad(2, "host-3");
    const routes = await routesPromise;
    cleanups.forEach(cleanup => cleanup());

    expect(routes).toMatchObject(createRoutes("host-3"));
});

test("revalidates from `getRoutes()` when no background loop is running", async () => {
    const router = new CountingTaskRealtimeServiceRouter();

    const initialRoutes = await processContext.with({}, context => router.getRoutes(context));

    // Once routes are stale (but still valid) a `getRoutes()` call serves the current
    // routes while refreshing fresh ones in the background.
    import.meta.jest.advanceTimersByTime(taskRealtimeServiceRoutesRevalidateMs + 1);
    const staleRoutes = await processContext.with({}, context => router.getRoutes(context));
    await ProcessContextModule.waitForTestTasks();
    const revalidatedRoutes = await processContext.with({}, context => router.getRoutes(context));

    expect({initialRoutes, staleRoutes, revalidatedRoutes}).toMatchObject({
        initialRoutes: {
            partitionPlanes: [{partitions: [{instances: [{workers: [{host: "host-1"}]}]}]}],
        },
        staleRoutes: {
            partitionPlanes: [{partitions: [{instances: [{workers: [{host: "host-1"}]}]}]}],
        },
        revalidatedRoutes: {
            partitionPlanes: [{partitions: [{instances: [{workers: [{host: "host-2"}]}]}]}],
        },
    });
});

function createRoutes(host: string): TaskRealtimeServiceRoutes {
    return {
        partitionPlanes: [
            {
                partitions: [
                    {
                        instances: [
                            {
                                isHealthy: true,
                                workers: [{host}],
                            },
                        ],
                    },
                ],
            },
        ],
    };
}
