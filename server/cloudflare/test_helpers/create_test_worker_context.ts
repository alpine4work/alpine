import {
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
    WorkerSystemActionContext,
    WorkerSystemActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {
    TestContext,
    TestSessionActionContextModules,
    TestSystemActionContextModules,
    createTestContext,
} from "~/server/dynamo/test_helpers/create_test_context.js";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {Replace} from "~/shared/helpers/types/replace.js";

type TestWorkerSessionActionContext = Context<TestWorkerSessionActionContextModules>;

type TestWorkerSessionActionContextModules = TestSessionActionContextModules &
    Omit<WorkerSessionActionContextModules, keyof TestSessionActionContextModules>;

type TestWorkerSystemActionContext = Context<TestWorkerSystemActionContextModules>;

type TestWorkerSystemActionContextModules = TestSystemActionContextModules &
    Omit<WorkerSystemActionContextModules, keyof TestSystemActionContextModules>;

export type TestWorkerContext = Replace<
    TestContext,
    {
        action(...args: Parameters<TestContext["action"]>): TestWorkerSessionActionContext;

        systemAction(
            ...args: Parameters<TestContext["systemAction"]>
        ): TestWorkerSystemActionContext;
    }
>;

assertAssignableTypes<TestWorkerContext, TestContext>();
assertAssignableTypes<TestWorkerSessionActionContext, WorkerSessionActionContext>();
assertAssignableTypes<TestWorkerSystemActionContext, WorkerSystemActionContext>();

export function createTestWorkerContext(
    options?: Parameters<typeof createTestContext>[0],
): TestWorkerContext {
    const baseContext = createTestContext(options);

    const context: TestWorkerContext = Object.assign(baseContext.cloneWithHelpers({}), {
        action: ((session, options) => {
            return baseContext.action(session, options).clone({
                rpc: new LocalRpcContextModule(),
                fork: new ForkActionContextModule(),
            });
        }) satisfies TestWorkerContext["action"],
        systemAction: ((session, options) => {
            return baseContext.systemAction(session, options).clone({
                rpc: new LocalRpcContextModule(),
                fork: new ForkActionContextModule(),
            });
        }) satisfies TestWorkerContext["systemAction"],
    });

    return context;
}
