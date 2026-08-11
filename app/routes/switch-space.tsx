import {redirect} from "@remix-run/router";
import {Plus} from "phosphor-react";
import {useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {MobileSettingsRow} from "~/client/web/design/mobile_settings_row.js";
import {LoudNotificationBadge} from "~/client/web/inbox/loud_notification_badge.js";
import {SpaceRouteScrollView} from "~/client/web/navigation/space_route_scroll_view.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {SpaceInviteDecisionModal} from "~/client/web/spaces/layout/space_invite_decision_modal.js";
import {SpaceAvatar} from "~/client/web/spaces/space_avatar.js";
import {spaceAvatarBorderRadius} from "~/client/web/styles/space_settings_shared_styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
import {neverPromise} from "~/shared/helpers/async/never_promise.js";
import {emptySet} from "~/shared/helpers/set/empty_set.open_source.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {getOurAccountSpaces, loadSpaceInviteContent} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

const LoaderSchema = Schema.object({
    otherSpaces: Schema.array(
        Schema.object({
            space: SpaceModel.schema(),
            inbox: createRynamoItemSchema(InboxModel.schema()).nullable(),
            isInvitePending: Schema.boolean.default(false),
        }),
    ),
});

export function meta() {
    return [{title: `Switch space${metaTitlePostfix}`}];
}

export async function loader({context: unauthenticatedContext}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const {spaces: otherSpaces} = await getOurAccountSpaces(context, {});

    if (otherSpaces.length === 0) {
        return redirect(`/create-space`);
    }

    return jsonWithSchema(LoaderSchema, {otherSpaces});
}

export default function SwitchSpaceRoute({selectedSpace}: {selectedSpace?: SpaceModel}) {
    const platform = usePlatform();
    const rootNavigate = useRootNavigate();
    const context = useAppContext();

    const {otherSpaces} = useLoaderDataWithSchema(LoaderSchema);

    const [spaceInviteContent, setSpaceInviteContent] = useState<{
        space: SpaceModel;
        allAccounts: ReadonlyArray<AccountModel>;
        currentAccount: AccountModel;
    } | null>(null);

    const [rejectedInviteSpaceIds, setRejectedInviteSpaceIds] =
        useState<ReadonlySet<string>>(emptySet);

    const visibleSpaces = otherSpaces.filter(({space}) => !rejectedInviteSpaceIds.has(space.id));

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    return (
        <SpaceRouteScrollView
            title="Switch space"
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
            defaultPreviousRoute={selectedSpace ? `/more/${selectedSpace.id}` : "/"}
            withoutDisappearingTitle
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center">
                {visibleSpaces.map(({space: otherSpace, inbox, isInvitePending}, i) => (
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
                        pressErrorTitle={
                            isInvitePending
                                ? "Couldn\u2019t open invite"
                                : "Couldn\u2019t switch to space"
                        }
                        onPress={async () => {
                            if (isInvitePending) {
                                setSpaceInviteContent(
                                    await loadSpaceInviteContent(context, {
                                        spaceId: otherSpace.id,
                                    }),
                                );
                                return;
                            }

                            if (otherSpace.id === selectedSpace?.id) return;

                            if (NativeMobileBridge) {
                                NativeMobileBridge.session.switchSpace(otherSpace.id);

                                // `switchSpace()` should destroy the current web browsing context and create a new
                                // one.
                                await neverPromise;
                            } else {
                                // We must perform a full page navigation when switching spaces in order to reload
                                // the `_space` route with a new `SpaceId`. We can't currently perform single page
                                // navigation to a new space because the `_space` route must run in parallel with
                                // some other loaders and currently Remix makes a network request for each
                                // individual loader on single page navigation.
                                window.location.assign(`/home/${otherSpace.id}`);
                                await neverPromise;
                            }
                        }}
                    />
                ))}
                <MobileSettingsRow
                    icon={
                        <Box
                            // Picked so we get the same margin horizontally and vertically between the
                            // `<SpaceAvatar>` and hover/press background edge.
                            paddingY="2"
                        >
                            <Box
                                position="relative"
                                width="8"
                                height="8"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                borderRadius={spaceAvatarBorderRadius}
                                backgroundColor="grey-10"
                            >
                                <Plus />
                            </Box>
                        </Box>
                    }
                    label={
                        <Box fontSize="100" fontStyle="truncate-semi-bold">
                            Create space
                        </Box>
                    }
                    pressErrorTitle="Couldn&#x2019;t create space"
                    onPress={async () => {
                        await rootNavigate(`/create-space`);
                    }}
                />
            </Box>
            {spaceInviteContent && (
                <SpaceInviteDecisionModal
                    allAccounts={spaceInviteContent.allAccounts}
                    currentAccount={spaceInviteContent.currentAccount}
                    space={spaceInviteContent.space}
                    onClose={() => setSpaceInviteContent(null)}
                    onRejected={() => {
                        setRejectedInviteSpaceIds(
                            new Set([...rejectedInviteSpaceIds, spaceInviteContent.space.id]),
                        );
                        setSpaceInviteContent(null);
                    }}
                />
            )}
        </SpaceRouteScrollView>
    );
}
