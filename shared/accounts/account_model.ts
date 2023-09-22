import {AccountId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type AccountModelData = SchemaType<typeof AccountModelDataSchema>;

export const AccountModelDataSchema = Schema.object({
    id: Schema.id<AccountId>(),
    version: Schema.integer,
    name: LabelStringSchema,
    createdTime: Schema.date,
    hasInternalAccess: Schema.boolean.optional(),
});

/**
 * Representation of an account in our system that we can share with
 * the client. Information like the account's email address is not
 * publicly available.
 *
 * Usually an account corresponds to a person who signed up with the real name
 * and work email address but an account could also represent a "service
 * account" or bot acting against our systems.
 *
 * These objects are not normalized! You may have multiple `AccountModel`s
 * representing the same user. Even with different data. On the client we have
 * an `AccountClientStore` object that normalizes accounts. You can use the
 * `useAccountModel()` hook to get the account's latest data so the account
 * renders the same way everywhere. If an account with new data is loaded from
 * the server we re-render the application with the new `AccountModel`.
 */
export class AccountModel {
    public readonly id: AccountId;

    /**
     * The data this `AccountModel` object was initialized with. May not be the
     * latest data for the account!
     *
     * You can use the `version` property on an account's data to tell whether one
     * instance of the account is newer than another instance of the account.
     *
     * On the client you should call `useAccountModel()` instead of using this
     * property to get up-to-date account data that's the same everywhere on the
     * screen. (So you don't have a situation where, e.g., the account's avatar is
     * different in two places.)
     */
    public readonly initialData: AccountModelData;

    constructor(initialData: AccountModelData) {
        this.id = initialData.id;
        this.initialData = initialData;
    }

    public static readonly schema = AccountModelDataSchema.transform<AccountModel>({
        serialize: account => account.initialData,
        deserialize: account => new AccountModel(account),
    });
}
