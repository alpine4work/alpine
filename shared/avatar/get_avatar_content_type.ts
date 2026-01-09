/**
 * Get the content type for some avatar content. Avatars are either PNG or
 * AVIF. If we processed the avatar then it's AVIF. However, for convenience
 * when creating a space for a company we take a small PNG of the company's
 * logo verbatim from Logo.dev and use it without processing (until we can
 * process the full sized logo later).
 */
export function getAvatarContentType(content: Uint8Array): string {
    // PNGs always start with the following 8 bytes. Source:
    // https://www.w3.org/TR/png/#5PNG-file-signature
    if (
        content[0] === 0x89 &&
        content[1] === 0x50 &&
        content[2] === 0x4e &&
        content[3] === 0x47 &&
        content[4] === 0x0d &&
        content[5] === 0x0a &&
        content[6] === 0x1a &&
        content[7] === 0x0a
    ) {
        return "image/png";
    }

    return "image/avif";
}
