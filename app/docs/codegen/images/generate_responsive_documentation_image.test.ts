import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import {basename, join} from "path";
import sharp from "sharp";
import {generateResponsiveDocumentationImage} from "~/app/docs/codegen/images/generate_responsive_documentation_image.js";

test("fingerprints candidates from their completed bytes", async () => {
    const directoryPath = await fs.mkdtemp(join(os.tmpdir(), "responsive-image-"));
    const sourcePath = join(directoryPath, "source.png");
    const outputDirectoryPath = join(directoryPath, "output");

    try {
        const sourceBytes = await sharp({
            create: {
                width: 641,
                height: 480,
                channels: 4,
                background: {r: 20, g: 40, b: 60, alpha: 1},
            },
        })
            .png()
            .toBuffer();
        await fs.writeFile(sourcePath, viewResponsiveDocumentationImageTestBytes(sourceBytes));

        const image = await generateResponsiveDocumentationImage({
            sourcePath,
            sourceUrl: "/blog/example/source.png",
            outputDirectoryPath,
            outputRelativePath: "source.png",
            outputUrlBase: "/blog/example/_responsive/source.png/source",
            copyStableSource: false,
        });
        const candidateUrl = image.srcSet.split(",")[0]!.split(" ")[0]!;
        const candidateBytes = await fs.readFile(join(outputDirectoryPath, basename(candidateUrl)));
        const candidateHash = crypto
            .createHash("sha256")
            .update(viewResponsiveDocumentationImageTestBytes(candidateBytes))
            .digest("hex")
            .slice(0, 16);
        const sourceHash = crypto
            .createHash("sha256")
            .update(viewResponsiveDocumentationImageTestBytes(sourceBytes))
            .digest("hex")
            .slice(0, 16);

        expect({candidateUrl, src: image.src}).toEqual({
            candidateUrl: `/blog/example/_responsive/source.png/source.${candidateHash}.320w.webp`,
            src: `/blog/example/_responsive/source.png/source.${sourceHash}.png`,
        });
    } finally {
        await fs.rm(directoryPath, {recursive: true, force: true});
    }
});

function viewResponsiveDocumentationImageTestBytes(bytes: Buffer): Uint8Array {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

test("can omit the stable source copy", async () => {
    const directoryPath = await fs.mkdtemp(join(os.tmpdir(), "responsive-image-"));
    const sourcePath = join(directoryPath, "source.png");
    const outputDirectoryPath = join(directoryPath, "output");

    try {
        await sharp({
            create: {
                width: 1,
                height: 1,
                channels: 4,
                background: {r: 20, g: 40, b: 60, alpha: 1},
            },
        })
            .png()
            .toFile(sourcePath);
        await generateResponsiveDocumentationImage({
            sourcePath,
            sourceUrl: "/blog/example/source.png",
            outputDirectoryPath,
            outputRelativePath: "source.png",
            copyStableSource: false,
        });

        await expect(fs.stat(join(outputDirectoryPath, "source.png"))).rejects.toThrow("ENOENT");
    } finally {
        await fs.rm(directoryPath, {recursive: true, force: true});
    }
});
