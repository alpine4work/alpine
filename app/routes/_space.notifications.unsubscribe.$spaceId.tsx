import {SpinnerGap} from "phosphor-react";
import {useEffect, useMemo, useRef, useState} from "react";
import {BlobsArt} from "~/client/web/blobs/blobs_art.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {useInitialAppRenderId} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useErrorState} from "~/client/web/helpers/use_error_state.js";
import {LogoWordmark} from "~/client/web/icons/brand/logo_wordmark.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {spinAnimationClassName} from "~/client/web/styles/styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {unsubscribeFromEmailNotificationWithUrl} from "~/shared/rpc/notifications_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({
    url: Schema.string,
});

export async function loader({request}: LoaderArgs) {
    return jsonWithSchema(LoaderSchema, {
        url: request.url,
    });
}

export default function NotificationsUnsubscribeRoute() {
    const {url} = useLoaderDataWithSchema(LoaderSchema);

    const appContext = useAppContext();
    const setErrorState = useErrorState();
    const hasInitiallyMountedRef = useRef(false);
    const context = useSpaceContext();

    // This is an unauthenticated (but presigned) route. Unless we're logged in, we
    // won't have the actual theme color here - just the default.
    const themeColor = context.space.themeColor;

    const [unsubscribeComplete, setUnsubscribeComplete] = useState(false);

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        void (async () => {
            try {
                await unsubscribeFromEmailNotificationWithUrl(appContext, {
                    signedUrl: url,
                });
                setUnsubscribeComplete(true);
            } catch (error) {
                setErrorState(error);
            }
        })();
    }, [appContext, setErrorState, url]);

    const initialAppRenderId = useInitialAppRenderId();
    const [idForGeneration] = useState(initialAppRenderId ?? generateId());
    const blobsSettings = useMemo(() => {
        return {
            seed: idForGeneration.replaceAll(/[^a-zA-Z0-9]/g, ""),
            hueSpread: 10,
            themeColor,
        };
    }, [idForGeneration, themeColor]);

    return (
        <Box width="full" paddingY="safe-area-inset">
            <BlobsArt settings={blobsSettings} />
            <Box
                height="full"
                display="flex"
                justifyContent="center"
                alignItems="center"
                flexDirection="column"
            >
                <Box
                    display="flex"
                    flexDirection="column"
                    gap="8"
                    width="full"
                    maxWidth="128"
                    textAlign="center"
                    alignItems="center"
                    paddingX={screenPaddingX}
                >
                    {unsubscribeComplete ? (
                        <>
                            <LogoWordmark size="32" />
                            <Box>
                                You&#x2019;ve been unsubscribed from email notification updates for
                                this space.
                            </Box>
                            <Box>You may now leave this window.</Box>
                        </>
                    ) : (
                        <Box display="flex" alignItems="center" gap="2">
                            <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                            Unsubscribing…
                        </Box>
                    )}
                </Box>
            </Box>
        </Box>
    );
}
