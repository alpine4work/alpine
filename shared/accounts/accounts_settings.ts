import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type AccountSettings = SchemaType<typeof AccountSettingsSchema>;

export const AccountSettingsSchema = Schema.object({
    /**
     * The ID of the space this account last opened. Used for determining which default
     * space to open to when needing to route home.
     */
    lastOpenedSpaceId: Schema.id<SpaceId>().optional(),

    /**
     * This account's observed timezone as an IANA timezone name[1]. This field is
     * automatically set based the last observed time zone received from the client.
     *
     * [1] https://www.iana.org/time-zones
     */
    observedTimeZone: TimeZoneSchema.nullable().default(null),
});

export const initialAccountSettings: AccountSettings = {
    observedTimeZone: null,
};

export type AccountSettingsAction = SchemaType<typeof AccountSettingsActionSchema>;

export const AccountSettingsActionSchema = Schema.union({
    UpdateLastOpenedSpaceId: Schema.object({
        type: Schema.value("UpdateLastOpenedSpaceId"),
        spaceId: Schema.id<SpaceId>(),
    }),
    UpdateObservedTimeZone: Schema.object({
        type: Schema.value("UpdateObservedTimeZone"),
        timeZone: TimeZoneSchema,
    }),
});

export function applyAccountSettingsAction(
    oldSettings: AccountSettings,
    action: AccountSettingsAction,
): AccountSettings {
    const newSettings = actuallyApplyAccountSettingsAction(oldSettings, action);

    // In development and test environments, verify that applying an action is actually
    // idempotent.
    if (process.env.NODE_ENV !== "production") {
        assert(
            isDeepEqual(newSettings, actuallyApplyAccountSettingsAction(newSettings, action)),
            "`actuallyApplyAccountSettingsAction()` must be idempotent",
        );
    }

    return newSettings;
}

function actuallyApplyAccountSettingsAction(
    settings: AccountSettings,
    action: AccountSettingsAction,
): AccountSettings {
    switch (action.type) {
        case "UpdateLastOpenedSpaceId": {
            if (settings.lastOpenedSpaceId === action.spaceId) {
                return settings;
            }
            return {
                ...settings,
                lastOpenedSpaceId: action.spaceId,
            };
        }
        case "UpdateObservedTimeZone": {
            if (settings.observedTimeZone === action.timeZone) {
                return settings;
            }
            return {
                ...settings,
                observedTimeZone: action.timeZone,
            };
        }
        default:
            throw exhaustive(action);
    }
}
