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
    private readonly _sharedBatches: Map<ContextBatcherBase<any, any, any, any>, any> | null = null;
    private readonly _batches = new Map<ContextBatcherBase<any, any, any, any>, any>();

    private constructor(sharedBatches: Map<ContextBatcherBase<any, any, any, any>, any> | null) {
        super();
        this._sharedBatches = sharedBatches;
    }

    public static new() {
        return new BatchContextModule(null);
    }

    public execute<Modules extends {[key: string]: ContextModuleBase}, Batch, Input, Output>(
        this: ContextModuleBase<Modules> & BatchContextModule,
        batcher: ContextBatcherBase<Modules, Batch, Input, Output>,
        input: Input,
    ): Promise<Output> {
        const batches =
            batcher.whenActorChanges === "DangerouslyShare"
                ? (this._sharedBatches ?? this._batches)
                : this._batches;

        const batch = getOrSetDefaultMapValue(batches, batcher, () => {
            const batch = batcher.newBatch();

            schedulePostPromiseJob(() => {
                batches.delete(batcher);
                batcher.executeBatch(this._context, batch);
            });

            return batch;
        });

        return batcher.addToBatch(batch, input);
    }

    public fork() {
        // Create a new batch context for our fork. Do not share IO with the
        // parent action.
        return new BatchContextModule(null);
    }

    /**
     * Create a new `BatchContextModule` and share any batches that set
     * `whenActorChanges: "DangerouslyShare"` between this batch context module and
     * the new batch context module. See the documentation on `whenActorChanges`
     * for more info.
     */
    public forkForChangedActor() {
        return new BatchContextModule(this._sharedBatches ?? this._batches);
    }
}

export abstract class ContextBatcherBase<
    Modules extends {[key: string]: ContextModuleBase},
    Batch,
    Input,
    Output,
> {
    /**
     * What should happen to the batcher when the actor changes? Should we share
     * IO across different actors or have separate batches? The actor may change
     * within an action through a `dangerouslyEscalateToSystemContext()` call or an
     * `impersonateAccountAsSystemContext()` call.
     *
     * If the value is `DangerouslyShare` then batched IO will be shared between the
     * action context for the old actor and new actor. If we add to the batch as
     * the old actor the same batch can be added to by the new actor and vice
     * versa. You should only use `DangerouslyShare` if batch loading doesn't
     * depend on the actor! This option is the most performant since we batch more
     * stuff.
     *
     * If the value is `SafelyReset` then we keep batches separate and if we add
     * to this new actor's batch it won't be shared with the old actor. This option
     * is safer since if we execute a batch with a system actor then a session
     * actor won't accidentally have system permissions.
     */
    public abstract readonly whenActorChanges: "DangerouslyShare" | "SafelyReset";

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
    public override readonly whenActorChanges: "DangerouslyShare" | "SafelyReset";

    private readonly _execute: (
        context: Context<Modules>,
        inputs: ReadonlyArray<Input>,
    ) => Promise<ReadonlyArray<Output>>;

    constructor(
        {whenActorChanges}: {whenActorChanges: "DangerouslyShare" | "SafelyReset"},
        execute: (
            context: Context<Modules>,
            inputs: ReadonlyArray<Input>,
        ) => Promise<ReadonlyArray<Output>>,
    ) {
        super();
        this.whenActorChanges = whenActorChanges;
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
