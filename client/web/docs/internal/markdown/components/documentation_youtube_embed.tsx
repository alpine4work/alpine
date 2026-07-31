import {Box} from "~/client/web/design/box.js";
import {getDocumentationYoutubeEmbedUrl} from "~/client/web/docs/internal/markdown/components/get_documentation_youtube_embed_url.js";
import {documentationComponent} from "~/client/web/docs/internal/markdown/documentation_component.js";
import {documentationMarkdownStringProp} from "~/shared/docs/documentation_markdown_string_prop.js";

type DocumentationYoutubeEmbedProps = {
    url: string;
    title?: string;
};

/** An embedded YouTube video that remains a normal link in markdown output. */
export const DocumentationYoutubeEmbed = documentationComponent({
    react: ({url, title = "YouTube video"}: DocumentationYoutubeEmbedProps) => (
        <Box as="figure" marginY="5" marginX="0">
            <iframe
                src={getDocumentationYoutubeEmbedUrl(url)}
                title={title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{
                    aspectRatio: "16 / 9",
                    border: 0,
                    borderRadius: 8,
                    display: "block",
                    width: "100%",
                }}
            />
        </Box>
    ),
    markdown: props => {
        const url = documentationMarkdownStringProp(props, "url");
        const title =
            typeof props.title === "string" && props.title.length > 0
                ? props.title
                : "Watch video on YouTube";
        return `[${title}](${url})\n\n`;
    },
});
