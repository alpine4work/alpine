import {Outlet, ShouldReloadFunction} from "@remix-run/react";
import {useEffect} from "react";
import {attachDevConsoleForAccountInProduction} from "~/client/dev/dev_console";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {SpaceContextProvider} from "~/client/spaces/space_context";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {runAllPromises, runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises";
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

    const [currentAccount] = await runAllPromiseThunks(
        async () => {
            const authenticatedContext = await context.auth.authenticate();
            return authenticatedContext.auth.getAccount();
        },
        async () => {
            const sessionCookie = await context.loader.getSessionCookie();
            await authorizeSpaceAccess(context, spaceId, sessionCookie.get().sessionAccountId);
        },
    );

    const propagateEventData: TracerEventData = {
        context: {
            accountId: currentAccount.id,
            spaceId,
        },
    };

    return jsonWithSchema(LoaderSchema, {currentAccount}, {propagateEventData});
}

export default function SpaceLayout() {
    const {currentAccount} = useLoaderDataWithSchema(LoaderSchema);

    useEffect(() => {
        attachDevConsoleForAccountInProduction(currentAccount);
    }, [currentAccount]);

    return (
        <SpaceContextProvider currentAccount={currentAccount}>
            <Outlet />
        </SpaceContextProvider>
    );
}
