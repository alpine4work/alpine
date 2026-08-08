import {Step} from "prosemirror-transform";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {TaskNotesStepTransactionItem, TaskTable} from "~/server/tasks/data/internal/task_table.js";
import {DataLossError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {ContentEditorClientId, TaskId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Reads the task notes steps applied between `startVersion` (inclusive) and
 * `endVersion` (exclusive) from the `NotesStepTransactionsBeforeSnapshot` sort
 * range.
 *
 * Used to rebase an update made against an older version onto the latest content.
 * Assumes the version range has been validated (i.e. `endVersion` is at most the
 * current notes version). Throws a `DataLossError` if a step in the range is
 * missing.
 */
export async function getTaskNotesContentStepsBetweenValidatedVersionRange(
    context: DynamoContext,
    {
        taskId,
        startVersion,
        endVersion,
    }: {
        taskId: TaskId;
        startVersion: number;
        endVersion: number;
    },
): Promise<Array<{step: Step; invertedStep: Step; clientId: ContentEditorClientId}>> {
    return await context.tracer.withSpan("Get task notes content steps", async (context, span) => {
        span.addData({
            content: {
                collaborative: {
                    startVersion: startVersion,
                    endVersion: endVersion,
                },
            },
        });

        assert(Number.isSafeInteger(startVersion));
        assert(Number.isSafeInteger(endVersion));
        assert(startVersion >= 0);
        assert(startVersion < endVersion);

        const stepByVersion = new Map<
            number,
            {step: Step; invertedStep: Step; clientId: ContentEditorClientId}
        >();

        const processStepTransaction = (stepTransaction: TaskNotesStepTransactionItem) => {
            for (let i = 0; i < stepTransaction.steps.length; i++) {
                const version = stepTransaction.startVersion + i;
                const step = stepTransaction.steps[i]!;
                const invertedStep = stepTransaction.invertedSteps[i];
                if (!invertedStep) throw new DataLossError("Missing inverted task notes step");

                // A transaction may include steps outside our version range if it straddles the
                // boundary. Only keep the steps inside the range.
                if (startVersion <= version && version < endVersion) {
                    stepByVersion.set(version, {
                        step,
                        invertedStep,
                        clientId: stepTransaction.clientId,
                    });
                }
            }
        };

        const collectSteps = () => {
            const steps = [];
            for (let version = startVersion; version < endVersion; version++) {
                const step = stepByVersion.get(version);
                if (!step) return null;
                steps.push(step);
            }
            return steps;
        };

        const query = async (consistency: DynamoReadConsistency) => {
            stepByVersion.clear();

            // Find the transaction containing `startVersion`. Its `startVersion` sort key may
            // be less than `startVersion` if `startVersion` falls in the middle of a batch. So
            // query descending for the last transaction whose key is `<= startVersion`.
            const [transactionContainingStartVersion] = await arrayFromAsyncIterable(
                TaskTable.query(context, {
                    consistency,
                    limit: 1,
                    descending: true,
                    partitionKey: {partitionType: "Task", taskId},
                    startSortKey: {
                        sortRangeType: "NotesStepTransactionsBeforeSnapshot",
                        startVersion: 0,
                    },
                    endSortKey: {
                        sortRangeType: "NotesStepTransactionsBeforeSnapshot",
                        startVersion,
                    },
                }),
            );

            if (transactionContainingStartVersion) {
                processStepTransaction(transactionContainingStartVersion);
            }

            // Query the remaining transactions forward up to `endVersion - 1`.
            const forwardStartVersion = transactionContainingStartVersion
                ? transactionContainingStartVersion.startVersion +
                  transactionContainingStartVersion.steps.length
                : startVersion;

            if (forwardStartVersion < endVersion) {
                for await (const stepTransaction of TaskTable.query(context, {
                    consistency,
                    limit: "All",
                    partitionKey: {partitionType: "Task", taskId},
                    startSortKey: {
                        sortRangeType: "NotesStepTransactionsBeforeSnapshot",
                        startVersion: forwardStartVersion,
                    },
                    endSortKey: {
                        sortRangeType: "NotesStepTransactionsBeforeSnapshot",
                        startVersion: endVersion - 1,
                    },
                })) {
                    processStepTransaction(stepTransaction);
                }
            }

            return collectSteps();
        };

        // Try an eventually consistent read first. Since the version range has been
        // validated we know all the steps must exist. If we don't find them all it's
        // likely due to eventual consistency lag, so retry with a strongly consistent
        // read.
        const eventualSteps = await query("Eventual");
        if (eventualSteps) return eventualSteps;

        const strongSteps = await query("Strong");
        if (strongSteps) return strongSteps;

        throw new DataLossError("Missing a task notes step");
    });
}
