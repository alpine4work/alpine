/* eslint-disable cyberworlds/string-quotes --
 * Straight quotes here are JavaScript source fixture text and expected error text. */
import {renderDocumentationMdxToMarkdown} from "~/app/docs/codegen/markdown/render_documentation_mdx_to_markdown.js";

function createCompiledMdxCodeForElement(typeExpression: string): string {
    return `
const {jsx: _jsx} = arguments[0];
function MDXContent() {
    return _jsx(${typeExpression}, {children: "Hidden typo"});
}
return {default: MDXContent};
`;
}

test("throws when compiled MDX renders an unsupported intrinsic element", () => {
    expect(() =>
        renderDocumentationMdxToMarkdown(createCompiledMdxCodeForElement('"Typo"'), {}),
    ).toThrow("Unsupported docs markdown MDX element: <Typo>");
});
