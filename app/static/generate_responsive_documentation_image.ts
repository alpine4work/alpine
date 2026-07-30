import crypto from "crypto";
import fs from "fs/promises";
import {dirname, extname, join} from "path";
import sharp from "sharp";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const documentationImageWidths = [320, 640, 960, 1280, 1600] as const;
const documentationAnimatedImageWidths = [320, 640] as const;
const documentationAuthorImageWidths = [24, 48, 72] as const;

export type ResponsiveDocumentationImage = {
    src: string;
    srcSet: string;
    width: number;
    height: number;
};

/**
 * Create an immutable original and responsive WebP candidates for one image.
 */
export async function generateResponsiveDocumentationImage({
    sourcePath,
    sourceUrl,
    outputDirectoryPath,
    outputRelativePath,
    outputUrlBase,
    isAuthorImage = false,
    copyStableSource = true,
}: {
    sourcePath: string;
    sourceUrl: string;
    outputDirectoryPath: string;
    outputRelativePath: string;
    outputUrlBase?: string;
    isAuthorImage?: boolean;
    copyStableSource?: boolean;
}): Promise<ResponsiveDocumentationImage> {
    const sourceBytes = await fs.readFile(sourcePath);
    const sourceHash = hashResponsiveDocumentationImageBytes(sourceBytes);
    const metadata = await sharp(sourceBytes, {
        animated: true,
        limitInputPixels: false,
    }).metadata();
    const width = assertExists(metadata.width, `Expected image width for ${sourcePath}`);
    const height = assertExists(
        metadata.pageHeight ?? metadata.height,
        `Expected image height for ${sourcePath}`,
    );
    const isAnimated = (metadata.pages ?? 1) > 1;
    const extension = extname(outputRelativePath);
    const outputRelativeBasePath = outputRelativePath.slice(0, -extension.length);
    const generatedUrlBase = outputUrlBase ?? sourceUrl.slice(0, -extension.length);
    const immutableSourceRelativePath = `${outputRelativeBasePath}.${sourceHash}${extension}`;
    const immutableSourcePath = join(outputDirectoryPath, immutableSourceRelativePath);

    if (copyStableSource) {
        const outputSourcePath = join(outputDirectoryPath, outputRelativePath);
        await fs.mkdir(dirname(outputSourcePath), {recursive: true});
        await fs.writeFile(
            outputSourcePath,
            viewResponsiveDocumentationImageBufferBytes(sourceBytes),
        );
    }

    // Preserve the original encoding as the largest candidate so animated media and
    // formats that outperform WebP keep their authored quality.
    await fs.mkdir(dirname(immutableSourcePath), {recursive: true});
    await fs.writeFile(
        immutableSourcePath,
        viewResponsiveDocumentationImageBufferBytes(sourceBytes),
    );

    // Avatars only render at small sizes, while large animated conversions are capped
    // to control both build cost and transferred bytes.
    const configuredWidths = isAuthorImage
        ? documentationAuthorImageWidths
        : isAnimated
          ? documentationAnimatedImageWidths
          : documentationImageWidths;
    const candidateWidths = configuredWidths.filter(candidateWidth => candidateWidth < width);
    const sourceSet: Array<{src: string; width: number}> = [];

    for (const candidateWidth of candidateWidths) {
        const candidateBytes = await sharp(sourceBytes, {
            animated: isAnimated,
            limitInputPixels: false,
        })
            .resize({width: candidateWidth})
            .webp({quality: 80, effort: 2, smartSubsample: true})
            .toBuffer();
        const candidateHash = hashResponsiveDocumentationImageBytes(candidateBytes);
        const candidateRelativePath = `${outputRelativeBasePath}.${candidateHash}.${candidateWidth}w.webp`;
        const candidatePath = join(outputDirectoryPath, candidateRelativePath);

        await fs.mkdir(dirname(candidatePath), {recursive: true});
        await fs.writeFile(
            candidatePath,
            viewResponsiveDocumentationImageBufferBytes(candidateBytes),
        );
        sourceSet.push({
            src: `${generatedUrlBase}.${candidateHash}.${candidateWidth}w.webp`,
            width: candidateWidth,
        });
    }

    // Always include the original width so large layouts have a candidate without
    // upscaling a smaller generated variant.
    const immutableSourceUrl = `${generatedUrlBase}.${sourceHash}${extension}`;
    sourceSet.push({src: immutableSourceUrl, width});
    return {
        src: immutableSourceUrl,
        srcSet: sourceSet.map(source => `${source.src} ${source.width}w`).join(", "),
        width,
        height,
    };
}

function hashResponsiveDocumentationImageBytes(bytes: Buffer): string {
    return crypto
        .createHash("sha256")
        .update(viewResponsiveDocumentationImageBufferBytes(bytes))
        .digest("hex")
        .slice(0, 16);
}

function viewResponsiveDocumentationImageBufferBytes(bytes: Buffer): Uint8Array {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
