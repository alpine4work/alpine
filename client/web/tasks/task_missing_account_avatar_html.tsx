import {User} from "phosphor-react";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {userIconSvg} from "~/client/web/icons/user_icon_svg.js";
import {inputPlaceholderStyles, sprinkles} from "~/client/web/styles/styles.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {HtmlElementGenerator, HtmlGenerator} from "~/shared/helpers/html/html_generator.js";

// Hardcode Phosphor User icon SVG since we don't want to mount a React root
// when we need to render the icon outside of React.
//
// We import the component anyway, though, so that if we're ever refactoring
// our icon usage we can find this hardcoded string.
//
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
User;

export const taskMissingAccountAvatarClassName = sprinkles({
    flexShrink: "0",
    position: "relative",
    borderRadius: "full",
});

export const taskMissingAccountAvatarIconContainerClassName = sprinkles({
    position: "absolute",
    inset: "0",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    color: "grey-30",
});

/**
 * Renders a task missing account avatar to an `HtmlElementGenerator` object. For
 * rendering avatars in `<ContentEditor>` where we can't render React UI.
 */
// IMPORTANT: If you update the HTML here you should also update
// `<TaskMissingAccountAvatar>` for code that renders avatars in React.
export function renderTaskMissingAccountAvatar({
    size = "5",
    spacingScale,
}: {
    size?: "3" | "4" | "5";
    spacingScale: SpacingScale;
}): HtmlElementGenerator {
    const outerHtml = new HtmlElementGenerator("div");
    outerHtml.setAttribute("class", taskMissingAccountAvatarClassName);
    outerHtml.setAttribute("style", `width: ${spacing[size]}; height: ${spacing[size]}`);

    outerHtml.appendChild(renderTaskMissingAccountAvatarDashedCircle({size, spacingScale}));

    const iconContainerHtml = outerHtml.appendChild(new HtmlElementGenerator("div"));
    iconContainerHtml.setAttribute("class", taskMissingAccountAvatarIconContainerClassName);
    iconContainerHtml.appendChild(
        createSvgHtmlGenerator(
            userIconSvg({
                weight: parseInt(size, 10) < 5 ? "bold" : undefined,
                style: `width: ${spacing["3"]}; height: ${spacing["3"]}; transform: scale(${parseInt(size, 10) / 5})`,
            }),
        ),
    );

    return outerHtml;
}

function renderTaskMissingAccountAvatarDashedCircle({
    size,
    spacingScale,
}: {
    size: "3" | "4" | "5";
    spacingScale: SpacingScale;
}): HtmlGenerator {
    const radius = convertRemLengthToPx(size, spacingScale) / 2;
    const strokeWidth = 1;
    const viewBoxSize = radius * 2 + strokeWidth;
    const circumference = 2 * Math.PI * radius;
    const dashes = 7;
    const gapRatio = 0.5;

    const strokeDasharray = `${(circumference / dashes) * (1 - gapRatio)} ${
        (circumference / dashes) * gapRatio
    }`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="width: ${spacing[size]}; height: ${spacing[size]}" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}"><circle cx="${
        viewBoxSize / 2
    }" cy="${viewBoxSize / 2}" r="${radius}" fill="none" stroke="${
        inputPlaceholderStyles.color
    }" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${strokeDasharray}"/></svg>`;

    return createSvgHtmlGenerator(svg);
}
