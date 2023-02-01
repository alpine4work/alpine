import {Outlet, ShouldReloadFunction} from "@remix-run/react";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {SpaceContextProvider} from "~/client/spaces/space_context";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    currentAccount: AccountModel.schema(),
});

// Run the loader again when the space ID changes.
export const unstable_shouldReload: ShouldReloadFunction = ({url, prevUrl}) =>
    url.pathname.split("/")[1] !== prevUrl.pathname.split("/")[1];

export async function loader({context, params}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);
    const authenticatedContext = await context.auth.authenticate();

    const [currentAccount] = await runAllPromises([
        authenticatedContext.auth.getAccount(),
        authorizeSpaceAccess(authenticatedContext, spaceId),
    ]);

    const propagateEventData: TracerEventData = {
        context: {
            accountId: currentAccount.id,
            spaceId,
        },
    };

    return jsonWithSchema(LoaderSchema, {currentAccount}, {propagateEventData});
}

export default function InternalLayout() {
    const {currentAccount} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <SpaceContextProvider currentAccount={currentAccount}>
            <Outlet />
        </SpaceContextProvider>
    );
}
