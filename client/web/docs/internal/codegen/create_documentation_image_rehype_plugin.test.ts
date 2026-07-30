import {createDocumentationImageRehypePlugin} from "~/client/web/docs/internal/codegen/create_documentation_image_rehype_plugin.js";

test.each(["api", "blog", "docs"])(
    "replaces authored /%s image sources with responsive image attributes",
    sourceDirectory => {
        const source = `/${sourceDirectory}/example.png`;
        const generatedSource = `/${sourceDirectory}/example.0123456789abcdef.png`;
        const generatedWebpSource = `/${sourceDirectory}/example.0123456789abcdef.320w.webp`;
        const image = {
            src: generatedSource,
            srcSet: `${generatedWebpSource} 320w, ${generatedSource} 800w`,
            width: 800,
            height: 450,
        };
        const tree = {
            type: "root",
            children: [
                {
                    type: "element",
                    tagName: "img",
                    properties: {src: source, alt: "Example"},
                },
            ],
        };

        createDocumentationImageRehypePlugin({
            imageDataBySource: {[source]: image},
            sizes: "(max-width: 800px) 100vw, 800px",
        })()(tree);

        expect(tree.children[0]?.properties).toEqual({
            src: image.src,
            srcSet: image.srcSet,
            sizes: "(max-width: 800px) 100vw, 800px",
            width: 800,
            height: 450,
            alt: "Example",
            loading: "lazy",
            decoding: "async",
        });
    },
);
