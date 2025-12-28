import {createAccountWithEmailAddressTransactionEntries} from "~/server/accounts/create_account_transaction_entries.js";
import {getAccountIdByEmailAddressIfExists} from "~/server/accounts/get_account_id_by_email_address_if_exists.js";
import {
    ServerActionContext,
    ServerSessionActionContextWithEmail,
} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {EmailAddress, isEmailAddressValid} from "~/server/emails/email_address.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {getAddSpaceAccountTransactionEntries} from "~/server/spaces/internal/get_add_space_account_transaction_entries.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

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

        const {spaceItem, account, newAccountItem, transactionEntries} =
            await getAddSpaceAccountTransactionEntries(context, {
                currentTime,
                space: {type: "Existing", id: spaceId},
                account: existingAccountId
                    ? {type: "Existing", id: accountId, invitedEmailAddress: emailAddress}
                    : {type: "New", id: accountId, emailAddress},
                role: "Member",
            });

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

        const spaceUrl = `${context.constants.edgeServiceUrl}/s/${spaceId}`;

        if (process.env.NODE_ENV === "development" || process.env.PLAYWRIGHT_TEST_PATH) {
            // eslint-disable-next-line no-console
            console.log(
                quote`Accept the invite for ${emailAddress} in ${
                    spaceItem.name
                } here: ${`${spaceUrl}/invite`}`,
            );
        }

        await context.email.send({
            fromEmailAddressAlias: "Invitation",
            toEmailAddress: emailAddress,
            templateName: "SpaceInvite",
            templateProps: {
                spaceUrl,
                spaceName: spaceItem.name,
            },
        });

        return createAccountModelFromItem(
            newAccountItem,
            newAccountItem.state.type === "Active" ? account : null,
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
          validatedEmailAddress: EmailAddress;
      }
> {
    let validatedEmailAddress: EmailAddress;
    if (isEmailAddressValid(emailAddress)) {
        validatedEmailAddress = emailAddress;
    } else {
        return {ok: false, reason: "Invalid"};
    }

    const accountId = await getAccountIdByEmailAddressIfExists(context, validatedEmailAddress);

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

    return {ok: true, accountId, validatedEmailAddress};
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
          emailAddress: string;
          inviteEmailAddressToSpace: (
              context: ServerSessionActionContextWithEmail,
          ) => Promise<AccountModel>;
      }
> {
    const result = await validateEmailAddressForInviteInSpace(context, spaceId, emailAddress);

    if (!result.ok) {
        return {
            ok: false,
            emailAddress: emailAddress,
            reason: result.reason,
        };
    }

    const {accountId: initialAccountId, validatedEmailAddress} = result;

    return {
        ok: true,
        emailAddress: emailAddress,
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
