import {internalGetAccountIdByEmailAddressIfExists} from "~/server/accounts/accounts_table.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {dangerouslyFavoriteSearchEntityWithoutAuthorization} from "~/server/search/data/table/search_entity_table.js";
import {
    authorizeSpaceAccess,
    internalValidateInviteEmailAddressToSpace,
} from "~/server/spaces/spaces_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
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
    context: ServerSessionActionContext,
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
                const result = await internalValidateInviteEmailAddressToSpace(context, {
                    spaceId,
                    emailAddress,
                    getAccountIdByEmailAddressIfExists: async emailAddress => {
                        return internalGetAccountIdByEmailAddressIfExists(context, emailAddress);
                    },
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
                    const account = await result.internalInviteEmailAddressToSpace(context, {
                        favoriteSearchEntity: (
                            context,
                            {spaceId: otherSpaceId, accountId: otherAccountId, entityId},
                        ) => {
                            return dangerouslyFavoriteSearchEntityWithoutAuthorization(context, {
                                spaceId: otherSpaceId,
                                accountId: otherAccountId,
                                entityId,
                            });
                        },
                    });

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
