import {Outlet, ShouldReloadFunction} from "@remix-run/react";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {useEffect} from "react";
import {Box} from "~/client/design/box";
import {attachDevConsoleForAccountInProduction} from "~/client/dev/dev_console";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {SpaceContextProvider} from "~/client/spaces/space_context";
import {SpaceLayoutTopBar} from "~/client/spaces/space_layout_top_bar";
import {getSpace} from "~/server/dynamo/spaces_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises";
import {SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {SpaceModel} from "~/shared/models/space_model";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    space: SpaceModel.schema(),
    currentAccount: AccountModel.schema(),
});

export function links(): Array<LinkDescriptor> {
    return [
        // Turn off scrolling on `body` when in a space which comes with a top bar.
        // This prevents over-scrolling up and down when at the top or bottom of a
        // nested scroll view.
        {rel: "stylesheet", href: `data:text/css,${encodeURIComponent("body {overflow: hidden}")}`},
    ];
}

// Run the loader again when the space ID changes.
export const unstable_shouldReload: ShouldReloadFunction = ({url, prevUrl}) =>
    url.pathname.split("/")[1] !== prevUrl.pathname.split("/")[1];

export async function loader({context, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);

    const [currentAccount, space] = await runAllPromiseThunks(
        async () => {
            const authenticatedContext = await context.auth.authenticate();
            return authenticatedContext.auth.getAccount();
        },
        async () => {
            const sessionCookie = await context.loader.getSessionCookie();
            return getSpace(context, spaceId, sessionCookie.get().sessionAccountId);
        },
    );

    const propagateEventData: TracerEventData = {
        context: {
            accountId: currentAccount.id,
            spaceId: space.id,
        },
    };

    return jsonWithSchema(LoaderSchema, {space, currentAccount}, {propagateEventData});
}

/**
 * Routes that render under `/s/$space_id` should generally render
 * `<SpaceRouteScrollView>` as their parent since it contains best practices for
 * a space route's content area. Ideally we would make it the default but some
 * routes need to opt-out and manage scrolling on their own
 * (e.g. virtualized lists).
 */
export default function SpaceLayout() {
    const {space, currentAccount} = useLoaderDataWithSchema(LoaderSchema);

    useEffect(() => {
        attachDevConsoleForAccountInProduction(currentAccount);
    }, [currentAccount]);

    return (
        <SpaceContextProvider
            // Re-render everything when the space changes.
            key={space.id}
            spaceId={space.id}
            currentAccount={currentAccount}
        >
            <Box
                display="flex"
                flexDirection="column"
                height="full"
                overflow="hidden"
                position="relative"
                zIndex="0"
            >
                <SpaceLayoutTopBar space={space} />
                <Outlet />
            </Box>
        </SpaceContextProvider>
    );
}
