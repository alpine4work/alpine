import classNames from "classnames";
import {
    navigationBarBreadcrumbInnerGap,
    navigationBarBreadcrumbToTitleSpacing,
    navigationBarTitleBreadcrumbButtonHeight,
    navigationBarTitleBreadcrumbCaretSize,
    navigationBarTitleBreadcrumbColor,
    navigationBarTitleBreadcrumbFontSize,
} from "~/client/web/design/navigation_bar_helpers.js";
import {caretRightIconSvg} from "~/client/web/icons/caret_right_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {SiteRegistry} from "~/client/web/sites/context/site_registry.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.open_source.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {Store} from "~/shared/store/store.js";

/**
 * Appends a `[Site name] >` breadcrumb to `parent`. Used by every file entity
 * preview that supports being added to a site so the visual treatment stays
 * consistent. Render this above the entity's title.
 *
 * Spacing contract:
 *
 * - The breadcrumb is rendered with
 *   `padding-bottom: navigationBarBreadcrumbToTitleSpacing` so the gap to the next
 *   sibling is fixed regardless of where the helper is used. The constant is the
 *   only knob; do not pass a different bottom margin.
 * - The breadcrumb is rendered with no top margin. Whatever sits above it in the
 *   parent (typically the container's natural top padding) determines the distance
 *   from the box top.
 *
 * `extraClassName` is reserved for layout-level integration only — e.g.
 * `flex-grow: 1` when the breadcrumb shares a row with a sibling. Do not use it to
 * override the spacing contract above.
 */
export function renderContentFileEntitySiteBreadcrumb({
    get,
    siteRegistry,
    parent,
    site,
    platform,
}: {
    get: <Value>(store: Store<Value>) => Value;
    siteRegistry: SiteRegistry;
    parent: HtmlElementGenerator;
    site: SitePreviewModel;
    platform: Platform;
}): HtmlElementGenerator {
    const siteEntityData = get(siteRegistry.getSiteStore(site));
    const breadcrumbHtml = parent.appendChild(new HtmlElementGenerator("div"));
    breadcrumbHtml.setAttribute(
        "class",
        classNames(
            sprinkles({
                display: "flex",
                alignItems: "center",
                gap: navigationBarBreadcrumbInnerGap,
                color: navigationBarTitleBreadcrumbColor,
                fontSize: navigationBarTitleBreadcrumbFontSize,
                paddingBottom: navigationBarBreadcrumbToTitleSpacing[platform],
            }),
        ),
    );

    const siteBreadcrumbButtonHtml = breadcrumbHtml.appendChild(new HtmlElementGenerator("button"));
    siteBreadcrumbButtonHtml.setAttribute(
        "class",
        sprinkles({
            paddingLeft: "1.5",
            marginLeft: "-1.5",
            height: navigationBarTitleBreadcrumbButtonHeight,
        }),
    );
    siteBreadcrumbButtonHtml.appendChild(new HtmlTextGenerator(siteEntityData.name));

    breadcrumbHtml.appendChild(
        createSvgHtmlGenerator(
            caretRightIconSvg({
                className: sprinkles({
                    width: navigationBarTitleBreadcrumbCaretSize,
                    height: navigationBarTitleBreadcrumbCaretSize,
                    flexShrink: "0",
                }),
            }),
        ),
    );

    return breadcrumbHtml;
}
