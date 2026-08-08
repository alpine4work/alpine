import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * The Alpine company-wide space in production.
 */
export const alpineCompanyKnownSpaceId = "c2pwxmpv3z7b3db19tsn6y1qfg" as SpaceId;

/**
 * The Escape design studio space in production.
 */
export const escapeStudiosKnownSpaceId = "nz82s5pkb5yf33s4vd0z7xr9q8" as SpaceId;

/**
 * Team personal spaces.
 */
const alpineTeamPersonalSpaces = {
    joshJohnson: "3j9jv84vzxgwky5dnb2ejfccag" as SpaceId,
    rachelDate: "2e2q4p1cka8vpgzv8qbmtraxf0" as SpaceId,
    calebMeredith: "z6j3jxcdvk60d9035txg4aw9t8" as SpaceId,
};

/**
 * A utility for flagging features to internal spaces.
 */
export const internalSpaceIds = new Set([
    alpineCompanyKnownSpaceId,
    ...Object.values(alpineTeamPersonalSpaces),
]);
