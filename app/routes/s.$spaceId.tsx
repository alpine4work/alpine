import {Outlet, ShouldRevalidateFunction} from "@remix-run/react";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {useContext, useEffect, useMemo} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext, useRouteError} from "react-router";
import {Box} from "~/client/design/box.js";
import {ContextMenuManager} from "~/client/design/context_menu.js";
import {attachDevConsoleForAccountInProduction} from "~/client/dev/dev_console.js";
import {PeekStackContextProvider} from "~/client/peek/peek_stack.js";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {SpaceLayoutTopBar} from "~/client/spaces/layout/space_layout_top_bar.js";
import {SpaceContextProvider} from "~/client/spaces/space_context.js";
import {SpaceRouteErrorRenderer} from "~/client/spaces/space_route_error_renderer.js";
import {TaskRealtimeClientContextProvider} from "~/client/tasks/task_realtime_client_context_provider.js";
import {getInbox} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getSpace} from "~/server/spaces/spaces_table.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

export const LoaderSchema = Schema.object({
    space: SpaceModel.schema(),
    currentAccount: AccountModel.schema,
    inbox: createDynamoGeneralRealtimeItemSchema(InboxModel.schema()),
});

export function links(): Array<LinkDescriptor> {
    return [
        // Turn off scrolling on `body` when in a space which comes with a top bar.
        // This prevents over-scrolling up and down when at the top or bottom of a
        // nested scroll view.
        {rel: "stylesheet", href: `data:text/css,${encodeURIComponent("body {overflow: hidden}")}`},
    ];
}

// Run the loader again only when the `SpaceId` changes.
export const shouldRevalidate: ShouldRevalidateFunction = ({currentParams, nextParams}) =>
    currentParams.spaceId !== nextParams.spaceId;

export async function loader({context: loaderContext, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);

    const context = (await loaderContext.actor.authenticate()).actor.authorizeSession();

    const [space, currentAccount, inbox] = await runAllPromises([
        getSpace(context, spaceId),
        context.actor.getAccount(),
        getInbox(context, {spaceId}),
    ]);

    const propagateEventData: TracerEventData = {
        context: {
            accountId: currentAccount.id,
            spaceId: space.id,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {
            space,
            currentAccount,
            inbox,
        },
        {propagateEventData},
    );
}

/**
 * Routes that render under `/s/$spaceId` should generally render
 * `<SpaceRouteScrollView>` as their parent since it contains best practices for
 * a space route's content area. Ideally we would make it the default but some
 * routes need to opt-out and manage scrolling on their own
 * (e.g. virtualized lists).
 */
export default function SpaceLayoutRoute() {
    const dataRouterStateContext = assertExists(useContext(DataRouterStateContext));

    const rawLoaderData = dataRouterStateContext.loaderData["routes/s.$spaceId"];

    // `useLoaderData()` doesn't work in an error boundary. We use this exact
    // component for error and catch boundaries to avoid remounting when navigating
    // between errors and non-errors. So manually deserialize the data for this
    // route.
    const loaderData = useMemo(
        () => (rawLoaderData ? getLoaderDataWithSchema(LoaderSchema, rawLoaderData) : null),
        [rawLoaderData],
    );

    const error = useRouteError();

    // If it's our `/s/:spaceId` route throwing then we won't be able to render the
    // state chrome so let a parent error boundary handle it.
    if (!loaderData) throw error;

    const {space, currentAccount, inbox} = loaderData;

    useEffect(() => {
        attachDevConsoleForAccountInProduction(currentAccount);
    }, [currentAccount]);

    return (
        <SpaceContextProvider
            // Re-render everything when the space changes.
            key={space.id}
            space={space}
            currentAccount={currentAccount}
        >
            <ContextMenuManager />
            <Box
                display="flex"
                flexDirection="column"
                height="full"
                overflow="hidden"
                position="relative"
                zIndex="0"
            >
                <PeekStackContextProvider>
                    <TaskRealtimeClientContextProvider spaceId={space.id}>
                        <SpaceLayoutTopBar space={space} initialInbox={inbox} />
                        {error !== undefined ? (
                            <SpaceRouteErrorRenderer error={error} />
                        ) : (
                            <Outlet />
                        )}
                    </TaskRealtimeClientContextProvider>
                </PeekStackContextProvider>
            </Box>
        </SpaceContextProvider>
    );
}

// We use the same component for the error boundary so we don't remount the
// space context and top bar if an error in a child component occurs.
//
// Making sure there's no remount on error requires careful patching to Remix
// and React Router.
export const ErrorBoundary = SpaceLayoutRoute;
