import {memo} from "react";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {Color} from "~/shared/design/core/colors.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {LogoWordmarkBase} from "~/shared/design/logo_wordmark_base.js";

const LogoWordmarkMemo = memo(LogoWordmark);
export {LogoWordmarkMemo as LogoWordmark};

function LogoWordmark({size, color}: {size?: Spacing; color?: Color | `#${string}`}) {
    const finalColor = color?.startsWith("#")
        ? color
        : colorSchemeVars[(color as Color | undefined) ?? "grey-90"];

    return <LogoWordmarkBase size={size} color={finalColor} />;
}
