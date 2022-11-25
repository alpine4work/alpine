import {compareAsc as compareDatesAsc} from "date-fns";
import {RequestContext} from "~/server/context/context";
import {
    authorizeAccountHasInternalAccess,
    checkAccountEmailAddressDoesNotExistTransactionEntry,
    createAccountForAlphaTransactionEntries,
} from "~/server/dynamo/accounts_table";
import {DynamoConditionExpression} from "~/server/dynamo/internal/dynamo_condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {
    AlphaAccessRequestDecisionSchema,
    AlphaAccessRequestModel,
} from "~/shared/alpha/alpha_access_request_model";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable";
import {filterMapAsyncIterableIterator} from "~/shared/helpers/iterable/filter_map_async_iterable_iterator";
import {generateId} from "~/shared/id/id";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema} from "~/shared/schema/schema";

const AlphaAccessTable = DynamoTableSchema.new({
    name: "AlphaAccess",
    partitions: {
        /**
         * All our alpha access requests are in one partition so we can query them
         * at once.
         *
         * We expect a small number of alpha access requests.
         */
        AlphaAccessRequests: {
            partitionKeyAttributes: {},
            sortRanges: {
                Request: {
                    sortKeyAttributes: {
                        /**
                         * Can only have one access request per email address.
                         */
                        emailAddress: DynamoKeyAttributeSchema.labelString,
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                        lockVersion: Schema.integer,

                        /**
                         * The name of the person asking for access.
                         */
                        name: LabelStringSchema,

                        /**
                         * A message from the person asking for access. We prompt the user with "How
                         * do you know the team?" but they can put whatever they want in this field.
                         */
                        message: Schema.string,

                        /**
                         * The decision made by an admin account on whether to accept or reject the
                         * access request.
                         */
                        decision: AlphaAccessRequestDecisionSchema.nullable(),
                    }),
                },
            },
        },
    },
});

/**
 * Sends a request for alpha access to the admin accounts managing alpha
 * access requests.
 *
 * Can not request alpha access twice for the same email address.
 */
export async function requestAlphaAccess({
    name,
    emailAddress,
    message,
}: {
    name: string;
    emailAddress: string;
    message: string;
}) {
    // Email address is case insensitive.
    emailAddress = emailAddress.toLowerCase();

    try {
        await DynamoTableSchema.executeTransaction([
            // Make sure an account does not already exist when requesting alpha access.
            // The account could have been created manually.
            checkAccountEmailAddressDoesNotExistTransactionEntry(emailAddress),

            AlphaAccessTable.transactionPutItem(
                {
                    partitionType: "AlphaAccessRequests",
                    sortRangeType: "Request",
                    createdTime: new Date(),
                    lockVersion: 0,
                    name,
                    emailAddress,
                    message,
                    decision: null,
                },
                {
                    condition: {name: DynamoConditionExpression.exists().not()},
                },
            ),
        ]);
    } catch (error) {
        if (!isDynamoConditionCheckError(error)) throw error;

        const existingRequest = await AlphaAccessTable.getItem({
            partitionType: "AlphaAccessRequests",
            sortRangeType: "Request",
            emailAddress,
        });
        const decision = existingRequest?.decision ?? null;

        let displayMessage;
        if (!decision) {
            // TODO(calebmer): Maybe this should have a "warn" severity?
            displayMessage = errorDisplayMessage`Already requested access for the email address ${emailAddress}. You\u2019ll get an email to this address if your request is approved. Reach out to someone on our team if you\u2019d like to know the status of your request.`;
        } else {
            switch (decision.type) {
                case "Approved": {
                    // TODO(calebmer): Maybe this should have a "success" severity?
                    displayMessage = errorDisplayMessage`You\u2019re already approved! Try ${errorDisplayMessage.link(
                        "signing in",
                        "/sign-in",
                    )} with the email address ${emailAddress}.`;
                    break;
                }
                case "Denied": {
                    displayMessage = errorDisplayMessage`Your access request for email address ${emailAddress} was denied by a member of our team. You may not submit another access request for this email address.`;
                    break;
                }
                default:
                    throw exhaustive(decision);
            }
        }

        throw new FailedPreconditionError("Already requested alpha access for this email address", {
            cause: error,
            displayMessage,
        });
    }
}

/**
 * Get the list of alpha access requests for an internal user who will decide
 * whether to accept or reject them.
 */
export async function getUndecidedAlphaAccessRequests(context: RequestContext) {
    await authorizeAccountHasInternalAccess(context);

    const requests = await arrayFromAsyncIterable(
        filterMapAsyncIterableIterator(
            AlphaAccessTable.queryEntirePartition({
                partitionKey: {
                    partitionType: "AlphaAccessRequests",
                },
            }),
            requestItem => {
                if (requestItem.decision !== null) return null;

                return new AlphaAccessRequestModel({
                    createdTime: requestItem.createdTime,
                    name: requestItem.name,
                    emailAddress: requestItem.emailAddress,
                    message: requestItem.message,
                    decision: requestItem.decision,
                });
            },
        ),
    );

    return requests.sort((request1, request2) =>
        compareDatesAsc(request1.createdTime, request2.createdTime),
    );
}

/**
 * Approves a request for alpha access.
 *
 * When we approve a request for alpha access, we create a new account for the
 * user and we send them an email with instructions on how to sign in.
 */
export async function approveAlphaAccessRequest(context: RequestContext, emailAddress: string) {
    await authorizeAccountHasInternalAccess(context);

    const requestItem = await AlphaAccessTable.getItem({
        partitionType: "AlphaAccessRequests",
        sortRangeType: "Request",
        emailAddress,
    });
    if (!requestItem) throw new NotFoundError("Alpha access request not found");

    if (requestItem.decision)
        throw new FailedPreconditionError("A decision has already been made for this request");

    const accountId = generateId();

    await DynamoTableSchema.executeTransaction([
        AlphaAccessTable.transactionPutItem(
            {
                ...requestItem,
                lockVersion: requestItem.lockVersion + 1,
                decision: {
                    type: "Approved",
                    approvedByAccountId: context.getAuthenticatedAccountId(),
                    accountId,
                },
            },
            {
                condition: {
                    lockVersion: DynamoConditionExpression.eq(requestItem.lockVersion),
                },
            },
        ),
        ...createAccountForAlphaTransactionEntries({
            id: accountId,
            name: requestItem.name,
            emailAddress: requestItem.emailAddress,
        }),
    ]);

    // TODO(calebmer): Send an email when we approve the alpha access request.
}

/**
 * Denies a request for alpha access.
 */
export async function denyAlphaAccessRequest(context: RequestContext, emailAddress: string) {
    await authorizeAccountHasInternalAccess(context);

    const requestItem = await AlphaAccessTable.getItem({
        partitionType: "AlphaAccessRequests",
        sortRangeType: "Request",
        emailAddress,
    });
    if (!requestItem) throw new NotFoundError("Alpha access request not found");

    if (requestItem.decision)
        throw new FailedPreconditionError("A decision has already been made for this request");

    await AlphaAccessTable.putItem(
        {
            ...requestItem,
            lockVersion: requestItem.lockVersion + 1,
            decision: {
                type: "Denied",
                deniedByAccountId: context.getAuthenticatedAccountId(),
            },
        },
        {
            condition: {
                lockVersion: DynamoConditionExpression.eq(requestItem.lockVersion),
            },
        },
    );
}
