import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {internalSpaceIds} from "~/shared/spaces/known_space_ids.js";

export const hasDatePickerFeature = (spaceId: SpaceId) => {
    return internalSpaceIds.has(spaceId);
};
