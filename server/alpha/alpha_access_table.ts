import {compareAsc as compareDatesAsc} from "date-fns";
import {
    authorizeInternalAccess,
    checkAccountEmailAddressDoesNotExistTransactionEntry,
    createAccountWithEmailAddressTransactionEntries,
} from "~/server/accounts/accounts_actions.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {EmailAddress} from "~/server/emails/email_address.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {internalDangerouslyCreateAlphaSpaceWelcomeChannelTransactionEntries} from "~/server/forum/data/forum_actions.js";
import {internalCreateAlphaSpaceAsAdmin} from "~/server/spaces/spaces_actions.js";
import {parseAccountNameAssumingWesternNameOrder} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {
    AlphaAccessRequestDecisionSchema,
    AlphaAccessRequestModel,
} from "~/shared/alpha/alpha_access_request_model.js";
import {
    AlphaConfiguration,
    AlphaConfigurationSchema,
} from "~/shared/alpha/alpha_configuration_schema.js";
import {Context} from "~/shared/context/context.js";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {filterMapAsyncIterableIterator} from "~/shared/helpers/iterable/filter_map_async_iterable_iterator.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";

const AlphaAccessTable = DynamoTableSchema.new({
    name: "AlphaAccess",
    partitions: [
        /**
         * We include one item in our alpha access table with some configuration
         * options that we can change on the fly.
         */
        {
            name: "AlphaConfiguration",
            partitionKeyAttributes: {},
            sortRanges: [
                {
                    name: "Configuration",
                    sortKeyAttributes: {},
                    attributes: AlphaConfigurationSchema,
                },
            ],
        },

        /**
         * All our alpha access requests are in one partition so we can query them
         * at once.
         *
         * We expect a small number of alpha access requests.
         */
        {
            name: "AlphaAccessRequests",
            partitionKeyAttributes: {},
            sortRanges: [
                {
                    name: "Request",
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
            ],
        },
    ],
});

/**
 * Sends a request for alpha access to the admin accounts managing alpha
 * access requests.
 *
 * Can not request alpha access twice for the same email address.
 */
export async function requestAlphaAccess(
    context: Context<DynamoContextModules & {email: EmailContextModuleBase}>,
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

        const existingRequest = await AlphaAccessTable.getItemIfExists(context, {
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
                    displayMessage = errorDisplayMessage`You’re already approved! Try ${errorDisplayMessage.signInLink(
                        "signing in",
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
}

/**
 * Get the list of alpha access requests for an internal user who will decide
 * whether to accept or reject them.
 */
export async function getUndecidedAlphaAccessRequests(context: ServerActionContext) {
    await authorizeInternalAccess(context);

    const requests = await arrayFromAsyncIterable(
        filterMapAsyncIterableIterator(
            AlphaAccessTable.query(context, {
                partitionKey: {
                    partitionType: "AlphaAccessRequests",
                },
                limit: "All",
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
    context: ServerSessionActionContext,
    emailAddress: EmailAddress,
) {
    await authorizeInternalAccess(context);

    const requestItem = await AlphaAccessTable.getItemIfExists(context, {
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
                approvedByAccountId: context.actor.getAccountId(),
                accountId,
            },
        }),
        ...createAccountWithEmailAddressTransactionEntries({
            id: accountId,
            currentTime: new Date(),
            name: requestItem.name,
            emailAddress: requestItem.emailAddress,
        }),
    ]);

    const shortName = parseAccountNameAssumingWesternNameOrder(requestItem.name);
    await createAlphaSpaceAsAdmin(context, {
        name: `${shortName.givenName}’s Space`,
        ownerAccountId: accountId,
    });
}

/**
 * Denies a request for alpha access.
 */
export async function denyAlphaAccessRequest(
    context: ServerSessionActionContext,
    emailAddress: EmailAddress,
) {
    await authorizeInternalAccess(context);

    const requestItem = await AlphaAccessTable.getItemIfExists(context, {
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
            deniedByAccountId: context.actor.getAccountId(),
        },
    });
}

/**
 * Get all the email addresses for alpha access requests we approved. Only
 * accounts with internal access may call this function.
 */
export async function* getAllApprovedAlphaAccessRequestEmailAddresses(
    context: ServerActionContext,
): AsyncIterableIterator<EmailAddress> {
    await authorizeInternalAccess(context);

    for await (const request of AlphaAccessTable.query(context, {
        partitionKey: {
            partitionType: "AlphaAccessRequests",
        },
        limit: "All",
    })) {
        if (request.decision?.type === "Approved") {
            yield request.emailAddress;
        }
    }
}

export async function getAlphaConfiguration(context: DynamoContext): Promise<AlphaConfiguration> {
    const configuration = await AlphaAccessTable.getItemIfExists(context, {
        partitionType: "AlphaConfiguration",
        sortRangeType: "Configuration",
    });
    return configuration ?? {};
}

export async function saveAlphaConfiguration(
    context: ServerActionContext,
    configuration: AlphaConfiguration,
) {
    await authorizeInternalAccess(context);

    await AlphaAccessTable.createOrReplaceItem(context, {
        partitionType: "AlphaConfiguration",
        sortRangeType: "Configuration",
        ...configuration,
    });
}

/**
 * Create an alpha space owned by the provided `ownerAccountId`. Only
 * administrators may call this function. We don't yet have self-serve space
 * creation.
 */
export async function createAlphaSpaceAsAdmin(
    context: ServerActionContext,
    {name, ownerAccountId}: {name: string; ownerAccountId: AccountId},
): Promise<{
    spaceId: SpaceId;
    welcomeChannelId: ChannelId;
    createdTime: Date;
}> {
    await authorizeInternalAccess(context);

    const spaceId = generateId<SpaceId>();
    const welcomeChannelId = generateId<ChannelId>();
    const createdTime = new Date();

    await internalCreateAlphaSpaceAsAdmin(context, {
        name,
        spaceId,
        createdTime,
        ownerAccountId,
        welcomeChannelId,
        createWelcomeChannelTransactionEntries:
            internalDangerouslyCreateAlphaSpaceWelcomeChannelTransactionEntries(context, {
                ownerAccountId,
                spaceId,
                welcomeChannelId,
                createdTime,
            }),
    });

    return {
        spaceId,
        welcomeChannelId,
        createdTime,
    };
}
