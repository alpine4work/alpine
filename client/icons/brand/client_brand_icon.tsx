import {IconContext} from "phosphor-react";
import {useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {ChannelBrandIcon} from "~/shared/design/core/icons/brand/channel_brand_icon.js";
import {ChatBrandIcon} from "~/shared/design/core/icons/brand/chat_brand_icon.js";
import {DocumentBrandIcon} from "~/shared/design/core/icons/brand/document_brand_icon.js";
import {DocumentCommentBrandIcon} from "~/shared/design/core/icons/brand/document_comment_brand_icon.js";
import {PostBrandIcon} from "~/shared/design/core/icons/brand/post_brand_icon.js";
import {PostCommentBrandIcon} from "~/shared/design/core/icons/brand/post_comment_brand_icon.js";
import {SearchFavoritesBrandIcon} from "~/shared/design/core/icons/brand/search_favorites_brand_icon.js";
import {TaskBrandIcon} from "~/shared/design/core/icons/brand/task_brand_icon.js";
import {TaskCollectionBrandIcon} from "~/shared/design/core/icons/brand/task_collection_brand_icon.js";
import {TaskCommentBrandIcon} from "~/shared/design/core/icons/brand/task_comment_brand_icon.js";
import {TaskQueryBrandIcon} from "~/shared/design/core/icons/brand/task_query_brand_icon.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const brandIconComponentMap = {
    Channel: {Component: ChannelBrandIcon, splashColor: "orange"},
    Chat: {Component: ChatBrandIcon, splashColor: "red"},
    Document: {Component: DocumentBrandIcon, splashColor: "blue"},
    DocumentComment: {Component: DocumentCommentBrandIcon, splashColor: "blue"},
    Post: {Component: PostBrandIcon, splashColor: "orange"},
    PostComment: {Component: PostCommentBrandIcon, splashColor: "orange"},
    SearchFavorites: {Component: SearchFavoritesBrandIcon, splashColor: "orange"},
    Task: {Component: TaskBrandIcon, splashColor: "green"},
    TaskCollection: {Component: TaskCollectionBrandIcon, splashColor: "green"},
    TaskComment: {Component: TaskCommentBrandIcon, splashColor: "green"},
    TaskQuery: {Component: TaskQueryBrandIcon, splashColor: "green"},
} as const;

type ClientBrandIconType = keyof typeof brandIconComponentMap;

/**
 * This component wraps our shared `{iconType}BrandIcon` components with client-side logic like IconContext
 * and color variables. Prefer using this component over the shared `{iconType}BrandIcon` components on the client.
 */
export function ClientBrandIcon({iconType, size}: {iconType: ClientBrandIconType; size?: Spacing}) {
    const {Component, splashColor} = brandIconComponentMap[iconType];

    const {size: contextSize, color: contextColor} = useContext(IconContext);

    const color =
        contextColor === colorSchemeVars["grey-90"] || contextColor === colorSchemeVars["grey-100"]
            ? contextColor
            : colorSchemeVars[contentStyles.brandIconDefaultColor];

    const splashColorClassName = sprinkles({
        fill: mapObjectValues(
            brandIconSplashColorShade,
            shade => `${splashColor}-${shade}` as const,
        ),
        opacity: brandIconSplashColorOpacity,
    });

    const actualSize = size ? spacing[size] : contextSize ?? spacing["5"];

    return (
        <Component size={actualSize} color={color} splashColorClassName={splashColorClassName} />
    );
}
