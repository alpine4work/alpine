import {highlightCode} from "@lezer/highlight";
import {parser as lezerJsonParser} from "@lezer/json";
import escapeHtml from "escape-html";
import {STATUS_CODES} from "http";
// @ts-expect-error: After upgrading Prettier, we need to directly import
// `prettier/index.mjs` to make sure we don't get the standalone build.
// However, there's no blessed way from Prettier to import the full version
// with types.
import * as prettier from "prettier/index.mjs";
import {colors} from "~/shared/design/core/colors.js";
import {invertColor} from "~/shared/design/core/inverted_colors.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.open_source.js";
import {lezerClassHighlighter} from "~/shared/lezer/lezer_class_highlighter.open_source.js";

const selectionLightColor = (() => {
    const selectionAlpha = 2 / 3;
    const selectionAlphaHex = Math.round(selectionAlpha * 255)
        .toString(16)
        .padStart(2, "0");

    return `${colors["indigo-20"]}${selectionAlphaHex}`;
})();

const selectionDarkColor = (() => {
    const selectionAlpha = 1 / 3;
    const selectionAlphaHex = Math.round(selectionAlpha * 255)
        .toString(16)
        .padStart(2, "0");

    return `${colors["indigo-20"]}${selectionAlphaHex}`;
})();

export async function renderApiBrowser({
    request,
    response,
    resourceServiceUrl,
    url,
    route: findMyWayPath,
}: {
    request: Request;
    response: Response;
    resourceServiceUrl: string;
    url: URL;
    route: string;
}) {
    // Convert path params from the `find-my-way` format (`/hello/:name`) to the
    // OpenAPI format (`/hello/{name}`). Right now we only support path params that are
    // an entire path segment. Paths like `/report.:format` aren't currently accepted.
    const openApiPath = findMyWayPath
        .split("/")
        .map(pathSegment => {
            if (!pathSegment.startsWith(":")) return pathSegment;

            const pathParamName = pathSegment.slice(1);
            assert(isIdentifier(pathParamName));

            return `{${pathParamName}}`;
        })
        .join("/");

    let body = await response.text();

    // We want errors to be printed on multiple lines. So add a new line after
    // `"error": {` to force Prettier to print on multiple lines.
    //
    // eslint-disable-next-line cyberworlds/string-quotes
    if (body.startsWith('{"error":{')) {
        body = body.slice(0, 10) + "\n" + body.slice(10);
    }

    // We always want the root object to be rendered on multiple lines. Which is why we
    // test if the first character is `{` or `[` and insert a newline immediately after
    // if we are opening an object or array.
    if (/^[{[]/.test(body)) {
        body = body[0]! + "\n" + body.slice(1);
    }

    // Use Prettier to print the JSON. This way small objects are printed on a single
    // line instead of always printing on multiple lines like `JSON.stringify()` will
    // do.
    const prettyBody = await prettier.format(body, {
        parser: "json",
        printWidth: 80,
        tabWidth: 2,
    });

    let highlightedPrettyBodyHtml = "";

    highlightCode(
        prettyBody,
        lezerJsonParser.parse(prettyBody),
        lezerClassHighlighter.get(),
        (text: string, classes: string) => {
            if (classes.length === 0) {
                highlightedPrettyBodyHtml += escapeHtml(text);
            } else {
                highlightedPrettyBodyHtml += `<span class="${classes}">${escapeHtml(text)}</span>`;
            }
        },
        () => {
            highlightedPrettyBodyHtml += "\n";
        },
    );

    const dateHeaderValue = new Date().toUTCString();

    /* eslint-disable cyberworlds/string-quotes */

    const ltHtml = '<span class="tok-comment">&lt;</span>';
    const gtHtml = '<span class="tok-comment">&gt;</span>';

    const html = `\
<!doctype html>
<html>
    <head>
        <meta charset="utf-8">
        <meta name="robots" content="noindex">
        <title>${openApiPath} | Alpine API</title>
        <link rel="preload" href="${resourceServiceUrl}/fonts/commit-mono.v1.woff2" as="font" type="font/woff2" crossorigin="anonymous">
        <style>
            @font-face {
                font-family: "Commit Mono";
                src: url(${resourceServiceUrl}/fonts/commit-mono.v1.woff2) format('woff2 supports variations'), url(${resourceServiceUrl}/fonts/commit-mono.v1.woff2) format('woff2-variations'), url(${resourceServiceUrl}/fonts/commit-mono.v1.woff2) format('woff2');
                font-weight: 100 900;
                font-style: normal;
                font-display: swap;
            }

            :root {
                color: ${colors["grey-100"]};
                background-color: ${colors["grey-0"]};
                font-family: "Commit Mono", monospace;
                font-weight: 400;
                font-size: 16px;
                line-height: 1.5;
            }

            ::selection {
                background: ${selectionLightColor};
            }

            ::-moz-selection {
                background: ${selectionLightColor};
            }

            body {
                width: fit-content;
                padding: 1.5rem;
                margin: 0;
            }

            pre {
                margin: 0;
            }

            pre, code {
                display: block;
                font-family: inherit;
            }

            .tok-propertyName {
                color: ${colors["indigo-80"]};
            }

            .tok-bool {
                color: ${colors["pink-60"]};
                font-weight: 500;
            }

            .tok-number {
                color: ${colors["orange-60"]};
            }

            .tok-string {
                color: ${colors["green-60"]};
            }

            .tok-comment {
                color: ${colors["grey-50"]};
            }

            .tok-inserted {
                color: ${colors["green-60"]};
            }

            .tok-deleted {
                color: ${colors["red-60"]};
            }

            @media (prefers-color-scheme: dark) {
                :root {
                    color: ${colors[invertColor("grey-100")]};
                    background-color: ${colors[invertColor("grey-0")]};
                }

                ::selection {
                    background: ${selectionDarkColor};
                }

                ::-moz-selection {
                    background: ${selectionDarkColor};
                }

                .tok-propertyName {
                    color: ${colors[invertColor("indigo-90")]};
                }

                .tok-bool {
                    color: ${colors[invertColor("pink-60")]};
                }

                .tok-number {
                    color: ${colors[invertColor("orange-60")]};
                }

                .tok-string {
                    color: ${colors[invertColor("green-60")]};
                }

                .tok-comment {
                    color: ${colors[invertColor("grey-50")]};
                }

                .tok-inserted {
                    color: ${colors[invertColor("green-60")]};
                }

                .tok-deleted {
                    color: ${colors[invertColor("red-60")]};
                }
            }
        </style>
    </head>
    <body>
        <pre><code>\
${ltHtml} ${escapeHtml(`${request.method} ${url.pathname}${url.search}`)} HTTP/1.1
${ltHtml} Host: api.alpine.inc
${ltHtml} Accept: application/json

${gtHtml} HTTP/1.1 <span class="${response.ok ? "tok-inserted" : "tok-deleted"}">${
        response.status
    }</span> ${escapeHtml(STATUS_CODES[response.status])}
${gtHtml} Date: ${dateHeaderValue}
${Array.from(
    response.headers,
    ([headerName, headerValue]) =>
        `${gtHtml} ${escapeHtml(`${capitalizeHeaderName(headerName)}: ${headerValue}`)}`,
).join("\n")}

${highlightedPrettyBodyHtml}</code></pre>
    </body>
</html>
`;

    /* eslint-enable cyberworlds/string-quotes */

    return new Response(html, {
        status: response.status,
        headers: {date: dateHeaderValue, "content-type": "text/html"},
    });
}

function capitalizeHeaderName(headerName: string): string {
    return headerName
        .split("-")
        .map(headerNameWord =>
            headerNameWord.length > 0
                ? headerNameWord[0]!.toUpperCase() + headerNameWord.slice(1)
                : headerNameWord,
        )
        .join("-");
}
