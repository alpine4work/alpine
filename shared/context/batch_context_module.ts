import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {schedulePostPromiseJob} from "~/shared/helpers/async/schedule_post_promise_job.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

/**
 * Context module for batching requests to some backend service like DynamoDB
 * associated with some context. So that two actions don't share IO, we create
 * a new batch context module for each action.
 *
 * Conceptually the [same as `dataloader`][1].
 *
 * [1]: https://www.npmjs.com/package/dataloader
 */
export class BatchContextModule extends ContextModuleBase implements ForkableContextModuleBase {
    private readonly _batchByBatcher = new Map<ContextBatcherBase<any, any, any, any>, any>();

    public execute<Modules extends {[key: string]: ContextModuleBase}, Batch, Input, Output>(
        this: ContextModuleBase<Modules> & BatchContextModule,
        batcher: ContextBatcherBase<Modules, Batch, Input, Output>,
        input: Input,
    ): Promise<Output> {
        const batch = getOrSetDefaultMapValue(this._batchByBatcher, batcher, () => {
            const batch = batcher.newBatch();

            schedulePostPromiseJob(() => {
                this._batchByBatcher.delete(batcher);
                batcher.executeBatch(this._context, batch);
            });

            return batch;
        });

        return batcher.addToBatch(batch, input);
    }

    public fork() {
        // Create a new batch context for our fork. Do not share IO with the
        // parent action.
        return new BatchContextModule();
    }
}

export abstract class ContextBatcherBase<
    Modules extends {[key: string]: ContextModuleBase},
    Batch,
    Input,
    Output,
> {
    public abstract newBatch(): Batch;
    public abstract addToBatch(batch: Batch, input: Input): Promise<Output>;
    public abstract executeBatch(context: Context<Modules>, batch: Batch): void;
}

/**
 * Create a batcher for use with `BatchContextModule`. Once a batch is
 * finished, we call `execute` with the batched inputs and we expect an outputs
 * array of the exact same length. If the outputs array is a different length
 * than the inputs array then an error will be thrown.
 *
 * Has basically the [same API as `dataloader`][1].
 *
 * [1]: https://www.npmjs.com/package/dataloader
 */
export class ContextBatcher<
    Modules extends {[key: string]: ContextModuleBase},
    Input,
    Output,
> extends ContextBatcherBase<
    Modules,
    Array<{input: Input; outputPromiseResolver: PromiseResolver<Output>}>,
    Input,
    Output
> {
    private readonly _execute: (
        context: Context<Modules>,
        inputs: ReadonlyArray<Input>,
    ) => Promise<ReadonlyArray<Output>>;

    constructor(
        execute: (
            context: Context<Modules>,
            inputs: ReadonlyArray<Input>,
        ) => Promise<ReadonlyArray<Output>>,
    ) {
        super();
        this._execute = execute;
    }

    public override newBatch() {
        return [];
    }

    public override addToBatch(
        batch: Array<{input: Input; outputPromiseResolver: PromiseResolver<Output>}>,
        input: Input,
    ): Promise<Output> {
        const outputPromiseResolver = createPromiseResolver<Output>();
        batch.push({input, outputPromiseResolver});
        return outputPromiseResolver.promise;
    }

    public override executeBatch(
        context: Context<Modules>,
        batch: Array<{
            input: Input;
            outputPromiseResolver: PromiseResolver<Output>;
        }>,
    ): void {
        this._execute(
            context,
            batch.map(({input}) => input),
        ).then(
            outputs => {
                if (outputs.length !== batch.length) {
                    const error = new InternalError(
                        "Batcher `execute()` outputs length does not equal inputs length",
                    );

                    for (const {outputPromiseResolver} of batch) {
                        outputPromiseResolver.reject(error);
                    }
                } else {
                    for (let i = 0; i < batch.length; i++) {
                        batch[i]!.outputPromiseResolver.resolve(outputs[i]!);
                    }
                }
            },
            error => {
                for (const {outputPromiseResolver} of batch) {
                    outputPromiseResolver.reject(error);
                }
            },
        );
    }
}
