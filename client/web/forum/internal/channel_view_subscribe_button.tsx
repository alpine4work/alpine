import {Bell, BellRinging} from "phosphor-react";
import {useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Button} from "~/client/web/design/button.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {postFauxInputCreateButtonInnerButtonHeight} from "~/client/web/styles/forum_shared_styles.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {subscribeToChannel, unsubscribeFromChannel} from "~/shared/rpc/forum_rpc_definitions.js";

export function ChannelViewSubscribeButton({
    channelId,
    initialIsSubscribed,
}: {
    channelId: ChannelId;
    initialIsSubscribed: boolean;
}) {
    const context = useAppContext();

    const [isSubscribed, setIsSubscribed] = useState(initialIsSubscribed);

    return (
        <Tooltip placement="bottom-end" content="Get notified about new posts">
            <Button
                variant={isSubscribed ? "neutral-disabled" : "neutral"}
                icon={isSubscribed ? <BellRinging /> : <Bell />}
                // Consistent height with the post faux create input.
                height={postFauxInputCreateButtonInnerButtonHeight}
                paddingX="2.5"
                pressErrorTitle={
                    !isSubscribed
                        ? "Couldn\u2019t subscribe to channel"
                        : "Couldn\u2019t unsubscribe from channel"
                }
                onPress={async () => {
                    if (isSubscribed) {
                        // Optimistically update our `isSubscribed` state so the UI changes at the same
                        // time as `isPressed` becomes false. If the RPC fails then we revert the change.
                        setIsSubscribed(false);

                        try {
                            await unsubscribeFromChannel(context, {channelId});
                        } catch (error) {
                            setIsSubscribed(isSubscribed);
                            throw error;
                        }
                    } else {
                        // Optimistically update our `isSubscribed` state so the UI changes at the same
                        // time as `isPressed` becomes false. If the RPC fails then we revert the change.
                        setIsSubscribed(true);

                        try {
                            await subscribeToChannel(context, {channelId});
                        } catch (error) {
                            setIsSubscribed(isSubscribed);
                            throw error;
                        }
                    }
                }}
            >
                {isSubscribed ? "Subscribed" : "Subscribe"}
            </Button>
        </Tooltip>
    );
}
