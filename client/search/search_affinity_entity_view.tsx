import {memo, useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {getSearchEntityTypeDisplay} from "~/client/search/internal/search_entity_type_display.js";
import {SearchEntityViewTitle} from "~/client/search/internal/search_entity_view_title.js";
import {
    searchAffinityEntityViewMinHeightPx,
    searchEntityViewPaddingY,
} from "~/client/styles/search_shared_styles.js";
import {SearchAffinityEntityResult} from "~/shared/search/search_affinity_entity_result.js";

const SearchAffinityEntityViewMemo = memo(SearchAffinityEntityView);
export {SearchAffinityEntityViewMemo as SearchAffinityEntityView};

function SearchAffinityEntityView({
    result,
    lineClamp,
}: {
    result: SearchAffinityEntityResult;
    lineClamp?: number;
}) {
    const spacingScale = useSpacingScale();

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
                icon={typeDisplay.icon}
                title={result.title}
                media={result.media}
                lineClamp={lineClamp}
            />
        </Box>
    );
}
