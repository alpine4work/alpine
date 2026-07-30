export const searchAffinityEntityViewInteractionPoints = 1;
export const searchAffinityEntityVeryLowIntentUpdateInteractionPoints = 0.0625;
export const searchAffinityEntityLowIntentUpdateInteractionPoints = 0.2;
export const searchAffinityEntityMediumIntentUpdateInteractionPoints = 1;
export const searchAffinityEntityHighIntentUpdateInteractionPoints = 3;

/**
 * When affinity points accrue for an entity that lives in a site, this fraction of
 * those points also accrues to the containing site so the site itself rises in the
 * actor's affinity list as they engage with content inside it.
 */
export const searchAffinityEntitySiteCascadeRatio = 0.8;
