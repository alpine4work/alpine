import {differenceInMinutes} from "date-fns";
import {accountEmailAddressNotFoundError} from "~/server/accounts/internal/account_email_address_not_found_error.js";
import {accountEmailAddressSignInLockedError} from "~/server/accounts/internal/account_email_address_sign_in_locked_error.js";
import {AccountEmailAddressItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getHoursUntilRegenerateOneTimePasswordUnlocked} from "~/server/accounts/internal/get_hours_until_regenerate_one_time_password_unlocked.js";
import {
    expireOneTimePasswordAfterMinutes,
    maxFailedOneTimePasswordAttemptCount,
} from "~/server/accounts/one_time_password_constants.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type AttemptOneTimePasswordSignInOptions = {
    /**
     * What is the IP address of the client attempting to sign in? We will store
     * this with the created session to identify the device the session is for.
     */
    ipAddress: string | null;

    /**
     * What is the user agent of the client attempting to sign in? We will store
     * this with the created session to identify the device the session is for.
     */
    userAgent: string | null;
};

/**
 * Attempts to sign into the account with a one time password. After a few
 * consecutive failed attempts to sign in, we will lock the account for at
 * least 24 hours.
 */
export async function attemptOneTimePasswordSignIn(
    context: DynamoContext,
    emailAddress: EmailAddress,
    oneTimePassword: string,
    options: AttemptOneTimePasswordSignInOptions,
): Promise<{
    sessionId: SessionId;
    sessionAccountId: AccountId;
}> {
    const [, result] = await attemptOneTimePasswordSignInWithAction(
        context,
        emailAddress,
        oneTimePassword,
        options,
        asyncNoop,
    );

    return result;
}

/**
 * Same as `attemptOneTimePasswordSignIn()` but you can provide an action that
 * runs after the password has been verified in parallel with session creation.
 * Useful for implementing sign up. We can immediately start creating the space
 * instead of waiting for session creation to finish.
 */
export function attemptOneTimePasswordSignInWithAction<Value>(
    context: DynamoContext,
    emailAddress: EmailAddress,
    oneTimePassword: string,
    {ipAddress, userAgent}: AttemptOneTimePasswordSignInOptions,
    action: (accountEmailAddressItem: AccountEmailAddressItem, span: TracerSpan) => Promise<Value>,
): Promise<
    [
        Value,
        {
            sessionId: SessionId;
            sessionAccountId: AccountId;
        },
    ]
> {
    return context.tracer.withSpan("Attempt one time password sign in", (context, span) => {
        return context.dynamo.retryTransaction(context => {
            return run(context, span);
        });
    });

    async function run(
        context: DynamoContext,
        span: TracerSpan,
    ): Promise<
        [
            Value,
            {
                sessionId: SessionId;
                sessionAccountId: AccountId;
            },
        ]
    > {
        span.addData({
            http: {
                clientIp: ipAddress ?? undefined,
                userAgent: userAgent ?? undefined,
            },
        });

        const accountEmailAddressItem = await AccountsTable.getItemIfExists(context, {
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
        });
        if (!accountEmailAddressItem) {
            span.addData({common: {branch: "EmailAddressNotFound"}});
            throw accountEmailAddressNotFoundError(emailAddress);
        }

        span.addPropagatedData({context: {accountId: accountEmailAddressItem.accountId}});

        if (!accountEmailAddressItem.oneTimePasswordSignInState) {
            span.addData({common: {branch: "MissingOneTimePassword"}});
            throw missingOneTimePasswordError();
        }

        const minutesSinceGeneratedTime = differenceInMinutes(
            new Date(),
            accountEmailAddressItem.oneTimePasswordSignInState.generatedTime,
        );

        const hoursUntilUnlocked =
            getHoursUntilRegenerateOneTimePasswordUnlocked(accountEmailAddressItem);

        span.addData({
            auth: {
                signIn: {
                    failedAttemptCount:
                        accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount,
                    minutesUntilExpiration: Math.max(
                        0,
                        expireOneTimePasswordAfterMinutes - minutesSinceGeneratedTime + 1,
                    ),
                },
            },
        });

        // Check if the account is locked.
        if (hoursUntilUnlocked > 0) {
            span.addData({
                common: {branch: "EmailAddressSignInLocked"},
                auth: {signIn: {hoursUntilUnlocked}},
            });
            throw accountEmailAddressSignInLockedError(hoursUntilUnlocked);
        }

        // Check if the one-time password is expired. We check if the account is locked
        // first since the one-time password will expire while the account is locked
        // and you won't be able to generate a new one-time password until after the
        // account is unlocked.
        if (minutesSinceGeneratedTime > expireOneTimePasswordAfterMinutes) {
            span.addData({common: {branch: "ExpiredOneTimePassword"}});
            throw missingOneTimePasswordError();
        }

        const isCorrectOneTimePassword =
            accountEmailAddressItem.oneTimePasswordSignInState.password === oneTimePassword;

        if (!isCorrectOneTimePassword) {
            span.addData({common: {branch: "IncorrectOneTimePassword"}});

            await AccountsTable.directlyUpdateItem(context, {
                ...accountEmailAddressItem,
                oneTimePasswordSignInState: {
                    ...accountEmailAddressItem.oneTimePasswordSignInState,
                    failedAttemptCount:
                        accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount + 1,
                    lastFailedAttemptTime: new Date(),
                },
            });

            const remainingAttemptCount =
                maxFailedOneTimePasswordAttemptCount -
                (accountEmailAddressItem.oneTimePasswordSignInState.failedAttemptCount + 1);

            throw new PermissionDeniedError("Incorrect one time password", {
                displayMessage: errorDisplayMessage`The sign in code does not match the one we sent to your email. ${remainingAttemptCount} attempt(s) remaining before this account is locked. If you can’t find the email, check your spam folder or try ${errorDisplayMessage.signInLink(
                    "signing in",
                )} again.`,
            });
        } else {
            span.addData({common: {branch: "CorrectOneTimePassword"}});

            const sessionId = generateId<SessionId>();

            const [value] = await runAllPromises([
                action(accountEmailAddressItem, span),
                DynamoTableSchema.executeTransaction(context, [
                    AccountsTable.transactionDirectlyUpdateItem({
                        ...accountEmailAddressItem,
                        // Verify this email address.
                        isVerified: true,
                        // Remove our one-time password sign in state.
                        oneTimePasswordSignInState: undefined,
                    }),
                    AccountsTable.transactionCreateOrReplaceItem({
                        partitionType: "Session",
                        sortRangeType: "Attributes",
                        sessionId,
                        accountId: accountEmailAddressItem.accountId,
                        createdTime: new Date(),
                        initialIpAddress: ipAddress,
                        initialUserAgent: userAgent,
                    }),
                ]),
            ]);

            return [
                value,
                {
                    sessionId,
                    sessionAccountId: accountEmailAddressItem.accountId,
                },
            ];
        }
    }
}

function missingOneTimePasswordError() {
    return new FailedPreconditionError("Missing one time password", {
        displayMessage: errorDisplayMessage`To sign in, you need a recent code. Try ${errorDisplayMessage.signInLink(
            "signing in",
        )} again to get a new code.`,
    });
}
