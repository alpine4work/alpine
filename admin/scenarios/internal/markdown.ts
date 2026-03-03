import Mustache from "mustache";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Template string tag that tells Prettier to format the string as Markdown.
 * Variable substitutions break Prettier's formatting of the template string tag so
 * we return a function that runs Mustache to substitute in variable values using
 * Mustache.
 *
 * This currently lives in `admin/scenarios/internal` but could be a general
 * purpose utility. We're keeping it in `admin` for now since using Mustache for
 * substitution isn't efficient.
 */
export function markdown(
    template: TemplateStringsArray,
    ...substitutions: []
): (view?: object) => string {
    const string = template[0] ?? "";

    assert(substitutions.length === 0, "Substitutions break Prettier formatting");

    return (view = {}) => Mustache.render(string, view);
}
