import {SpaceId} from "~/shared/id/types/id_types.js";
import {alpineCompanyKnownSpaceId} from "~/shared/spaces/known_space_ids.js";

export const hasSpaceSettingsFeature = (spaceId: SpaceId) => {
    return process.env.NODE_ENV !== "production" || spaceId === alpineCompanyKnownSpaceId;
};
