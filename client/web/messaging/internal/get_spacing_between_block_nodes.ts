import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/web/content/has_standalone_margin_by_content_block_node_type_name.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {
    ContentBlockNodeTypeName,
    isContentListItemNodeTypeName,
} from "~/shared/content/content_node_type_name.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export function getSpacingBetweenBlockNodes({
    currentBlockNodeTypeName,
    previousBlockNodeTypeName,
    previousHasReactions,
}: {
    currentBlockNodeTypeName: ContentBlockNodeTypeName;
    previousBlockNodeTypeName: ContentBlockNodeTypeName | null;
    previousHasReactions: boolean;
}): Spacing | null {
    if (previousBlockNodeTypeName) {
        if (previousHasReactions) {
            return contentStyles.standaloneBlockMargin;
        } else if (
            isContentListItemNodeTypeName(currentBlockNodeTypeName) &&
            isContentListItemNodeTypeName(previousBlockNodeTypeName)
        ) {
            return contentStyles.paragraphMargin;
        } else if (
            currentBlockNodeTypeName === "divider" ||
            previousBlockNodeTypeName === "divider"
        ) {
            return contentStyles.messageDividerMargin;
        } else if (
            hasStandaloneMarginByContentBlockNodeTypeName[currentBlockNodeTypeName] ||
            hasStandaloneMarginByContentBlockNodeTypeName[previousBlockNodeTypeName]
        ) {
            return contentStyles.standaloneBlockMargin;
        } else {
            return contentStyles.paragraphMargin;
        }
    }

    return null;
}
