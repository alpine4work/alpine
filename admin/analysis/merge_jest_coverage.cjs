"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const fflate = require("fflate");
const libCoverage = require("istanbul-lib-coverage");
const libInstrument = require("istanbul-lib-instrument");
const libReport = require("istanbul-lib-report");
const reports = require("istanbul-reports");
const yargs = require("yargs/yargs");
const {coverageSourceRoots, isCoverageSourceFile} = require("./coverage_source_file.cjs");

const coverageMetricNames = ["statements", "branches", "functions", "lines"];
const honeycombCoverageRetryCount = 2;
const honeycombCoverageRetryDelayMs = 1000;
const coverageSourceParserPlugins = [
    "typescript",
    "jsx",
    "classProperties",
    "classPrivateMethods",
    "classPrivateProperties",
    "decorators-legacy",
    "dynamicImport",
    "importAttributes",
    "importMeta",
    "topLevelAwait",
];

main().catch(error => {
    writeStderr(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});

/**
 * Merges Jest coverage data and writes the full report bundle.
 *
 * Local `dev coverage` already has Bazel testlogs, and CI collection rebuilds that
 * same shape from uploaded shard artifacts. This script is the shared report
 * generator for both paths.
 */
async function main() {
    const args = readArgs(process.argv.slice(2));
    const workspacePath = args.workspace ?? process.cwd();
    const outputPath = args.output ?? path.join(workspacePath, "coverage");
    const testlogsPath = args.testlogs ?? path.join(workspacePath, "bazel-testlogs");
    const targetLabels = readTargetLabels(args.targetsFile);
    const coverageInputs = getCoverageInputs(testlogsPath, targetLabels);
    const missingCoverageInputs = coverageInputs.filter(
        coverageInput => !isCoverageInputAvailable(coverageInput),
    );

    if (missingCoverageInputs.length > 0) {
        writeStderr("Missing Jest coverage output for some targets:");
        for (const coverageInput of missingCoverageInputs.slice(0, 20)) {
            writeStderr(`  ${coverageInput.targetLabel}`);
        }
        if (missingCoverageInputs.length > 20) {
            writeStderr(`  ...and ${missingCoverageInputs.length - 20} more`);
        }
        process.exitCode = 1;
        return;
    }

    fs.rmSync(outputPath, {force: true, recursive: true});
    fs.mkdirSync(outputPath, {recursive: true});

    let coverageMap = libCoverage.createCoverageMap({});
    for (const coverageInput of coverageInputs) {
        mergeCoverageInput({coverageInput, coverageMap, workspacePath});
    }

    let uncoveredSourceFileCount;
    if (args.sourceFilePath) {
        const sourceFilePath = normalizeCoveragePath({
            filePath: args.sourceFilePath,
            workspacePath,
        });

        const sourceFileCoverage = getSourceFileCoverageMap({
            coverageMap,
            sourceFilePath,
            workspacePath,
        });

        coverageMap = sourceFileCoverage.coverageMap;
        uncoveredSourceFileCount = sourceFileCoverage.uncoveredSourceFileCount;
    } else if (args.skipUncoveredSourceFiles) {
        uncoveredSourceFileCount = 0;
    } else {
        uncoveredSourceFileCount = addUncoveredSourceFiles({coverageMap, workspacePath});
    }

    const files = coverageMap.files();
    if (files.length === 0) {
        writeStderr("No coverage data was produced by the selected Jest targets.");
        process.exitCode = 1;
        return;
    }

    const packageSummaries = getPackageSummaries({coverageMap, workspacePath});
    const overallSummary = coverageMap.getCoverageSummary().toJSON();

    writeIstanbulReports({coverageMap, outputPath});
    writeJson(outputPath, "coverage-final.json", coverageMap.toJSON());
    writeJson(outputPath, "package-summary.json", {
        overall: overallSummary,
        packages: packageSummaries,
    });
    writePackageSummaryHtml({
        outputFilePath: path.join(outputPath, "package-summary.html"),
        overallSummary,
        packageSummaries,
    });

    const summaryText = formatCoverageReport({
        fileCount: files.length,
        outputPath,
        overallSummary,
        packageSummaries,
        targetCount: targetLabels.length,
        uncoveredSourceFileCount,
        workspacePath,
    });

    fs.writeFileSync(path.join(outputPath, "coverage-summary.txt"), `${summaryText}\n`);

    if (!args.quiet) {
        writeStdout(summaryText);
    }

    if (args.honeycomb) {
        await sendHoneycombCoverageEvents({overallSummary, packageSummaries, workspacePath});
    }
}

/**
 * Reads and validates the CLI options for coverage report generation.
 */
function readArgs(argv) {
    const args = yargs(argv)
        .scriptName("merge_jest_coverage")
        .usage("$0 --targets-file <path> [options]")
        .option("output", {
            coerce: value => path.resolve(value),
            describe: "Coverage output directory. Defaults to ./coverage.",
            type: "string",
        })
        .option("quiet", {
            default: false,
            describe: "Write report files without printing the summary.",
            type: "boolean",
        })
        .option("source-file", {
            describe: "Only report coverage for one workspace source file.",
            type: "string",
        })
        .option("skip-uncovered-source-files", {
            default: false,
            describe: "Do not seed tracked source files that selected tests did not cover.",
            type: "boolean",
        })
        .option("honeycomb", {
            default: true,
            describe: "Send coverage events to Honeycomb.",
            type: "boolean",
        })
        .option("targets-file", {
            coerce: value => path.resolve(value),
            demandOption: true,
            describe: "File containing covered Bazel test target labels.",
            type: "string",
        })
        .option("testlogs", {
            coerce: value => path.resolve(value),
            describe: "Bazel testlogs directory. Defaults to ./bazel-testlogs.",
            type: "string",
        })
        .option("workspace", {
            coerce: value => path.resolve(value),
            describe: "Repository root. Defaults to the current working directory.",
            type: "string",
        })
        .help()
        .strict()
        .parseSync();

    return {
        ...args,
        skipUncoveredSourceFiles: args.skipUncoveredSourceFiles,
        sourceFilePath: args.sourceFile,
    };
}

/**
 * Reads Bazel test target labels from a newline-delimited file.
 */
function readTargetLabels(targetsFilePath) {
    return fs
        .readFileSync(targetsFilePath, "utf8")
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.length > 0);
}

/**
 * Builds the possible coverage output locations for each Bazel test target.
 */
function getCoverageInputs(testlogsPath, targetLabels) {
    return targetLabels.map(targetLabel => {
        const outputPath = path.join(
            testlogsPath,
            testlogPathForLabel(targetLabel),
            "test.outputs",
        );
        return {
            jsonPath: path.join(outputPath, "coverage", "coverage-final.json"),
            targetLabel,
            zipPath: path.join(outputPath, "outputs.zip"),
        };
    });
}

/**
 * Checks whether a target produced coverage in raw or zipped test outputs.
 */
function isCoverageInputAvailable(coverageInput) {
    return fs.existsSync(coverageInput.jsonPath) || fs.existsSync(coverageInput.zipPath);
}

/**
 * Converts a canonical Bazel target label into its testlogs-relative path.
 */
function testlogPathForLabel(targetLabel) {
    const match = /^\/\/([^:]*):(.+)$/.exec(targetLabel);
    if (!match) {
        throw new Error(`Expected canonical Bazel label, got: ${targetLabel}`);
    }

    const packagePath = match[1];
    const targetName = match[2];
    return packagePath.length === 0 ? targetName : path.join(packagePath, targetName);
}

/**
 * Normalizes and merges one target's Jest coverage into the aggregate map.
 */
function mergeCoverageInput({coverageInput, coverageMap, workspacePath}) {
    const json = readCoverageInputJson(coverageInput);
    const targetCoverageMap = libCoverage.createCoverageMap(json);

    for (const filePath of targetCoverageMap.files()) {
        const fileCoverage = targetCoverageMap.fileCoverageFor(filePath);
        const fileCoverageJson = fileCoverage.toJSON();

        fileCoverageJson.path = normalizeCoveragePath({
            filePath: fileCoverageJson.path,
            workspacePath,
        });

        coverageMap.merge({[fileCoverageJson.path]: fileCoverageJson});
    }
}

/**
 * Seeds uncovered tracked source files into the aggregate coverage map.
 *
 * Jest reports only files it loaded or explicitly collected. Adding tracked source
 * files that no selected test touched keeps those files visible at 0% coverage
 * instead of omitting them from the HTML report.
 */
function addUncoveredSourceFiles({coverageMap, workspacePath}) {
    const coveredFilePaths = new Set(coverageMap.files());
    let uncoveredSourceFileCount = 0;
    for (const filePath of getCoverageSourceFilePaths(workspacePath)) {
        if (coveredFilePaths.has(filePath)) {
            continue;
        }

        coverageMap.addFileCoverage(
            createUncoveredSourceFileCoverage({
                filePath,
                workspacePath,
            }),
        );
        uncoveredSourceFileCount++;
    }
    return uncoveredSourceFileCount;
}

/**
 * Narrows aggregate coverage down to a single source file.
 */
function getSourceFileCoverageMap({coverageMap, sourceFilePath, workspacePath}) {
    const sourceCoverageMap = libCoverage.createCoverageMap({});
    if (coverageMap.files().includes(sourceFilePath)) {
        sourceCoverageMap.addFileCoverage(coverageMap.fileCoverageFor(sourceFilePath));
        return {coverageMap: sourceCoverageMap, uncoveredSourceFileCount: 0};
    }

    sourceCoverageMap.addFileCoverage(
        createUncoveredSourceFileCoverage({
            filePath: sourceFilePath,
            workspacePath,
        }),
    );
    return {coverageMap: sourceCoverageMap, uncoveredSourceFileCount: 1};
}

/**
 * Lists source files that should appear in aggregate coverage reports.
 */
function getCoverageSourceFilePaths(workspacePath) {
    return runGit(["ls-files", ...coverageSourceRoots], {cwd: workspacePath})
        .split("\n")
        .map(filePath => filePath.trim())
        .filter(filePath => filePath.length > 0)
        .filter(filePath => isCoverageSourceFile(filePath));
}

/**
 * Instruments a source file to produce a synthetic 0% coverage entry.
 */
function createUncoveredSourceFileCoverage({filePath, workspacePath}) {
    const instrumenter = libInstrument.createInstrumenter({
        coverageVariable: "__coverage__",
        esModules: true,
        parserPlugins: coverageSourceParserPlugins,
        produceSourceMap: false,
    });
    const absoluteFilePath = path.join(workspacePath, filePath);

    instrumenter.instrumentSync(fs.readFileSync(absoluteFilePath, "utf8"), filePath);
    return instrumenter.fileCoverage;
}

/**
 * Reads coverage JSON from direct test outputs or from Bazel's outputs zip.
 */
function readCoverageInputJson(coverageInput) {
    if (fs.existsSync(coverageInput.jsonPath)) {
        return JSON.parse(fs.readFileSync(coverageInput.jsonPath, "utf8"));
    }

    const zip = fflate.unzipSync(fs.readFileSync(coverageInput.zipPath));
    const coverageJson = zip["coverage/coverage-final.json"];
    if (!coverageJson) {
        throw new Error(
            `Coverage zip did not include coverage-final.json: ${coverageInput.targetLabel}`,
        );
    }
    return JSON.parse(Buffer.from(coverageJson).toString("utf8"));
}

/**
 * Converts Jest and Bazel coverage paths into workspace-relative source paths.
 */
function normalizeCoveragePath({filePath, workspacePath}) {
    const normalizedFilePath = filePath.replace(/\\/g, "/");
    const normalizedWorkspacePath = workspacePath.replace(/\\/g, "/");

    const runfilesPath = removeRunfilesPrefix(normalizedFilePath);
    if (runfilesPath !== normalizedFilePath) {
        return runfilesPath;
    }

    if (normalizedFilePath.startsWith(`${normalizedWorkspacePath}/`)) {
        return normalizedFilePath.slice(normalizedWorkspacePath.length + 1);
    }

    for (const marker of ["/runfiles/cyberworlds/", "/execroot/cyberworlds/"]) {
        const markerIndex = normalizedFilePath.indexOf(marker);
        if (markerIndex !== -1) {
            return removeBazelBinPrefix(normalizedFilePath.slice(markerIndex + marker.length));
        }
    }

    if (normalizedFilePath.startsWith("cyberworlds/")) {
        return normalizedFilePath.slice("cyberworlds/".length);
    }

    return removeBazelBinPrefix(normalizedFilePath);
}

/**
 * Removes Bazel runfiles prefixes from coverage paths.
 */
function removeRunfilesPrefix(filePath) {
    for (const marker of [".runfiles/cyberworlds/", "/runfiles/cyberworlds/"]) {
        const markerIndex = filePath.indexOf(marker);
        if (markerIndex !== -1) {
            return filePath.slice(markerIndex + marker.length);
        }
    }

    return filePath;
}

/**
 * Removes Bazel output prefixes when coverage points at compiled files.
 */
function removeBazelBinPrefix(filePath) {
    if (!filePath.startsWith("bazel-out/")) {
        return filePath;
    }

    const binMarker = "/bin/";
    const binMarkerIndex = filePath.indexOf(binMarker);
    return binMarkerIndex === -1 ? filePath : filePath.slice(binMarkerIndex + binMarker.length);
}

/**
 * Groups aggregate coverage by the nearest Bazel package.
 */
function getPackageSummaries({coverageMap, workspacePath}) {
    const packageCoverageMaps = new Map();

    for (const filePath of coverageMap.files()) {
        const packagePath = findBazelPackagePath({filePath, workspacePath});
        let packageCoverageMap = packageCoverageMaps.get(packagePath);
        if (!packageCoverageMap) {
            packageCoverageMap = libCoverage.createCoverageMap({});
            packageCoverageMaps.set(packagePath, packageCoverageMap);
        }
        packageCoverageMap.addFileCoverage(coverageMap.fileCoverageFor(filePath));
    }

    return Array.from(packageCoverageMaps, ([packagePath, packageCoverageMap]) => ({
        files: packageCoverageMap.files().length,
        package: packagePath,
        summary: packageCoverageMap.getCoverageSummary().toJSON(),
    })).sort((a, b) => a.package.localeCompare(b.package));
}

/**
 * Finds the nearest ancestor BUILD file for a source path.
 */
function findBazelPackagePath({filePath, workspacePath}) {
    let packagePath = path.dirname(filePath);

    while (packagePath !== ".") {
        if (fs.existsSync(path.join(workspacePath, packagePath, "BUILD"))) {
            return packagePath;
        }
        packagePath = path.dirname(packagePath);
    }

    return ".";
}

/**
 * Writes Istanbul's standard reports and the Alpine directory index overlay.
 */
function writeIstanbulReports({coverageMap, outputPath}) {
    const context = libReport.createContext({
        coverageMap,
        dir: outputPath,
    });

    reports.create("html", {summarizer: "nested"}).execute(context);
    reports.create("lcovonly", {file: "lcov.info"}).execute(context);
    reports.create("json-summary", {file: "coverage-summary.json"}).execute(context);
    writeHierarchicalHtmlIndexes({coverageMap, outputPath});
}

/**
 * Writes a stable, newline-terminated JSON file.
 */
function writeJson(outputPath, fileName, value) {
    fs.writeFileSync(path.join(outputPath, fileName), `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Writes true click-through directory indexes over Istanbul's HTML report.
 *
 * Istanbul's nested HTML output still makes the root feel file-heavy for this
 * repo. These pages summarize each directory first, then link down into deeper
 * directories and finally into Istanbul's per-file pages.
 */
function writeHierarchicalHtmlIndexes({coverageMap, outputPath}) {
    const rootNode = createCoverageTree(coverageMap);
    summarizeCoverageTree({coverageMap, node: rootNode});
    writeCoverageTreeHtmlPages({node: rootNode, outputPath});
}

/**
 * Builds an in-memory directory tree from workspace-relative coverage paths.
 */
function createCoverageTree(coverageMap) {
    const rootNode = createCoverageTreeNode({name: "All files", nodePath: ""});

    for (const filePath of coverageMap.files().sort()) {
        const parts = filePath.split("/");
        const fileName = parts.pop();
        let node = rootNode;
        for (const part of parts) {
            let childNode = node.directories.get(part);
            if (!childNode) {
                childNode = createCoverageTreeNode({
                    name: part,
                    nodePath: joinCoveragePath(node.nodePath, part),
                });
                node.directories.set(part, childNode);
            }
            node = childNode;
        }
        node.files.push({fileName, filePath, summary: null});
    }

    return rootNode;
}

/**
 * Creates a directory node for the coverage tree.
 */
function createCoverageTreeNode({name, nodePath}) {
    return {
        directories: new Map(),
        fileCount: 0,
        files: [],
        name,
        nodePath,
        summary: null,
    };
}

/**
 * Adds recursive coverage summaries to every coverage tree directory.
 */
function summarizeCoverageTree({coverageMap, node}) {
    const nodeCoverageMap = libCoverage.createCoverageMap({});
    for (const file of node.files) {
        const fileCoverage = coverageMap.fileCoverageFor(file.filePath);
        file.summary = fileCoverage.toSummary().toJSON();
        nodeCoverageMap.addFileCoverage(fileCoverage);
    }
    for (const childNode of sortedCoverageTreeDirectories(node)) {
        const childCoverageMap = summarizeCoverageTree({coverageMap, node: childNode});
        nodeCoverageMap.merge(childCoverageMap);
    }

    node.fileCount = nodeCoverageMap.files().length;
    node.summary = nodeCoverageMap.getCoverageSummary().toJSON();
    return nodeCoverageMap;
}

/**
 * Writes an `index.html` file for each directory in the coverage tree.
 */
function writeCoverageTreeHtmlPages({node, outputPath}) {
    const indexPath =
        node.nodePath.length === 0
            ? path.join(outputPath, "index.html")
            : path.join(outputPath, node.nodePath, "index.html");
    fs.mkdirSync(path.dirname(indexPath), {recursive: true});
    fs.writeFileSync(indexPath, formatCoverageTreeHtmlPage(node));

    for (const childNode of sortedCoverageTreeDirectories(node)) {
        writeCoverageTreeHtmlPages({node: childNode, outputPath});
    }
}

/**
 * Formats one directory page for the click-through coverage tree.
 */
function formatCoverageTreeHtmlPage(node) {
    const rows = [
        ...sortedCoverageTreeDirectories(node).map(childNode =>
            formatCoverageTreeRow({
                href: coverageTreeHref({
                    fromNode: node,
                    targetPath: `${childNode.nodePath}/index.html`,
                }),
                fileCount: childNode.fileCount,
                name: `${childNode.name}/`,
                summary: childNode.summary,
                type: "directory",
            }),
        ),
        ...node.files
            .slice()
            .sort((a, b) => a.fileName.localeCompare(b.fileName))
            .map(file =>
                formatCoverageTreeRow({
                    href: coverageTreeHref({fromNode: node, targetPath: `${file.filePath}.html`}),
                    fileCount: 1,
                    name: file.fileName,
                    summary: file.summary,
                    type: "file",
                }),
            ),
    ];

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Code coverage report for ${escapeHtml(node.nodePath || "All files")}</title>
<style>
body {
    color: #17202a;
    font-family: system-ui, sans-serif;
    line-height: 1.45;
    margin: 32px;
}
a {
    color: #0550ae;
    text-decoration: none;
}
a:hover {
    text-decoration: underline;
}
.breadcrumbs, .summary {
    color: #57606a;
    margin-bottom: 16px;
}
table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
    width: 100%;
}
th, td {
    border-bottom: 1px solid #d8dee4;
    padding: 8px 10px;
    text-align: right;
}
th:first-child, td:first-child {
    text-align: left;
}
.type {
    color: #57606a;
    width: 96px;
}
.metric.high {
    color: #116329;
}
.metric.medium {
    color: #9a6700;
}
.metric.low {
    color: #cf222e;
}
</style>
</head>
<body>
<div class="breadcrumbs">${formatCoverageTreeBreadcrumbs(node)}</div>
<h1>${escapeHtml(node.nodePath || "All files")}</h1>
<p class="summary">${escapeHtml(formatCoverageTreeSummary(node))}</p>
<table>
<thead>
<tr><th>Name</th><th class="type">Type</th>${coverageMetricNames
        .map(metricName => `<th>${escapeHtml(metricName)}</th>`)
        .join("")}<th>Files</th></tr>
</thead>
<tbody>
${rows.length === 0 ? `<tr><td colspan="7">No files</td></tr>` : rows.join("\n")}
</tbody>
</table>
</body>
</html>
`;
}

/**
 * Formats a directory or file row for a coverage tree page.
 */
function formatCoverageTreeRow({fileCount, href, name, summary, type}) {
    return `<tr><td><a href="${escapeHtml(href)}">${escapeHtml(name)}</a></td><td class="type">${escapeHtml(
        type,
    )}</td>${coverageMetricNames
        .map(metricName => formatCoverageTreeMetricCell(summary[metricName]))
        .join("")}<td>${fileCount}</td></tr>`;
}

/**
 * Formats a metric cell with a threshold class for visual scanning.
 */
function formatCoverageTreeMetricCell(metric) {
    return `<td class="metric ${coverageTreeMetricClass(metric.pct)}">${formatPct(metric.pct)}</td>`;
}

/**
 * Assigns broad health classes to coverage percentages.
 */
function coverageTreeMetricClass(pct) {
    if (pct >= 80) return "high";
    if (pct >= 50) return "medium";
    return "low";
}

/**
 * Formats navigation links from the current directory back to the root.
 */
function formatCoverageTreeBreadcrumbs(node) {
    const crumbs = [
        `<a href="${escapeHtml(coverageTreeHref({fromNode: node, targetPath: "index.html"}))}">All files</a>`,
    ];
    const parts = node.nodePath.length === 0 ? [] : node.nodePath.split("/");
    for (let i = 0; i < parts.length; i++) {
        const crumbPath = parts.slice(0, i + 1).join("/");
        crumbs.push(
            `<a href="${escapeHtml(
                coverageTreeHref({fromNode: node, targetPath: `${crumbPath}/index.html`}),
            )}">${escapeHtml(parts[i])}</a>`,
        );
    }
    return crumbs.join(" / ");
}

/**
 * Formats the compact summary shown below each directory heading.
 */
function formatCoverageTreeSummary(node) {
    return `${node.fileCount} files, ${formatSummaryLine("overall", node.summary)}`;
}

/**
 * Builds a relative URL between generated coverage tree pages.
 */
function coverageTreeHref({fromNode, targetPath}) {
    const fromPath = fromNode.nodePath.length === 0 ? "." : fromNode.nodePath;
    const href = path.posix.relative(fromPath, targetPath) || "index.html";
    return href
        .split("/")
        .map(part => encodeURIComponent(part))
        .join("/");
}

/**
 * Returns child directories in stable display order.
 */
function sortedCoverageTreeDirectories(node) {
    return Array.from(node.directories.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Joins two workspace-relative coverage path segments.
 */
function joinCoveragePath(parentPath, childPath) {
    return parentPath.length === 0 ? childPath : `${parentPath}/${childPath}`;
}

/**
 * Formats the terminal and text-file coverage summary.
 */
function formatCoverageReport({
    fileCount,
    outputPath,
    overallSummary,
    packageSummaries,
    targetCount,
    uncoveredSourceFileCount,
    workspacePath,
}) {
    const lines = [];
    lines.push("Coverage report");
    lines.push(`Targets: ${targetCount}`);
    lines.push(`Files: ${fileCount}`);
    lines.push(`Uncovered source files included: ${uncoveredSourceFileCount}`);
    lines.push(`HTML: ${path.relative(workspacePath, path.join(outputPath, "index.html"))}`);
    lines.push(
        `Package HTML: ${path.relative(workspacePath, path.join(outputPath, "package-summary.html"))}`,
    );
    lines.push("");
    lines.push(formatSummaryLine("Overall", overallSummary));
    lines.push("");
    lines.push(formatPackageSummaryTable(packageSummaries));
    return lines.join("\n");
}

/**
 * Formats one aggregate coverage line for human-readable output.
 */
function formatSummaryLine(label, summary) {
    return `${label}: ${formatMetric(summary.lines)} lines, ${formatMetric(
        summary.statements,
    )} statements, ${formatMetric(summary.branches)} branches, ${formatMetric(
        summary.functions,
    )} functions`;
}

/**
 * Formats package-level coverage percentages as a fixed-width table.
 */
function formatPackageSummaryTable(packageSummaries) {
    const packageColumnWidth = Math.max(
        "Package".length,
        ...packageSummaries.map(packageSummary => packageSummary.package.length),
    );
    const lines = [];
    lines.push(
        [
            "Package".padEnd(packageColumnWidth),
            "Stmts".padStart(8),
            "Branch".padStart(8),
            "Funcs".padStart(8),
            "Lines".padStart(8),
            "Files".padStart(6),
        ].join("  "),
    );

    for (const packageSummary of packageSummaries) {
        lines.push(
            [
                packageSummary.package.padEnd(packageColumnWidth),
                formatPct(packageSummary.summary.statements.pct).padStart(8),
                formatPct(packageSummary.summary.branches.pct).padStart(8),
                formatPct(packageSummary.summary.functions.pct).padStart(8),
                formatPct(packageSummary.summary.lines.pct).padStart(8),
                String(packageSummary.files).padStart(6),
            ].join("  "),
        );
    }

    return lines.join("\n");
}

/**
 * Formats a metric with both percentage and covered-count detail.
 */
function formatMetric(metric) {
    return `${formatPct(metric.pct)} (${metric.covered}/${metric.total})`;
}

/**
 * Formats a coverage percentage consistently across reports.
 */
function formatPct(value) {
    return `${value.toFixed(2)}%`;
}

/**
 * Writes the package-level coverage HTML summary page.
 */
function writePackageSummaryHtml({outputFilePath, overallSummary, packageSummaries}) {
    fs.writeFileSync(
        outputFilePath,
        `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Unit Test Coverage by Package</title>
<style>
body {
    color: #17202a;
    font-family: system-ui, sans-serif;
    line-height: 1.45;
    margin: 32px;
}
table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
    width: 100%;
}
th, td {
    border-bottom: 1px solid #d8dee4;
    padding: 8px 10px;
    text-align: right;
}
th:first-child, td:first-child {
    text-align: left;
}
.summary {
    margin-bottom: 24px;
}
</style>
</head>
<body>
<h1>Unit Test Coverage by Package</h1>
<p class="summary">${escapeHtml(formatSummaryLine("Overall", overallSummary))}</p>
<table>
<thead>
<tr><th>Package</th>${coverageMetricNames
            .map(metricName => `<th>${escapeHtml(metricName)}</th>`)
            .join("")}<th>Files</th></tr>
</thead>
<tbody>
${packageSummaries
    .map(
        packageSummary =>
            `<tr><td>${escapeHtml(packageSummary.package)}</td>${coverageMetricNames
                .map(metricName => `<td>${formatPct(packageSummary.summary[metricName].pct)}</td>`)
                .join("")}<td>${packageSummary.files}</td></tr>`,
    )
    .join("\n")}
</tbody>
</table>
</body>
</html>
`,
    );
}

/**
 * Sends coverage percentages to the lifecycle Honeycomb dataset.
 *
 * One event records global line coverage and one event records each package's line
 * coverage. Telemetry is best-effort: report generation stays local if
 * `HONEYCOMB_API_KEY` is not present or Honeycomb keeps rejecting events.
 */
async function sendHoneycombCoverageEvents({overallSummary, packageSummaries, workspacePath}) {
    const honeycombApiKey = process.env.HONEYCOMB_API_KEY;
    if (!honeycombApiKey) return;

    const time = new Date().toISOString();
    const branchName = getGitBranchName({workspacePath});
    const events = [
        createHoneycombCoverageEvent({
            branchName,
            coverageType: "global",
            lineCoveragePercentage: overallSummary.lines.pct,
            time,
        }),
        ...packageSummaries.map(packageSummary =>
            createHoneycombCoverageEvent({
                branchName,
                coverageType: packageSummary.package,
                lineCoveragePercentage: packageSummary.summary.lines.pct,
                time,
            }),
        ),
    ];

    let lastError;
    for (let attempt = 0; attempt <= honeycombCoverageRetryCount; attempt += 1) {
        try {
            await sendHoneycombCoverageEventBatch({events, honeycombApiKey});
            return;
        } catch (error) {
            lastError = error;
            if (attempt < honeycombCoverageRetryCount) {
                await sleep(honeycombCoverageRetryDelayMs);
            }
        }
    }

    writeStderr(
        `Skipping Honeycomb coverage reporting after ${
            honeycombCoverageRetryCount + 1
        } failed attempts: ${formatErrorMessage(lastError)}`,
    );
}

/**
 * Sends one Honeycomb batch request and verifies all event responses.
 */
async function sendHoneycombCoverageEventBatch({events, honeycombApiKey}) {
    // eslint-disable-next-line cyberworlds/no-global-fetch
    const response = await fetch("https://api.honeycomb.io/1/batch/lifecycle", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-honeycomb-team": honeycombApiKey,
        },
        body: JSON.stringify(events),
    });

    if (response.status >= 400) {
        throw new Error(
            `Failed to send code coverage events to Honeycomb (status code: ${response.status})`,
        );
    }

    const eventResponses = await response.json();
    for (const eventResponse of eventResponses) {
        if (eventResponse.status >= 400) {
            throw new Error(
                `Failed to send code coverage event to Honeycomb${
                    eventResponse.error ? `: ${eventResponse.error}` : ""
                } (status code: ${eventResponse.status})`,
            );
        }
    }
}

/**
 * Resolves once the requested number of milliseconds has elapsed.
 */
function sleep(milliseconds) {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}

/**
 * Builds one Honeycomb batch event for a coverage percentage.
 */
function createHoneycombCoverageEvent({branchName, coverageType, lineCoveragePercentage, time}) {
    return {
        time,
        data: {
            name: "Finished code coverage",
            "common.branch": branchName,
            "common.type": coverageType,
            "common.count": lineCoveragePercentage,
        },
    };
}

/**
 * Resolves the current branch for local runs and detached CI checkouts.
 */
function getGitBranchName({workspacePath}) {
    const branchName =
        process.env.GITHUB_HEAD_REF ||
        process.env.GITHUB_REF_NAME ||
        runGit(["branch", "--show-current"], {cwd: workspacePath});
    return branchName || "unknown";
}

/**
 * Escapes text before interpolating it into generated HTML.
 */
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Runs a git command and returns trimmed stdout.
 */
function runGit(args, {cwd}) {
    const result = childProcess.spawnSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status !== 0) {
        throw new Error(
            `git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`,
        );
    }
    return result.stdout.trim();
}

function formatErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function writeStdout(value) {
    process.stdout.write(`${value}\n`);
}

function writeStderr(value) {
    process.stderr.write(`${value}\n`);
}
