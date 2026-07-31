import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {SynchronizedSystemClock} from "~/shared/helpers/clock/synchronized_system_clock.js";

let clockPromise: PromiseImmediate<SynchronizedSystemClock> | null = null;

export function getClientTracerSynchronizedSystemClock(): PromiseImmediate<SynchronizedSystemClock> {
    clockPromise ??= PromiseImmediate.resolve(createClientTracerSynchronizedSystemClock());
    return clockPromise;
}

async function createClientTracerSynchronizedSystemClock(): Promise<SynchronizedSystemClock> {
    const clock = await SynchronizedSystemClock.new(async () => {
        // eslint-disable-next-line cyberworlds/no-global-fetch
        const response = await fetch("/api/time", {cache: "no-store"});
        const {startTime, endTime}: {startTime: number; endTime: number} = await response.json();
        return startTime + (endTime - startTime) / 2;
    });

    const resyncTimeoutDuration = 1000 * 60 * 10;
    let resyncTimeout: Timeout | null = null;

    const runResyncTimeout = () => {
        resyncTimeout = null;

        // Ignore errors from resync. We'll still have the initial offset.
        clock.sync().catch(() => {});

        resyncTimeout = createTimeout(runResyncTimeout, resyncTimeoutDuration);
    };

    let isOnline = true;

    const onBrowserStateChange = () => {
        if (isOnline && document.visibilityState === "visible") {
            if (resyncTimeout === null) {
                runResyncTimeout();
            }
        } else {
            if (resyncTimeout !== null) {
                resyncTimeout.clear();
                resyncTimeout = null;
            }
        }
    };

    // Start the resync loop if it hasn't started already.
    onBrowserStateChange();

    const documentVisibilityChangeListener = () => {
        onBrowserStateChange();
    };

    const windowOnlineListener = () => {
        isOnline = true;
        onBrowserStateChange();
    };

    const windowOfflineListener = () => {
        isOnline = false;
        onBrowserStateChange();
    };

    if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", documentVisibilityChangeListener);
    }

    if (typeof window !== "undefined") {
        window.addEventListener("online", windowOnlineListener);
        window.addEventListener("offline", windowOfflineListener);
    }

    return clock;
}
