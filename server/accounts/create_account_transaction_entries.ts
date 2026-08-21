import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {createAccountModelWithoutSpaceFromItem} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {BotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {getUnstableReactionCharacterForNewAccountId} from "~/shared/reactions/get_unstable_reaction_character_for_new_account_id.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * Make transaction entries that create a new account with the provided name and
 * email address. The account starts with an unverified email address.
 *
 * This is meant to be used for creating accounts during closed alpha.
 */
export function createAccountWithEmailAddressTransactionEntries({
    id,
    currentTime,
    name,
    emailAddress,
}: {
    id: AccountId;
    currentTime: Date;
    name: string;
    emailAddress: EmailAddress;
}): Array<DynamoTransactionEntry> {
    return [
        ...createAccountTransactionEntries({id, currentTime, name}).transactionEntries,
        AccountsTable.transactionCreateItem({
            partitionType: "AccountEmailAddress",
            sortRangeType: "Attributes",
            emailAddress,
            accountId: id,
            isVerified: false,
            createdTime: currentTime,
        }),
    ];
}

/**
 * Returns transaction entries for creating an account.
 */
export function createAccountTransactionEntries({
    id,
    currentTime,
    name,
    dangerouslyInstantiateBot,
}: {
    id: AccountId;
    currentTime: Date;
    name: string;

    /**
     * This is set when installing a bot to mark the account as a bot account. This is
     * dangerous since when creating a bot account we need to make sure there's no
     * other account for the bot in the space (and that the `BotId` exists). This
     * function doesn't make those checks.
     *
     * Only the `installBotInSpace()` function in `spaces_table.ts` should use this.
     */
    dangerouslyInstantiateBot?: {
        botId: BotId;
        spaceId: SpaceId;

        /**
         * The bot's owner, copied onto the account so we can tell who a bot account
         * belongs to without reading the bot. See `accounts_table.ts`.
         */
        ownerEntity: BotOwnerEntityId;

        avatar?: {
            avatarId: AvatarId;
            content: Uint8Array;
        } | null;
    };
}): {
    account: AccountModelWithoutSpace;
    transactionEntries: Array<DynamoTransactionEntry>;
} {
    const createAccountTransactionEntry = AccountsTable.transactionCreateItem({
        partitionType: "Account",
        sortRangeType: "Attributes",
        accountId: id,
        name: name.slice(0, maxLabelStringLength),
        nameVersion: 0,
        createdTime: currentTime,
        observedTimeZone: null,
        // Always set to true if we're instantiating a non-bot account. Humans must always
        // go through the `/sign-up` flow.
        hasNotSignedUp: !dangerouslyInstantiateBot ? true : undefined,
        bot: dangerouslyInstantiateBot,
        reactionCharacter: getUnstableReactionCharacterForNewAccountId(id),
    });

    const createAccountAvatarTransactionEntry = dangerouslyInstantiateBot?.avatar
        ? AccountsTable.transactionCreateItem({
              partitionType: "Account",
              sortRangeType: "Avatar",
              accountId: id,
              avatarId: dangerouslyInstantiateBot.avatar.avatarId,
              content: dangerouslyInstantiateBot.avatar.content,
          })
        : null;

    const account = createAccountModelWithoutSpaceFromItem({
        ...createAccountTransactionEntry.newItem,
        avatar: createAccountAvatarTransactionEntry?.newItem ?? null,
    });

    return {
        account,
        transactionEntries: [
            createAccountTransactionEntry,
            ...(createAccountAvatarTransactionEntry ? [createAccountAvatarTransactionEntry] : []),
        ],
    };
}
