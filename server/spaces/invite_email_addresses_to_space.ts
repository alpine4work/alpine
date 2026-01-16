import {createAccountWithEmailAddressTransactionEntries} from "~/server/accounts/create_account_transaction_entries.js";
import {getAccountIdByEmailAddressIfExists} from "~/server/accounts/get_account_id_by_email_address_if_exists.js";
import {getOwnAccount} from "~/server/accounts/get_own_account.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
    ServerSessionActionContextWithEmail,
} from "~/server/context/server_action_context.js";
import {maxLabelStringForDynamoKeyAttribute} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {getAddSpaceAccountTransactionEntries} from "~/server/spaces/internal/get_add_space_account_transaction_entries.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {
    SpaceInviteRateLimitBucketItem,
    SpacesTable,
} from "~/server/spaces/internal/spaces_table.js";
import {genericEmailAddressDomains} from "~/shared/accounts/generic_email_address_domains.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {EmailAddress, isEmailAddressValid} from "~/shared/helpers/string/email_address.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {minLabelString} from "~/shared/schema/helpers/label_string_schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * The number of invites to a space that can be sent per hour for email addresses outside
 * of the space's organization.
 */
const nonDomainInviteRateLimit = 50;
const nonDomainInviteWindowLength = 60 * 60 * 1000; // 60 minutes

/**
 * Invite a list of email addresses to a space.
 * This validates the email addresses, checks if they are are already members, and validates
 * the email has not previously rejected an invite from this space as spam.
 *
 * Given a spaceId and a list of email addresses, return status information of those email
 * addresses within a space. This includes whether the email addresses are invalid,
 * already members, rejected an invite as spam, or ready to invite.
 *
 * We must call getSpaceAccountStatesByAccountIds to get the space account states for
 * the email addresses, so we return the resulting accountIDs from this as well to
 * avoid refetching data.
 *
 * Security considerations:
 *   This function allows determining whether an email address has signed up for Alpine
 *   and obtaining their AccountId. This is considered an acceptable information leak since:
 *     a) On the sign-in page, we already reveal whether an account exists
 *     b) An AccountId alone provides no access without additional authentication
 *   Additionally, there's no way to directly call this function from the client.
 */
export async function inviteEmailAddressesToSpace(
    context: ServerSessionActionContextWithEmail,
    {
        spaceId,
        emailAddresses,
    }: {
        spaceId: SpaceId;
        emailAddresses: ReadonlyArray<string>;
    },
): Promise<{
    accounts: Array<AccountModel>;
    invalidEmailAddresses: Array<string>;
    rejectedAsSpamEmailAddresses: Array<string>;
    alreadyMemberEmailAddresses: Array<string>;
    unexpectedFailureEmailAddresses: Map<string, unknown>;
}> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    return context.tracer.withSpan("Invite email addresses to space", async (context, span) => {
        const accounts: Array<AccountModel> = [];
        const unexpectedFailureEmailAddresses = new Map<string, unknown>();
        const invalidEmailAddresses = new Set<string>();
        const rejectedAsSpamEmailAddresses = new Set<string>();
        const alreadyMemberEmailAddresses = new Set<string>();

        await validateEmailAddressInvitesAreNotRateLimited(context, spaceId, emailAddresses);

        // NOTE(imjoshin): We don't do any transaction or validation here because
        // it would be too difficult to rollback at this point in time. If we do want
        // to invest into that, we would likely call into SES to validate email statuses
        // and report any that may have failed here. Given that's all async, it's likely
        // not worth the time to implement that.
        await runAllPromises(
            emailAddresses.map(async emailAddress => {
                const result = await validateInviteEmailAddressToSpace(context, {
                    spaceId,
                    emailAddress,
                });

                if (!result.ok) {
                    switch (result.reason) {
                        case "Invalid":
                            invalidEmailAddresses.add(emailAddress);
                            return;
                        case "InviteRejectedAsSpam":
                            rejectedAsSpamEmailAddresses.add(emailAddress);
                            return;
                        case "AlreadyMember":
                            alreadyMemberEmailAddresses.add(emailAddress);
                            return;
                    }
                }

                try {
                    const account = await result.inviteEmailAddressToSpace(context);

                    accounts.push(account);
                } catch (error) {
                    // Error is reported in internalInviteAccountToSpace, no need to report
                    // again here.
                    unexpectedFailureEmailAddresses.set(emailAddress, error);
                    return;
                }
            }),
        );

        span.addData({
            space: {
                members: {
                    invite: {
                        invalidEmailAddressCount: invalidEmailAddresses.size,
                        rejectedAsSpamEmailAddressCount: rejectedAsSpamEmailAddresses.size,
                        alreadyMemberEmailAddressCount: alreadyMemberEmailAddresses.size,
                        invitedEmailAddressCount: accounts.length,
                        unexpectedFailureEmailAddressCount: unexpectedFailureEmailAddresses.size,
                    },
                },
            },
        });

        return {
            accounts: Array.from(accounts),
            invalidEmailAddresses: Array.from(invalidEmailAddresses),
            rejectedAsSpamEmailAddresses: Array.from(rejectedAsSpamEmailAddresses),
            alreadyMemberEmailAddresses: Array.from(alreadyMemberEmailAddresses),
            unexpectedFailureEmailAddresses,
        };
    });
}

/**
 * Invites a user to join a space by their email address. Only space administrators
 * can invite users. The invited user will be invited as a "Member" role.
 *
 * The function ensures proper authorization and maintains the space membership state
 * in the database.
 */
async function inviteEmailAddressToSpaceWithoutRetryTransaction(
    context: ServerSessionActionContextWithEmail,
    {
        emailAddress,
        existingAccountId,
        spaceId,
    }: {
        spaceId: SpaceId;
        emailAddress: EmailAddress;
        existingAccountId: AccountId | undefined;
    },
): Promise<AccountModel> {
    return context.tracer.withSpan("Invite email address to space", async (context, span) => {
        await authorizeSpaceAccess(context, spaceId, "Admin");

        const accountId = existingAccountId ?? generateId<AccountId>();
        span.addData({
            space: {
                members: {
                    invite: {
                        send: existingAccountId ? {existingAccountId} : {newAccountId: accountId},
                    },
                },
            },
        });

        const currentTime = new Date();

        const [actorAccount, {spaceItem, account, newSpaceAccountItem, transactionEntries}] =
            await runAllPromises([
                getOwnAccount(context),
                getAddSpaceAccountTransactionEntries(context, {
                    currentTime,
                    space: {type: "Existing", id: spaceId},
                    account: existingAccountId
                        ? {type: "Existing", id: accountId, invitedEmailAddress: emailAddress}
                        : {type: "New", id: accountId, emailAddress},
                    role: "Member",
                }),
            ]);

        assert(spaceItem);

        await DynamoTableSchema.executeTransaction(context, [
            ...(!existingAccountId
                ? createAccountWithEmailAddressTransactionEntries({
                      id: accountId,
                      // Use email as name for new account so they can be mentioned
                      // in the space before they join.
                      name: emailAddress,
                      emailAddress,
                      currentTime,
                  })
                : []),
            ...transactionEntries,
        ]);

        const acceptInviteUrl = `${
            context.constants.edgeServiceUrl
        }/auth/sign-in?email=${encodeURIComponent(emailAddress)}&to=${encodeURIComponent(
            `/s/${spaceId}/invite/accept`,
        )}`;
        const rejectInviteAndMarkAsSpamUrl = `${context.constants.edgeServiceUrl}/s/${spaceId}/invite/reject-and-mark-as-spam`;

        if (process.env.NODE_ENV === "development" || process.env.PLAYWRIGHT_TEST_PATH) {
            // Use strong consistency for the `/invite/accept` route to make sure we
            // correctly read any data from sign in.

            // eslint-disable-next-line no-console
            console.log(
                quote`Accept the invite for ${emailAddress} in ${spaceItem.name} here: ${acceptInviteUrl}`,
            );
        }

        await context.email.send({
            fromEmailAddressAlias: "Invites",
            toEmailAddress: emailAddress,
            templateName: "SpaceInvite",
            templateProps: {
                spaceName: spaceItem.name,
                inviterShortName: getAccountShortNameWithoutFullNameTooltip(
                    actorAccount.initialData,
                ),
                acceptInviteUrl,
                rejectInviteAndMarkAsSpamUrl,
            },
        });

        return createAccountModelFromItem(
            newSpaceAccountItem,
            newSpaceAccountItem.state.type === "Active" ? account : null,
        );
    });
}

async function validateEmailAddressForInviteInSpace(
    context: ServerActionContext,
    spaceId: SpaceId,
    emailAddress: string,
): Promise<
    | {
          ok: false;
          reason: "Invalid" | "InviteRejectedAsSpam" | "AlreadyMember";
      }
    | {
          ok: true;
          accountId: AccountId | null;
          emailAddress: EmailAddress;
      }
> {
    emailAddress = emailAddress.toLowerCase();

    if (!isEmailAddressValid(emailAddress)) {
        return {ok: false, reason: "Invalid"};
    }

    const accountId = await getAccountIdByEmailAddressIfExists(context, emailAddress);

    const spaceAccountItem = accountId
        ? await getSpaceAccountItemIfExists(context, spaceId, accountId, {
              consistency: "Strong",
          })
        : null;

    if (spaceAccountItem) {
        if (spaceAccountItem.state.type !== "Removed") {
            return {ok: false, reason: "AlreadyMember"};
        } else if (spaceAccountItem.state.reason === "InviteRejectedAsSpam") {
            return {ok: false, reason: "InviteRejectedAsSpam"};
        }
    }

    return {ok: true, accountId, emailAddress};
}

async function validateInviteEmailAddressToSpace(
    context: ServerSessionActionContextWithEmail,
    {
        spaceId,
        emailAddress,
    }: {
        spaceId: SpaceId;
        emailAddress: string;
    },
): Promise<
    | {
          ok: false;
          emailAddress: string;
          reason: "Invalid" | "InviteRejectedAsSpam" | "AlreadyMember";
      }
    | {
          ok: true;
          emailAddress: EmailAddress;
          inviteEmailAddressToSpace: (
              context: ServerSessionActionContextWithEmail,
          ) => Promise<AccountModel>;
      }
> {
    const result = await validateEmailAddressForInviteInSpace(context, spaceId, emailAddress);

    if (!result.ok) {
        return {
            ok: false,
            emailAddress,
            reason: result.reason,
        };
    }

    const {accountId: initialAccountId, emailAddress: validatedEmailAddress} = result;

    return {
        ok: true,
        emailAddress: validatedEmailAddress,
        inviteEmailAddressToSpace: async context => {
            let hasAlreadyAttempted = false;

            return context.dynamo.retryTransaction(async context => {
                const isInitialAttempt = !hasAlreadyAttempted;
                hasAlreadyAttempted = true;

                let accountId = initialAccountId;

                if (!isInitialAttempt) {
                    // Run the EXACT SAME validations as a sanity check. This time we'll throw.
                    const result = await validateEmailAddressForInviteInSpace(
                        context,
                        spaceId,
                        emailAddress,
                    );

                    if (!result.ok) {
                        throw new FailedPreconditionError("Can’t invite email address to space");
                    }

                    accountId = result.accountId;
                }

                const account = await inviteEmailAddressToSpaceWithoutRetryTransaction(context, {
                    spaceId,
                    emailAddress: validatedEmailAddress,
                    existingAccountId: accountId ?? undefined,
                });

                return account;
            });
        },
    };
}

async function validateEmailAddressInvitesAreNotRateLimited(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    emailAddresses: ReadonlyArray<string>,
): Promise<void> {
    const consistency = "StrongWithinCache" as const;

    const [spaceAutoAddAccountsFromEmailDomains, currentSpaceInviteRateLimitBucket] =
        await runAllPromises([
            arrayFromAsyncIterable(
                mapAsyncIterableIterator(
                    SpacesTable.query(context, {
                        limit: "All",
                        consistency,
                        partitionKey: {
                            partitionType: "Space",
                            spaceId,
                        },
                        startSortKey: {
                            sortRangeType: "AutoAddAccountsFromEmailDomain",
                            emailDomain: minLabelString,
                        },
                        endSortKey: {
                            sortRangeType: "AutoAddAccountsFromEmailDomain",
                            emailDomain: maxLabelStringForDynamoKeyAttribute,
                        },
                    }),
                    item => item.emailDomain,
                ),
            ),
            getCurrentSpaceInviteRateLimitBucket(context, spaceId, {consistency}),
        ]);

    const spaceAutoAddDomainsSet = new Set(spaceAutoAddAccountsFromEmailDomains);

    const emailAddressInvitesOutsideOfOrganizationDomain = filterMapArray(
        emailAddresses,
        emailAddress =>
            isEmailAddressOutsideOfOrganizationDomain(emailAddress, spaceAutoAddDomainsSet)
                ? emailAddress
                : undefined,
    );

    // If all email address in the batch are domain invites, do not rate limit.
    if (emailAddressInvitesOutsideOfOrganizationDomain.length === 0) {
        return;
    }

    const consumedInviteCountForCurrentRequest =
        emailAddressInvitesOutsideOfOrganizationDomain.length;

    const remainingInviteCountAfterRequest =
        currentSpaceInviteRateLimitBucket.bucket.remainingInviteCount -
        consumedInviteCountForCurrentRequest;

    // NOTE(ifitzsimmons, 2026-01-14): If there are more than 50 invites to emails
    // outside of the organization, throw an error. This kind of stinks because if they
    // invite 60 people outside of their organization in one batch request, we'll fail
    // all 60. I think this is fine, because the people doing this are most likely
    // trying to spam.
    if (remainingInviteCountAfterRequest < 0) {
        throw new FailedPreconditionError("Invite email rate limit exceeded", {
            displayMessage: errorDisplayMessage`You have reached the maximum number of invites \
            for accounts outside of your organization. Please try again later. \
            You can continue inviting people within your organization. To raise the invite limit, contact ${errorDisplayMessage.supportLink}.`,
        });
    }

    const newItem = {
        ...currentSpaceInviteRateLimitBucket,
        bucket: {
            ...currentSpaceInviteRateLimitBucket.bucket,
            remainingInviteCount: remainingInviteCountAfterRequest,
        },
    };

    // This will throw an exception if the `updateLockVersion` has changed since we last read the item.
    await SpacesTable.directlyUpdateItem(context, newItem);
}

async function getCurrentSpaceInviteRateLimitBucket(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<SpaceInviteRateLimitBucketItem> {
    const currentTime = new Date(Date.now());

    const bucketItem = await SpacesTable.getItemIfExists(
        context,
        {
            partitionType: "Space",
            sortRangeType: "SpaceInviteRateLimitBucket",
            spaceId,
        },
        {consistency},
    );

    if (!bucketItem) {
        return {
            partitionType: "Space",
            sortRangeType: "SpaceInviteRateLimitBucket",
            spaceId,
            bucket: {
                startTime: currentTime,
                remainingInviteCount: nonDomainInviteRateLimit,
            },
        };
    }

    const currentWindowEndTime = new Date(
        bucketItem.bucket.startTime.getTime() + nonDomainInviteWindowLength,
    );

    if (currentTime > currentWindowEndTime) {
        // Reset the bucket starting at time now.
        return {
            ...bucketItem,
            bucket: {
                startTime: currentTime,
                remainingInviteCount: nonDomainInviteRateLimit,
            },
        };
    }

    // Return the current and active bucket
    return bucketItem;
}

function isEmailAddressOutsideOfOrganizationDomain(
    emailAddress: string,
    autoAddDomains: Set<string>,
): boolean {
    const domain = emailAddress.split("@", 2)[1];
    const emailAddressBeforeFirstDot = domain?.split(".", 2)[0];

    const isGeneric = genericEmailAddressDomains
        .get()
        .beforeFirstDotSet.has(emailAddressBeforeFirstDot?.toLowerCase() ?? "");

    return isGeneric || !autoAddDomains.has(domain ?? "");
}
