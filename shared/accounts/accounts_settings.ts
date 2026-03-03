import {SpaceId} from "~/shared/id/types/id_types.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export const AccountsSettingsSchema = Schema.object({
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

export type AccountsSettings = SchemaType<typeof AccountsSettingsSchema>;
