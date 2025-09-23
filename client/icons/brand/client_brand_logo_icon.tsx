import {colorSchemeVars} from "~/client/styles/styles.js";
import {Color} from "~/shared/design/core/colors.js";
import {BrandLogoIcon} from "~/shared/design/core/icons/brand/brand_logo_icon.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export function ClientBrandLogoIcon({size, color}: {size?: Spacing; color?: Color}) {
    const finalColor = colorSchemeVars[color || "grey-90"];
    return <BrandLogoIcon size={size} color={finalColor} />;
}
