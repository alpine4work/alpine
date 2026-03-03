/**
 * Get the content type for some avatar content. Avatars are either PNG or AVIF. If
 * we processed the avatar then it's AVIF. However, for convenience when creating a
 * space for a company we take a small PNG of the company's logo verbatim from
 * Logo.dev and use it without processing (until we can process the full sized logo
 * later).
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

    // SVGs are XML and contain an <svg> tag near the start. Look for "<svg" (case
    // insensitive) in the first 64 bytes.
    for (let i = 0; i <= Math.min(64, content.length - 4); i++) {
        if (
            content[i] === 0x3c && // `<`
            (content[i + 1] === 0x73 || content[i + 1] === 0x53) && // `s` or `S`
            (content[i + 2] === 0x76 || content[i + 2] === 0x56) && // `v` or `V`
            (content[i + 3] === 0x67 || content[i + 3] === 0x47) // `g` or `G`
        ) {
            return "image/svg+xml";
        }
    }

    return "image/avif";
}
