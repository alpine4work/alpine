import {compareAsc as compareDatesAsc} from "date-fns";
import {
    authorizeInternalAccess,
    checkAccountEmailAddressDoesNotExistTransactionEntry,
    createAccountForAlphaTransactionEntries,
} from "~/server/dynamo/accounts_table";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {
    RequestContext,
    UnauthenticatedRequestContext,
} from "~/server/dynamo/context/request_context";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {createSpaceAccountForAlphaTransactionEntries} from "~/server/dynamo/spaces_table";
import {EmailAddress, validateEmailAddress} from "~/server/emails/email_address";
import {FromEmailAddress} from "~/server/emails/from_email_address";
import {FailedPreconditionError, InternalError, NotFoundError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable";
import {filterMapAsyncIterableIterator} from "~/shared/helpers/iterable/filter_map_async_iterable_iterator";
import {generateId} from "~/shared/id/id";
import {AccountId} from "~/shared/id/types/id_types";
import {
    AlphaAccessRequestDecisionSchema,
    AlphaAccessRequestModel,
} from "~/shared/models/alpha_access_request_model";
import {
    AlphaConfiguration,
    AlphaConfigurationSchema,
} from "~/shared/models/alpha_configuration_schema";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema} from "~/shared/schema/schema";

const AlphaAccessTable = DynamoTableSchema.new({
    name: "AlphaAccess",
    partitions: {
        /**
         * We include one item in our alpha access table with some configuration
         * options that we can change on the fly.
         */
        AlphaConfiguration: {
            partitionKeyAttributes: {},
            sortRanges: {
                Configuration: {
                    sortKeyAttributes: {},
                    attributes: AlphaConfigurationSchema,
                },
            },
        },

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
                        emailAddress: DynamoKeyAttributeSchema.emailAddressString,
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,

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

export async function seedTestAlphaConfiguration(context: DynamoContext) {
    assert(process.env.NODE_ENV !== "production");
    const {defaultSpaceId} = getDynamoSeedConstants();

    await AlphaAccessTable.updateItem(
        context,
        {
            partitionType: "AlphaConfiguration",
            sortRangeType: "Configuration",
        },
        configuration => {
            // If we have configured a default space, then don't update.
            if (configuration?.defaultSpaceId) return configuration;

            return {
                partitionType: "AlphaConfiguration",
                sortRangeType: "Configuration",
                ...configuration,
                defaultSpaceId,
            };
        },
    );
}

/**
 * Sends a request for alpha access to the admin accounts managing alpha
 * access requests.
 *
 * Can not request alpha access twice for the same email address.
 */
export async function requestAlphaAccess(
    context: UnauthenticatedRequestContext,
    {
        name,
        emailAddress,
        message,
    }: {
        name: string;
        emailAddress: EmailAddress;
        message: string;
    },
) {
    try {
        await DynamoTableSchema.executeTransaction(context, [
            // Make sure an account does not already exist when requesting alpha access.
            // The account could have been created manually.
            checkAccountEmailAddressDoesNotExistTransactionEntry(emailAddress),

            AlphaAccessTable.transactionCreateItem({
                partitionType: "AlphaAccessRequests",
                sortRangeType: "Request",
                createdTime: new Date(),
                name,
                emailAddress,
                message,
                decision: null,
            }),
        ]);
    } catch (error) {
        if (!isDynamoConditionCheckError(error)) throw error;

        const existingRequest = await AlphaAccessTable.getItem(context, {
            partitionType: "AlphaAccessRequests",
            sortRangeType: "Request",
            emailAddress,
        });
        const decision = existingRequest?.decision ?? null;

        let displayMessage;
        if (!decision) {
            // TODO(calebmer): Maybe this should have a "warn" severity?
            displayMessage = errorDisplayMessage`Already requested access for the email address “${emailAddress}”. You’ll get an email to this address if your request is approved. Reach out to someone on our team if you’d like to know the status of your request.`;
        } else {
            switch (decision.type) {
                case "Approved": {
                    // TODO(calebmer): Maybe this should have a "success" severity?
                    displayMessage = errorDisplayMessage`You’re already approved! Try ${errorDisplayMessage.link(
                        "signing in",
                        "/sign-in",
                    )} with the email address “${emailAddress}”.`;
                    break;
                }
                case "Denied": {
                    displayMessage = errorDisplayMessage`Your access request for email address “${emailAddress}” was denied by a member of our team. You may not submit another access request for this email address.`;
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

    // NOTE(calebmer): Send an email to me whenever someone requests alpha access
    // so I know to approve it immediately.
    //
    // TODO(calebmer): Temporarily disable in Jest tests so we don't have to
    // validate the email address.
    if (typeof jest === "undefined") {
        await context.email.send({
            fromEmailAddress: FromEmailAddress.Alpha,
            toEmailAddress: await validateEmailAddress(context, "calebmeredith8@gmail.com"),
            templateName: "RequestedAlphaAccess",
            templateProps: {
                name,
                emailAddress,
                message,
            },
        });
    }
}

/**
 * Get the list of alpha access requests for an internal user who will decide
 * whether to accept or reject them.
 */
export async function getUndecidedAlphaAccessRequests(context: RequestContext) {
    await authorizeInternalAccess(context);

    const requests = await arrayFromAsyncIterable(
        filterMapAsyncIterableIterator(
            AlphaAccessTable.queryEntirePartition(context, {
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
export async function approveAlphaAccessRequest(
    context: RequestContext,
    emailAddress: EmailAddress,
) {
    await authorizeInternalAccess(context);

    const {defaultSpaceId} = await getAlphaConfiguration(context);
    if (!defaultSpaceId)
        throw new InternalError('Expected alpha configuration to include "defaultSpaceId"');

    const requestItem = await AlphaAccessTable.getItem(context, {
        partitionType: "AlphaAccessRequests",
        sortRangeType: "Request",
        emailAddress,
    });
    if (!requestItem) throw new NotFoundError("Alpha access request not found");

    if (requestItem.decision)
        throw new FailedPreconditionError("A decision has already been made for this request");

    const accountId = generateId<AccountId>();

    await DynamoTableSchema.executeTransaction(context, [
        AlphaAccessTable.transactionDirectlyUpdateItem({
            ...requestItem,
            decision: {
                type: "Approved",
                approvedByAccountId: context.auth.getAccountId(),
                accountId,
            },
        }),
        ...createAccountForAlphaTransactionEntries({
            id: accountId,
            name: requestItem.name,
            emailAddress: requestItem.emailAddress,
        }),
        ...createSpaceAccountForAlphaTransactionEntries({
            spaceId: defaultSpaceId,
            accountId,
        }),
    ]);

    // TODO(calebmer): For now I am sending alpha request approval emails manually
    // so they don't get trapped in a junk email folder.
    //
    // await sendEmail(context, {
    //     fromEmailAddress: FromEmailAddress.Caleb,
    //     toEmailAddress: requestItem.emailAddress,
    //     templateName: "AlphaAccessRequestApproved",
    //     templateProps: {},
    // });
}

/**
 * Denies a request for alpha access.
 */
export async function denyAlphaAccessRequest(context: RequestContext, emailAddress: EmailAddress) {
    await authorizeInternalAccess(context);

    const requestItem = await AlphaAccessTable.getItem(context, {
        partitionType: "AlphaAccessRequests",
        sortRangeType: "Request",
        emailAddress,
    });
    if (!requestItem) throw new NotFoundError("Alpha access request not found");

    if (requestItem.decision)
        throw new FailedPreconditionError("A decision has already been made for this request");

    await AlphaAccessTable.directlyUpdateItem(context, {
        ...requestItem,
        decision: {
            type: "Denied",
            deniedByAccountId: context.auth.getAccountId(),
        },
    });
}

/**
 * Get all the email addresses for alpha access requests we approved. Only
 * accounts with internal access may call this function.
 */
export async function* getAllApprovedAlphaAccessRequestEmailAddresses(
    context: RequestContext,
): AsyncIterableIterator<EmailAddress> {
    await authorizeInternalAccess(context);

    for await (const request of AlphaAccessTable.queryEntirePartition(context, {
        partitionKey: {
            partitionType: "AlphaAccessRequests",
        },
    })) {
        if (request.decision?.type === "Approved") {
            yield request.emailAddress;
        }
    }
}

export async function getAlphaConfiguration(context: DynamoContext): Promise<AlphaConfiguration> {
    const configuration = await AlphaAccessTable.getItem(context, {
        partitionType: "AlphaConfiguration",
        sortRangeType: "Configuration",
    });
    return configuration ?? {};
}

export async function saveAlphaConfiguration(
    context: RequestContext,
    configuration: AlphaConfiguration,
) {
    await authorizeInternalAccess(context);

    await AlphaAccessTable.createOrReplaceItem(context, {
        partitionType: "AlphaConfiguration",
        sortRangeType: "Configuration",
        ...configuration,
    });
}
