import {SpaceId} from "~/shared/id/types/id_types.js";
import {hasSpaceSettingsFeature} from "~/shared/spaces/has_space_settings_feature.js";
import {alpineCompanyKnownSpaceId} from "~/shared/spaces/known_space_ids.js";

export const hasNotificationSettingsFeature = (spaceId: SpaceId) => {
    return (
        hasSpaceSettingsFeature(spaceId) &&
        (process.env.NODE_ENV !== "production" || spaceId === alpineCompanyKnownSpaceId)
    );
};
