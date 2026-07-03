import {loadWithSpaceDiscovery} from "~/app/helpers/load_with_space_discovery.js";
import {DiscoveryContextModule} from "~/server/context/discovery_context_module.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {getSite} from "~/server/sites/data/get_site.js";
import {Context} from "~/shared/context/context.js";
import {RynamoQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {SiteLoaderData} from "~/shared/remix/site_loader_data.js";
import {SiteItemSearchEntityId} from "~/shared/search/site_item_search_entity_id.js";
import {SiteOrSiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

export async function loadWithSpaceAndSiteDiscovery<Data1, Data2>(
    context: Context<ServerActionContextModules & {discovery: DiscoveryContextModule}>,
    {
        request,
        entityId,
        load1,
        load2,
        fetchSite = siteId => getSite(context, {siteId}),
    }: {
        request: Request;
        entityId: SiteItemSearchEntityId;
        load1: (options: {onSiteId: (siteId: SiteId) => void}) => Promise<Data1>;
        load2: (options: {spaceId: SpaceId}) => Promise<Data2>;
        fetchSite?: (siteId: SiteId) => Promise<RynamoQueryResult<SiteOrSiteEntryModel> | null>;
    },
): Promise<{
    data1: Data1;
    data2: Data2 | undefined;
    siteLoaderData: SiteLoaderData | undefined;
}> {
    let isFinished = false;
    let siteLoaderDataPromise: Promise<SiteLoaderData | null> | null = null;

    const spaceIdPromiseResolver = createPromiseResolver<SpaceId>();

    const onSiteId = (siteId: SiteId) => {
        if (isFinished) return;
        isFinished = true;

        assert(siteLoaderDataPromise === null);

        siteLoaderDataPromise = (async (): Promise<SiteLoaderData | null> => {
            const activeSiteId = request.headers.get("cyberworlds-active-site-id")?.trim();

            if (activeSiteId === siteId) {
                return {
                    type: "UseActiveSite",
                    siteId,
                    activeEntityId: entityId,
                };
            }

            const sitePromise = fetchSite(siteId);

            const [initialQueryResult, isFavorite] = await runAllPromises([
                sitePromise,
                Promise.race([
                    spaceIdPromiseResolver.promise,
                    sitePromise.then(site => {
                        if (site === null) return null;

                        const spaceId = assertExists(
                            findMapIterable(site.items, item =>
                                item.model instanceof SitePreviewModel
                                    ? // Runs on the server so this is fine.
                                      // eslint-disable-next-line cyberworlds/no-model-initial-data
                                      item.model.initialData.spaceId
                                    : undefined,
                            ),
                        );

                        return spaceId;
                    }),
                ]).then(spaceId => {
                    if (spaceId === null) return null;
                    return isSearchFavoriteEntity(context, {
                        spaceId,
                        entityId: `Site:${siteId}`,
                    });
                }),
            ]);

            if (initialQueryResult === null) return null;

            return {
                type: "UseNewSite",
                siteId,
                initialQueryResult,
                activeEntityId: entityId,
                // If we loaded a site, we must have loaded its favorite status.
                isFavorite: assertExists(isFavorite),
            };
        })();
    };

    try {
        const {data1, data2} = await loadWithSpaceDiscovery(context, {
            load1: () => load1({onSiteId}),
            load2: ({spaceId}) => {
                spaceIdPromiseResolver.resolve(spaceId);
                return load2({spaceId});
            },
        });
        isFinished = true;

        // TypeScript is dumb and doesn't realize `onSiteId()` may run during
        // `loadWithSpaceDiscovery()`.
        siteLoaderDataPromise = siteLoaderDataPromise as any;

        if (siteLoaderDataPromise === null) {
            return {data1, data2, siteLoaderData: undefined};
        }

        const siteLoaderData = await siteLoaderDataPromise;

        return {data1, data2, siteLoaderData: siteLoaderData ?? undefined};
    } catch (error1) {
        isFinished = true;

        // If `loadWithSpaceDiscovery()` throws and we're still waiting on
        // `siteLoaderDataPromise` then wait for `siteLoaderDataPromise` to finish before
        // throwing. If both `loadWithSpaceDiscovery()` and `siteLoaderDataPromise` throw,
        // then throw an aggregate error.
        if (siteLoaderDataPromise !== null) {
            try {
                await siteLoaderDataPromise;
            } catch (error2) {
                throw createAggregateError([error1, error2]);
            }
        }

        throw error1;
    }
}
