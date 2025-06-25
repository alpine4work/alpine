import {
    AccountModelWithoutSpace,
    AccountModelWithoutSpaceData,
    AccountModelWithoutSpaceDataSchema,
} from "~/shared/accounts/account_model_without_space.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SpaceRoleSchema} from "~/shared/spaces/space_model.js";

export type AccountModelData = SchemaType<typeof AccountModelDataSchema>;

// We don't include the `SpaceId` in `SpaceAccountModel`. You should know what
// the `SpaceId` is from the context this account is in.
export const AccountModelDataSchema = AccountModelWithoutSpaceDataSchema.merge(
    Schema.object({
        space: Schema.object({
            version: Schema.integer,
            joinedTime: Schema.date,
            removal: Schema.object({time: Schema.date}).nullable(),
            role: SpaceRoleSchema.default("Member"),
        }),
    }),
);

/**
 * Representation of the pair of an account and space in our system that we can
 * share with the client. Information like the account's email address is not
 * publicly available.
 *
 * Usually an account corresponds to a person who signed up with the real name
 * and work email address but an account could also represent a "service
 * account" or bot acting against our systems.
 *
 * An account may be a member of multiple spaces. We have an `AccountModel`
 * object for each space an account is a member of. It tracks information like
 * when did the account join the space or was the account removed from the
 * space? `AccountModelWithoutSpace` represents the shared data for an account
 * across all spaces.
 *
 * These objects are not normalized! You may have multiple `AccountModel`s
 * representing the same user. Even with different data. On the client we have
 * an `AccountRegistry` object that normalizes accounts. You can use the
 * `useAccountModel()` hook to get the account's latest data so the account
 * renders the same way everywhere. If an account with new data is loaded from
 * the server we re-render the application with the new `AccountModel`.
 */
export class AccountModel implements AccountModelWithoutSpace {
    public readonly id: AccountId;

    /**
     * The data this `AccountModel` object was initialized with. May not be the
     * latest data for the account! Either we loaded data from the server before it
     * was updated or, if the account was removed from a space, we'll keep
     * returning account data as it was when the account was removed.
     *
     * You can use the `version` property on an account's data to tell whether one
     * instance of the account is newer than another instance of the account.
     * Conceptually, there are two separate pieces of data controlled by `version`
     * that update independently in `AccountModelData`. `data` itself and
     * `data.space`. If `newData.version > oldData.version` but
     * `oldData.space.version > newData.space.version` then we need to keep
     * `oldData.space` so the latest data when merged would be
     * `{...newData, space: oldData.space}`.
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

    public static mergeData(data1: AccountModelData, data2: AccountModelData): AccountModelData {
        if (data1.version >= data2.version && data1.space.version >= data2.space.version) {
            return data1;
        }
        if (data2.version >= data1.version && data2.space.version >= data1.space.version) {
            return data2;
        }
        return {
            ...(data1.version >= data2.version ? data1 : data2),

            // `space` is updated separately from the rest of the account data. We have two
            // independently updating pieces of data in a `AccountModel` that we may load
            // at mismatched versions.
            space: data1.space.version >= data2.space.version ? data1.space : data2.space,
        };
    }

    public static mergeDataWithoutSpace(
        data1: AccountModelData,
        data2: AccountModelWithoutSpaceData,
    ): AccountModelData {
        if (data1.version >= data2.version) {
            return data1;
        }
        return {
            ...(data1.version >= data2.version ? data1 : data2),
            space: data1.space,
        };
    }

    public merge(otherAccount: AccountModel): AccountModel {
        const data = AccountModel.mergeData(this.initialData, otherAccount.initialData);
        if (data === this.initialData) return this;
        if (data === otherAccount.initialData) return otherAccount;
        return new AccountModel(data);
    }

    public mergeWithoutSpace(otherAccount: AccountModelWithoutSpace): AccountModel {
        const data = AccountModel.mergeDataWithoutSpace(this.initialData, otherAccount.initialData);
        if (data === this.initialData) return this;
        return new AccountModel(data);
    }

    private static _unknown: AccountModel | null = null;

    /**
     * Get the model for an unknown account. If we need an account model but we
     * have no account available then you may use this model to render an unknown
     * account.
     */
    public static getUnknown(): AccountModel {
        this._unknown ??= new AccountModel({
            ...AccountModelWithoutSpace.getUnknown().initialData,
            space: {
                version: 0,
                joinedTime: new Date(0),
                removal: null,
                role: "Member",
            },
        });

        return this._unknown;
    }
}
