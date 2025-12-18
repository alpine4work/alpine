import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Switch} from "~/client/web/design/switch.js";
import {useDynamoGeneralRealtimeItem} from "~/client/web/dynamo/use_dynamo_general_realtime_item.js";
import {getOrPromptForBrowserPushNotificationPermission} from "~/client/web/notifications/get_or_prompt_for_browser_push_notification_permission.js";
import {subscribeToPushNotificationsInBrowser} from "~/client/web/notifications/subscribe_to_push_notifications_in_browser.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {
    useMyAccountWebSocket,
    useSpaceContextAndRequireSpaceAccess,
} from "~/client/web/spaces/space_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    DynamoGeneralRealtimeItem,
    createDynamoGeneralRealtimeItemSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {
    getInboxWithStrongReadConsistency,
    isOptedOutOfWebPushForSpace,
    optOutOfWebPushForSpace,
    registerAccountWebPushSubscriptionAndOptInToSpace,
    subscribeToDigestNotificationsEmail,
    unsubscribeFromDigestNotificationsEmail,
} from "~/shared/rpc/notifications_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    browserId: Schema.id<BrowserId>(),
    inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()),
    isOptedOutOfWebPush: Schema.boolean,
});

export async function loader({context, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const browserId = context.loader.getBrowserId();

    const [{inbox}, {optedOut}] = await runAllPromises([
        getInboxWithStrongReadConsistency(await context.actor.authenticate(), {spaceId}),
        isOptedOutOfWebPushForSpace(await context.actor.authenticate(), {
            spaceId,
            browserId,
        }),
    ]);

    return jsonWithSchema(LoaderSchema, {
        browserId,
        inbox,
        isOptedOutOfWebPush: optedOut,
    });
}

export default function SpaceNotificationSettingsRoute() {
    const context = useAppContext();

    const {
        browserId,
        inbox: initialInbox,
        isOptedOutOfWebPush,
    } = useLoaderDataWithSchema(LoaderSchema);
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();
    const {space} = useSpaceContextAndRequireSpaceAccess();

    const {item: inbox} = useDynamoGeneralRealtimeItem(initialInbox, {
        isConnected,
        subscribeToEvents: useCallback(
            subscriber => subscribeToEvents(event => subscriber(event.eventTransaction)),
            [subscribeToEvents],
        ),
        reloadItemWithStrongReadConsistency: useCallback(async () => {
            const {inbox} = await getInboxWithStrongReadConsistency(context, {spaceId: space.id});
            return inbox;
        }, [context, space.id]),
    });

    return (
        <Box display="flex" flexDirection="column" gap="6">
            <PushNotificationsSection
                browserId={browserId}
                isOptedOutOfWebPush={isOptedOutOfWebPush}
            />
            <DigestNotificationsSection inbox={inbox} />
        </Box>
    );
}

function DigestNotificationsSection({inbox}: {inbox: DynamoGeneralRealtimeItem<InboxModel>}) {
    const context = useAppContext();
    const {currentAccount, space} = useSpaceContextAndRequireSpaceAccess();

    const [isSubscribed, setIsSubscribed] = useState(
        inbox.model.digestNotificationsOptedOutTime === null,
    );

    useEffect(() => {
        setIsSubscribed(inbox.model.digestNotificationsOptedOutTime === null);
    }, [inbox.model.digestNotificationsOptedOutTime]);

    return (
        <Box>
            <Switch
                fontSize="100"
                isSelected={isSubscribed}
                changeErrorTitle={`Couldn’t ${
                    isSubscribed ? "unsubscribe" : "subscribe"
                } from email notifications`}
                onChange={async isSubscribed => {
                    if (isSubscribed) {
                        await subscribeToDigestNotificationsEmail(context, {
                            accountId: currentAccount.id,
                            spaceId: space.id,
                        });
                    } else {
                        await unsubscribeFromDigestNotificationsEmail(context, {
                            accountId: currentAccount.id,
                            spaceId: space.id,
                        });
                    }
                    setIsSubscribed(isSubscribed);
                }}
            >
                Send an email twice a day with new notifications
            </Switch>
        </Box>
    );
}

function PushNotificationsSection({
    browserId,
    isOptedOutOfWebPush,
}: {
    browserId: BrowserId;
    isOptedOutOfWebPush: boolean;
}) {
    const context = useAppContext();
    const {space} = useSpaceContextAndRequireSpaceAccess();

    const [isSubscribed, setIsSubscribed] = useState<boolean>(!isOptedOutOfWebPush);
    const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null);
    const [isPushSupported, setIsPushSupported] = useState(true);

    const hasInitiallyMountedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (
            typeof navigator === "undefined" ||
            typeof navigator.permissions === "undefined" ||
            typeof Notification === "undefined"
        ) {
            setIsPushSupported(false);
            return;
        }

        navigator.permissions.query({name: "notifications"}).then(
            permissionStatus => {
                setPermissionStatus(permissionStatus);
            },
            () => {
                setPermissionStatus(null);
            },
        );
    }, []);

    const permissionState = useSyncExternalStore(
        useCallback(
            callback => {
                if (!permissionStatus) return () => {};

                permissionStatus.addEventListener("change", callback);
                return () => {
                    permissionStatus.removeEventListener("change", callback);
                };
            },
            [permissionStatus],
        ),
        useCallback(() => permissionStatus?.state ?? null, [permissionStatus]),
        () => null,
    );

    const handleToggle = async (shouldSubscribe: boolean) => {
        if (shouldSubscribe) {
            try {
                const permission = await getOrPromptForBrowserPushNotificationPermission();
                if (permission !== "granted") {
                    setIsSubscribed(false);
                    return;
                }

                const subscription = await subscribeToPushNotificationsInBrowser(browserId);

                if (!subscription) {
                    throw new FailedPreconditionError(
                        "Couldn’t subscribe to push notifications in browser",
                    );
                }
                await registerAccountWebPushSubscriptionAndOptInToSpace(context, {
                    browserId,
                    subscription,
                    spaceId: space.id,
                });
                setIsSubscribed(true);
            } catch (error) {
                throw error;
            }
        } else {
            try {
                await optOutOfWebPushForSpace(context, {
                    browserId,
                    spaceId: space.id,
                });
                setIsSubscribed(false);
            } catch (error) {
                throw error;
            }
        }
    };

    const getDisabledMessage = () => {
        if (!isPushSupported) return "(notifications not supported in browser)";
        if (permissionState === "denied") return "(notifications disabled in browser)";
        return null;
    };

    return (
        <Box>
            <Box
                display="flex"
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
            >
                <Switch
                    fontSize="100"
                    isSelected={isSubscribed && permissionState === "granted"}
                    changeErrorTitle={`Couldn’t ${
                        isSubscribed ? "disable" : "enable"
                    } push notifications`}
                    onChange={handleToggle}
                    isDisabled={!isPushSupported || permissionState === "denied"}
                >
                    Receive web push notifications {getDisabledMessage()}
                </Switch>
            </Box>
        </Box>
    );
}
