import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {lockIconSvg} from "~/client/web/icons/lock_icon_svg.js";
import {trashIconSvg} from "~/client/web/icons/trash_icon_svg.js";
import {warningIconSvg} from "~/client/web/icons/warning_icon_svg.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";

export function renderContentFileErrorPreview({
    layout,
    icon,
    title,
    displayMessage,
    platform,
    spacingScale,
}: {
    layout: {width: number; height: number};
    icon: "Warning" | "Lock" | "Trash" | null;
    title: string;
    displayMessage: ErrorDisplayMessage | null;
    platform: Platform;
    spacingScale: SpacingScale;
}) {
    const thirdOfBlockMaxWidth =
        ((contentStyles.blockMaxWidthRem[platform] - contentStyles.fileRowGapWidthRem * 2) / 3) *
        remPxBySpacingScale[spacingScale];

    const isSmallerThanThirdOfBlockMaxWidth = layout.width <= thirdOfBlockMaxWidth;

    const containerHtml = new HtmlElementGenerator("div");

    containerHtml.setAttribute(
        "class",
        sprinkles({
            position: "absolute",
            inset: "0",
            backgroundColor: "grey-0",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
        }),
    );

    const errorHtml = new HtmlElementGenerator("div");
    containerHtml.appendChild(errorHtml);

    errorHtml.setAttribute(
        "style",
        `min-width: ${thirdOfBlockMaxWidth}px; transform: scale(${Math.min(
            1,
            layout.width / thirdOfBlockMaxWidth,
        )})`,
    );

    errorHtml.setAttribute(
        "class",
        sprinkles({
            zIndex: "20",
            position: "relative",
            maxWidth: "96",
            paddingX: "8",
            paddingTop: "5",
            paddingBottom: "4",
            display: "flex",
            flexDirection: "column",
            gap: "1.5",
        }),
    );

    const errorTitleHtml = new HtmlElementGenerator("div");
    errorHtml.appendChild(errorTitleHtml);

    errorTitleHtml.setAttribute(
        "class",
        sprinkles({
            fontSize: "200",
            fontStyle: "normal",
            color: "grey-70",
        }),
    );

    const iconClassName = isSmallerThanThirdOfBlockMaxWidth
        ? sprinkles({
              width: "4",
              height: "4",
              marginBottom: "1.5",
          })
        : sprinkles({
              width: "4",
              height: "4",
              display: "inline",
              position: "relative",
              top: "-0.5",
              marginRight: "1.5",
          });

    switch (icon) {
        case null: {
            break;
        }
        case "Warning": {
            errorTitleHtml.appendChild(
                createSvgHtmlGenerator(warningIconSvg({className: iconClassName})),
            );
            break;
        }
        case "Lock": {
            errorTitleHtml.appendChild(
                createSvgHtmlGenerator(lockIconSvg({className: iconClassName})),
            );
            break;
        }
        case "Trash": {
            errorTitleHtml.appendChild(
                createSvgHtmlGenerator(trashIconSvg({className: iconClassName})),
            );
            break;
        }
        default:
            throw exhaustive(icon);
    }

    errorTitleHtml.appendChild(new HtmlTextGenerator(title));

    if (displayMessage !== null) {
        const errorMessageHtml = new HtmlElementGenerator("div");
        errorHtml.appendChild(errorMessageHtml);

        errorMessageHtml.setAttribute(
            "class",
            sprinkles({
                fontSize: "75",
                color: "grey-50",
            }),
        );

        for (const displayMessageSegment of displayMessage) {
            switch (displayMessageSegment.type) {
                case "Text":
                case "SensitiveText": {
                    errorMessageHtml.appendChild(new HtmlTextGenerator(displayMessageSegment.text));
                    break;
                }
                case "Link": {
                    // We don't currently support links in content file previews. Since we can't
                    // render a full `<Link>` component (like we do in
                    // `<ErrorDisplayMessageRenderer>`) with all the navigation bells and whistles.
                    errorMessageHtml.appendChild(new HtmlTextGenerator(displayMessageSegment.text));
                    break;
                }
                default:
                    throw exhaustive(displayMessageSegment);
            }
        }
    }

    return containerHtml;
}
