import {AvatarModel} from "~/shared/avatar/avatar_schema.js";

/**
 * Given two AvatarModel objects, returns the latest avatar version. Tiebreaker (both
 * versions are the same or both avatars are null) always goes to avatar1.
 */
export function getLatestAvatarVersion(
    avatar1: AvatarModel | null,
    avatar2: AvatarModel | null,
): AvatarModel | null {
    if (avatar1 === null) {
        if (avatar2 === null) return avatar1;
        return avatar2;
    }

    if (avatar2 === null) {
        return avatar1;
    }

    if (avatar1.version >= avatar2.version) return avatar1;
    return avatar2;
}
