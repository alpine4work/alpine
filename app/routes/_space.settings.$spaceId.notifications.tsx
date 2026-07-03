import {CaretRight} from "phosphor-react";
import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Link} from "~/client/web/design/link.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {Switch} from "~/client/web/design/switch.js";
import {useRynamoItem} from "~/client/web/dynamo/use_rynamo_item.js";
import {SlackLogo} from "~/client/web/icons/socials/slack_logo.js";
import {getOrPromptForBrowserPushNotificationPermission} from "~/client/web/notifications/get_or_prompt_for_browser_push_notification_permission.js";
import {subscribeToPushNotificationsInBrowser} from "~/client/web/notifications/subscribe_to_push_notifications_in_browser.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {
    useMyAccountWebSocket,
    useSpaceContextAndRequireSpaceAccess,
} from "~/client/web/spaces/context/space_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {RynamoItem, createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
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
    inbox: createRynamoItemSchema(InboxModel.schema()),
    isOptedOutOfWebPush: Schema.boolean,
});

export async function loader({context, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const browserId = context.loader.getBrowserId();

    const authenticatedContext = await context.actor.authenticate();

    const [{inbox}, {optedOut}] = await runAllPromises([
        getInboxWithStrongReadConsistency(authenticatedContext, {spaceId}),
        isOptedOutOfWebPushForSpace(authenticatedContext, {
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

    const {item: inbox} = useRynamoItem(initialInbox, {
        isConnected,
        subscribeToEvents: useCallback(
            subscriber => subscribeToEvents(event => subscriber(event.events)),
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
            <Spacer space="2" />
            <Box
                display="flex"
                alignItems="baseline"
                justifyContent="space-between"
                paddingBottom="1.5"
                borderBottom="grey-5"
            >
                <Box fontSize="300" fontStyle="bold" userSelect="text">
                    Integrations
                </Box>
            </Box>
            <SlackNotificationsSection />
        </Box>
    );
}

function DigestNotificationsSection({inbox}: {inbox: RynamoItem<InboxModel>}) {
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
                changeErrorTitle={`Couldn\u2019t ${
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
            await getOrPromptForBrowserPushNotificationPermission();

            // NOTE (rmtobin 12/18/2025): We shouldn't need to re-query permissions and
            // manually update state since we're already using `useSyncExternalStore`, but for
            // some reason Safari does not update the old PermissionStatus object with the new
            // state value when it changes (even though it does fire a change event for it!).
            // So we have to re-query to get a new PermissionStatus instance with the correct
            // state value.
            const newPermissionStatus = await navigator.permissions.query({
                name: "notifications",
            });
            setPermissionStatus(newPermissionStatus);

            if (newPermissionStatus.state !== "granted") {
                setIsSubscribed(false);
                return;
            }

            const subscription = await subscribeToPushNotificationsInBrowser(browserId);

            if (!subscription) {
                throw new FailedPreconditionError(
                    "Couldn\u2019t subscribe to push notifications in browser",
                );
            }
            await registerAccountWebPushSubscriptionAndOptInToSpace(context, {
                browserId,
                subscription,
                spaceId: space.id,
            });
            setIsSubscribed(true);
        } else {
            await optOutOfWebPushForSpace(context, {
                browserId,
                spaceId: space.id,
            });
            setIsSubscribed(false);
        }
    };

    const getDisabledMessage = () => {
        if (!isPushSupported) return " (notifications not supported in browser)";
        if (permissionState === "denied") return " (notifications disabled in browser)";
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
                    isSelected={
                        isSubscribed &&
                        // While permission status is unknown (`permissionState` is null) fully rely on
                        // `isSubscribed` state. That way this switch doesn't animate on when you switch to
                        // the page.
                        (permissionState === null || permissionState === "granted")
                    }
                    changeErrorTitle={`Couldn\u2019t ${
                        isSubscribed ? "disable" : "enable"
                    } push notifications`}
                    onChange={handleToggle}
                    isDisabled={!isPushSupported || permissionState === "denied"}
                >
                    Receive web push notifications{getDisabledMessage()}
                </Switch>
            </Box>
        </Box>
    );
}

function SlackNotificationsSection() {
    const {space} = useSpaceContextAndRequireSpaceAccess();

    return (
        <Link url={`/settings/${space.id}/integrations/slack`} color="inherit" underline={false}>
            <Box
                display="flex"
                flexDirection="row"
                alignItems="center"
                gap="4"
                marginLeft="1.5"
                width="fit-content"
            >
                <Box width="4" height="4" display="flex" borderRadius="full">
                    <SlackLogo style={{width: "100%", height: "100%"}} />
                </Box>
                <Box
                    display="flex"
                    flexDirection="row"
                    gap="0.5"
                    alignItems="center"
                    marginLeft="-0.5"
                >
                    <Box fontSize="100">Configure Slack notifications</Box>
                    <CaretRight size={spacing[4]} />
                </Box>
            </Box>
        </Link>
    );
}
