import {redirect} from "@remix-run/node";
import {loadRouteModuleWithBlockingLinks} from "@remix-run/react";
import {useEffect, useRef} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {FeedRouteShimmer} from "~/client/web/shimmer/route_shimmer.js";
import {spaceLayoutStyles} from "~/client/web/styles/styles.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getOwnAccountIfExists} from "~/server/spaces/get_own_account_if_exists.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {acceptSpaceAccountInvite} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

const LoaderSchema = Schema.object({
    space: SpaceModel.schema(),
});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const [currentAccount, space] = await runAllPromises([
        getOwnAccountIfExists(
            context,
            spaceId,
            context.actor.getAccountId(),
            // Use strong consistency in case we're coming from sign up or some other flow
            // which just updated our account state.
            {consistency: "StrongWithinCache"},
        ),
        getSpace(context, spaceId, {
            consistency: "StrongWithinCache",
            allowInvitePending: true,
        }),
    ]);

    if (!currentAccount) {
        throw new PermissionDeniedError("Account isn\u2019t invited to the space");
    }

    if (currentAccount.initialData.space.state.type !== "InvitePending") {
        return redirect(`/home/${spaceId}`);
    }

    return jsonWithSchema(LoaderSchema, {space});
}

// We mimic the home page loading state here to optimistically render the feed
// view.
export const meta = createMetaFunction(LoaderSchema, ({data: {space}}) => [{title: space.name}]);

export default function InviteAcceptRoute() {
    const navigate = useNavigate();
    const appContext = useAppContext();
    const platform = usePlatform();
    const {space} = useLoaderDataWithSchema(LoaderSchema);

    const hasInitiallyMountedRef = useRef(false);
    const hasSpaceLayoutSideBar = platform !== "mobile";

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        // Optimization: Preload the `home.$spaceId` route so that redirecting to the space
        // at the end of sign in or sign up isn't blocked by loading a bunch of JavaScript
        // code.
        runPromiseWithoutAwaiting(
            loadRouteModuleWithBlockingLinks(
                window.__remixManifest.routes["routes/_space.home.$spaceId._index"]!,
                window.__remixRouteModules,
            ),
        );

        runPromiseWithoutAwaiting(async () => {
            await acceptSpaceAccountInvite(appContext, {
                spaceId: space.id,
            });

            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get("redirect") !== "no") {
                await navigate(`/home/${space.id}`);
            }
        });
    }, [appContext, navigate, space.id]);

    return (
        <Box
            width="full"
            height="full"
            overflow="hidden"
            backgroundColor={
                hasSpaceLayoutSideBar ? {light: "grey-1", dark: "grey-100-lowered"} : undefined
            }
            display="flex"
            flexDirection="row"
        >
            {hasSpaceLayoutSideBar && (
                <Box flexShrink="0" style={{width: spaceLayoutStyles.sideBarWidth}} />
            )}
            <Box
                flexGrow="1"
                overflow="hidden"
                marginTop={hasSpaceLayoutSideBar ? "2" : undefined}
                marginBottom={hasSpaceLayoutSideBar ? "2" : undefined}
                marginRight={hasSpaceLayoutSideBar ? "2" : undefined}
                backgroundColor="grey-0"
                borderRadius={hasSpaceLayoutSideBar ? "1.5" : undefined}
                boxShadow={hasSpaceLayoutSideBar ? "elevation-5" : undefined}
            >
                <FeedRouteShimmer />
            </Box>
        </Box>
    );
}
