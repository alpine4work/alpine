import {Outlet, ShouldRevalidateFunction} from "@remix-run/react";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {useEffect} from "react";
import {Box} from "~/client/design/box.js";
import {ContextMenuManager} from "~/client/design/context_menu.js";
import {attachDevConsoleForAccountInProduction} from "~/client/dev/dev_console.js";
import {PeekStackContextProvider} from "~/client/peek/peek_stack.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {SpaceLayoutTopBar} from "~/client/spaces/layout/space_layout_top_bar.js";
import {SpaceContextProvider} from "~/client/spaces/space_context.js";
import {getInbox} from "~/server/dynamo/notifications_table.js";
import {getSpace} from "~/server/dynamo/spaces_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

export const LoaderSchema = Schema.object({
    space: SpaceModel.schema(),
    currentAccount: AccountModel.schema(),
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

// Run the loader again when the space ID changes.
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
export default function SpaceLayout() {
    const {space, currentAccount, inbox} = useLoaderDataWithSchema(LoaderSchema);

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
                    <SpaceLayoutTopBar space={space} initialInbox={inbox} />
                    <Outlet />
                </PeekStackContextProvider>
            </Box>
        </SpaceContextProvider>
    );
}
