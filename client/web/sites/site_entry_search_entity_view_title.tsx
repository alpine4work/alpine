import {useSearchEntityModel} from "~/client/web/search/core/search_entity_registry_context.js";
import {SearchEntityViewTitle} from "~/client/web/search/core/search_entity_view_title.js";
import {SiteEntityModel} from "~/shared/sites/site_model.js";

export function SiteEntrySearchEntityViewTitle({entry}: {entry: SiteEntityModel}) {
    const entityData = useSearchEntityModel(entry.entity);

    return <SearchEntityViewTitle entityData={entityData} />;
}
