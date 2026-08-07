import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {internalSpaceIds} from "~/shared/spaces/known_space_ids.js";

export const hasSpellCheckFeature = (spaceId: SpaceId) => {
    return process.env.NODE_ENV !== "production" || internalSpaceIds.has(spaceId);
};
