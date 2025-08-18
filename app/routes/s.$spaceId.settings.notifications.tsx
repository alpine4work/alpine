import {Box} from "~/client/design/box.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {hasNotificationSettingsFeature} from "~/shared/spaces/has_notification_settings_feature.js";

const LoaderSchema = Schema.object({});

export async function loader({params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    if (!hasNotificationSettingsFeature(spaceId)) {
        throw new UnimplementedError("Notification settings is not available");
    }

    return jsonWithSchema(LoaderSchema, {});
}

export default function SpaceNotificationSettingsRoute() {
    return (
        <>
            <Box display="flex" flexDirection="column" gap="6" width="full">
                <Box gap="6" display="flex" alignItems="center" justifyContent="space-between">
                    {/* TODO */}
                </Box>
            </Box>
        </>
    );
}
