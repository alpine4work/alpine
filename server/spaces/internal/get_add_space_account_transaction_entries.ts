import {createAccountVersionConditionCheckTransactionEntry} from "~/server/accounts/create_account_version_condition_check_transaction_entry.js";
import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {pickRandomReactionCharacterForAccount} from "~/server/accounts/pick_random_reaction_character_for_account.js";
import {SearchInjectionContextModule} from "~/server/context/injection_context_module.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {
    AccountSpacesItem,
    SpaceAccountAvatarOverrideItem,
    SpaceAccountItem,
    SpaceAccountItemWithAccountAvatarOverride,
    SpaceAttributesItem,
    SpacesTable,
} from "~/server/spaces/internal/spaces_table.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {getMaxId, getMinId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";
import {SpaceAccountState} from "~/shared/spaces/space_account_state.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";

export const addSpaceAccountBeforeExecuteTestCheckpoint =
    new TestCheckpoint<`${SpaceId}:${AccountId}`>();

/**
 * Gets the transaction entries for adding an account to a space. Does all the
 * data loading and validation we need to make sure the account is correctly
 * added to the space.
 *
 * IMPORTANT: Does not authorize the actor is allowed to add an account to the
 * space! You must perform authorization outside of this function. Also does
 * not check the space/account doesn't actually exist when you use
 * `space: {type: "New"}` or `account: {type: "New"}`. You're expected to add
 * an additional transaction entry that checks whether new space/account
 * actually exists or not.
 *
 * You also need to set up your own `context.dynamo.retryTransaction()` loop
 * around this call.
 *
 * There's a bunch of edge cases in here to consider:
 *
 * - If `role` is set to `Owner` we verify the space doesn't have any other
 *   owners if `space.type === "Existing"`.
 *
 * - If the account wasn't added to the space before and the account exists
 *   then you must provide `invitedEmailAddress` which represents the email
 *   address associated with the account that's known by the actor since we'll
 *   use this as the account's name.
 *
 * - Existing bot accounts can't be added to a space through this function.
 *   However, if you remove a bot account from a space then you can add it back
 *   with this function.
 */
export async function getAddSpaceAccountTransactionEntries(
    context: Context<
        DynamoContextModules & {
            cache: CacheContextModule;
            jobs: JobsContextModule;
            searchInjection: SearchInjectionContextModule;
        }
    >,
    {
        currentTime,
        space: spaceInputWithoutData,
        account: accountInputWithoutData,
        role = "Member",
    }: {
        currentTime: Date;
        space: {type: "Existing"; id: SpaceId} | {type: "New"; id: SpaceId};
        account:
            | {
                  type: "Existing";
                  id: AccountId;
                  invitedEmailAddress?: EmailAddress;
                  // Dangerous both because we skip the `InvitePending` state for this account
                  // but also because we don't apply the welcome package for the account when
                  // adding it as `Active`. You're responsible for applying the welcome package
                  // for the account if you set `dangerouslyWithoutInvite: true`.
                  dangerouslyWithoutInvite?: boolean;
              }
            | {
                  type: "New";
                  id: AccountId;
                  emailAddress: EmailAddress;
              };
        role?: SpaceRole;
    },
) {
    const [existingSpaceData, existingAccountData] = await runAllPromises([
        spaceInputWithoutData.type === "Existing"
            ? runAllPromises([
                  SpacesTable.getItem(context, {
                      partitionType: "Space",
                      sortRangeType: "Attributes",
                      spaceId: spaceInputWithoutData.id,
                  }),
              ])
            : null,
        accountInputWithoutData.type === "Existing"
            ? runAllPromises([
                  dangerouslyGetAccountIfExistsWithoutAuthorization(
                      context,
                      accountInputWithoutData.id,
                  ),
                  spaceInputWithoutData.type === "Existing"
                      ? getSpaceAccountItemIfExists(
                            context,
                            spaceInputWithoutData.id,
                            accountInputWithoutData.id,
                        )
                      : null,
                  SpacesTable.getItemIfExists(context, {
                      partitionType: "Account",
                      sortRangeType: "Spaces",
                      accountId: accountInputWithoutData.id,
                  }),
              ])
            : null,
    ]);

    let spaceInput:
        | {type: "New"; id: SpaceId}
        | {type: "Existing"; id: SpaceId; spaceItem: SpaceAttributesItem};

    let accountInput:
        | {
              type: "New";
              id: AccountId;
              emailAddress: EmailAddress;
          }
        | {
              type: "Existing";
              id: AccountId;
              invitedEmailAddress: EmailAddress | undefined;
              dangerouslyWithoutInvite: boolean;
              account: AccountModelWithoutSpace;
              spaceAccountItem: SpaceAccountItem | null;
              accountSpacesItem: AccountSpacesItem | null;
          };

    switch (spaceInputWithoutData.type) {
        case "New": {
            assert(!existingSpaceData);
            spaceInput = spaceInputWithoutData;
            break;
        }
        case "Existing": {
            assert(existingSpaceData);
            const [spaceItem] = existingSpaceData;

            spaceInput = {
                type: "Existing",
                id: spaceInputWithoutData.id,
                spaceItem,
            };
            break;
        }
        default:
            throw exhaustive(spaceInputWithoutData);
    }

    switch (accountInputWithoutData.type) {
        case "New": {
            assert(!existingAccountData);
            accountInput = accountInputWithoutData;
            break;
        }
        case "Existing": {
            assert(existingAccountData);
            const [account, spaceAccountItem, accountSpacesItem] = existingAccountData;
            if (!account) throw new NotFoundError("Account not found");

            accountInput = {
                type: "Existing",
                id: accountInputWithoutData.id,
                invitedEmailAddress: accountInputWithoutData.invitedEmailAddress,
                dangerouslyWithoutInvite: accountInputWithoutData.dangerouslyWithoutInvite ?? false,
                account,
                spaceAccountItem,
                accountSpacesItem,
            };
            break;
        }
        default:
            throw exhaustive(accountInputWithoutData);
    }

    const accountSpaceIds: Set<SpaceId> =
        accountInput.type === "Existing"
            ? new Set(accountInput.accountSpacesItem?.spaceIds)
            : new Set();

    const accountInvitePendingSpaceIds: Set<SpaceId> =
        accountInput.type === "Existing"
            ? new Set(accountInput.accountSpacesItem?.invitePendingSpaceIds)
            : new Set();

    if (
        accountSpaceIds.has(spaceInput.id) ||
        (accountInvitePendingSpaceIds.has(spaceInput.id) &&
            // If the account has a pending invite in the space but we're adding the
            // account as `Active` then don't error here.
            !(accountInput.type === "Existing" && accountInput.dangerouslyWithoutInvite))
    ) {
        // This is an extra check to make sure our spaceIds on the Account#Spaces isn't
        // drifting apart from the source of the truth.
        throw new FailedPreconditionError("Account is already a member of space");
    }

    // Make sure there aren't any other owners in the space.
    //
    // This is race condition safe because of we use
    // `SpacesTable.transactionUpdateLockVersionConditionCheck()` in our
    // transaction to actually add an account. If two calls are racing then the
    // race winner updates the space `updateLockVersion` causing the race loser to
    // retry which will run this query again.
    if (role === "Owner" && spaceInput.type === "Existing") {
        for await (const otherSpaceAccountItem of SpacesTable.query(context, {
            consistency: "Strong",
            limit: "All",
            partitionKey: {
                partitionType: "Space",
                spaceId: spaceInput.id,
            },
            startSortKey: {
                sortRangeType: "Account",
                accountId: getMinId<AccountId>(),
            },
            endSortKey: {
                sortRangeType: "Account",
                accountId: getMaxId<AccountId>(),
            },
        })) {
            if (otherSpaceAccountItem.role === "Owner") {
                throw new FailedPreconditionError("Space already has an owner account");
            }
        }
    }

    let spaceAccountItemTransactionEntry: DynamoTransactionEntry & {newItem: SpaceAccountItem};
    let spaceAccountAvatarOverrideItemTransactionEntry:
        | (DynamoTransactionEntry & {newItem: SpaceAccountAvatarOverrideItem})
        | null;

    // If the account was previously removed, we should re-add it
    if (accountInput.type === "Existing" && accountInput.spaceAccountItem) {
        let state: SpaceAccountState;

        // If the account already exists in the space with an `InvitePending` state
        // then `dangerouslyWithoutInvite` will switch them to an `Active` state.
        if (
            accountInput.spaceAccountItem.state.type === "InvitePending" &&
            accountInput.dangerouslyWithoutInvite
        ) {
            state = {type: "Active", activatedTime: currentTime};
        } else {
            if (accountInput.spaceAccountItem.state.type !== "Removed") {
                throw new FailedPreconditionError("Account is already a member of space");
            }
            if (accountInput.spaceAccountItem.state.reason !== "ActionByAdmin") {
                throw new FailedPreconditionError("Account cannot be invited to this space.");
            }

            if (accountInput.account.botId) {
                // Bots are added back to spaces as `Active` since a bot won't be accepting
                // invites. That'd be silly.
                state = {type: "Active", activatedTime: currentTime};
            } else {
                state = {
                    type: "InvitePending",
                    invitedTime: new Date(),
                    pendingAccountData: accountInput.spaceAccountItem.state.oldAccountData,
                    // Should always be true in this code path.
                    wasPreviouslyRemoved: accountInput.spaceAccountItem.state.type === "Removed",
                };
            }
        }

        spaceAccountItemTransactionEntry = SpacesTable.transactionDirectlyUpdateItem(
            {
                ...accountInput.spaceAccountItem,
                role,
                state,
            },
            {onAfterTransactionExecutedSuccessfully},
        );

        // If the account was previously removed, we should not update the account avatar override
        // item. Maintain the "removed" avatar UX until they re-accept
        spaceAccountAvatarOverrideItemTransactionEntry = null;
    } else {
        // Bot accounts can only be a member of one space. Don't allow adding a bot
        // account to a new space but it's ok if the bot account was previously a
        // member of the space that was removed. Then it's ok to add the bot account
        // back to the space.
        if (accountInput.type === "Existing" && accountInput.account.botId) {
            throw new FailedPreconditionError(
                "Can’t add existing bot account to space, must use `instantiateBotSpaceAccount()` to create a new bot account for the space",
            );
        }

        let state: SpaceAccountState;

        if (
            // As the owner of a new space, the account is automatically active and doesn't
            // need to accept an invite.
            role === "Owner" ||
            // We allow the caller to dangerously skip the invite process and directly add
            // the account as `Active`. This is dangerous since it reveals private
            // information about the account before they've intentionally opened a space.
            //
            // We use this when auto-adding accounts to a space based on their email
            // domain. We only auto-add _new_ accounts to a space and as long as we do a
            // good job deciding what's a company email domain vs generic email domain
            // we'll always be adding the account to a space with trusted peers.
            (accountInput.type === "Existing" && accountInput.dangerouslyWithoutInvite)
        ) {
            state = {type: "Active", activatedTime: currentTime};
        } else {
            let emailAddress: EmailAddress;

            if (accountInput.type !== "Existing") {
                emailAddress = accountInput.emailAddress;
            } else {
                if (!accountInput.invitedEmailAddress) {
                    throw new FailedPreconditionError(
                        "Can only add account to a space it hasn’t been added to before through an email address invite",
                    );
                }

                emailAddress = accountInput.invitedEmailAddress;
            }

            state = {
                type: "InvitePending",
                invitedTime: currentTime,
                pendingAccountData: {
                    id: accountInput.id,
                    version: 0,
                    // Names are labelStrings and can only support 50 characters
                    // Just do a hard truncate here
                    name: emailAddress.slice(0, maxLabelStringLength),
                    // Once the account accepts their invite, the correct name should always have a
                    // higher version than this pending name.
                    nameVersion: -1,
                    // Pick a random character for the account since we don't want to reveal the
                    // character selected by the account (which is private information along with
                    // the rest of the account's data).
                    reactionCharacter: pickRandomReactionCharacterForAccount(),
                },
                // Should always be false since `accountInput.spaceAccountItem` is always null
                // in this code path.
                wasPreviouslyRemoved: false,
            };
        }

        spaceAccountItemTransactionEntry = SpacesTable.transactionCreateItem(
            {
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId: spaceInput.id,
                accountId: accountInput.id,
                role,
                addedTime: currentTime,
                state,
            },
            {onAfterTransactionExecutedSuccessfully},
        );

        // If the account was not previously a member of the space, we need to create an account
        // avatar override item with null content so that the user's avatar does not show up
        // in the space
        spaceAccountAvatarOverrideItemTransactionEntry = SpacesTable.transactionCreateItem({
            partitionType: "Space",
            sortRangeType: "AccountAvatarOverride",
            spaceId: spaceInput.id,
            accountId: accountInput.id,
            avatarId: null,
            content: null,
        });
    }

    await addSpaceAccountBeforeExecuteTestCheckpoint.waitForTest(
        `${spaceInput.id}:${accountInput.id}`,
    );

    const newAccountStateType = spaceAccountItemTransactionEntry.newItem.state.type;

    // Only update the account's `spaceId`s if the account is being added to the space as Active.
    if (newAccountStateType === "Active") {
        accountSpaceIds.add(spaceInput.id);
    } else if (newAccountStateType === "InvitePending") {
        accountInvitePendingSpaceIds.add(spaceInput.id);
    }

    // Sanity check: Bot accounts should only ever be in a single space and never
    // invited to a space.
    if (accountInput.type === "Existing" && accountInput.account.botId) {
        assert(accountSpaceIds.size === 1);
        assert(accountInvitePendingSpaceIds.size === 0);
    }

    async function onAfterTransactionExecutedSuccessfully() {
        // When an account is added to a space, index the account in the space so it
        // can be searched.
        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: spaceInput.id,
            update: {
                type: "Account",
                accountId: accountInput.id,
                updatedTraits: {type: "Some", traits: []},
            },
        });
    }

    const accountVersionConditionCheckTransactionEntry =
        accountInput.type === "Existing"
            ? createAccountVersionConditionCheckTransactionEntry(
                  accountInput.id,
                  accountInput.account.initialData.version,
              )
            : null;

    const accountSpacesItemTransactionEntry = SpacesTable.transactionDirectlyUpdateItem({
        ...(accountInput.type === "Existing" ? accountInput.accountSpacesItem : null),
        partitionType: "Account",
        sortRangeType: "Spaces",
        accountId: accountInput.id,
        spaceIds: accountSpaceIds,
        invitePendingSpaceIds: accountInvitePendingSpaceIds,
    });

    return {
        currentTime,
        spaceItem: spaceInput.type === "Existing" ? spaceInput.spaceItem : null,
        account: accountInput.type === "Existing" ? accountInput.account : null,
        spaceAccountItem: accountInput.type === "Existing" ? accountInput.spaceAccountItem : null,
        accountSpacesItem: accountInput.type === "Existing" ? accountInput.accountSpacesItem : null,

        newSpaceAccountItem: cast<SpaceAccountItemWithAccountAvatarOverride>({
            ...spaceAccountItemTransactionEntry.newItem,
            accountAvatarOverride: spaceAccountAvatarOverrideItemTransactionEntry
                ? spaceAccountAvatarOverrideItemTransactionEntry.newItem
                : null,
        }),

        accountSpacesItemTransactionEntry,
        accountVersionConditionCheckTransactionEntry,

        transactionEntries: [
            // Since this transaction is security sensitive, make sure the account and
            // space didn't update when we commit. This also makes sure both the space and
            // account exist.
            //
            // If we're adding an owner, force this transaction to be serialized with other
            // add space account `role: "Owner"` transactions.
            ...(spaceInput.type === "Existing"
                ? [
                      role === "Owner"
                          ? SpacesTable.transactionDirectlyUpdateItemLockVersion(
                                spaceInput.spaceItem,
                                spaceInput.spaceItem.updateLockVersion,
                            )
                          : SpacesTable.transactionUpdateLockVersionConditionCheck(
                                spaceInput.spaceItem,
                                spaceInput.spaceItem.updateLockVersion,
                            ),
                  ]
                : []),
            ...(accountVersionConditionCheckTransactionEntry
                ? [accountVersionConditionCheckTransactionEntry]
                : []),
            accountSpacesItemTransactionEntry,
            spaceAccountItemTransactionEntry,
            ...(spaceAccountAvatarOverrideItemTransactionEntry
                ? [spaceAccountAvatarOverrideItemTransactionEntry]
                : []),
        ],
    };
}
