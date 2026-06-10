import classNames from "classnames";
import {caretRightIconSvg} from "~/client/web/icons/caret_right_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {SiteRegistry} from "~/client/web/sites/context/site_registry.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {HtmlElementGenerator, HtmlTextGenerator} from "~/shared/helpers/html/html_generator.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {Store} from "~/shared/store/store.js";

/**
 * Vertical spacing between the bottom of the site breadcrumb and the top of the
 * entity title beneath it. Every file entity preview that renders a site
 * breadcrumb should produce this exact visual gap so the design stays consistent
 * across entity types.
 *
 * Applied as `padding-bottom` on the breadcrumb element (rather than
 * `margin-bottom`) so it survives unchanged when the breadcrumb lives inside a
 * flex container with its own `gap`. Callers are responsible for ensuring that no
 * parent `gap` or sibling top-padding contributes additional space below the
 * breadcrumb — typically by making the breadcrumb a child of a no-gap wrapper that
 * also contains the entity title.
 */
export const siteBreadcrumbToTitleSpacing = "1";

/**
 * Appends a `[Site name] >` breadcrumb to `parent`. Used by every file entity
 * preview that supports being added to a site so the visual treatment stays
 * consistent. Render this above the entity's title.
 *
 * Spacing contract:
 *
 * - The breadcrumb is rendered with `padding-bottom: siteBreadcrumbToTitleSpacing`
 *   so the gap to the next sibling is fixed regardless of where the helper is
 *   used. The constant is the only knob; do not pass a different bottom margin.
 * - The breadcrumb is rendered with no top margin. Whatever sits above it in the
 *   parent (typically the container's natural top padding) determines the distance
 *   from the box top.
 *
 * `extraClassName` is reserved for layout-level integration only — e.g.
 * `flex-grow: 1` when the breadcrumb shares a row with a sibling. Do not use it to
 * override the spacing contract above.
 */
export function renderContentFileEntitySiteBreadcrumb(
    get: <Value>(store: Store<Value>) => Value,
    siteRegistry: SiteRegistry,
    parent: HtmlElementGenerator,
    site: SitePreviewModel,
    options?: {extraClassName?: string},
): HtmlElementGenerator {
    const siteEntityData = get(siteRegistry.getSiteStore(site));
    const breadcrumbHtml = parent.appendChild(new HtmlElementGenerator("div"));
    breadcrumbHtml.setAttribute(
        "class",
        classNames(
            sprinkles({
                display: "flex",
                alignItems: "center",
                gap: "1.5",
                color: "grey-50",
                paddingBottom: siteBreadcrumbToTitleSpacing,
            }),
            options?.extraClassName,
        ),
    );

    const siteNameHtml = breadcrumbHtml.appendChild(new HtmlElementGenerator("div"));
    siteNameHtml.setAttribute("class", sprinkles({fontStyle: "truncate"}));
    siteNameHtml.appendChild(new HtmlTextGenerator(siteEntityData.name));

    breadcrumbHtml.appendChild(
        createSvgHtmlGenerator(
            caretRightIconSvg({
                className: sprinkles({width: "3", height: "3", flexShrink: "0"}),
            }),
        ),
    );

    return breadcrumbHtml;
}
