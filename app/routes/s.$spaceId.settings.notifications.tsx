import {useCallback, useEffect, useState} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Switch} from "~/client/web/design/switch.js";
import {useDynamoGeneralRealtimeItem} from "~/client/web/dynamo/use_dynamo_general_realtime_item.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {
    useMyAccountWebSocket,
    useSpaceContextAndRequireSpaceAccess,
} from "~/client/web/spaces/space_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {
    getInboxWithStrongReadConsistency,
    subscribeToDigestNotificationsEmail,
    unsubscribeFromDigestNotificationsEmail,
} from "~/shared/rpc/notifications_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()),
});

export async function loader({context, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const {inbox} = await getInboxWithStrongReadConsistency(await context.actor.authenticate(), {
        spaceId,
    });

    return jsonWithSchema(LoaderSchema, {inbox});
}

export default function SpaceNotificationSettingsRoute() {
    const context = useAppContext();

    const {inbox: initialInbox} = useLoaderDataWithSchema(LoaderSchema);
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();
    const {currentAccount, space} = useSpaceContextAndRequireSpaceAccess();

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

    const [isSubscribed, setIsSubscribed] = useState(
        inbox.model.digestNotificationsOptedOutTime === null,
    );

    useEffect(() => {
        setIsSubscribed(inbox.model.digestNotificationsOptedOutTime === null);
    }, [inbox.model.digestNotificationsOptedOutTime]);

    return (
        <>
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
        </>
    );
}
