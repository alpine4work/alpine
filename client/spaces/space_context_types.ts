import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export type SpaceContext = {
    readonly space: SpaceModel;
    readonly currentAccount: AccountModel;
};
