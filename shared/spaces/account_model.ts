import {
    AccountModelWithoutSpace,
    AccountModelWithoutSpaceData,
    AccountModelWithoutSpaceDataSchema,
} from "~/shared/accounts/account_model_without_space.js";
import {AvatarModelWithSignedUrl} from "~/shared/avatar/avatar_schema.js";
import {getLatestAvatarVersion} from "~/shared/avatar/get_latest_avatar_version.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    SpaceAccountStateSchemas,
    SpaceAccountStateType,
} from "~/shared/spaces/space_account_state.js";
import {SpaceRoleSchema} from "~/shared/spaces/space_model.js";

export type AccountModelData = SchemaType<typeof AccountModelDataSchema>;
export type AccountModelDataSpaceState = SchemaType<typeof AccountModelDataSpaceStateSchema>;

type AccountModelDataState<T extends SpaceAccountStateType> = AccountModelData & {
    space: AccountModelData["space"] & {
        state: SchemaType<(typeof SpaceAccountStateSchemas)[T]>;
    };
};

export type AccountModelDataWithRemovedState = AccountModelDataState<"Removed">;
export type AccountModelDataWithActiveState = AccountModelDataState<"Active">;
export type AccountModelDataWithInvitePendingState = AccountModelDataState<"InvitePending">;
export type AccountModelDataWithoutAvatar = Omit<AccountModelData, "avatar">;
export type AccountModelDataWithSignedAvatarUrl = Replace<
    AccountModelData,
    {avatar: AvatarModelWithSignedUrl | null}
>;

export const AccountModelDataSpaceStateSchema = Schema.union(SpaceAccountStateSchemas);

// We don't include the `SpaceId` in `SpaceAccountModel`. You should know what the
// `SpaceId` is from the context this account is in.
export const AccountModelDataSchema = AccountModelWithoutSpaceDataSchema.merge(
    Schema.object({
        space: Schema.object({
            version: Schema.integer,
            addedTime: Schema.date.originalPropertyKey("joinedTime"),
            state: AccountModelDataSpaceStateSchema.defaultVariant("Removed").originalPropertyKey(
                "removal",
            ),
            role: SpaceRoleSchema.default("Member"),
        }),
    }),
);

/**
 * Representation of the pair of an account and space in our system that we can
 * share with the client. Information like the account's email address is not
 * publicly available.
 *
 * Usually an account corresponds to a person who signed up with the real name and
 * work email address but an account could also represent a "service account" or
 * bot acting against our systems.
 *
 * An account may be a member of multiple spaces. We have an `AccountModel` object
 * for each space an account is a member of. It tracks information like when did
 * the account join the space or was the account removed from the space?
 * `AccountModelWithoutSpace` represents the shared data for an account across all
 * spaces.
 *
 * These objects are not normalized! You may have multiple `AccountModel`s
 * representing the same user. Even with different data. On the client we have an
 * `AccountRegistry` object that normalizes accounts. You can use the
 * `useAccountModel()` hook to get the account's latest data so the account renders
 * the same way everywhere. If an account with new data is loaded from the server
 * we re-render the application with the new `AccountModel`.
 */
export class AccountModel implements AccountModelWithoutSpace {
    public readonly id: AccountId;

    /**
     * The data this `AccountModel` object was initialized with. May not be the latest
     * data for the account! Either we loaded data from the server before it was
     * updated or, if the account was removed from a space, we'll keep returning
     * account data as it was when the account was removed.
     *
     * You can use the `version` property on an account's data to tell whether one
     * instance of the account is newer than another instance of the account.
     * Conceptually, there are two separate pieces of data controlled by `version` that
     * update independently in `AccountModelData`. `data` itself and `data.space`. If
     * `newData.version > oldData.version` but
     * `oldData.space.version > newData.space.version` then we need to keep
     * `oldData.space` so the latest data when merged would be
     * `{...newData, space: oldData.space}`.
     *
     * On the client you should call `useAccountModel()` instead of using this property
     * to get up-to-date account data that's the same everywhere on the screen. (So you
     * don't have a situation where, e.g., the account's avatar is different in two
     * places.)
     */
    public readonly initialData: AccountModelData;

    constructor(initialData: AccountModelData) {
        this.id = initialData.id;
        this.initialData = initialData;
    }

    public static readonly schema = AccountModelDataSchema.transform<AccountModel>({
        // Serializing the model over the network is fine. Generally only the
        // server serializes data over the network for the client.
        //
        // eslint-disable-next-line cyberworlds/no-model-initial-data
        serialize: account => account.initialData,
        deserialize: account => new AccountModel(account),
    });

    /**
     * `botId` is immutable so it's ok to access it directly with `account.botId`
     * instead of indirectly with `account.initialData.botId`.
     */
    public get botId() {
        // `botId` for an account is immutable so it's ok to access it directly with
        // `account.botId` instead of going through `AccountRegistry`.
        //
        // eslint-disable-next-line cyberworlds/no-model-initial-data
        return this.initialData.botId;
    }

    /**
     * Also implemented by `SearchEntityModel` so you can call `getSearchEntityId()` on
     * `SearchEntityModel | AccountModel` to get the `SearchEntityId`.
     */
    public getSearchEntityId(): `Account:${AccountId}` {
        return `Account:${this.id}`;
    }

    // TODO(ifitzsimmons, #add-avatar-tests): Add tests for this function.
    public static mergeData(data1: AccountModelData, data2: AccountModelData): AccountModelData {
        const avatar1 = data1.avatar;
        const avatar2 = data2.avatar;

        if (
            data1.version >= data2.version &&
            data1.space.version >= data2.space.version &&
            avatar1 === getLatestAvatarVersion(avatar1, avatar2)
        ) {
            return data1;
        }
        if (
            data2.version >= data1.version &&
            data2.space.version >= data1.space.version &&
            avatar2 === getLatestAvatarVersion(avatar2, avatar1)
        ) {
            return data2;
        }

        const latestAccountData = data1.version >= data2.version ? data1 : data2;
        const latestSpace = data1.space.version >= data2.space.version ? data1.space : data2.space;
        const latestAvatar = getLatestAvatarVersion(avatar1, avatar2);

        return {
            ...latestAccountData,
            // `space` is updated separately from the rest of the account data. We have two
            // independently updating pieces of data in a `AccountModel` that we may load at
            // mismatched versions.
            space: latestSpace,
            avatar: latestAvatar,
        };
    }

    public static mergeDataWithoutSpace(
        data1: AccountModelData,
        data2: AccountModelWithoutSpaceData,
    ): AccountModelData {
        const latestAvatar = getLatestAvatarVersion(data1.avatar, data2.avatar);
        if (data1.version >= data2.version && data1.avatar === latestAvatar) {
            return data1;
        }

        const latestAccountData = data1.version >= data2.version ? data1 : data2;
        return {
            ...latestAccountData,
            space: data1.space,
            avatar: latestAvatar,
        };
    }

    public static mergeDataWithoutSpaceAndWithoutAvatar(
        data1: Omit<AccountModelData, "avatar">,
        data2: Omit<AccountModelWithoutSpaceData, "avatar">,
    ): Omit<AccountModelData, "avatar"> {
        const latestAccountData = data1.version >= data2.version ? data1 : data2;
        return {...latestAccountData, space: data1.space};
    }

    public merge(otherAccount: AccountModel): AccountModel {
        // Used when merging `AccountModel`s to reconcile to models and get the latest
        // data. So accessing `initialData` is required to do that. (This is the mechanism
        // that helps keeps `AccountRegistry` up-to-date.)
        /* eslint-disable cyberworlds/no-model-initial-data */
        const data = AccountModel.mergeData(this.initialData, otherAccount.initialData);
        if (data === this.initialData) return this;
        if (data === otherAccount.initialData) return otherAccount;
        return new AccountModel(data);
        /* eslint-enable cyberworlds/no-model-initial-data */
    }

    public mergeWithoutSpace(otherAccount: AccountModelWithoutSpace): AccountModel {
        // Used when merging `AccountModel`s to reconcile to models and get the latest
        // data. So accessing `initialData` is required to do that. (This is the mechanism
        // that helps keeps `AccountRegistry` up-to-date.)
        /* eslint-disable cyberworlds/no-model-initial-data */
        const data = AccountModel.mergeDataWithoutSpace(this.initialData, otherAccount.initialData);
        if (data === this.initialData) return this;
        return new AccountModel(data);
        /* eslint-enable cyberworlds/no-model-initial-data */
    }

    private static _unknown: AccountModel | null = null;
    private static _unknownData: AccountModelData | null = null;

    /**
     * Get the model for an unknown account. If we need an account model but we have no
     * account available then you may use this model to render an unknown account.
     */
    public static getUnknown(): AccountModel {
        this._unknown ??= new AccountModel(this.getUnknownData());
        return this._unknown;
    }

    /**
     * Get the model data for an unknown account. If we need an account model data but
     * we have no account available then you may use this model data to render an
     * unknown account.
     */
    public static getUnknownData(): AccountModelData {
        if (this._unknownData === null) {
            const addedTime = new Date(0);

            this._unknownData = {
                ...AccountModelWithoutSpace.getUnknownData(),
                space: {
                    version: 0,
                    addedTime,
                    state: {
                        type: "Active",
                        activatedTime: addedTime,
                    },
                    role: "Member",
                },
            };
        }

        return this._unknownData;
    }
}
