import {InternalError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {RpcCallId} from "~/shared/id/types/id_types.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";

// This file can only be imported in a test environment.
assert(import.meta.jest);

const testRpcExecutions = new Map<
    RpcDefinition<any, any>,
    Array<{input: any; outputPromiseResolver: PromiseResolver<any>}>
>();

afterEach(() => {
    try {
        for (const [definition, executions] of testRpcExecutions) {
            const pendingExecutionCount = executions.filter(
                execution => !execution.outputPromiseResolver.isSettled(),
            ).length;

            assert(
                pendingExecutionCount === 0,
                `Expected 0 pending ${definition.name} RPC executions but found ${pendingExecutionCount}`,
            );
        }
    } finally {
        testRpcExecutions.clear();
    }
});

/**
 * A test RPC context module that lets you return whatever result you like for
 * an RPC execution in tests to see how code which calls the RPC behaves.
 */
export class TestRpcContextModule extends RpcContextModuleBase {
    public override execute<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        callId: RpcCallId,
        input: Input,
    ): Promise<Output> {
        const executions = getOrSetDefaultMapValue(testRpcExecutions, definition, () => []);

        const outputPromiseResolver = createPromiseResolver<Output>();

        executions.push({
            input,
            outputPromiseResolver,
        });

        return outputPromiseResolver.promise;
    }

    public static getExecutions<Input, Output>(
        definition: RpcDefinition<Input, Output>,
    ): ReadonlyArray<{
        readonly input: Input;
        readonly outputPromiseResolver: PromiseResolver<Output>;
    }> {
        return testRpcExecutions.get(definition) ?? [];
    }

    public static resolveLastExecution<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        output: Output,
    ): void {
        const executions = testRpcExecutions.get(definition) ?? [];
        assert(executions.length > 0, "No pending executions");

        const lastExecution = executions[executions.length - 1]!;
        assert(
            !lastExecution.outputPromiseResolver.isSettled(),
            "Last execution is already resolved",
        );

        lastExecution.outputPromiseResolver.resolve(output);
    }

    public static resolveExecution<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        n: number,
        output: Output,
    ): void {
        const executions = testRpcExecutions.get(definition) ?? [];
        assert(n < executions.length, "Execution not found");

        const lastExecution = executions[n]!;
        assert(!lastExecution.outputPromiseResolver.isSettled(), "Execution is already resolved");

        lastExecution.outputPromiseResolver.resolve(output);
    }

    public static rejectLastExecution<Input, Output>(
        definition: RpcDefinition<Input, Output>,
    ): void {
        const executions = testRpcExecutions.get(definition) ?? [];
        assert(executions.length > 0, "No pending executions");

        const lastExecution = executions[executions.length - 1]!;
        assert(
            !lastExecution.outputPromiseResolver.isSettled(),
            "Last execution is already settled",
        );

        lastExecution.outputPromiseResolver.reject(new InternalError("Test rejected"));
    }

    public static rejectExecution<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        n: number,
    ): void {
        const executions = testRpcExecutions.get(definition) ?? [];
        assert(n < executions.length, "Execution not found");

        const lastExecution = executions[n]!;
        assert(!lastExecution.outputPromiseResolver.isSettled(), "Execution is already settled");

        lastExecution.outputPromiseResolver.reject(new InternalError("Test rejected"));
    }

    public override fork() {
        return new TestRpcContextModule();
    }
}
