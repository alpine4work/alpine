import {IconContext} from "phosphor-react";
import {useContext} from "react";
import {
    brandIconSplashColorOpacity,
    brandIconSplashColorShade,
} from "~/client/icons/brand/internal/brand_icon_splash_color.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {ChatBrandBigIcon} from "~/shared/design/core/icons/brand/chat_brand_big_icon.js";
import {DocumentBrandBigIcon} from "~/shared/design/core/icons/brand/document_brand_big_icon.js";
import {PostBrandBigIcon} from "~/shared/design/core/icons/brand/post_brand_big_icon.js";
import {TaskBrandBigIcon} from "~/shared/design/core/icons/brand/task_brand_big_icon.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const brandIconComponentMap = {
    Chat: {Component: ChatBrandBigIcon, splashColor: "red"},
    Document: {Component: DocumentBrandBigIcon, splashColor: "blue"},
    Post: {Component: PostBrandBigIcon, splashColor: "orange"},
    Task: {Component: TaskBrandBigIcon, splashColor: "green"},
} as const;

type ClientBrandBigIconType = keyof typeof brandIconComponentMap;

/**
 * This component wraps our shared `{iconType}BrandBigIcon` components with client-side logic like IconContext
 * and color variables. Prefer using this component over the shared `{iconType}BrandBigIcon` components on the client.
 */
export function ClientBrandBigIcon({
    iconType,
    size,
}: {
    iconType: ClientBrandBigIconType;
    size?: Spacing;
}) {
    const {Component, splashColor} = brandIconComponentMap[iconType];

    const {color: contextColor} = useContext(IconContext);

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

    const actualSize = size ? spacing[size] : spacing["12"];

    return (
        <Component size={actualSize} color={color} splashColorClassName={splashColorClassName} />
    );
}
