import {Box} from "~/client/design/box.js";
import {MobileSettingsRow} from "~/client/design/mobile_settings_row.js";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SpaceAvatar} from "~/client/spaces/space_avatar.js";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view.js";
import {getInbox} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getSessionActorAccountSpaceIds, getSpace} from "~/server/spaces/spaces_table.js";
import {screenPaddingX} from "~/shared/design/spacing.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

const LoaderSchema = Schema.object({
    spaces: Schema.array(
        Schema.object({
            space: SpaceModel.schema(),
            inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()),
        }),
    ),
});

export function meta() {
    return [{title: `Switch space${metaTitlePostfix}`}];
}

export async function loader({context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const {spaceIds} = await getSessionActorAccountSpaceIds(context);

    const spaces = await runAllPromises(
        Array.from(spaceIds, async spaceId =>
            runAllPromises([getSpace(context, spaceId), getInbox(context, {spaceId})]).then(
                ([space, inbox]) => ({space, inbox}),
            ),
        ),
    );

    return jsonWithSchema(LoaderSchema, {spaces});
}

export default function MoreSwitchSpaceRoute() {
    const isMobile = useIsMobile();

    const {spaces} = useLoaderDataWithSchema(LoaderSchema);

    const maxWidth = !isMobile ? "96" : undefined;

    return (
        <SpaceRouteScrollView
            withMobileLayout={isMobile}
            title="Switch space"
            titleJustifyContents="center"
            desktopMaxWidth={maxWidth}
            withoutDisappearingTitle
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center">
                {spaces.map(({space, inbox}, i) => (
                    <MobileSettingsRow
                        key={space.id}
                        withBorderTop={i === 0}
                        icon={
                            <Box
                                position="relative"
                                // Picked so we get the same margin horizontally and vertically between the
                                // `<SpaceAvatar>` and hover/press edge.
                                paddingY="2"
                            >
                                <SpaceAvatar space={space} size="8" />
                                {inbox.model.loudNotificationCount > 0 && (
                                    <LoudNotificationBadge
                                        top="0.3125rem"
                                        right="0.125rem"
                                        loudNotificationCount={inbox.model.loudNotificationCount}
                                    />
                                )}
                            </Box>
                        }
                        label={
                            <Box fontSize="100" fontStyle="truncate-semi-bold">
                                {space.name}
                            </Box>
                        }
                        pressErrorTitle="Couldn’t switch to space"
                        onPress={async () => {
                            // NOCOMMIT: Implement
                        }}
                    />
                ))}
            </Box>
        </SpaceRouteScrollView>
    );
}
