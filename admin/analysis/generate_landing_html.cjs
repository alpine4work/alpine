#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {createRequestHandler} = require("@remix-run/node");
const yargs = require("yargs/yargs");

const browserId = "00000000000000000000000000";
const landingBasePath = "/landing";
const landingStaticFileExtensions = new Set([
    ".avif",
    ".css",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".mp4",
    ".otf",
    ".pdf",
    ".png",
    ".svg",
    ".ttf",
    ".webm",
    ".webp",
    ".woff",
    ".woff2",
]);

main();

/**
 * Pre-renders the explicitly public blog and documentation route families.
 */
async function main() {
    try {
        const args = readArgs(process.argv.slice(2));
        const runfilesPath = requireEnvironmentVariable("RUNFILES");
        const runfilesWorkspacePath = path.join(runfilesPath, "cyberworlds");
        const outputPath = path.resolve(
            args.output ??
                path.join(
                    requireEnvironmentVariable("TEST_UNDECLARED_OUTPUTS_DIR"),
                    "landing-html",
                ),
        );
        const appClientPath = path.join(runfilesWorkspacePath, "app", "build", "client");
        const appServerBuildPath = path.join(
            runfilesWorkspacePath,
            "app",
            "build",
            "server",
            "remix_server_build.js",
        );
        const documentationMarkdownPath = path.join(
            runfilesWorkspacePath,
            "app",
            "docs",
            "codegen",
            "pages",
        );

        assertSafeOutputPath({
            appClientPath,
            appServerBuildPath,
            documentationMarkdownPath,
            outputPath,
            runfilesWorkspacePath,
        });

        // Fastbuild applies the React refresh transform. The integration app defines these
        // no-op globals in its document; the static renderer needs them before importing
        // the server bundle.
        globalThis.$RefreshReg$ = () => {};
        globalThis.$RefreshSig$ = () => value => value;
        const serverBuild = await import(pathToFileURL(appServerBuildPath).href);
        const handleRequest = createRequestHandler(serverBuild, "development");
        const routes = findLandingRoutes(documentationMarkdownPath);

        if (fs.existsSync(outputPath)) makeTreeWritable(outputPath);
        fs.rmSync(outputPath, {force: true, recursive: true});
        fs.mkdirSync(outputPath, {recursive: true});
        const landingOutputPath = path.join(outputPath, landingBasePath.slice(1));
        fs.mkdirSync(landingOutputPath, {recursive: true});
        copyStaticClientFiles({appClientPath, landingOutputPath});
        copyDocumentationMarkdown({documentationMarkdownPath, outputPath});

        for (const route of routes) {
            await renderRoute({handleRequest, outputPath, route});
        }

        writeLandingIndex(outputPath);
        validateLandingOutput({outputPath, routes});
        process.stdout.write(
            `Landing HTML written to ${outputPath} (${routes.length} public routes).\n`,
        );
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
        );
        process.exitCode = 1;
    }
}

function readArgs(argv) {
    return yargs(argv)
        .scriptName("generate_landing_html")
        .usage("$0 --output <path>")
        .option("output", {
            describe: "Directory where the pre-rendered Landing site is written.",
            type: "string",
        })
        .help()
        .strict()
        .parseSync();
}

function requireEnvironmentVariable(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Expected \`${name}\` environment variable to exist`);
    return value;
}

function assertSafeOutputPath({
    appClientPath,
    appServerBuildPath,
    documentationMarkdownPath,
    outputPath,
    runfilesWorkspacePath,
}) {
    const resolvedOutputPath = path.resolve(outputPath);
    if (resolvedOutputPath === path.parse(resolvedOutputPath).root) {
        throw new Error(`Refusing to clear filesystem root: ${resolvedOutputPath}`);
    }
    if (resolvedOutputPath === path.resolve(runfilesWorkspacePath)) {
        throw new Error(`Refusing to clear runfiles workspace root: ${resolvedOutputPath}`);
    }

    for (const inputPath of [appClientPath, appServerBuildPath, documentationMarkdownPath]) {
        if (
            samePathOrChild(resolvedOutputPath, inputPath) ||
            samePathOrChild(inputPath, resolvedOutputPath)
        ) {
            throw new Error(
                `Refusing to use overlapping input and output paths: ${inputPath}, ${resolvedOutputPath}`,
            );
        }
        if (!fs.existsSync(inputPath)) throw new Error(`Missing generated input: ${inputPath}`);
    }
}

function samePathOrChild(childPath, parentPath) {
    const relativePath = path.relative(parentPath, childPath);
    return (
        relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    );
}

/**
 * Uses the generated Markdown tree as the route manifest. It contains every
 * authored guide, blog post, generated API operation, and generated API schema. No
 * application route outside `/blog` and `/docs` can enter this allowlist.
 */
function findLandingRoutes(documentationMarkdownPath) {
    const routes = new Set(["/blog", "/docs"]);
    for (const filePath of walkFiles(documentationMarkdownPath)) {
        if (!filePath.endsWith(".md")) continue;
        const relativePath = path.relative(documentationMarkdownPath, filePath);
        if (relativePath === "blog.md") continue;
        routes.add(`/${relativePath.slice(0, -".md".length).split(path.sep).join("/")}`);
    }
    return [...routes].sort();
}

function walkFiles(directoryPath) {
    const files = [];
    for (const entry of fs.readdirSync(directoryPath, {withFileTypes: true})) {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(entryPath));
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files;
}

/**
 * Client scripts contain every Remix route, including authenticated application
 * routes, and static Landing pages do not hydrate. Publish only styles and public
 * media so dynamic application code never enters the deploy artifact.
 */
function copyStaticClientFiles({appClientPath, landingOutputPath}) {
    fs.cpSync(appClientPath, landingOutputPath, {
        filter: sourcePath => {
            if (fs.statSync(sourcePath).isDirectory()) return true;
            return landingStaticFileExtensions.has(path.extname(sourcePath).toLowerCase());
        },
        force: true,
        recursive: true,
    });

    makeTreeWritable(landingOutputPath);

    for (const filePath of walkFiles(landingOutputPath)) {
        if (!filePath.endsWith(".css")) continue;
        const css = fs
            .readFileSync(filePath, "utf8")
            .replace(/url\((['"]?)\/(?!\/)/giu, `url($1${landingBasePath}/`);
        fs.writeFileSync(filePath, css);
    }
}

function makeTreeWritable(directoryPath) {
    fs.chmodSync(directoryPath, 0o755);
    for (const entry of fs.readdirSync(directoryPath, {withFileTypes: true})) {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            makeTreeWritable(entryPath);
        } else if (entry.isFile()) {
            fs.chmodSync(entryPath, 0o644);
        }
    }
}

function copyDocumentationMarkdown({documentationMarkdownPath, outputPath}) {
    for (const sourcePath of walkFiles(documentationMarkdownPath)) {
        if (!sourcePath.endsWith(".md")) continue;
        const relativePath = path.relative(documentationMarkdownPath, sourcePath);
        const destinationPath = path.join(outputPath, landingBasePath.slice(1), relativePath);
        const markdown = fs
            .readFileSync(sourcePath, "utf8")
            .replaceAll("](/blog", `](${landingBasePath}/blog`)
            .replaceAll("](/docs", `](${landingBasePath}/docs`);
        fs.mkdirSync(path.dirname(destinationPath), {recursive: true});
        fs.writeFileSync(destinationPath, markdown);
    }
}

async function renderRoute({handleRequest, outputPath, route}) {
    let response = await handleRequest(
        new Request(`https://landing.alpine.inc${route}`, {
            headers: {"user-agent": "Alpine static Landing generator"},
        }),
        createStaticLoaderContext(),
    );

    if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) throw new Error(`Redirect for ${route} did not include a location`);
        const redirectUrl = new URL(location, `https://landing.alpine.inc${route}`);
        if (redirectUrl.origin !== "https://landing.alpine.inc") {
            throw new Error(`Refusing external redirect while rendering ${route}: ${location}`);
        }
        response = await handleRequest(
            new Request(redirectUrl, {
                headers: {"user-agent": "Alpine static Landing generator"},
            }),
            createStaticLoaderContext(),
        );
    }

    if (!response.ok) {
        throw new Error(`Failed to render ${route}: HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("text/html")) {
        throw new Error(`Expected HTML while rendering ${route}, received ${contentType}`);
    }

    const html = prefixLandingUrls(stripClientScripts(await response.text()));
    const routeOutputPath = path.join(
        outputPath,
        landingBasePath.slice(1),
        route.replace(/^\/+/, ""),
        "index.html",
    );
    fs.mkdirSync(path.dirname(routeOutputPath), {recursive: true});
    fs.writeFileSync(routeOutputPath, html);
}

/**
 * Static Landing pages deliberately do not hydrate. Remix client navigation
 * expects a live loader server; without one, full-page anchor navigation is the
 * correct behavior for this allowlisted static export.
 */
function stripClientScripts(html) {
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "");
}

function prefixLandingUrls(html) {
    return html
        .replace(/<link\b[^>]*\brel=(['"])manifest\1[^>]*>/giu, "")
        .replace(/<link\b(?=[^>]*\brel=(['"])modulepreload\1)[^>]*>/giu, "")
        .replace(
            /\b(href|src|content|action)=(['"])\/(?!\/)/giu,
            (_match, attribute, quote) => `${attribute}=${quote}${landingBasePath}/`,
        )
        .replace(/url\((['"]?)\/(?!\/)/giu, `url($1${landingBasePath}/`);
}

/**
 * Enforces the static export boundary after rendering. The generator fails closed
 * if an application script, unknown file type, or URL outside the `/landing` mount
 * enters the artifact.
 */
function validateLandingOutput({outputPath, routes}) {
    const allowedOutputExtensions = new Set([...landingStaticFileExtensions, ".html", ".md"]);
    const outputFiles = walkFiles(outputPath);

    for (const outputFilePath of outputFiles) {
        const relativePath = path.relative(outputPath, outputFilePath);
        if (!relativePath.startsWith(`landing${path.sep}`)) {
            throw new Error(`Landing output escaped its mount: ${relativePath}`);
        }
        if (!allowedOutputExtensions.has(path.extname(outputFilePath).toLowerCase())) {
            throw new Error(`Unexpected Landing output file: ${relativePath}`);
        }

        const extension = path.extname(outputFilePath).toLowerCase();
        if (extension !== ".html" && extension !== ".css") continue;
        const content = fs.readFileSync(outputFilePath, "utf8");
        if (extension === ".html" && /<script\b/iu.test(content)) {
            throw new Error(`Client script remained in Landing HTML: ${relativePath}`);
        }
        if (
            extension === ".html" &&
            /<link\b[^>]*\brel=(['"])(?:manifest|modulepreload)\1/iu.test(content)
        ) {
            throw new Error(`Client module link remained in Landing HTML: ${relativePath}`);
        }
        if (
            extension === ".html" &&
            /\b(?:href|src|content|action)=['"]\/(?!\/|landing(?:\/|['"]))/iu.test(content)
        ) {
            throw new Error(`Root URL escaped the Landing mount: ${relativePath}`);
        }
        if (/url\((['"]?)\/(?!\/|landing\/)/iu.test(content)) {
            throw new Error(`CSS URL escaped the Landing mount: ${relativePath}`);
        }
    }

    const expectedHtmlPaths = [
        path.join(outputPath, "landing", "index.html"),
        ...routes.map(route =>
            path.join(
                outputPath,
                landingBasePath.slice(1),
                route.replace(/^\/+/, ""),
                "index.html",
            ),
        ),
    ];
    for (const expectedHtmlPath of expectedHtmlPaths) {
        if (!fs.existsSync(expectedHtmlPath)) {
            throw new Error(`Missing rendered Landing route: ${expectedHtmlPath}`);
        }
    }
}

function createStaticLoaderContext() {
    const rootTracer = createStaticTracer();

    function createContext() {
        const context = {
            batch: {
                execute() {
                    throw new Error("Landing routes may not execute batched data requests");
                },
            },
            loader: {
                cookieNameSuffix: "",
                getBrowserId: () => browserId,
                getClientInfo: () => ({
                    screenWidth: 1920,
                    screenHeight: 1080,
                    timeZone: "America/New_York",
                    locale: "en-US",
                    renderingEngine: "Blink",
                    isAppleDevice: true,
                    isNativeMobile: false,
                }),
                getInitialTime: () => new Date(0),
                webPushVapidPublicKey: "",
            },
            react: {reportRenderedError: error => rootTracer.addException(error)},
            rpc: {
                execute() {
                    throw new Error("Landing routes may not execute RPCs");
                },
            },
            clone: () => createContext(),
        };
        context.tracer = createStaticTracerModule({context, rootTracer});
        return context;
    }

    return createContext();
}

function createStaticTracer() {
    const rootTracer = {
        addException(error) {
            if (error instanceof Error) {
                process.stderr.write(`Rendered Landing error: ${error.stack || error.message}\n`);
            }
        },
        addPropagatedData() {},
        getRoot: () => rootTracer,
        log() {},
        logException() {},
        startSpan() {
            return {span: rootTracer, finishSpan() {}};
        },
        withPropagatedData: () => rootTracer,
    };
    return rootTracer;
}

function createStaticTracerModule({context, rootTracer}) {
    return {
        addException: error => rootTracer.addException(error),
        getRoot: () => rootTracer,
        getTracer: () => rootTracer,
        log() {},
        logException() {},
        startSpan: () => rootTracer.startSpan(),
        withSpan: (_name, action) => action(context, rootTracer),
        withSpanSync: (_name, action) => action(context, rootTracer),
        withPropagatedData: () => context,
    };
}

function writeLandingIndex(outputPath) {
    const landingPath = path.join(outputPath, "landing");
    fs.mkdirSync(landingPath, {recursive: true});
    fs.writeFileSync(
        path.join(landingPath, "index.html"),
        `<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <title>Alpine Landing</title>
        <style>
            body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; margin: 48px auto; max-width: 720px; padding: 0 24px; }
            nav { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
            a { border: 1px solid #d1d5db; border-radius: 12px; color: #111827; padding: 24px; text-decoration: none; }
            a:hover { border-color: #111827; }
            p { color: #4b5563; }
        </style>
    </head>
    <body>
        <main>
            <h1>Landing</h1>
            <p>Static public routes generated from this branch.</p>
            <nav>
                <a href="/landing/blog/"><strong>Blog</strong><br />Posts and announcements</a>
                <a href="/landing/docs/"><strong>Docs</strong><br />Guides and API reference</a>
            </nav>
        </main>
    </body>
</html>
`,
    );
}
