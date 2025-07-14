import {memo, useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useSearchEntityModel} from "~/client/search/core/search_entity_registry_context.js";
import {getSearchEntityTypeDisplay} from "~/client/search/core/search_entity_type_display.js";
import {SearchEntityViewTitle} from "~/client/search/core/search_entity_view_title.js";
import {
    searchAffinityEntityViewMinHeightPx,
    searchEntityViewPaddingY,
} from "~/client/styles/search_shared_styles.js";
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
    const typeDisplay = useMemo(() => getSearchEntityTypeDisplay(result.id), [result.id]);

    return (
        <Box
            paddingY={searchEntityViewPaddingY}
            style={{
                height:
                    lineClamp === 1 ? searchAffinityEntityViewMinHeightPx[spacingScale] : undefined,
                minHeight:
                    lineClamp !== 1 ? searchAffinityEntityViewMinHeightPx[spacingScale] : undefined,
            }}
        >
            <SearchEntityViewTitle
                typeDisplay={typeDisplay}
                entityData={entityData}
                lineClamp={lineClamp}
            />
        </Box>
    );
}
