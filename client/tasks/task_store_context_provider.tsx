import {ReactNode, useContext} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {taskStoreDataKey} from "~/shared/remix/json_with_schema_shared.js";
import {TaskStoreLoaderDataSchema} from "~/shared/remix/task_store_loader_data.js";

/**
 * The task store lives at the space route (`/s/:spaceId`) so the task store is
 * available to any UI that needs it in the space.
 */
export function TaskStoreContextProvider({children}: {children: ReactNode}) {
    const dataRouterStateContext = useContext(DataRouterStateContext);
    assert(dataRouterStateContext, "Expected data router state context");

    const loaderData = filterMapArray(
        Object.values(dataRouterStateContext.loaderData),
        loaderData => {
            if (!loaderData) return null;
            if (!hasOwnProperty(loaderData, taskStoreDataKey)) return null;

            return getLoaderDataWithSchema(
                TaskStoreLoaderDataSchema,
                loaderData[taskStoreDataKey] as any,
            );
        },
    );

    console.log(loaderData);

    return <>{children}</>;
}
