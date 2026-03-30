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
    lastOpenedSpaceId: Schema.id<SpaceId>().nullable().default(null),

    /**
     * This account's observed timezone as an IANA timezone name[1]. This field is
     * automatically set based the last observed time zone received from the client.
     *
     * [1] https://www.iana.org/time-zones
     */
    observedTimeZone: TimeZoneSchema.nullable().default(null),

    /**
     * Should we show a hint prompting the user to share their creation with others
     * after they've made some edits? An object if so and undefined if not. Once we
     * show the hint we remove this object so we don't show the hint again in the
     * future.
     *
     * The goal of this hint is to "activate" users. An activated user is one that's
     * going to keep coming back to Alpine day after day for a long time. We believe
     * the activation moment is when a user starts collaborating with others in Alpine.
     * Which is why we have this activation moment prompting the user to share their
     * creation.
     *
     * This is an empty object in case we want to add more state in the future.
     */
    shareActivationHint: Schema.object({}).nullable().default({}),

    /**
     * If present then we need to show the search education hint. This hint tells the
     * user that everything from their home sidebar is in search. We've found users are
     * sometimes confused when the try Alpine because they expect the sidebar to always
     * be visible. This hint helps teach them that everything is in search.
     *
     * We only show this hint after the user has opened their feed and then navigated
     * to a different page. Once the user opens search for the first time we remove
     * this hint from their settings object so we don't show it again.
     *
     * We use `useHintOracle()` to make sure we don't show this hint at the same time
     * we're showing `shareActivationHint` which takes priority.
     */
    searchEducationHint: Schema.object({hasOpenedFeed: Schema.boolean})
        .nullable()
        .default({hasOpenedFeed: false}),
});

export const initialAccountSettings: AccountSettings = {
    lastOpenedSpaceId: null,
    observedTimeZone: null,
    shareActivationHint: {},
    searchEducationHint: {hasOpenedFeed: false},
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
    HideShareActivationHint: Schema.object({
        type: Schema.value("HideShareActivationHint"),
    }),
    OpenFeedForSearchEducationHint: Schema.object({
        type: Schema.value("OpenFeedForSearchEducationHint"),
    }),
    HideSearchEducationHint: Schema.object({
        type: Schema.value("HideSearchEducationHint"),
    }),
    ResetOnboardingForDev: Schema.object({
        type: Schema.value("ResetOnboardingForDev"),
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
        case "HideShareActivationHint": {
            if (!settings.shareActivationHint) return settings;
            return {...settings, shareActivationHint: null};
        }
        case "OpenFeedForSearchEducationHint": {
            if (settings.searchEducationHint?.hasOpenedFeed) return settings;

            return {
                ...settings,
                searchEducationHint: {
                    ...settings.searchEducationHint,
                    hasOpenedFeed: true,
                },
            };
        }
        case "HideSearchEducationHint": {
            if (!settings.searchEducationHint) return settings;
            return {...settings, searchEducationHint: null};
        }
        case "ResetOnboardingForDev": {
            return {
                ...settings,
                shareActivationHint: {},
                searchEducationHint: {hasOpenedFeed: false},
            };
        }
        default:
            throw exhaustive(action);
    }
}
