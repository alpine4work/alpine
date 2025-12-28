import {SpacesInjection} from "~/server/context/injection_context_module.js";
import {
    getOurAccountSpaceIds,
    isAccountInNoSpaces,
} from "~/server/spaces/get_our_account_space_ids.js";

export const spacesInjection: SpacesInjection = {
    getOurAccountSpaceIds,
    isAccountInNoSpaces,
};
