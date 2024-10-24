import {assert} from "~/shared/helpers/control/assert.js";
import {HtmlGenerator} from "~/shared/helpers/html/html_generator.js";

export function createSvgHtmlGenerator(svg: string) {
    const htmlGenerator: HtmlGenerator = {
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
        patchNode: (previous, node) => {
            return previous === htmlGenerator && node instanceof Element && node.tagName === "svg";
        },
    };

    return htmlGenerator;
}
