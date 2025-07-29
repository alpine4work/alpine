import {ProcessContextModule} from "~/shared/context/process_context_module.js";

/**
 * Run all timers and any promises passed until `context.process.waitUntil()`
 * until there are no timers or `context.process.waitUntil()` promises.
 */
export async function runAllTimersAndWaitForTestTasks() {
    await ProcessContextModule.waitForTestTasks();

    while (import.meta.jest.getTimerCount() > 0) {
        import.meta.jest.runAllTimers();
        await ProcessContextModule.waitForTestTasks();
    }
}
