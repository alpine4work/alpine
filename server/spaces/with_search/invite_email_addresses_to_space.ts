import {internalGetAccountIdByEmailAddressIfExists} from "~/server/accounts/accounts_table.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {dangerouslyFavoriteSearchEntityWithoutAuthorization} from "~/server/search/data/table/search_entity_table.js";
import {
    authorizeSpaceAccess,
    internalFilterEmailsByInviteStatusWithoutAuthorization,
    internalInviteAccountToSpace,
} from "~/server/spaces/spaces_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Invite a list of email addresses to a space.
 * This validates the email addresses, checks if they are are already members, and validates
 * the email has not previously rejected an invite from this space as spam.
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
        const {
            invalidEmailAddresses,
            rejectedAsSpamEmailAddresses,
            alreadyMemberEmailAddresses,
            readyToInviteEmailAddresses,
            emailAddressToExistingAccountId,
        } = await internalFilterEmailsByInviteStatusWithoutAuthorization(
            // Any reads here should be strongly consistent since there's
            // no DynamoDB transaction retry loop (as we'll be sending SES emails).
            context.dynamo.expectStrongReadConsistency(),
            {
                spaceId,
                emailAddresses,
                getAccountIdByEmailAddressIfExists: async emailAddress => {
                    return internalGetAccountIdByEmailAddressIfExists(context, emailAddress);
                },
            },
        );

        const unexpectedFailureEmailAddresses = new Map<string, unknown>();

        // NOTE(imjoshin): We don't do any transaction or validation here because
        // it would be too difficult to rollback at this point in time. If we do want
        // to invest into that, we would likely call into SES to validate email statuses
        // and report any that may have failed here. Given that's all async, it's likely
        // not worth the time to implement that.
        const accounts = await runAllPromises(
            readyToInviteEmailAddresses.map(async emailAddress => {
                // Wrap this call in a silent try/catch so we can report
                // any email addresses that failed to invite within the final result.
                try {
                    const account = await internalInviteAccountToSpace(context, {
                        emailAddress,
                        existingAccountId: emailAddressToExistingAccountId.get(emailAddress),
                        spaceId,
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

                    return account;
                } catch (error) {
                    // Error is reported in internalInviteAccountToSpace, no need to report
                    // again here.
                    unexpectedFailureEmailAddresses.set(emailAddress, error);
                }

                return null;
            }),
        );

        span.addData({
            space: {
                members: {
                    invite: {
                        invalidEmailAddressCount: invalidEmailAddresses.length,
                        rejectedAsSpamEmailAddressCount: rejectedAsSpamEmailAddresses.length,
                        alreadyMemberEmailAddressCount: alreadyMemberEmailAddresses.length,
                        invitedEmailAddressCount: readyToInviteEmailAddresses.length,
                        unexpectedFailureEmailAddressCount: unexpectedFailureEmailAddresses.size,
                    },
                },
            },
        });

        return {
            accounts: accounts.filter(isNonNullable),
            invalidEmailAddresses,
            rejectedAsSpamEmailAddresses,
            alreadyMemberEmailAddresses,
            unexpectedFailureEmailAddresses,
        };
    });
}
