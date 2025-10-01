import {SpacesInjection} from "~/server/context/injection_context_module.js";
import {getOurAccountSpaceIds} from "~/server/spaces/spaces_actions.js";

export const spacesInjection: SpacesInjection = {
    getOurAccountSpaceIds,
};
