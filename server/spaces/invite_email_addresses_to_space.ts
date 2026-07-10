import {createAccountWithEmailAddressTransactionEntries} from "~/server/accounts/create_account_transaction_entries.js";
import {getAccountIdByEmailAddressIfExists} from "~/server/accounts/get_account_id_by_email_address_if_exists.js";
import {getOwnAccountWithoutSpace} from "~/server/accounts/get_own_account_without_space.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
    ServerSessionActionContextWithEmail,
} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {
    authorizeSpaceAccess,
    authorizeSpaceAccessIfPossible,
} from "~/server/spaces/authorize_space_access.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {getAddSpaceAccountTransactionEntries} from "~/server/spaces/internal/get_add_space_account_transaction_entries.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {
    SpaceInviteRateLimitBucketItem,
    SpacesTable,
} from "~/server/spaces/internal/spaces_table.js";
import {genericEmailAddressDomains} from "~/shared/accounts/generic_email_address_domains.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {getEmailDomainForAutoAddSpaceAccounts} from "~/shared/accounts/get_email_domain_for_auto_add_space_accounts.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {EmailAddress, isEmailAddressValid} from "~/shared/helpers/string/email_address.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * The number of invites to a space that can be sent per hour for email addresses
 * outside of the space's organization.
 */
const nonDomainInviteRateLimit = 50;
const nonDomainInviteWindowLength = 60 * 60 * 1000; // 60 minutes

/**
 * Invite a list of email addresses to a space. This validates the email addresses,
 * checks if they are are already members, and validates the email has not
 * previously rejected an invite from this space as spam.
 *
 * Given a spaceId and a list of email addresses, return status information of
 * those email addresses within a space. This includes whether the email addresses
 * are invalid, already members, rejected an invite as spam, or ready to invite.
 *
 * We must call getSpaceAccountStatesByAccountIds to get the space account states
 * for the email addresses, so we return the resulting accountIDs from this as well
 * to avoid refetching data.
 *
 * Security considerations: This function allows determining whether an email
 * address has signed up for Alpine and obtaining their AccountId. This is
 * considered an acceptable information leak since: a) On the sign-in page, we
 * already reveal whether an account exists b) An AccountId alone provides no
 * access without additional authentication Additionally, there's no way to
 * directly call this function from the client.
 */
export async function inviteEmailAddressesToSpace(
    context: ServerSessionActionContextWithEmail,
    {
        spaceId,
        emailAddresses,
        withoutAffinityPoints = false,
    }: {
        spaceId: SpaceId;
        emailAddresses: ReadonlyArray<string>;
        withoutAffinityPoints?: boolean;
    },
): Promise<{
    accounts: ReadonlyArray<AccountModel>;
    affinityPoints: ReadonlyArray<number>;
    invalidEmailAddresses: ReadonlySet<string>;
    rejectedAsSpamEmailAddresses: ReadonlySet<string>;
    alreadyMemberEmailAddresses: ReadonlyMap<string, AccountId>;
    requiresAdminAccessEmailAddresses: ReadonlySet<string>;
    unexpectedFailureEmailAddresses: ReadonlyMap<string, unknown>;
}> {
    await authorizeSpaceAccess(context, spaceId, "Member");

    // Make sure `emailAddresses` are unique! Otherwise we'll get unexpected failures.
    emailAddresses = Array.from(new Set(emailAddresses));

    return await context.tracer.withSpan(
        "Invite email addresses to space",
        async (context, span) => {
            const accounts: Array<AccountModel> = [];
            const affinityPoints: Array<number> = [];
            const unexpectedFailureEmailAddresses = new Map<string, unknown>();
            const invalidEmailAddresses = new Set<string>();
            const rejectedAsSpamEmailAddresses = new Set<string>();
            const alreadyMemberEmailAddresses = new Map<string, AccountId>();
            const requiresAdminAccessEmailAddresses = new Set<string>();

            const {autoAddAccountsFromEmailDomains} =
                await validateEmailAddressInvitesAreNotRateLimited(
                    context,
                    spaceId,
                    emailAddresses,
                );

            // NOTE(imjoshin): We don't do any transaction or validation here because it would
            // be too difficult to rollback at this point in time. If we do want to invest into
            // that, we would likely call into SES to validate email statuses and report any
            // that may have failed here. Given that's all async, it's likely not worth the
            // time to implement that.
            await runAllPromises(
                emailAddresses.map(async emailAddress => {
                    const result = await validateInviteEmailAddressToSpace(context, {
                        spaceId,
                        emailAddress,
                        autoAddAccountsFromEmailDomains,
                    });

                    if (!result.ok) {
                        switch (result.reason) {
                            case "Invalid": {
                                invalidEmailAddresses.add(emailAddress);
                                return;
                            }
                            case "InviteRejectedAsSpam": {
                                rejectedAsSpamEmailAddresses.add(emailAddress);
                                return;
                            }
                            case "AlreadyMember": {
                                alreadyMemberEmailAddresses.set(emailAddress, result.accountId);

                                // Even though we didn't send an invite, we still want to boost affinity points for
                                // this account that's already a member of the space.
                                if (!withoutAffinityPoints) {
                                    await context.searchInjection.markSearchAffinityEntityInteraction(
                                        {
                                            spaceId,
                                            entityId: `Account:${result.accountId}`,
                                            interaction: {type: "HighIntentUpdate"},
                                            // Accounts cannot live in a site.
                                            siteId: null,
                                        },
                                    );
                                }
                                return;
                            }
                            case "RequiresAdminAccess": {
                                requiresAdminAccessEmailAddresses.add(emailAddress);
                                return;
                            }
                            default:
                                throw exhaustive(result);
                        }
                    }

                    try {
                        const account = await result.inviteEmailAddressToSpace(context);

                        // Add affinity points for each account the actor has invited so they show up high
                        // in the account's suggested accounts list.
                        const points = withoutAffinityPoints
                            ? 0
                            : await context.searchInjection.markSearchAffinityEntityInteraction({
                                  spaceId,
                                  entityId: `Account:${account.id}`,
                                  interaction: {type: "HighIntentUpdate"},
                                  // Accounts cannot live in a site.
                                  siteId: null,
                              });

                        accounts.push(account);
                        affinityPoints.push(points);
                    } catch (error) {
                        // Error is reported in internalInviteAccountToSpace, no need to report again here.
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
                            requiresAdminAccessEmailAddressCount:
                                requiresAdminAccessEmailAddresses.size,
                            invitedEmailAddressCount: accounts.length,
                            unexpectedFailureEmailAddressCount:
                                unexpectedFailureEmailAddresses.size,
                        },
                    },
                },
            });

            return {
                accounts,
                affinityPoints,
                invalidEmailAddresses,
                rejectedAsSpamEmailAddresses,
                alreadyMemberEmailAddresses,
                requiresAdminAccessEmailAddresses,
                unexpectedFailureEmailAddresses,
            };
        },
    );
}

/**
 * Invites a user to join a space by their email address. Only space administrators
 * can invite users. The invited user will be invited as a "Member" role.
 *
 * The function ensures proper authorization and maintains the space membership
 * state in the database.
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
    return await context.tracer.withSpan("Invite email address to space", async (context, span) => {
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
                getOwnAccountWithoutSpace(context),
                getAddSpaceAccountTransactionEntries(context, {
                    currentTime,
                    space: {type: "Existing", id: spaceId},
                    account: existingAccountId
                        ? {type: "Existing", id: accountId, invitedEmailAddress: emailAddress}
                        : {type: "New", id: accountId, emailAddress},
                    role: "Member",
                    inviterAccountId: context.actor.getAccountId(),
                }),
            ]);

        assert(spaceItem);

        await DynamoTableSchema.executeTransaction(context, [
            ...(!existingAccountId
                ? createAccountWithEmailAddressTransactionEntries({
                      id: accountId,
                      // Use email as name for new account so they can be mentioned in the space before
                      // they join.
                      name: emailAddress,
                      emailAddress,
                      currentTime,
                  })
                : []),
            ...transactionEntries,
        ]);

        const acceptInviteUrl = `${
            context.constants.edgeServiceUrl
        }/auth/sign-in?email=${encodeURIComponent(emailAddress)}&invite=${spaceId}`;
        const rejectInviteAndMarkAsSpamUrl = `${context.constants.edgeServiceUrl}/invite/${spaceId}/reject-and-mark-as-spam`;

        if (process.env.NODE_ENV !== "production") {
            // Use strong consistency for the `/invite/accept` route to make sure we correctly
            // read any data from sign in.

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
    {
        spaceId,
        emailAddress,
        autoAddAccountsFromEmailDomains,
    }: {
        spaceId: SpaceId;
        emailAddress: string;
        autoAddAccountsFromEmailDomains: ReadonlySet<string>;
    },
): Promise<
    | {ok: false; emailAddress: string; reason: "Invalid"}
    | {ok: false; emailAddress: string; reason: "InviteRejectedAsSpam"}
    | {ok: false; emailAddress: string; reason: "RequiresAdminAccess"}
    | {ok: false; emailAddress: string; reason: "AlreadyMember"; accountId: AccountId}
    | {ok: true; accountId: AccountId | null; emailAddress: EmailAddress}
> {
    emailAddress = emailAddress.toLowerCase();

    if (!isEmailAddressValid(emailAddress)) {
        return {ok: false, reason: "Invalid", emailAddress};
    }

    const emailDomainForAutoAddSpaceAccounts = getEmailDomainForAutoAddSpaceAccounts(emailAddress);

    const [accountId, adminAuthorizationResult] = await runAllPromises([
        getAccountIdByEmailAddressIfExists(context, emailAddress),

        // If auto-add domains are enabled for the space then non-admins are allowed to
        // invite people from the enabled auto-add domains.
        emailDomainForAutoAddSpaceAccounts &&
        autoAddAccountsFromEmailDomains.has(emailDomainForAutoAddSpaceAccounts)
            ? {ok: true as const}
            : authorizeSpaceAccessIfPossible(context, spaceId, "Admin"),
    ]);

    if (!adminAuthorizationResult.ok) {
        return {ok: false, reason: "RequiresAdminAccess", emailAddress};
    }

    const spaceAccountItem = accountId
        ? await getSpaceAccountItemIfExists(context, spaceId, accountId, {
              consistency: "Strong",
          })
        : null;

    if (spaceAccountItem) {
        if (spaceAccountItem.state.type !== "Removed") {
            return {
                ok: false,
                reason: "AlreadyMember",
                emailAddress,
                accountId: spaceAccountItem.accountId,
            };
        } else if (spaceAccountItem.state.reason === "InviteRejectedAsSpam") {
            return {ok: false, reason: "InviteRejectedAsSpam", emailAddress};
        }
    }

    return {ok: true, accountId, emailAddress};
}

async function validateInviteEmailAddressToSpace(
    context: ServerSessionActionContextWithEmail,
    {
        spaceId,
        emailAddress,
        autoAddAccountsFromEmailDomains,
    }: {
        spaceId: SpaceId;
        emailAddress: string;
        autoAddAccountsFromEmailDomains: ReadonlySet<string>;
    },
): Promise<
    | {ok: false; emailAddress: string; reason: "Invalid"}
    | {ok: false; emailAddress: string; reason: "InviteRejectedAsSpam"}
    | {ok: false; emailAddress: string; reason: "RequiresAdminAccess"}
    | {ok: false; emailAddress: string; reason: "AlreadyMember"; accountId: AccountId}
    | {
          ok: true;
          emailAddress: EmailAddress;
          inviteEmailAddressToSpace: (
              context: ServerSessionActionContextWithEmail,
          ) => Promise<AccountModel>;
      }
> {
    const result = await validateEmailAddressForInviteInSpace(context, {
        spaceId,
        emailAddress,
        autoAddAccountsFromEmailDomains,
    });
    if (!result.ok) return result;

    const {accountId: initialAccountId, emailAddress: validatedEmailAddress} = result;

    return {
        ok: true,
        emailAddress: validatedEmailAddress,
        inviteEmailAddressToSpace: async context => {
            let hasAlreadyAttempted = false;

            return await context.dynamo.retryTransaction(async context => {
                const isInitialAttempt = !hasAlreadyAttempted;
                hasAlreadyAttempted = true;

                let accountId = initialAccountId;

                if (!isInitialAttempt) {
                    // Run the EXACT SAME validations as a sanity check. This time we'll throw.
                    const result = await validateEmailAddressForInviteInSpace(context, {
                        spaceId,
                        emailAddress,
                        autoAddAccountsFromEmailDomains,
                    });

                    if (!result.ok) {
                        throw new FailedPreconditionError(
                            quote`Can\u2019t invite email address to space: ${result.reason}`,
                        );
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
): Promise<{autoAddAccountsFromEmailDomains: ReadonlySet<string>}> {
    const consistency = "StrongWithinCache" as const;

    const possibleEmailDomainsForAutoAddSpaceAccounts = new Set(
        filterMapIterable(
            emailAddresses,
            emailAddress => getEmailDomainForAutoAddSpaceAccounts(emailAddress) ?? undefined,
        ),
    );

    const [autoAddAccountsFromEmailDomainItems, currentSpaceInviteRateLimitBucket] =
        await runAllPromises([
            runAllPromises(
                mapIterable(possibleEmailDomainsForAutoAddSpaceAccounts, emailDomain =>
                    SpacesTable.getItemIfExists(
                        context,
                        {
                            partitionType: "AutoAddAccountsFromEmailDomain",
                            sortRangeType: "Space",
                            emailDomain,
                        },
                        {consistency},
                    ),
                ),
            ).then(items => {
                return filterMapArray(items, item => {
                    if (!item) return;
                    if (item.spaceId !== spaceId) return;
                    return item;
                });
            }),
            getCurrentSpaceInviteRateLimitBucket(context, spaceId, {consistency}),
        ]);

    const autoAddAccountsFromEmailDomainsWithDisabledEmailDomains = new Set(
        mapIterable(autoAddAccountsFromEmailDomainItems, ({emailDomain}) => {
            return emailDomain;
        }),
    );

    const autoAddAccountsFromEmailDomains = new Set(
        filterMapIterable(autoAddAccountsFromEmailDomainItems, ({isEnabled, emailDomain}) => {
            if (!isEnabled) return;
            return emailDomain;
        }),
    );

    const emailAddressInvitesOutsideOfOrganizationDomain = filterMapArray(
        emailAddresses,
        emailAddress =>
            isEmailAddressOutsideOfOrganizationDomain(
                emailAddress,
                autoAddAccountsFromEmailDomainsWithDisabledEmailDomains,
            )
                ? emailAddress
                : undefined,
    );

    // If all email address in the batch are domain invites, do not rate limit.
    if (emailAddressInvitesOutsideOfOrganizationDomain.length === 0) {
        return {autoAddAccountsFromEmailDomains};
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

    // This will throw an exception if the `updateLockVersion` has changed since we
    // last read the item.
    await SpacesTable.directlyUpdateItem(context, newItem);

    return {autoAddAccountsFromEmailDomains};
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
