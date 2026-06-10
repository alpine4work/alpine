import {SpaceId} from "~/shared/id/types/id_types.js";
import {internalSpaceIds} from "~/shared/spaces/known_space_ids.js";

export const hasGifPickerFeature = (spaceId: SpaceId) => {
    return process.env.NODE_ENV !== "production" || internalSpaceIds.has(spaceId);
};
