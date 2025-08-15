import {redirect} from "@remix-run/node";
import {useEffect} from "react";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {useAppContext} from "~/client/context/app_context.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {FeedRouteShimmer} from "~/client/shimmer/route_shimmer.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {acceptSpaceAccountInvite} from "~/shared/rpc/spaces_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";

const LoaderSchema = Schema.object({});

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? "");
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    if (context.actor.type !== "Session") {
        throw new PermissionDeniedError("Can’t load the invite page with a non-Session account");
    }

    const currentAccountResult = assertExists(
        await getAccountIfExists(context, spaceId, context.actor.getAccountId(), {
            disableOwnAccountAccessCheck: true,
        }),
    );

    if (currentAccountResult.initialData.space.state.type !== "InvitePending") {
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

    useEffect(() => {
        void (async () => {
            await acceptSpaceAccountInvite(appContext, {
                spaceId: context.space.id,
            });

            // TODO(imjoshin, #permissions-stale-on-navigate): https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/h6q3njtjbdmwwz13w1es8sbavw
            // hard set the URL to the space index after accepting the invite
            // to avoid any issues with auth state updates.
            window.location.href = `/s/${context.space.id}`;
        })();
    }, [appContext, context.space.id, navigate]);

    return <FeedRouteShimmer />;
}
