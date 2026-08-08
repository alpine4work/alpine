import {DiscoveryContextModule} from "~/server/context/discovery_context_module.js";
import {Context} from "~/shared/context/context.js";
import {createAggregateError} from "~/shared/error/aggregate_error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function loadWithSpaceDiscovery<Data1, Data2>(
    context: Context<{discovery: DiscoveryContextModule}>,
    {
        load1,
        load2,
    }: {
        load1: () => Promise<Data1>;
        load2: (options: {spaceId: SpaceId}) => Promise<Data2>;
    },
): Promise<{
    data1: Data1;
    data2: Data2 | undefined;
}> {
    let data2Promise: Promise<Data2> | null = null;

    const handleDiscoveredSpaceId = (spaceId: SpaceId) => {
        context.discovery.removeDiscoverSpaceIdListener(handleDiscoveredSpaceId);
        assert(data2Promise === null);
        data2Promise = load2({spaceId});
    };

    const alreadyDiscoveredSpaceId = context.discovery.getDiscoveredSpaceId();

    try {
        const data1Promise = load1();

        if (alreadyDiscoveredSpaceId === null) {
            context.discovery.addDiscoverSpaceIdListener(handleDiscoveredSpaceId);
        } else {
            handleDiscoveredSpaceId(alreadyDiscoveredSpaceId);
        }

        const data1 = await data1Promise;
        context.discovery.removeDiscoverSpaceIdListener(handleDiscoveredSpaceId);

        // TypeScript is dumb and doesn't realize `handleDiscoveredSpaceId()` may run
        // during `load1()`.
        data2Promise = data2Promise as any;

        if (data2Promise === null) {
            return {data1, data2: undefined};
        }

        const data2 = await data2Promise;
        return {data1, data2};
    } catch (error1) {
        context.discovery.removeDiscoverSpaceIdListener(handleDiscoveredSpaceId);

        // If `load1()` throws and we're still waiting on `load2()` then wait for `load2()`
        // to finish before throwing. If both `load1()` and `load2()` throw, then throw an
        // aggregate error.
        if (data2Promise !== null) {
            try {
                await data2Promise;
            } catch (error2) {
                throw createAggregateError([error1, error2]);
            }
        }

        throw error1;
    }
}
