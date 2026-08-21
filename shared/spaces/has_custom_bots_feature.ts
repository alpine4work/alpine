import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {internalSpaceIds} from "~/shared/spaces/known_space_ids.js";

/**
 * Whether the custom bot creation and management UI is available in this space.
 * Gated to development and internal spaces while the feature is being built out.
 * The rest of the bot settings page (installed and recommended bots) is always
 * available.
 */
export const hasCustomBotsFeature = (spaceId: SpaceId) => {
    return process.env.NODE_ENV !== "production" || internalSpaceIds.has(spaceId);
};
