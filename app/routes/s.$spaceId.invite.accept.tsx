import {redirect} from "@remix-run/node";
import {useEffect, useRef} from "react";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {FeedRouteShimmer} from "~/client/web/shimmer/route_shimmer.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getOwnAccountIfExists} from "~/server/spaces/spaces_actions.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {acceptSpaceAccountInvite} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? "");
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const currentAccount = await getOwnAccountIfExists(
        context,
        spaceId,
        context.actor.getAccountId(),
    );

    if (!currentAccount) {
        throw new PermissionDeniedError("Account isn’t invited to the space");
    }

    if (currentAccount.initialData.space.state.type !== "InvitePending") {
        return redirect(`/s/${spaceId}`);
    }

    return jsonWithSchema(LoaderSchema, {});
}

// We mimic the home page loading state here to optimistically render the
// feed view.
export const meta = createMetaFunction(LoaderSchema, ({getParentData}) => {
    const spaceRouteData = getParentData("routes/s.$spaceId", SpaceRouteLoaderSchema);

    return [{title: spaceRouteData?.space.name ?? "Home"}];
});

export default function InviteAcceptRoute() {
    const navigate = useNavigate();
    const appContext = useAppContext();
    const context = useSpaceContext();

    const hasInitiallyMountedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        void (async () => {
            await acceptSpaceAccountInvite(appContext, {
                spaceId: context.space.id,
            });

            // We use from=invite to tell remix to revalidate our space loader data
            // This will re-evalutate permissions and let the user immediately click on resources
            navigate(`/s/${context.space.id}?from=invite`);
        })();
    }, [appContext, context.space.id, navigate]);

    return <FeedRouteShimmer />;
}
