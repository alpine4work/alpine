import type {MDXContent} from "mdx/types.js";
import {Fragment, jsx, jsxs} from "react/jsx-runtime";
import {assert} from "~/shared/helpers/control/assert.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";

// Documentation MDX is compiled to a function body during docs codegen, shipped to
// routes in loader data, and evaluated here on both sides so server render and
// client hydration produce the same tree. Evaluations are cached since the same
// docs page renders many times.
//
// We evaluate the compiled body ourselves instead of using `runSync()` from
// `@mdx-js/mdx` so the client bundle never imports the MDX package — its entry
// point drags the whole compiler (micromark, acorn, …) into the browser.
const contentCache = new Map<string, MDXContent>();

export function getDocumentationMdxContent(code: string): MDXContent {
    const cached = contentCache.get(code);
    if (cached !== undefined) return cached;

    // A compiled MDX function body reads the JSX runtime from `arguments[0]`,
    // exactly how `runSync()` calls it. The code is our own build output
    // (compiled from checked-in MDX), not user input.
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    const initializeDocumentationMdxModule = new Function(code);
    const mdxModule: unknown = initializeDocumentationMdxModule({Fragment, jsx, jsxs});
    assert(
        isDocumentationMdxModule(mdxModule),
        "Expected compiled documentation MDX to export a content component",
    );

    contentCache.set(code, mdxModule.default);
    return mdxModule.default;
}

function isDocumentationMdxModule(value: unknown): value is {default: MDXContent} {
    return isPlainObject(value) && typeof value.default === "function";
}
