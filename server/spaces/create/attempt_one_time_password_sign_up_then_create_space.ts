import {
    AttemptOneTimePasswordSignInOptions,
    attemptOneTimePasswordSignInWithAction,
} from "~/server/accounts/attempt_one_time_password_sign_in.js";
import {dangerouslyGetAccountAndWithFinishSignUpTransactionEntryIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {ServerUnknownActionContextModules} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {createSpaceWelcomePackageTransactionEntries} from "~/server/spaces/create/internal/create_space_welcome_package_transaction_entries.js";
import {dangerouslyExpensivelyGetSuggestedSpaceAccountIdsWithoutAuthorization} from "~/server/spaces/dangerously_expensively_get_suggested_space_account_ids_without_authorization.js";
import {dangerouslyApplySpaceWelcomePackage} from "~/server/spaces/internal/dangerously_apply_space_welcome_package.js";
import {getAddSpaceAccountTransactionEntries} from "~/server/spaces/internal/get_add_space_account_transaction_entries.js";
import {
    AccountSpacesItem,
    SpaceWelcomePackageItem,
    SpacesTable,
} from "~/server/spaces/internal/spaces_table.js";
import {inviteEmailAddressesToSpace} from "~/server/spaces/invite_email_addresses_to_space.js";
import {LogoDevContextModuleBase} from "~/server/spaces/logo_dev_context_module.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {
    getAccountShortNameWithoutFullNameTooltip,
    parseAccountNameAssumingWesternNameOrder,
} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {getEmailDomainForAutoAddSpaceAccounts} from "~/shared/accounts/get_email_domain_for_auto_add_space_accounts.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {defaultSpaceThemeColor} from "~/shared/design/core/theme_colors.js";
import {DataLossError, FailedPreconditionError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {unionSets} from "~/shared/helpers/set/union_sets.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, AvatarId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {getLegacyFallbackReactionCharacterForId} from "~/shared/reactions/get_legacy_fallback_reaction_character_for_id.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Tries to sign in with the provided `oneTimePassword` and if that succeeds then
 * we create a personal space for the account.
 */
export async function attemptOneTimePasswordSignUpThenCreateSpace(
    context: Context<
        ServerUnknownActionContextModules & {
            logoDev: LogoDevContextModuleBase;
            email: EmailContextModuleBase;
        }
    >,
    {
        emailAddress,
        oneTimePassword,
        inviteEmailAddresses,
        ...options
    }: AttemptOneTimePasswordSignInOptions & {
        emailAddress: EmailAddress;
        oneTimePassword: string;
        inviteEmailAddresses: ReadonlyArray<EmailAddress>;
    },
): Promise<{
    sessionId: SessionId;
    sessionAccountId: AccountId;
    openSpaceId: SpaceId;
}> {
    const autoAddAccountsFromEmailDomain = getEmailDomainForAutoAddSpaceAccounts(emailAddress);

    const initialAutoAddAccountsFromEmailDomainItemPromise = autoAddAccountsFromEmailDomain
        ? SpacesTable.getItemIfExists(context, {
              partitionType: "AutoAddAccountsFromEmailDomain",
              sortRangeType: "Space",
              emailDomain: autoAddAccountsFromEmailDomain,
          })
        : null;

    const [
        {account, personalSpaceResult, autoAddToEmailDomainSpaceResult},
        {sessionId, sessionAccountId},
    ] = await attemptOneTimePasswordSignInWithAction(
        context,
        emailAddress,
        oneTimePassword,
        options,
        async (accountEmailAddressItem, span) => {
            return context
                .clone({tracer: new TracerContextModule(span)})
                .tracer.withSpan("Create space after sign up", context => {
                    let hasAlreadyAttempted = false;

                    return context.dynamo.retryTransaction(context => {
                        const isInitialAttempt = !hasAlreadyAttempted;
                        hasAlreadyAttempted = true;

                        return createSpace(
                            context,
                            span,
                            accountEmailAddressItem,
                            isInitialAttempt,
                        );
                    });
                });
        },
    );

    const inviteEmailAddressesToPersonalSpace: Array<string> = [];
    const inviteEmailAddressesToAutoAddToEmailDomainSpace: Array<string> = [];

    // We try to add invited email addresses the same domain to the auto-add space.
    // Otherwise we add invited email addresses to the user's new personal space.
    for (const inviteEmailAddress of inviteEmailAddresses) {
        if (
            getEmailDomainForAutoAddSpaceAccounts(inviteEmailAddress) !==
            autoAddAccountsFromEmailDomain
        ) {
            inviteEmailAddressesToPersonalSpace.push(inviteEmailAddress);
        } else {
            inviteEmailAddressesToAutoAddToEmailDomainSpace.push(inviteEmailAddress);
        }
    }

    let invitedPersonalAccountIdsPromise: Promise<Iterable<AccountId>> | null = null;
    let invitedAutoAddToEmailDomainAccountIdsPromise: Promise<Iterable<AccountId>> | null = null;

    if (!autoAddToEmailDomainSpaceResult) {
        for (const inviteEmailAddress of inviteEmailAddressesToAutoAddToEmailDomainSpace) {
            inviteEmailAddressesToPersonalSpace.push(inviteEmailAddress);
        }

        // Truncate this list since we didn't use it. Report the list length as zero if we
        // check it again.
        inviteEmailAddressesToAutoAddToEmailDomainSpace.length = 0;
    } else if (inviteEmailAddressesToAutoAddToEmailDomainSpace.length > 0) {
        invitedAutoAddToEmailDomainAccountIdsPromise = context.tracer.withSpan(
            "Invite email addresses after sign up to auto add accounts from email domain space",
            (context, span) => {
                span.addData({
                    common: {
                        count: inviteEmailAddressesToAutoAddToEmailDomainSpace.length,
                    },
                });

                return invite(
                    context,
                    autoAddToEmailDomainSpaceResult.spaceId,
                    inviteEmailAddressesToAutoAddToEmailDomainSpace,
                );
            },
        );
    }

    if (inviteEmailAddressesToPersonalSpace.length > 0) {
        invitedPersonalAccountIdsPromise = context.tracer.withSpan(
            "Invite email addresses after sign up to personal space",
            async (context, span) => {
                span.addData({
                    common: {
                        count: inviteEmailAddressesToPersonalSpace.length,
                    },
                });

                return invite(
                    context,
                    personalSpaceResult.spaceId,
                    inviteEmailAddressesToPersonalSpace,
                );
            },
        );
    }

    const [invitedPersonalAccountIds, invitedAutoAddToEmailDomainAccountIds] = await runAllPromises(
        [invitedPersonalAccountIdsPromise, invitedAutoAddToEmailDomainAccountIdsPromise],
    );

    await runAllPromises([
        dangerouslyApplySpaceWelcomePackage(context, {
            accountId: sessionAccountId,
            welcomePackageItem: personalSpaceResult.welcomePackageItem,
            suggestedAccountIds: personalSpaceResult.suggestedAccountIds,
            invitedAccountIds: invitedPersonalAccountIds ?? emptyArray,
        }),

        autoAddToEmailDomainSpaceResult?.welcomePackageItem
            ? dangerouslyApplySpaceWelcomePackage(context, {
                  accountId: sessionAccountId,
                  welcomePackageItem: autoAddToEmailDomainSpaceResult.welcomePackageItem,
                  suggestedAccountIds: autoAddToEmailDomainSpaceResult.suggestedAccountIds,
                  invitedAccountIds: invitedAutoAddToEmailDomainAccountIds ?? emptyArray,
              })
            : null,

        (async () => {
            const {givenName, familyName} = parseAccountNameAssumingWesternNameOrder(
                account.initialData.name,
            );

            // Put loop contact creation on the job queue so it doesn't block the response.
            await context.jobs.dangerouslySendMaintenance({
                type: "CreateLoopContact",
                emailAddress,
                firstName: givenName,
                lastName: familyName ?? undefined,
                fullName: account.initialData.name,
                accountId: sessionAccountId,
            });
        })(),
    ]);

    let openSpaceId: SpaceId;

    // If the user invited some emails we added to their personal space then redirect
    // them to the personal space (not the company space).
    if (
        inviteEmailAddressesToPersonalSpace.length > 0 &&
        inviteEmailAddressesToAutoAddToEmailDomainSpace.length === 0
    ) {
        openSpaceId = personalSpaceResult.spaceId;
    } else {
        openSpaceId = autoAddToEmailDomainSpaceResult?.spaceId ?? personalSpaceResult.spaceId;
    }

    return {sessionId, sessionAccountId, openSpaceId};

    type CreateSpaceResult = {
        spaceId: SpaceId;
        welcomePackageItem: SpaceWelcomePackageItem | null;
        suggestedAccountIds: Array<AccountId>;
        accountVersionConditionCheckTransactionEntry: DynamoTransactionEntry | null;
        accountSpacesItemTransactionEntry: DynamoTransactionEntry & {
            newItem: AccountSpacesItem;
        };
        transactionEntries: Array<DynamoTransactionEntry>;
    };

    async function createSpace(
        context: Context<ServerUnknownActionContextModules & {logoDev: LogoDevContextModuleBase}>,
        span: TracerSpan,
        {accountId}: {accountId: AccountId},
        isInitialAttempt: boolean,
    ): Promise<{
        account: AccountModelWithoutSpace;
        personalSpaceResult: Replace<
            CreateSpaceResult,
            {welcomePackageItem: SpaceWelcomePackageItem}
        >;
        autoAddToEmailDomainSpaceResult: CreateSpaceResult | null;
    }> {
        span.addData({
            auth: {
                signUp: {
                    autoAddAccountsFromEmailDomain: autoAddAccountsFromEmailDomain ?? undefined,
                },
            },
        });

        const personalSpaceId = generateId<SpaceId>();

        const currentTime = new Date();

        const [accountResult, personalSpaceResult, autoAddToEmailDomainSpaceResult] =
            await runAllPromises([
                // NOTE(calebmer): We don't use a "without avatar" version of this function since:
                //
                // 1. There should be no avatar for the account at this point so we don't actually
                //    pay any cost to try and load the avatar.
                //
                // 2. `getAddSpaceAccountTransactionEntries()` also loads the account with avatar
                //    (other downstream functions of `getAddSpaceAccountTransactionEntries()` need
                //    the avatar) so by loading the account with avatar here it's already in cache
                //    and we can skip a DynamoDB read in `getAddSpaceAccountTransactionEntries()`.
                dangerouslyGetAccountAndWithFinishSignUpTransactionEntryIfExistsWithoutAuthorization(
                    context,
                    accountId,
                    // Make sure we read the most recent account name which may have been written by
                    // `saveAccountSignUpProfile()`.
                    {consistency: "Strong"},
                ),
                (async (): Promise<
                    Replace<CreateSpaceResult, {welcomePackageItem: SpaceWelcomePackageItem}>
                > => {
                    const [
                        {
                            transactionEntries,
                            accountVersionConditionCheckTransactionEntry,
                            accountSpacesItemTransactionEntry,
                        },
                        {welcomePackageItem, transactionEntries: welcomePackageTransactionEntries},
                    ] = await runAllPromises([
                        getAddSpaceAccountTransactionEntries(context, {
                            currentTime,
                            space: {type: "New", id: personalSpaceId},
                            account: {type: "Existing", id: accountId},
                            role: "Owner",
                        }),
                        createSpaceWelcomePackageTransactionEntries(context, {
                            currentTime,
                            ownerAccountId: accountId,
                            spaceId: personalSpaceId,
                        }),
                    ]);

                    return {
                        spaceId: personalSpaceId,
                        welcomePackageItem,
                        // New space so there are no suggested accounts.
                        suggestedAccountIds: [],
                        accountVersionConditionCheckTransactionEntry,
                        accountSpacesItemTransactionEntry,
                        transactionEntries: [
                            ...transactionEntries,
                            ...welcomePackageTransactionEntries,
                        ],
                    };
                })(),

                // Figure out what transaction entries we need to commit if we're auto-adding
                // accounts to this work email domain
                //
                // 1. Add the account to an existing space as `Active`; OR
                // 2. Create a new space for the email domain which will add future accounts; OR
                // 3. Do nothing since an admin has disabled auto-adding accounts
                (async (): Promise<CreateSpaceResult | null> => {
                    if (!autoAddAccountsFromEmailDomain) {
                        span.addData({common: {branch: "PersonalSpaceOnly"}});
                        return null;
                    }

                    const autoAddAccountsFromEmailDomainItem = isInitialAttempt
                        ? await initialAutoAddAccountsFromEmailDomainItemPromise
                        : await SpacesTable.getItemIfExists(context, {
                              partitionType: "AutoAddAccountsFromEmailDomain",
                              sortRangeType: "Space",
                              emailDomain: autoAddAccountsFromEmailDomain,
                          });

                    if (autoAddAccountsFromEmailDomainItem) {
                        // An admin disabled auto-adding accounts from this email domain.
                        if (!autoAddAccountsFromEmailDomainItem.isEnabled) {
                            span.addData({
                                common: {branch: "DisabledAutoAddAccountsFromEmailDomain"},
                            });

                            return null;
                        }
                        // Auto-add account to the space corresponding with their email domain!
                        else {
                            span.addData({
                                common: {branch: "AutoAddAccountFromEmailDomainToSpace"},
                            });

                            const [
                                {
                                    transactionEntries,
                                    accountVersionConditionCheckTransactionEntry,
                                    accountSpacesItemTransactionEntry,
                                },
                                welcomePackageItem,
                                suggestedAccountIds,
                            ] = await runAllPromises([
                                getAddSpaceAccountTransactionEntries(context, {
                                    currentTime,
                                    space: {
                                        type: "Existing",
                                        id: autoAddAccountsFromEmailDomainItem.spaceId,
                                    },
                                    account: {
                                        type: "Existing",
                                        id: accountId,
                                        // Skip the `InvitePending` state and directly add the account as `Active`. This
                                        // does reveal the user's name to everyone else in the space without the user
                                        // intentionally choosing to join the space. We make this exception for brand new
                                        // accounts since we immediately open the space for them so the user should
                                        // immediately understand the implication of what has just happened and change
                                        // their name if necessary.
                                        //
                                        // Also, if the user is using a company email domain they should be on their best
                                        // "safe for work" behavior anyway.
                                        dangerouslyWithoutInvite: true,
                                    },
                                    role: "Member",
                                }),
                                SpacesTable.getItemIfExists(
                                    context,
                                    {
                                        partitionType: "Space",
                                        sortRangeType: "WelcomePackage",
                                        spaceId: autoAddAccountsFromEmailDomainItem.spaceId,
                                    },
                                    // If there's an eventual consistency lag and we don't read the welcome package
                                    // item then the new user will have nothing in their suggested list which is a bad
                                    // experience!
                                    {consistency: "Strong"},
                                ),

                                // Load the first few `AccountId`s in the space so we can populate them in the
                                // suggested list.
                                dangerouslyExpensivelyGetSuggestedSpaceAccountIdsWithoutAuthorization(
                                    context,
                                    autoAddAccountsFromEmailDomainItem.spaceId,
                                    {excludeAccountId: accountId},
                                ),
                            ]);

                            return {
                                spaceId: autoAddAccountsFromEmailDomainItem.spaceId,
                                welcomePackageItem,
                                suggestedAccountIds,
                                accountVersionConditionCheckTransactionEntry,
                                accountSpacesItemTransactionEntry,
                                transactionEntries: [
                                    // Make sure there's no eventual consistency lag from reading the auto-add accounts
                                    // item. If `role` or `isEnabled` changed then we want to start respecting those
                                    // changes from the admin immediately.
                                    SpacesTable.transactionUpdateLockVersionConditionCheck(
                                        autoAddAccountsFromEmailDomainItem,
                                        autoAddAccountsFromEmailDomainItem.updateLockVersion,
                                    ),
                                    ...transactionEntries,
                                ],
                            };
                        }
                    }
                    // Create a new space for the email domain which new accounts will be auto-added
                    // to.
                    else {
                        span.addData({
                            common: {branch: "CreateAutoAddAccountsFromEmailDomainSpace"},
                        });

                        const autoAddAccountsFromEmailDomainSpaceId = generateId<SpaceId>();

                        const [
                            {
                                transactionEntries,
                                accountVersionConditionCheckTransactionEntry,
                                accountSpacesItemTransactionEntry,
                            },
                            {
                                welcomePackageItem,
                                transactionEntries: welcomePackageTransactionEntries,
                            },
                            logoDevResult,
                        ] = await runAllPromises([
                            getAddSpaceAccountTransactionEntries(context, {
                                currentTime,
                                space: {type: "New", id: autoAddAccountsFromEmailDomainSpaceId},
                                account: {type: "Existing", id: accountId},
                                role: "Owner",
                            }),
                            createSpaceWelcomePackageTransactionEntries(context, {
                                currentTime,
                                ownerAccountId: accountId,
                                spaceId: autoAddAccountsFromEmailDomainSpaceId,
                            }),
                            captureResultPromise(
                                fetchCompanyFromLogoDev(context, autoAddAccountsFromEmailDomain),
                            ),
                        ]);

                        return {
                            spaceId: autoAddAccountsFromEmailDomainSpaceId,
                            welcomePackageItem,
                            // New space so there are no suggested accounts.
                            suggestedAccountIds: [],
                            accountVersionConditionCheckTransactionEntry,
                            accountSpacesItemTransactionEntry,
                            transactionEntries: [
                                SpacesTable.transactionCreateItem({
                                    partitionType: "Space",
                                    sortRangeType: "Attributes",
                                    spaceId: autoAddAccountsFromEmailDomainSpaceId,
                                    // We ignore errors from the Logo.dev API. We use the result if it's there and
                                    // ignore if it's not.
                                    name: logoDevResult.value
                                        ? logoDevResult.value.name.slice(0, maxLabelStringLength)
                                        : `@${autoAddAccountsFromEmailDomain}`.slice(
                                              0,
                                              maxLabelStringLength,
                                          ),
                                    createdTime: currentTime,
                                    themeColor: defaultSpaceThemeColor,
                                }),
                                SpacesTable.transactionCreateItem({
                                    partitionType: "AutoAddAccountsFromEmailDomain",
                                    sortRangeType: "Space",
                                    emailDomain: autoAddAccountsFromEmailDomain,
                                    spaceId: autoAddAccountsFromEmailDomainSpaceId,
                                    isEnabled: true,
                                }),
                                // Create-or-replace is safe. If the `AutoAddAccountsFromEmailDomain#Space` item
                                // doesn't exist then neither will this item.
                                SpacesTable.transactionCreateOrReplaceItem({
                                    partitionType: "Space",
                                    sortRangeType: "AutoAddAccountsFromEmailDomain",
                                    spaceId: autoAddAccountsFromEmailDomainSpaceId,
                                    emailDomain: autoAddAccountsFromEmailDomain,
                                }),
                                ...transactionEntries,
                                ...welcomePackageTransactionEntries,

                                // If we got logos from Logo.dev then add them to DynamoDB. We'll need to store a
                                // larger version of the image in R2 later.
                                //
                                // TODO(calebmer): We eventually need to queue a job that runs our full avatar
                                // processing pipeline (e.g. storing large image to R2 and generating a small AVIF
                                // file that fits into DynamoDB 1 RCU).
                                ...(logoDevResult.value?.logoLightContent
                                    ? [
                                          SpacesTable.transactionCreateOrReplaceItem({
                                              partitionType: "Space",
                                              sortRangeType: "AvatarLightTheme",
                                              spaceId: autoAddAccountsFromEmailDomainSpaceId,
                                              avatarId: generateChronologicalId<AvatarId>(),
                                              content: new Uint8Array(
                                                  logoDevResult.value.logoLightContent,
                                              ),
                                          }),
                                      ]
                                    : []),
                                ...(logoDevResult.value?.logoDarkContent
                                    ? [
                                          SpacesTable.transactionCreateOrReplaceItem({
                                              partitionType: "Space",
                                              sortRangeType: "AvatarDarkTheme",
                                              spaceId: autoAddAccountsFromEmailDomainSpaceId,
                                              avatarId: generateChronologicalId<AvatarId>(),
                                              content: new Uint8Array(
                                                  logoDevResult.value.logoDarkContent,
                                              ),
                                          }),
                                      ]
                                    : []),
                            ],
                        };
                    }
                })(),
            ]);

        const {account, finishSignUpTransactionEntry} = assertExists(accountResult);

        // Allow us to check which reaction characters are the most popular after sign up.
        {
            const reactionCharacter =
                account.initialData.reactionCharacter ??
                getLegacyFallbackReactionCharacterForId(accountId);

            span.addData({
                reaction: {
                    character: {
                        type: reactionCharacter.type,
                        variant: reactionCharacter.variant,
                    },
                },
            });
        }

        // Account has already signed up! Don't bother creating spaces for the account.
        if (!finishSignUpTransactionEntry) {
            // If we hit this code then override the branch since we're not going to create any
            // spaces.
            span.addData({common: {branch: "AlreadySignedUp"}});

            throw new FailedPreconditionError("Account has already signed up", {
                displayMessage: errorDisplayMessage`You\u2019ve already signed up with this email address. Try ${errorDisplayMessage.signInLink("signing in")} instead.`,
            });
        }

        const accountShortName = getAccountShortNameWithoutFullNameTooltip(account.initialData);

        const spaceNameSuffix = "\u2019s Space";

        // Make sure `spaceName` is under the max label string length by slicing
        // `accountShortName` to a value that will fit with `spaceNameSuffix` added to the
        // end.
        const spaceName =
            accountShortName.slice(0, maxLabelStringLength - spaceNameSuffix.length) +
            spaceNameSuffix;

        let transactionEntries = [
            SpacesTable.transactionCreateItem({
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId: personalSpaceId,
                name: spaceName,
                createdTime: currentTime,
                themeColor: defaultSpaceThemeColor,
            }),

            // `getAddSpaceAccountTransactionEntries()` adds a condition check transaction
            // entry on the account. `finishSignUpTransactionEntry` should be our only
            // transaction entry on the account.
            ...personalSpaceResult.transactionEntries.filter(
                entry => entry !== personalSpaceResult.accountVersionConditionCheckTransactionEntry,
            ),
        ];

        // Make sure we actually auto-add the account to an associated space when needed.
        if (autoAddToEmailDomainSpaceResult) {
            transactionEntries = [
                ...transactionEntries.filter(
                    entry => entry !== personalSpaceResult.accountSpacesItemTransactionEntry,
                ),
                ...autoAddToEmailDomainSpaceResult.transactionEntries.filter(
                    entry =>
                        entry !==
                            autoAddToEmailDomainSpaceResult.accountSpacesItemTransactionEntry &&
                        // `getAddSpaceAccountTransactionEntries()` adds a condition check transaction
                        // entry on the account. `finishSignUpTransactionEntry` should be our only
                        // transaction entry on the account.
                        entry !==
                            autoAddToEmailDomainSpaceResult.accountVersionConditionCheckTransactionEntry,
                ),

                // There must only be one transaction entry updating the `Account#Spaces` item.
                // Remove the `Account#Spaces` transaction entries above and make sure we only have
                // one, merged, transaction entry here.
                SpacesTable.transactionDirectlyUpdateItem({
                    partitionType: "Account",
                    sortRangeType: "Spaces",
                    accountId,
                    spaceIds: unionSets(
                        personalSpaceResult.accountSpacesItemTransactionEntry.newItem.spaceIds,
                        autoAddToEmailDomainSpaceResult.accountSpacesItemTransactionEntry.newItem
                            .spaceIds,
                    ),
                    invitePendingSpaceIds: unionSets(
                        personalSpaceResult.accountSpacesItemTransactionEntry.newItem
                            .invitePendingSpaceIds,
                        autoAddToEmailDomainSpaceResult.accountSpacesItemTransactionEntry.newItem
                            .invitePendingSpaceIds,
                    ),
                    updateLockVersion:
                        (personalSpaceResult.accountSpacesItemTransactionEntry.newItem
                            .updateLockVersion ?? 0) - 1,
                }),
            ];
        }

        transactionEntries.push(finishSignUpTransactionEntry);

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        return {
            account,
            personalSpaceResult,
            autoAddToEmailDomainSpaceResult,
        };
    }

    async function invite(
        context: Context<ServerUnknownActionContextModules & {email: EmailContextModuleBase}>,
        spaceId: SpaceId,
        emailAddresses: ReadonlyArray<string>,
    ): Promise<Iterable<AccountId>> {
        const result = await inviteEmailAddressesToSpace(
            context.clone({
                // It's safe to create an actor context module here because we literally just
                // authenticated the account with a one time password.
                //
                // Assume we are being called by `AppClient`. This function is designed for
                // authorization then setting a browser session cookie.
                actor: SessionActorContextModule.dangerouslyNewWithoutCheckingIfRevoked(
                    "AppClient",
                    sessionId,
                    sessionAccountId,
                ),
            }),
            {
                spaceId,
                emailAddresses,
            },
        ).catch(error => {
            throw DataLossError.from(error, "Couldn\u2019t invite email addresses after sign up");
        });

        // TypeScript will error if you add a new class of failure here. You should then
        // decide if it needs to be escalated to a `DataLossError`.
        assertEqualTypes<
            keyof typeof result,
            | "accounts"
            | "invalidEmailAddresses"
            | "rejectedAsSpamEmailAddresses"
            | "alreadyMemberEmailAddresses"
            | "requiresAdminAccessEmailAddresses"
            | "unexpectedFailureEmailAddresses"
        >();

        // Escalate certain failures to `DataLossError`. These are unexpected failures. The
        // other error classes (invalid email address, rejected as spam, already member) we
        // ignore as either the UI should have handled them (invalid email address) or
        // since the user truly shouldn't be getting a new email (rejected as spam, already
        // member).
        if (
            result.requiresAdminAccessEmailAddresses.size > 0 ||
            result.unexpectedFailureEmailAddresses.size > 0
        ) {
            throw new DataLossError(
                `Couldn\u2019t invite email addresses after sign up (requires admin access errors = ${result.requiresAdminAccessEmailAddresses.size}, unexpected failures = ${result.unexpectedFailureEmailAddresses.size})`,
            );
        }

        return concatIterables(
            result.alreadyMemberEmailAddresses.values(),
            mapIterable(result.accounts, account => account.id),
        );
    }
}

function fetchCompanyFromLogoDev(
    context: Context<ServerUnknownActionContextModules & {logoDev: LogoDevContextModuleBase}>,
    emailDomain: string,
) {
    return context.tracer.withSpan("Fetch company from Logo.dev", async context => {
        const [description, logoLightContent, logoDarkContent] = await runAllPromises([
            context.logoDev.describe(emailDomain),

            // Get 2x the size of the `<SpaceAvatar>` in the top left corner of the app so the
            // logo looks good on retina displays but is (hopefully) still small enough to fit
            // in one DynamoDB item.
            context.logoDev.logo(emailDomain, {size: 64, theme: "light"}),
            context.logoDev.logo(emailDomain, {size: 64, theme: "dark"}),
        ]);

        if (!description) return null;

        return {
            name: description.name,
            logoLightContent,
            logoDarkContent,
        };
    });
}
