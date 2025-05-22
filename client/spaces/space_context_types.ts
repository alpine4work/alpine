import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export type SpaceContext = {
    /**
     * The space our component is rendered in.
     */
    readonly space: SpaceModel;

    /**
     * The account currently viewing the space when the account is a member of that
     * space. If non-null then this account has space access. If null then whatever
     * actor is interacting with our app does not have space access.
     *
     * Some cases where this'll be null:
     *
     * 1. An anonymous actor (someone who's not signed in) is using the app.
     *
     * 2. The signed in account doesn't have access to the space. In this case,
     *    `currentAccount` will be null but `currentAccountWithoutSpace` will be
     *    non-null with the account.
     *
     * If an account used to be a member of the space but was removed then this
     * will be null.
     */
    readonly currentAccount: AccountModel | null;

    /**
     * The current account. Will be the same as `currentAccount` accept when a user
     * is signed in but they're not a member of the space whose content they're
     * viewing. In this case `currentAccount` will be null and
     * `currentAccountWithoutSpace` will be non-null. Since we won't have space
     * data for an `AccountModel` but we'll still have the rest of the account's
     * data which will be made available on this property.
     */
    readonly currentAccountWithoutSpace: AccountModelWithoutSpace | null;

    /**
     * If the new space has a lower version than the current space then we don't
     * update the space. This is to prevent us from racing condition when a space
     * is being updated by multiple clients.
     */
    readonly updateSpace: (space: SpaceModel) => void;
};
