import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {HtmlGenerator} from "~/shared/helpers/html/html_generator.js";

const svgHtmlGeneratorKeySymbol = Symbol("svgHtmlGeneratorKey");

export function createSvgHtmlGenerator(svg: string) {
    const htmlGenerator: HtmlGenerator & {[svgHtmlGeneratorKeySymbol]?: string} = {
        [svgHtmlGeneratorKeySymbol]: svg,
        generateHtml: () => {
            assert(/^<svg[^a-z0-9-]/.test(svg));
            return svg;
        },
        generateNode: () => {
            const temporaryElement = document.createElement("div");
            temporaryElement.innerHTML = svg;
            assert(temporaryElement.firstElementChild?.tagName === "svg");
            return temporaryElement.firstElementChild;
        },
        patchNode: (
            previous: (HtmlGenerator & {[svgHtmlGeneratorKeySymbol]?: string}) | null,
            node,
        ) => {
            return (
                (previous === htmlGenerator || previous?.[svgHtmlGeneratorKeySymbol] === svg) &&
                node instanceof Element &&
                node.tagName === "svg"
            );
        },
    };

    return htmlGenerator;
}
