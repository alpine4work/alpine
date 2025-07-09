import {Box} from "~/client/design/box.js";
import {MobileSettingsRow} from "~/client/design/mobile_settings_row.js";
import {LoudNotificationBadge} from "~/client/inbox/loud_notification_badge.js";
import {SpaceRouteScrollView} from "~/client/navigation/space_route_scroll_view.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SpaceAvatar} from "~/client/spaces/space_avatar.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {getOurAccountSpaces} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

const LoaderSchema = Schema.object({
    otherSpaces: Schema.array(
        Schema.object({
            space: SpaceModel.schema(),
            inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()).nullable(),
        }),
    ),
});

export function meta() {
    return [{title: `Switch space${metaTitlePostfix}`}];
}

export async function loader({context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const {spaces: otherSpaces} = await getOurAccountSpaces(context, {});

    return jsonWithSchema(LoaderSchema, {otherSpaces});
}

export default function SwitchSpaceRoute({selectedSpace}: {selectedSpace?: SpaceModel}) {
    const platform = usePlatform();
    const rootNavigate = useRootNavigate();

    const {otherSpaces} = useLoaderDataWithSchema(LoaderSchema);

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <SpaceRouteScrollView
            title="Switch space"
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
            withoutDisappearingTitle
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center">
                {otherSpaces.map(({space: otherSpace, inbox}, i) => (
                    <MobileSettingsRow
                        key={otherSpace.id}
                        withBorderTop={i === 0}
                        isSelected={otherSpace.id === selectedSpace?.id}
                        icon={
                            <Box
                                position="relative"
                                // Picked so we get the same margin horizontally and vertically between the
                                // `<SpaceAvatar>` and hover/press background edge.
                                paddingY="2"
                            >
                                <SpaceAvatar space={otherSpace} size="8" />
                                {inbox && inbox.model.loudNotificationCount > 0 && (
                                    <LoudNotificationBadge
                                        top="0.3125rem"
                                        right="0.125rem"
                                        count={inbox.model.loudNotificationCount}
                                    />
                                )}
                            </Box>
                        }
                        label={
                            <Box fontSize="100" fontStyle="truncate-semi-bold">
                                {otherSpace.name}
                            </Box>
                        }
                        pressErrorTitle="Couldn’t switch to space"
                        onPress={async () => {
                            if (otherSpace.id === selectedSpace?.id) return;

                            if (NativeMobileBridge) {
                                NativeMobileBridge.session.switchSpace(otherSpace.id);

                                // `switchSpace()` should destroy the current web browsing context and create a
                                // new one.
                                await new Promise(() => {});
                            } else {
                                if (otherSpace.alphaAccessDefaultChannelId) {
                                    await rootNavigate(
                                        `/s/${otherSpace.id}/channels/${otherSpace.alphaAccessDefaultChannelId}`,
                                    );
                                } else {
                                    await rootNavigate(`/s/${otherSpace.id}`);
                                }
                            }
                        }}
                    />
                ))}
            </Box>
        </SpaceRouteScrollView>
    );
}
