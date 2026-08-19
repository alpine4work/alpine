import {Step} from "prosemirror-transform";
import {DocumentsTable} from "~/server/documents/data/internal/documents_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableItemType} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DataLossError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

type DocumentStepTransactionItem =
    | DynamoTableItemType<typeof DocumentsTable, "Document", "StepTransactionsAfterSnapshot">
    | DynamoTableItemType<typeof DocumentsTable, "Document", "StepTransactionsBeforeSnapshot">;

/**
 * Reads all steps between `startVersion` (inclusive) and `endVersion` (exclusive).
 *
 * We assume you have checked that `endVersion` is a version that exists! We will
 * throw a `DataLossError` if we don't find steps up to `endVersion`.
 *
 * We also assert that `versionStart` is less than `endVersion` and `versionStart`
 * is greater than zero.
 *
 * We call this function "for validated version range" because we assume
 * `versionStart` and `endVersion` are valid.
 *
 * We start by looking in the `StepsBeforeSnapshot` range since it has all our
 * historical steps. If we can't find all the steps we need then we check the
 * `StepsAfterSnapshot` range.
 */
export async function getDocumentContentStepsBetweenValidatedVersionRange(
    context: DynamoContext,
    options: {
        id: DocumentId;
        startVersion: number;
        endVersion: number;
    },
): Promise<Array<{step: Step; invertedStep: Step; clientId: ContentEditorClientId}>> {
    return await context.tracer.withSpan("Get document content steps", async (context, span) => {
        span.addData({
            content: {
                collaborative: {
                    startVersion: options.startVersion,
                    endVersion: options.endVersion,
                },
            },
        });

        const {branch, steps} =
            await getDocumentContentStepsBetweenValidatedVersionRangeWithoutSpan(context, options);

        // This function has a couple different code branches that handle various edge
        // cases. It's useful for debugging to know exactly which branch the function took.
        // So record the executed branch in our span.
        span.addData({common: {branch}});

        return steps;
    });
}

async function getDocumentContentStepsBetweenValidatedVersionRangeWithoutSpan(
    context: DynamoContext,
    {
        id,
        startVersion,
        endVersion,
    }: {
        id: DocumentId;
        startVersion: number;
        endVersion: number;
    },
): Promise<{
    branch:
        | "ShortCircuitStepsAfterSnapshot"
        | "ShortCircuitStepsBeforeSnapshot"
        | "StepsAfterSnapshot"
        | "StepsAfterSnapshotWithStrongConsistency"
        | "StepsAfterSnapshotMovedBeforeSnapshot"
        | "StepsBeforeSnapshot"
        | "StepsBeforeSnapshotWithStrongConsistency";
    steps: Array<{step: Step; invertedStep: Step; clientId: ContentEditorClientId}>;
}> {
    assert(Number.isSafeInteger(startVersion));
    assert(Number.isSafeInteger(endVersion));
    assert(startVersion < endVersion);
    assert(startVersion >= 0);

    const stepByVersion = new Map<
        number,
        {step: Step; invertedStep: Step; clientId: ContentEditorClientId}
    >();

    const processStepTransaction = (stepTransaction: DocumentStepTransactionItem) => {
        for (let i = 0; i < stepTransaction.steps.length; i++) {
            const version = stepTransaction.startVersion + i;
            const step = stepTransaction.steps[i]!;
            const invertedStep = stepTransaction.invertedSteps[i];
            if (!invertedStep) throw new DataLossError("Missing inverted document step");

            // We may get steps outside of the version range because they are in a transaction
            // that intersects with our version range. Don't set those steps to our map.
            if (startVersion <= version && version < endVersion) {
                stepByVersion.set(version, {
                    step,
                    invertedStep,
                    clientId: stepTransaction.clientId,
                });
            }
        }
    };

    const getSteps = () => {
        const steps = [];

        for (let version = startVersion; version < endVersion; version++) {
            const step = stepByVersion.get(version);
            if (!step) return null;
            steps.push(step);
        }

        return steps;
    };

    const stepTransactionContainingStartVersion =
        await getDocumentStepTransactionContainingValidatedVersion(context, id, startVersion);

    processStepTransaction(stepTransactionContainingStartVersion);

    // If the transaction containing our start version also contains our end version
    // then we're done!
    //
    // As an optimization, we could start the request to get
    // `stepTransactionContainingEndVersion` AFTER this short circuit so that if we
    // only need one transaction we don't need to make the extra requests. However, we
    // expect most of the time when you call this function you need more than one
    // transaction.
    if (
        endVersion <=
        stepTransactionContainingStartVersion.startVersion +
            stepTransactionContainingStartVersion.steps.length
    ) {
        const steps = getSteps();
        if (!steps) throw new DataLossError("Missing a document step");
        switch (stepTransactionContainingStartVersion.sortRangeType) {
            case "StepTransactionsAfterSnapshot":
                return {branch: "ShortCircuitStepsAfterSnapshot", steps};
            case "StepTransactionsBeforeSnapshot":
                return {branch: "ShortCircuitStepsBeforeSnapshot", steps};
            default:
                throw exhaustive(stepTransactionContainingStartVersion);
        }
    }

    switch (stepTransactionContainingStartVersion.sortRangeType) {
        // If we start in the after snapshot range then we will also end in the after
        // snapshot range.
        case "StepTransactionsAfterSnapshot": {
            const queryStepTransactions = async (consistency: DynamoReadConsistency) => {
                for await (const stepTransaction of DocumentsTable.query(context, {
                    consistency,
                    partitionKey: {
                        partitionType: "Document",
                        documentId: id,
                    },
                    startSortKey: {
                        sortRangeType: "StepTransactionsAfterSnapshot",
                        startVersion:
                            stepTransactionContainingStartVersion.startVersion +
                            stepTransactionContainingStartVersion.steps.length,
                    },
                    endSortKey: {
                        sortRangeType: "StepTransactionsAfterSnapshot",
                        startVersion: endVersion - 1,
                    },
                    limit: "All",
                })) {
                    processStepTransaction(stepTransaction);
                }
            };

            await queryStepTransactions("Eventual");

            {
                const steps = getSteps();
                if (steps) return {branch: "StepsAfterSnapshot", steps};
            }

            // If we couldn't find all the request steps then try querying again with strong
            // read consistency. Given this range has been validated we know the version range
            // MUST exist in the document. So if we don't have all the steps it's probably due
            // to an eventual consistency lag.
            //
            // We find eventual consistency lag is rare enough in practice that it's cheaper to
            // retry with strong consistency after a failed eventually consistent read then to
            // always make strong consistency reads.
            //
            // It's ok to call `processStepTransaction()` twice for step transactions we've
            // already seen.
            await queryStepTransactions("Strong");

            {
                const steps = getSteps();
                if (steps) return {branch: "StepsAfterSnapshotWithStrongConsistency", steps};
            }

            // If we still can't find the steps in the `StepTransactionsBeforeSnapshot` sort
            // range when reading with strong consistency then it's possible we're updating the
            // document snapshot and we read the first step transaction item BEFORE the
            // snapshot moved all steps from the `StepTransactionsAfterSnapshot` sort range to
            // the `StepTransactionsBeforeSnapshot` sort range. Therefore, querying
            // `StepTransactionsAfterSnapshot` will never produce results since all the steps
            // have been deleted. So try one last strong consistency query in the
            // `StepTransactionsBeforeSnapshot` sort range.
            for await (const stepTransaction of DocumentsTable.query(context, {
                consistency: "Strong",
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion:
                        stepTransactionContainingStartVersion.startVersion +
                        stepTransactionContainingStartVersion.steps.length,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: endVersion - 1,
                },
                limit: "All",
            })) {
                processStepTransaction(stepTransaction);
            }

            {
                const steps = getSteps();
                if (!steps) throw new DataLossError("Missing a document step");
                return {branch: "StepsAfterSnapshotMovedBeforeSnapshot", steps};
            }
        }
        // If we start in the before snapshot range then we might not have all the steps we
        // need in the before snapshot range. So query the before snapshot range and then
        // determine if we also need to query the after snapshot range.
        case "StepTransactionsBeforeSnapshot": {
            const queryStepTransactions = async (consistency: DynamoReadConsistency) => {
                const stepTransactionBeforeSnapshotIterator = DocumentsTable.query(context, {
                    consistency,
                    partitionKey: {
                        partitionType: "Document",
                        documentId: id,
                    },
                    startSortKey: {
                        sortRangeType: "StepTransactionsBeforeSnapshot",
                        startVersion:
                            stepTransactionContainingStartVersion.startVersion +
                            stepTransactionContainingStartVersion.steps.length,
                    },
                    endSortKey: {
                        sortRangeType: "StepTransactionsBeforeSnapshot",
                        startVersion: endVersion - 1,
                    },
                    limit: "All",
                });

                let lastStepTransactionBeforeSnapshot = null;

                for await (const stepTransaction of stepTransactionBeforeSnapshotIterator) {
                    lastStepTransactionBeforeSnapshot = stepTransaction;
                    processStepTransaction(stepTransaction);
                }

                // If the last step transaction we found in the before snapshot range contains the
                // end version then we're done! Otherwise we need to continue querying in the after
                // snapshot range.
                if (
                    lastStepTransactionBeforeSnapshot &&
                    endVersion <=
                        lastStepTransactionBeforeSnapshot.startVersion +
                            lastStepTransactionBeforeSnapshot.steps.length
                ) {
                    return;
                }

                const stepTransactionAfterSnapshotIterator = DocumentsTable.query(context, {
                    consistency,
                    partitionKey: {
                        partitionType: "Document",
                        documentId: id,
                    },
                    startSortKey: {
                        sortRangeType: "StepTransactionsAfterSnapshot",
                        startVersion:
                            stepTransactionContainingStartVersion.startVersion +
                            stepTransactionContainingStartVersion.steps.length,
                    },
                    endSortKey: {
                        sortRangeType: "StepTransactionsAfterSnapshot",
                        startVersion: endVersion - 1,
                    },
                    limit: "All",
                });

                for await (const stepTransactionAfterSnapshot of stepTransactionAfterSnapshotIterator) {
                    processStepTransaction(stepTransactionAfterSnapshot);
                }
            };

            await queryStepTransactions("Eventual");

            {
                const steps = getSteps();
                if (steps) return {branch: "StepsBeforeSnapshot", steps};
            }

            // If we couldn't find all the request steps then try querying again with strong
            // read consistency. Given this range has been validated we know the version range
            // MUST exist in the document. So if we don't have all the steps it's probably due
            // to an eventual consistency lag.
            //
            // We find eventual consistency lag is rare enough in practice that it's cheaper to
            // retry with strong consistency after a failed eventually consistent read then to
            // always make strong consistency reads.
            //
            // It's ok to call `processStepTransaction()` twice for step transactions we've
            // already seen.
            await queryStepTransactions("Strong");

            {
                const steps = getSteps();
                if (!steps) throw new DataLossError("Missing a document step");
                return {branch: "StepsBeforeSnapshotWithStrongConsistency", steps};
            }
        }
        default:
            throw exhaustive(stepTransactionContainingStartVersion);
    }
}

/**
 * Get the step transaction which contains `version` in the provided document.
 *
 * Throws a `DataLossError` if the `version` does not exist in the document. You're
 * responsible for validating that `version` exists in the document before calling
 * this function. Hence why the name says "validated" version.
 */
// Given the way we layout our documents table, we can't query
// `transaction.startVersion = version`. Since a transaction may contain multiple
// steps and hence multiple versions. We don't know where the transaction
// boundaries lie without querying the table.
//
// Given the way DynamoDB works we also can't query
// `transaction.startVersion >= version AND version < transaction.startVersion + transaction.steps.length`
// since we have to query on sort keys (of which `transaction.steps` is not a part
// of).
//
// So the way this function is implemented is:
//
// 1. We query the `StepTransactionsBeforeSnapshot` sort range for the transaction
//    containing this version.
// 2. We query the `StepTransactionsAfterSnapshot` sort range for the transaction
//    containing this version.
//
// To query those sort ranges, we use
// `transaction.startVersion BETWEEN 0 AND version` in reverse with a limit of one.
// The first transaction in that range should contain our version.
async function getDocumentStepTransactionContainingValidatedVersion(
    context: DynamoContext,
    id: DocumentId,
    version: number,
): Promise<DocumentStepTransactionItem> {
    assert(Number.isSafeInteger(version));

    const queryStepTransactionsBeforeSnapshot = async (consistency: DynamoReadConsistency) => {
        // Find the transaction which contains `version`. To do this, we need to query
        // `transaction.startVersion BETWEEN 0 AND version` in descending order and return
        // the first transaction we find.
        //
        // To understand why this works consider two cases:
        //
        // 1. The step for `version` is the first step of a transaction (the transaction's
        //    `startVersion`).
        // 2. The step for `version` is in the middle of some transaction.
        //
        // Now consider the following four transactions in the
        // `StepTransactionsBeforeSnapshot` sort range:
        //
        // ```
        // transaction1: startVersion = 0
        // transaction2: startVersion = 5
        // transaction3: startVersion = 6
        // transaction4: startVersion = 9
        // ```
        //
        // For case 1: We want to get a range of steps starting at version 6. So we query
        // `transaction.startVersion BETWEEN 0 AND 6` in descending order. The last
        // transaction in this range is `transaction3` which contains version 6 so we're
        // good.
        //
        // For case 2: We want to get a range of steps starting at version 8. So we query
        // `transaction.startVersion BETWEEN 0 AND 8` in descending order. The last
        // transaction in this range is `transaction3` which contains version 8 so we're
        // good.
        const stepTransactionBeforeSnapshotContainingVersionArray = await arrayFromAsyncIterable(
            DocumentsTable.query(context, {
                consistency,
                limit: 1,
                descending: true,
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: 0,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: version,
                },
            }),
        );

        assert(stepTransactionBeforeSnapshotContainingVersionArray.length <= 1);
        const stepTransactionBeforeSnapshotContainingVersion =
            stepTransactionBeforeSnapshotContainingVersionArray[0];

        if (!stepTransactionBeforeSnapshotContainingVersion) return null;

        const actuallyContainsVersion =
            stepTransactionBeforeSnapshotContainingVersion.startVersion <= version &&
            version <
                stepTransactionBeforeSnapshotContainingVersion.startVersion +
                    stepTransactionBeforeSnapshotContainingVersion.steps.length;

        // The last transaction in our `transaction.startVersion BETWEEN 0 AND version`
        // range might not actually contain the version we are looking for!
        //
        // This will happen if `version` is after the snapshot version.
        //
        // Since in our `StepTransactionsBeforeSnapshot` sort range we will have
        // transactions from version 0 to the snapshot version. So if `version` is after
        // the snapshot version then we will return the first transaction after the
        // snapshot version.
        if (!actuallyContainsVersion) return null;

        return stepTransactionBeforeSnapshotContainingVersion;
    };

    const queryStepTransactionsAfterSnapshot = async (consistency: DynamoReadConsistency) => {
        // Same as the query above but on the `StepTransactionsAfterSnapshot` sort range
        // instead of the `StepTransactionsBeforeSnapshot` sort range.
        const stepTransactionAfterSnapshotContainingVersionArray = await arrayFromAsyncIterable(
            DocumentsTable.query(context, {
                consistency,
                limit: 1,
                descending: true,
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: 0,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: version,
                },
            }),
        );

        assert(stepTransactionAfterSnapshotContainingVersionArray.length <= 1);
        const stepTransactionAfterSnapshotContainingVersion =
            stepTransactionAfterSnapshotContainingVersionArray[0];
        if (!stepTransactionAfterSnapshotContainingVersion) return null;

        const actuallyContainsVersion =
            stepTransactionAfterSnapshotContainingVersion.startVersion <= version &&
            version <
                stepTransactionAfterSnapshotContainingVersion.startVersion +
                    stepTransactionAfterSnapshotContainingVersion.steps.length;

        // The last transaction in our `transaction.startVersion BETWEEN 0 AND version`
        // range might not actually contain the version we are looking for!
        //
        // This will happen while we are updating the snapshot.
        //
        // Consider two adjacent transactions, `transaction1` and `transaction2`.
        // `transaction1` comes before `transaction2`. The version we are looking for is in
        // `transaction2`. But our query will give us `transaction1` if we are in the
        // following state:
        //
        // 1. We deleted `transaction2` from `StepTransactionsAfterSnapshot` and moved it
        //    to `StepTransactionsBeforeSnapshot`.
        // 2. We have not yet deleted `transaction1` from `StepTransactionsAfterSnapshot`.
        //
        // In this case we need to scan `StepTransactionsBeforeSnapshot` for `transaction2`
        // which.
        if (!actuallyContainsVersion) return null;

        return stepTransactionAfterSnapshotContainingVersion;
    };

    {
        const [stepTransactionBeforeSnapshot, stepTransactionAfterSnapshot] = await runAllPromises([
            queryStepTransactionsBeforeSnapshot("Eventual"),
            queryStepTransactionsAfterSnapshot("Eventual"),
        ]);

        // If we have both `stepTransactionBeforeSnapshot` and
        // `stepTransactionAfterSnapshot` then return the transaction from before the
        // snapshot since that's the new canonical transaction and we'll soon delete the
        // step transaction after the snapshot.
        if (stepTransactionBeforeSnapshot) return stepTransactionBeforeSnapshot;
        if (stepTransactionAfterSnapshot) return stepTransactionAfterSnapshot;
    }

    // Given this is a validated document version we know a step transaction containing
    // the step MUST exist. So try reading again but with strong consistency since we
    // might not have found the step transaction due to eventual consistency lag.
    //
    // Retrying with strong consistency is cheaper than always using strong consistency
    // because we've found in practice eventually consistency lags are pretty rare (1
    // in 10,000).
    {
        const [stepTransactionBeforeSnapshot, stepTransactionAfterSnapshot] = await runAllPromises([
            queryStepTransactionsBeforeSnapshot("Strong"),
            queryStepTransactionsAfterSnapshot("Strong"),
        ]);

        // If we have both `stepTransactionBeforeSnapshot` and
        // `stepTransactionAfterSnapshot` then return the transaction from before the
        // snapshot since that's the new canonical transaction and we'll soon delete the
        // step transaction after the snapshot.
        if (stepTransactionBeforeSnapshot) return stepTransactionBeforeSnapshot;
        if (stepTransactionAfterSnapshot) return stepTransactionAfterSnapshot;
    }

    throw new DataLossError("Could not find step transaction containing step");
}
