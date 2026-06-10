import {memo} from "react";
import {Box} from "~/client/web/design/box.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useSearchEntityModel} from "~/client/web/search/core/search_entity_registry_context.js";
import {SearchEntityViewTitle} from "~/client/web/search/core/search_entity_view_title.js";
import {
    searchAffinityEntityViewMinHeightPx,
    searchEntityViewPaddingY,
} from "~/client/web/styles/search_shared_styles.js";
import {SearchAffinityEntityResultModel} from "~/shared/search/search_entity_result_model.js";

const SearchAffinityEntityViewMemo = memo(SearchAffinityEntityView);
export {SearchAffinityEntityViewMemo as SearchAffinityEntityView};

function SearchAffinityEntityView({
    result,
    lineClamp,
}: {
    result: SearchAffinityEntityResultModel;
    lineClamp?: number;
}) {
    const spacingScale = useSpacingScale();

    const entityData = useSearchEntityModel(result.model);

    return (
        <Box
            data-testid="SearchAffinityEntityView"
            paddingY={searchEntityViewPaddingY}
            style={{
                height:
                    lineClamp === 1 ? searchAffinityEntityViewMinHeightPx[spacingScale] : undefined,
                minHeight:
                    lineClamp !== 1 ? searchAffinityEntityViewMinHeightPx[spacingScale] : undefined,
            }}
        >
            <SearchEntityViewTitle entityData={entityData} lineClamp={lineClamp} />
        </Box>
    );
}
