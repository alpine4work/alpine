import fs from "fs/promises";
import {Font, parse} from "opentype.js";
import {join} from "path";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import sharp from "sharp";
import {decompress} from "wawoff2";
import {LogoWordmarkBase} from "~/shared/design/logo_wordmark_base.js";
import {DocumentationApiMethod} from "~/shared/docs/documentation_api_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export type DocumentationOpenGraphImageDocument =
    | {
          type: "BlogHome";
          title: string;
      }
    | {
          type: "Blog";
          title: string;
          author: {
              name: string;
              avatar: Buffer;
          };
      }
    | {
          type: "Documentation";
          title: string;
          description?: string;
      }
    | {
          type: "APIReference";
          title: string;
          description?: string;
          method?: DocumentationApiMethod;
      };

type DocumentationOpenGraphImageFonts = {
    title: Font;
    subtitle: Font;
    monospace: Font;
};

type DocumentationOpenGraphImageLayout = {
    titleFont: Font;
    titleLayout: {fontSize: number; lines: Array<string>};
    titleTop: number;
    description?: string;
    author?: {name: string; avatar: Buffer};
    method?: DocumentationApiMethod;
};

// Canvas width required by Open Graph consumers.
const imageWidth = 1200;
// Canvas height required by Open Graph consumers.
const imageHeight = 630;

// Shared horizontal inset for every foreground element.
const contentLeft = 82;
// Available text width after applying equal left and right insets.
const contentWidth = imageWidth - contentLeft * 2;

// Primary color used by the logo, titles, mountain, and avatar outline.
const inkColor = "#0b0b0d";
// Secondary color used by the document type and blog author.
const secondaryInkColor = "#3d3d42";
// Softer color used by support and API descriptions.
const descriptionColor = "#4d4d52";
// Color of the divider between the logo and document type.
const dividerColor = "#c4c4c7";
// Solid canvas color beneath the mountain and rainbow glow.
const backgroundColor = "#ffffff";

// Width of the Alpine wordmark in the rendered image.
const logoWidth = 200;
// Native SVG width used to scale the Alpine wordmark paths.
const logoNativeWidth = 717.4301;
// Native SVG height used to preserve the Alpine wordmark aspect ratio.
const logoNativeHeight = 225.6489;
// Derived rendered height of the Alpine wordmark.
const logoHeight = logoWidth / (logoNativeWidth / logoNativeHeight);
// Distance from the top edge to the Alpine wordmark.
const logoTop = 63;

// Horizontal offset from the content edge to the document type.
const headerSubtitleLeftOffset = 246;
// Font size of Blog, Documentation, and API Reference beside the logo.
const headerSubtitleFontSize = 43;
// Horizontal offset from the content edge to the logo divider.
const dividerLeftOffset = 222;
// Distance from the top edge to the logo divider.
const dividerTop = 70;
// Width of the logo divider.
const dividerWidth = 2;
// Height of the logo divider.
const dividerHeight = 49;
// Corner radius of the logo divider.
const dividerRadius = 1;

// Top of blog and support titles.
const standardTitleTop = 155;
// Top of API page and schema titles without an HTTP method.
const apiReferenceTitleTop = 175;
// Top of API endpoint titles with an HTTP method badge.
const apiOperationTitleTop = 205;
// Largest title size for blog and support documents.
const standardTitleMaximumFontSize = 72;
// Largest title size for monospace API titles.
const apiTitleMaximumFontSize = 60;
// Smallest title size used by ordinary word wrapping.
const titleMinimumFontSize = 42;
// Amount subtracted on each title resizing attempt.
const titleFontSizeStep = 2;
// Maximum number of lines allowed for ordinary word wrapping.
const titleMaximumLineCount = 3;
// Extra space added to the font size for a consistent wrapped-title baseline
// advance.
const wrappedTitleLinePadding = 18;
// Font size used when ordinary title fitting cannot find a layout.
const fallbackTitleFontSize = 40;
// Largest font size tested while finding an API-specific split point.
const apiSplitProbeMaximumFontSize = 40;
// Smallest font size allowed for an API-specific split layout.
const apiSplitMinimumFontSize = 32;

// Gap from the final title baseline to a support or API description.
const descriptionTopGap = 45;
// Font size of support and API descriptions.
const descriptionFontSize = 32;
// Distance between description baselines.
const descriptionLineHeight = 40;
// Maximum number of visible description lines before truncation.
const descriptionMaximumLineCount = 2;

// Gap from the final blog title baseline to the top of the author avatar.
const authorTopGap = 55;
// Diameter of a blog author avatar.
const avatarSize = 68;
// Radius shared by the avatar mask and subtle outline.
const avatarRadius = avatarSize / 2;
// Horizontal gap between the avatar and author name.
const authorNameLeftGap = 16;
// Font size of the blog author name.
const authorNameFontSize = 32;
// Baseline offset that vertically centers the author name with the avatar.
const authorNameBaselineOffset = 48;
// Opacity of the subtle outline around a blog author avatar.
const avatarOutlineOpacity = 0.1;

// Font size of the HTTP method inside its badge.
const methodFontSize = 26;
// Horizontal padding on each side of the HTTP method.
const methodHorizontalPadding = 18;
// Distance from the top edge to the HTTP method badge.
const methodTop = 141;
// Height of the HTTP method badge.
const methodHeight = 50;
// Corner radius of the HTTP method badge.
const methodRadius = 10;
// Baseline of the HTTP method label.
const methodBaseline = 177;
// Colors used for each supported HTTP method badge.
const methodColors: Record<DocumentationApiMethod, {background: string; foreground: string}> = {
    GET: {background: "#eaf2ff", foreground: "#2864c7"},
    POST: {background: "#e8f8ef", foreground: "#168451"},
    PUT: {background: "#fff3df", foreground: "#a85a00"},
    PATCH: {background: "#f4ecff", foreground: "#7840ac"},
    DELETE: {background: "#ffeded", foreground: "#bd3a3a"},
};

// Scale applied to the homepage mountain before cropping it to the canvas.
const mountainScale = 2;
// Derived width of the scaled mountain.
const mountainWidth = Math.round(imageWidth * mountainScale);
// Additional horizontal crop adjustment after centering the mountain.
const mountainLeftAdjustment = 100;
// Vertical crop offset within the scaled mountain source.
const mountainCropTop = 0;
// Distance from the top edge to the composited mountain layer.
const mountainTop = 198;
// Derived visible height of the mountain layer.
const mountainHeight = imageHeight - mountainTop;
// Opacity applied to the monochrome mountain linework.
const mountainOpacity = 0.09;

// Subtle rainbow glows composited across the bottom of the canvas.
const backgroundGlows = [
    // Teal glow anchored toward the lower-left corner.
    {id: "teal", x: "28%", y: "115%", radius: "55%", color: "#1fa4ab", opacity: 0.09},
    // Blue glow spanning the lower middle of the image.
    {id: "blue", x: "49%", y: "125%", radius: "57%", color: "#2174b8", opacity: 0.075},
    // Pink glow spanning the lower-right portion of the image.
    {id: "pink", x: "70%", y: "119%", radius: "54%", color: "#d64dd4", opacity: 0.07},
    // Purple glow finishing the rainbow at the far-right edge.
    {id: "purple", x: "88%", y: "123%", radius: "48%", color: "#5b009c", opacity: 0.055},
] as const;

// Decimal precision used when serializing font outlines into SVG paths.
const svgPathDecimalPlaces = 2;
const runfilesPath = assertExists(process.env.RUNFILES);

const openGraphAssetDirectoryPath = join(
    runfilesPath,
    "cyberworlds/app/docs/codegen/opengraph/assets",
);
const interFontPath = join(runfilesPath, "cyberworlds/app/static/fonts/inter.woff2");
const commitMonoFontPath = join(runfilesPath, "cyberworlds/app/static/fonts/commit-mono.woff2");
let imageFontsPromise: ReturnType<typeof loadImageFonts> | undefined;
let mountainLayerPromise: ReturnType<typeof createMountainLayer> | undefined;
const logoMarkup = createLogoMarkup();

/**
 * Render one production-ready 1200×630 Open Graph image for any documentation
 * type.
 */
export async function renderDocumentationOpenGraphImage(
    document: DocumentationOpenGraphImageDocument,
): Promise<Buffer> {
    // Fonts and the mountain are immutable across requests, so load their cached
    // promises together before doing document-specific layout.
    const [fonts, mountainLayer] = await runAllPromises([
        loadImageFontsOnce(),
        createMountainLayerOnce(),
    ]);

    // Resolve every type-specific layout choice together so adding a document type
    // cannot silently inherit the wrong font, vertical position, or supporting row.
    const documentLayout = createDocumentLayout(document, fonts);
    const {titleFont, titleLayout, titleTop} = documentLayout;

    // Baselines advance by one font size plus fixed padding. Keeping this value
    // independent of glyph bounds prevents descenders from changing line spacing.
    const titleLineHeight = titleLayout.fontSize + wrappedTitleLinePadding;
    const titlePaths = titleLayout.lines
        .map((line, index) =>
            titleFont
                .getPath(
                    line,
                    contentLeft,
                    titleTop + titleLayout.fontSize + index * titleLineHeight,
                    titleLayout.fontSize,
                    {kerning: true},
                )
                .toPathData(svgPathDecimalPlaces),
        )
        .map(path => `<path d="${path}" fill="${inkColor}"/>`)
        .join("");
    const titleLastBaseline =
        titleTop + titleLayout.fontSize + (titleLayout.lines.length - 1) * titleLineHeight;

    // Blog images use an author row instead of a description. Documentation and API
    // descriptions flow from the final title baseline so wrapped titles push them
    // down.
    const descriptionPaths =
        documentLayout.description === undefined
            ? ""
            : createDescriptionPaths(fonts.subtitle, documentLayout.description, titleLastBaseline);

    // OpenType positions text by baseline, not visual center. Measure the subtitle at
    // an arbitrary baseline, then offset its glyph bounds to center against the logo.
    const headerSubtitle = headerSubtitleForDocument(document);
    const uncenteredHeaderSubtitlePath = fonts.subtitle.getPath(
        headerSubtitle,
        contentLeft + headerSubtitleLeftOffset,
        0,
        headerSubtitleFontSize,
        {kerning: true},
    );
    const headerSubtitleBounds = uncenteredHeaderSubtitlePath.getBoundingBox();
    const headerSubtitleBaseline =
        logoTop + logoHeight / 2 - (headerSubtitleBounds.y1 + headerSubtitleBounds.y2) / 2;
    const headerSubtitlePath = fonts.subtitle
        .getPath(
            headerSubtitle,
            contentLeft + headerSubtitleLeftOffset,
            headerSubtitleBaseline,
            headerSubtitleFontSize,
            {kerning: true},
        )
        .toPathData(svgPathDecimalPlaces);

    // The author row follows the final title line. Its text baseline is tuned to the
    // avatar center rather than to the top of the row.
    const authorTop = Math.round(titleLastBaseline + authorTopGap);
    const authorPath =
        documentLayout.author === undefined
            ? ""
            : fonts.subtitle
                  .getPath(
                      documentLayout.author.name,
                      contentLeft + avatarSize + authorNameLeftGap,
                      authorTop + authorNameBaselineOffset,
                      authorNameFontSize,
                      {kerning: true},
                  )
                  .toPathData(svgPathDecimalPlaces);
    const methodMarkup =
        documentLayout.method === undefined
            ? ""
            : createMethodMarkup(fonts.subtitle, documentLayout.method);
    const avatarOutline =
        documentLayout.author === undefined
            ? ""
            : `<circle cx="${contentLeft + avatarRadius}" cy="${authorTop + avatarRadius}" r="${avatarRadius}" fill="none" stroke="${inkColor}" stroke-opacity="${avatarOutlineOpacity}"/>`;

    // Rasterize all vector foreground elements once. The avatar remains a separate
    // bitmap layer so Sharp can crop and mask the original image without SVG encoding.
    const foregroundSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}">
            <rect x="${contentLeft + dividerLeftOffset}" y="${dividerTop}" width="${dividerWidth}" height="${dividerHeight}" rx="${dividerRadius}" fill="${dividerColor}"/>
            <path d="${headerSubtitlePath}" fill="${secondaryInkColor}"/>
            ${methodMarkup}
            ${titlePaths}
            ${descriptionPaths}
            ${authorPath === "" ? "" : `<path d="${authorPath}" fill="${secondaryInkColor}"/>`}
            ${avatarOutline}
            ${logoMarkup}
        </svg>`,
    );
    const foregroundLayer = await sharp(foregroundSvg).png().toBuffer();

    // Composite from back to front: mountain linework, vector typography, then the
    // optional author avatar. The rainbow glow is already part of the base image.
    const layers: Array<sharp.OverlayOptions> = [
        {
            input: mountainLayer,
            left: 0,
            top: mountainTop,
        },
        {input: foregroundLayer, left: 0, top: 0},
    ];
    if (documentLayout.author !== undefined) {
        layers.push({
            input: await createAvatarLayer(documentLayout.author.avatar),
            left: contentLeft,
            top: authorTop,
        });
    }

    // Sharp performs the final alpha compositing and emits the production PNG.
    return await sharp(createBackgroundSvg()).composite(layers).png().toBuffer();
}

/** Resolve every renderer choice that varies by Open Graph document type. */
function createDocumentLayout(
    document: DocumentationOpenGraphImageDocument,
    fonts: DocumentationOpenGraphImageFonts,
): DocumentationOpenGraphImageLayout {
    switch (document.type) {
        case "BlogHome":
            return {
                titleFont: fonts.title,
                titleLayout: createTitleLayout({
                    font: fonts.title,
                    title: document.title,
                    maxWidth: contentWidth,
                    maxFontSize: standardTitleMaximumFontSize,
                }),
                titleTop: standardTitleTop,
            };
        case "Blog":
            return {
                titleFont: fonts.title,
                titleLayout: createTitleLayout({
                    font: fonts.title,
                    title: document.title,
                    maxWidth: contentWidth,
                    maxFontSize: standardTitleMaximumFontSize,
                }),
                titleTop: standardTitleTop,
                author: document.author,
            };
        case "Documentation":
            return {
                titleFont: fonts.title,
                titleLayout: createTitleLayout({
                    font: fonts.title,
                    title: document.title,
                    maxWidth: contentWidth,
                    maxFontSize: standardTitleMaximumFontSize,
                }),
                titleTop: standardTitleTop,
                ...(document.description === undefined ? {} : {description: document.description}),
            };
        case "APIReference": {
            const title =
                document.method === undefined
                    ? document.title
                    : document.title.replace(
                          new RegExp(`^${document.method}(?:\\s+|:\\s*)`, "i"),
                          "",
                      );
            return {
                titleFont: fonts.monospace,
                titleLayout: createApiReferenceTitleLayout(fonts.monospace, title, contentWidth),
                titleTop:
                    document.method === undefined ? apiReferenceTitleTop : apiOperationTitleTop,
                ...(document.description === undefined ? {} : {description: document.description}),
                ...(document.method === undefined ? {} : {method: document.method}),
            };
        }
        default:
            throw exhaustive(document);
    }
}

/** Load and cache the three fonts shared by every rendered image. */
function loadImageFontsOnce(): ReturnType<typeof loadImageFonts> {
    // Clear a rejected promise so the preview server can retry after a source fix.
    imageFontsPromise ??= loadImageFonts().catch(error => {
        imageFontsPromise = undefined;
        throw error;
    });
    return imageFontsPromise;
}

/**
 * Build and cache the immutable mountain overlay shared by every rendered image.
 */
function createMountainLayerOnce(): ReturnType<typeof createMountainLayer> {
    // Clear a rejected promise so a bad crop does not poison later preview requests.
    mountainLayerPromise ??= createMountainLayer().catch(error => {
        mountainLayerPromise = undefined;
        throw error;
    });
    return mountainLayerPromise;
}

/** Read, decompress, and parse the title, supporting, and monospace fonts. */
async function loadImageFonts(): Promise<DocumentationOpenGraphImageFonts> {
    // Read independent font assets concurrently. The title font is a native TTF, while
    // the two site fonts are WOFF2 binaries.
    const [titleFontTtf, interFontWoff2, commitMonoFontWoff2] = await runAllPromises([
        fs.readFile(join(openGraphAssetDirectoryPath, "dm_serif_display_regular.ttf")),
        fs.readFile(interFontPath),
        fs.readFile(commitMonoFontPath),
    ]);

    // OpenType parses raw sfnt data, so expand WOFF2 and slice the exact view rather
    // than passing its potentially larger backing ArrayBuffer.
    const interFontTtf = await decompress(interFontWoff2);
    const interFontBuffer = interFontTtf.buffer.slice(
        interFontTtf.byteOffset,
        interFontTtf.byteOffset + interFontTtf.byteLength,
    );
    const commitMonoFontTtf = await decompress(commitMonoFontWoff2);
    const commitMonoFontBuffer = commitMonoFontTtf.buffer.slice(
        commitMonoFontTtf.byteOffset,
        commitMonoFontTtf.byteOffset + commitMonoFontTtf.byteLength,
    );
    return {
        title: parse(
            titleFontTtf.buffer.slice(
                titleFontTtf.byteOffset,
                titleFontTtf.byteOffset + titleFontTtf.byteLength,
            ),
        ),
        subtitle: parse(interFontBuffer),
        monospace: parse(commitMonoFontBuffer),
    };
}

/**
 * Convert the homepage mountain artwork into a cropped, low-opacity ink overlay.
 */
async function createMountainLayer(): Promise<Buffer> {
    const mountain = await fs.readFile(
        join(openGraphAssetDirectoryPath, "alpine_homepage_mountain.avif"),
    );

    // Scale first, then take a canvas-width crop around the center plus the manual
    // focal-point adjustment. Negating the grayscale channel turns dark linework into
    // alpha values for an ink-colored overlay.
    const alpha = await sharp(mountain)
        .resize({width: mountainWidth})
        .extract({
            left: Math.round((mountainWidth - imageWidth) / 2) + mountainLeftAdjustment,
            top: mountainCropTop,
            width: imageWidth,
            height: mountainHeight,
        })
        .greyscale()
        .extractChannel(0)
        .negate()
        .raw()
        .toBuffer({resolveWithObject: true});

    // Raw alpha values are 0–255. Multiplying each byte applies the configured opacity
    // before joining the channel to a solid ink image.
    for (let index = 0; index < alpha.data.length; index++) {
        alpha.data[index] = Math.round(assertExists(alpha.data[index]) * mountainOpacity);
    }

    // Create the RGB ink plane, attach the processed alpha channel, and encode it as a
    // reusable transparent PNG layer.
    return await sharp({
        create: {
            width: alpha.info.width,
            height: alpha.info.height,
            channels: 3,
            background: inkColor,
        },
    })
        .joinChannel(alpha.data, {
            raw: {width: alpha.info.width, height: alpha.info.height, channels: 1},
        })
        .png()
        .toBuffer();
}

/** Extract and position the Alpine wordmark's inner SVG markup. */
function createLogoMarkup(): string {
    const svg = renderToStaticMarkup(
        createElement(LogoWordmarkBase, {size: logoWidth, color: inkColor}),
    );

    // The foreground already owns the outer SVG. Keep only the logo's children and
    // scale its native coordinate system into the configured display width.
    const contents = svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));
    const scale = logoWidth / logoNativeWidth;
    return `<g transform="translate(${contentLeft} ${logoTop}) scale(${scale})" fill="${inkColor}">${contents}</g>`;
}

/**
 * Create the white canvas and subtle rainbow glow beneath all foreground layers.
 */
function createBackgroundSvg(): Buffer {
    // Define one radial gradient per configured color so their positions and falloff
    // can be tuned independently at the top of this module.
    const gradientDefinitions = backgroundGlows
        .map(
            glow => `<radialGradient id="${glow.id}" cx="${glow.x}" cy="${glow.y}" r="${glow.radius}">
                <stop offset="0" stop-color="${glow.color}" stop-opacity="${glow.opacity}"/>
                <stop offset="1" stop-color="${glow.color}" stop-opacity="0"/>
            </radialGradient>`,
        )
        .join("");

    // Full-canvas rectangles blend the radial gradients naturally where they overlap.
    const gradientLayers = backgroundGlows
        .map(
            glow => `<rect width="${imageWidth}" height="${imageHeight}" fill="url(#${glow.id})"/>`,
        )
        .join("");
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}">
        <defs>${gradientDefinitions}</defs>
        <rect width="${imageWidth}" height="${imageHeight}" fill="${backgroundColor}"/>
        ${gradientLayers}
    </svg>`);
}

/**
 * Find the largest title size that fits within the width and line-count limits.
 */
function createTitleLayout({
    font,
    title,
    maxWidth,
    maxFontSize,
}: {
    font: Font;
    title: string;
    maxWidth: number;
    maxFontSize: number;
}): {fontSize: number; lines: Array<string>} {
    // Try the largest size first and step down only when width or line count
    // overflows.
    for (
        let fontSize = maxFontSize;
        fontSize >= titleMinimumFontSize;
        fontSize -= titleFontSizeStep
    ) {
        const lines: Array<string> = [];

        // Greedily pack whole words onto each line. Measuring with the actual font and
        // kerning keeps the result aligned with the paths rendered later.
        for (const word of title.trim().split(/\s+/)) {
            const line = lines.at(-1);
            const candidate = line === undefined ? word : `${line} ${word}`;
            if (
                line === undefined ||
                font.getAdvanceWidth(candidate, fontSize, {kerning: true}) <= maxWidth
            ) {
                if (line === undefined) lines.push(word);
                else lines[lines.length - 1] = candidate;
            } else {
                lines.push(word);
            }
        }
        const fitsWidth = lines.every(
            line => font.getAdvanceWidth(line, fontSize, {kerning: true}) <= maxWidth,
        );
        if (lines.length <= titleMaximumLineCount && fitsWidth) {
            return {fontSize, lines};
        }
    }

    // A single unbroken token cannot be word-wrapped. Return the safe fallback size so
    // API-specific logic can try semantic split points afterward.
    return {fontSize: fallbackTitleFontSize, lines: [title]};
}

/**
 * Fit an API title, splitting paths or identifiers at meaningful syntax
 * boundaries.
 */
function createApiReferenceTitleLayout(
    font: Font,
    title: string,
    maxWidth: number,
): {fontSize: number; lines: Array<string>} {
    const titleLayout = createTitleLayout({
        font,
        title,
        maxWidth,
        maxFontSize: apiTitleMaximumFontSize,
    });
    if (
        titleLayout.lines.every(
            line => font.getAdvanceWidth(line, titleLayout.fontSize, {kerning: true}) <= maxWidth,
        )
    ) {
        return titleLayout;
    }

    // Paths split before a slash. Schema/type identifiers split before capitalized
    // words, including the underscore that precedes a response suffix.
    const isPath = title.startsWith("/");
    const identifierWordPattern = /[A-Z]+(?=[A-Z][a-z]|_|$)|[A-Z][a-z0-9]*/g;
    const breakIndexes = isPath
        ? [...title.matchAll(/\//g)]
              .map(match => match.index)
              .filter(index => index > 0)
              .reverse()
        : [...title.matchAll(identifierWordPattern)]
              .map(match =>
                  match.index > 0 && title[match.index - 1] === "_" ? match.index - 1 : match.index,
              )
              .filter(index => index > 0)
              .reverse();

    // Starting from the end favors a longer first line. Probe smaller font sizes until
    // both halves fit, but do not commit the size until orphan correction is complete.
    let selectedBreakIndex: number | undefined;
    for (
        let fontSize = apiSplitProbeMaximumFontSize;
        fontSize >= apiSplitMinimumFontSize;
        fontSize -= titleFontSizeStep
    ) {
        for (const breakIndex of breakIndexes) {
            const lines = [title.slice(0, breakIndex), title.slice(breakIndex)];
            if (
                lines.every(
                    line => font.getAdvanceWidth(line, fontSize, {kerning: true}) <= maxWidth,
                )
            ) {
                selectedBreakIndex = breakIndex;
                break;
            }
        }
        if (selectedBreakIndex !== undefined) break;
    }
    if (selectedBreakIndex === undefined) return titleLayout;

    // A single identifier word on the second line looks orphaned. Move the preceding
    // word down too, then rerun sizing so the balanced lines are as large as possible.
    const selectedBreakIndexPosition = breakIndexes.indexOf(selectedBreakIndex);
    const nextLineWordCount = isPath
        ? Number.MAX_SAFE_INTEGER
        : [...title.slice(selectedBreakIndex).matchAll(identifierWordPattern)].length;
    if (nextLineWordCount === 1) {
        selectedBreakIndex = breakIndexes[selectedBreakIndexPosition + 1] ?? selectedBreakIndex;
    }

    const lines = [title.slice(0, selectedBreakIndex), title.slice(selectedBreakIndex)];

    // The chosen break may fit at a larger size than the probe that discovered it.
    for (
        let fontSize = apiTitleMaximumFontSize;
        fontSize >= apiSplitMinimumFontSize;
        fontSize -= titleFontSizeStep
    ) {
        if (
            lines.every(line => font.getAdvanceWidth(line, fontSize, {kerning: true}) <= maxWidth)
        ) {
            return {fontSize, lines};
        }
    }
    return titleLayout;
}

/**
 * Return the short document-type label displayed beside the Alpine wordmark.
 */
function headerSubtitleForDocument(document: DocumentationOpenGraphImageDocument): string {
    switch (document.type) {
        case "BlogHome":
        case "Blog":
            return "Blog";
        case "Documentation":
            return "Documentation";
        case "APIReference":
            return "API Reference";
        default:
            throw exhaustive(document);
    }
}

/**
 * Wrap a documentation or API description and serialize its font outlines as SVG
 * paths.
 */
function createDescriptionPaths(
    font: Font,
    description: string,
    titleLastBaseline: number,
): string {
    // Descriptions follow the final title baseline, so one-, two-, and three-line
    // titles all preserve the same title-to-description gap.
    const descriptionTop = titleLastBaseline + descriptionTopGap;
    const lines = createWrappedTextLines({
        font,
        text: description,
        fontSize: descriptionFontSize,
        maxWidth: contentWidth,
        maxLines: descriptionMaximumLineCount,
    });

    // OpenType accepts baselines. Add one font size to the top edge for the first
    // line, then advance later lines by the configured description line height.
    return lines
        .map((line, index) =>
            font
                .getPath(
                    line,
                    contentLeft,
                    descriptionTop + descriptionFontSize + index * descriptionLineHeight,
                    descriptionFontSize,
                    {kerning: true},
                )
                .toPathData(svgPathDecimalPlaces),
        )
        .map(path => `<path d="${path}" fill="${descriptionColor}"/>`)
        .join("");
}

/**
 * Greedily wrap text to a fixed line count and truncate overflow with an ellipsis.
 */
function createWrappedTextLines({
    font,
    text,
    fontSize,
    maxWidth,
    maxLines,
}: {
    font: Font;
    text: string;
    fontSize: number;
    maxWidth: number;
    maxLines: number;
}): Array<string> {
    const lines: Array<string> = [];

    // Measure every candidate with the same font settings used for final rendering.
    for (const word of text.trim().split(/\s+/)) {
        const line = lines.at(-1);
        const candidate = line === undefined ? word : `${line} ${word}`;
        if (
            line === undefined ||
            font.getAdvanceWidth(candidate, fontSize, {kerning: true}) <= maxWidth
        ) {
            if (line === undefined) lines.push(word);
            else lines[lines.length - 1] = candidate;
            continue;
        }
        if (lines.length < maxLines) {
            lines.push(word);
            continue;
        }

        // Once no more lines are available, remove whole trailing words until an ellipsis
        // fits. This avoids clipping partial glyphs at the content boundary.
        const ellipsis = "…";
        let truncatedLine = `${line}${ellipsis}`;
        while (
            font.getAdvanceWidth(truncatedLine, fontSize, {kerning: true}) > maxWidth &&
            truncatedLine.includes(" ")
        ) {
            truncatedLine = `${truncatedLine.slice(0, truncatedLine.lastIndexOf(" "))}${ellipsis}`;
        }
        lines[lines.length - 1] = truncatedLine;
        return lines;
    }
    return lines;
}

/**
 * Create the background rectangle and text outline for an HTTP method badge.
 */
function createMethodMarkup(font: Font, method: DocumentationApiMethod): string {
    const color = methodColors[method];

    // The badge width is the kerned label width plus equal padding on both sides.
    const width =
        font.getAdvanceWidth(method, methodFontSize, {kerning: true}) + methodHorizontalPadding * 2;
    const path = font
        .getPath(method, contentLeft + methodHorizontalPadding, methodBaseline, methodFontSize, {
            kerning: true,
        })
        .toPathData(svgPathDecimalPlaces);
    return `<rect x="${contentLeft}" y="${methodTop}" width="${width}" height="${methodHeight}" rx="${methodRadius}" fill="${color.background}"/>
        <path d="${path}" fill="${color.foreground}"/>`;
}

/**
 * Crop an author image to a centered circle and encode it as a transparent PNG.
 */
async function createAvatarLayer(avatar: Buffer): Promise<Buffer> {
    // `dest-in` preserves source pixels only where the opaque circle mask exists.
    const circleMask = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${avatarSize}" height="${avatarSize}"><circle cx="${avatarRadius}" cy="${avatarRadius}" r="${avatarRadius}" fill="${backgroundColor}"/></svg>`,
    );
    return await sharp(avatar)
        .resize(avatarSize, avatarSize, {fit: "cover"})
        .composite([{input: circleMask, blend: "dest-in"}])
        .png()
        .toBuffer();
}
