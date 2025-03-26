import {useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {getSearchResultTypeDisplay} from "~/client/search/internal/search_result_type_display.js";
import {SearchResultViewTitle} from "~/client/search/internal/search_result_view_title.js";
import {
    minSearchResultViewHeightPx,
    searchResultViewPaddingY,
} from "~/client/styles/search_shared_styles.js";
import {SearchResultId, SearchResultMedia} from "~/shared/search/search_result.js";

// NOCOMMIT: Cleanup search naming hierarchy. Think carefully about taxonomies.
// Between search entity, search result, search affinity, and search command.
export function SearchAffinityView({
    id,
    title,
    media,
    lineClamp,
}: {
    id: SearchResultId;
    title: string | null;
    media: SearchResultMedia | null;
    lineClamp?: number;
}) {
    const spacingScale = useSpacingScale();

    const typeDisplay = useMemo(() => getSearchResultTypeDisplay(id), [id]);

    return (
        <Box
            paddingY={searchResultViewPaddingY}
            style={{
                minHeight: minSearchResultViewHeightPx[spacingScale],
            }}
        >
            <SearchResultViewTitle
                typeDisplay={typeDisplay}
                title={title}
                media={media}
                lineClamp={lineClamp}
            />
        </Box>
    );
}
