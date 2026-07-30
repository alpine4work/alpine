import {ImgHTMLAttributes} from "react";
import {DocumentationImageData} from "~/client/web/docs/documentation_image_data.js";

/**
 * Render generated responsive image candidates for the browser's layout size.
 */
export function DocumentationResponsiveImage({
    image,
    alt,
    loading = "lazy",
    decoding = "async",
    ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "height" | "src" | "srcSet" | "width"> & {
    image: DocumentationImageData;
    alt: string;
}) {
    return (
        <img
            {...props}
            alt={alt}
            src={image.src}
            srcSet={image.srcSet}
            width={image.width}
            height={image.height}
            loading={loading}
            decoding={decoding}
        />
    );
}
