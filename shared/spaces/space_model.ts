import {AvatarModelSchema} from "~/shared/avatar/avatar_schema.js";
import {getLatestAvatarVersion} from "~/shared/avatar/get_latest_avatar_version.js";
import {defaultThemeColor, themeColors} from "~/shared/design/core/theme_colors.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Since Each `document`/`channel`/`task collection` itself has permissions, we
 * have only defined these space roles for space specific settings like managing
 * people, changing name/avatar of space, invite other people etc.
 *
 * In upcoming roadmap of Alpine, we will have more access control based on these
 * roles.
 *
 * The available roles in a space, ordered from highest to lowest permissions:
 *
 * - `Owner`: Has complete control over the space
 *     - Can manage all space settings
 *     - Can add/remove members and change their roles
 *     - Move ownership to other member.
 *     - Has all `Admin` and `Member` permissions
 *
 * - `Admin`: Has administrative permissions but cannot modify `Owner`
 *     - Can manage all space settings other than moving ownership to other member.
 *     - Can add/remove members (except `Owner`)
 *     - Can modify member roles (except `Owner`)
 *     - Has all `Member` permissions
 *
 * - `Member`: Basic access to participate in the space
 *     - Can view other members
 *     - Cannot modify space settings or member roles
 */
const allSpaceRoles = ["Owner", "Admin", "Member"] as const;
export type SpaceRole = (typeof allSpaceRoles)[number];
export const SpaceRoleSchema = Schema.enum(allSpaceRoles);

export class SpaceModel extends Model(
    Schema.object({
        id: Schema.id<SpaceId>(),
        name: Schema.string,
        version: Schema.integer,

        avatars: Schema.object({
            darkTheme: AvatarModelSchema.nullable().default(null),
            lightTheme: AvatarModelSchema.nullable().default(null),
        }),

        /**
         * The theme color used for accent UI elements throughout the space. Defaults to
         * blue if not set.
         */
        themeColor: Schema.enum(themeColors).default(defaultThemeColor),
    }),
) {
    // TODO(ifitzsimmons, #add-avatar-tests): Add tests for this function.
    public static merge(space1: SpaceModel, space2: SpaceModel): SpaceModel {
        if (
            space1.version >= space2.version &&
            space1.avatars.darkTheme ===
                getLatestAvatarVersion(space1.avatars.darkTheme, space2.avatars.darkTheme) &&
            space1.avatars.lightTheme ===
                getLatestAvatarVersion(space1.avatars.lightTheme, space2.avatars.lightTheme)
        ) {
            return space1;
        }

        if (
            space2.version >= space1.version &&
            space2.avatars.darkTheme ===
                getLatestAvatarVersion(space2.avatars.darkTheme, space1.avatars.darkTheme) &&
            space2.avatars.lightTheme ===
                getLatestAvatarVersion(space2.avatars.lightTheme, space1.avatars.lightTheme)
        ) {
            return space2;
        }

        const latestSpaceData = space1.version >= space2.version ? space1 : space2;
        const latestDarkThemeAvatar = getLatestAvatarVersion(
            space1.avatars.darkTheme,
            space2.avatars.darkTheme,
        );
        const latestLightThemeAvatar = getLatestAvatarVersion(
            space1.avatars.lightTheme,
            space2.avatars.lightTheme,
        );

        return new SpaceModel({
            ...latestSpaceData,
            avatars: {
                darkTheme: latestDarkThemeAvatar,
                lightTheme: latestLightThemeAvatar,
            },
        });
    }

    public merge(otherSpace: SpaceModel): SpaceModel {
        return SpaceModel.merge(this, otherSpace);
    }
}

/**
 * It's a helper function that checks if a user with an actualRole has sufficient
 * permissions for an expectedRole in a space.
 *
 * The roles follow a hierarchy:
 *
 * - Owner > Admin > Member
 *
 * For example, an Owner can do anything, an Admin can do anything except for
 * removing the Owner, and a Member can only read.
 *
 * How this works:
 *
 * - If we're checking for Member permissions (expectedRole === "Member"), return
 *   true because everyone (Member, Admin, Owner) has Member permissions.
 * - If we're checking for Admin permissions (expectedRole === "Admin"), return
 *   true if the actual role is "Admin" or "Owner" because Admins can do anything
 *   except for removing the Owner.
 * - If we're checking for Owner permissions (expectedRole === "Owner"), return
 *   true if the actual role is "Owner" because Owners can do anything.
 */
export function hasSpaceRole(actualRole: SpaceRole, expectedRole: SpaceRole): boolean {
    if (expectedRole === "Member") return true;
    if (actualRole === "Member") return false;
    if (expectedRole === "Admin") return true;
    if (actualRole === "Admin") return false;
    if (expectedRole === "Owner") return true;
    if (actualRole === "Owner") return false;

    // Use TypeScript to make sure you've checked every role type.
    exhaustive(expectedRole);
    throw exhaustive(actualRole);
}
