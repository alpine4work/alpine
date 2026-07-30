import {json} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {loadGeneratedBlogPost} from "~/app/docs/load_generated_blog.server.js";
import {createDocumentationMetaFunction} from "~/app/docs/opengraph/create_documentation_meta.js";
import {
    BlogAuthorById,
    BlogPostPage,
    BlogPostPageData,
    createBlogPostUrl,
} from "~/client/web/docs/blog.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";

type BlogPostRouteMetaData = {post: BlogPostPageData; authors: BlogAuthorById};

/**
 * Build metadata for an individual blog post route.
 */
export const meta = createDocumentationMetaFunction<BlogPostRouteMetaData>(data => {
    const author = data.authors[data.post.authorId];
    const xHandle = author.socials.x?.split("/").filter(Boolean).at(-1) ?? null;
    return {
        type: "Blog",
        title: data.post.title,
        ...(data.post.summary.length === 0 ? {} : {description: data.post.summary}),
        pageUrl: createBlogPostUrl(data.post.slug),
        authorName: author.name,
        publishDate: data.post.publishDate,
        tags: data.post.tags,
        twitterCreator: xHandle === null ? null : `@${xHandle}`,
    };
});

/**
 * Load generated data for an individual blog post route.
 */
export async function loader({params}: LoaderArgs) {
    const slug = params.slug;
    if (slug === undefined) throw notFoundResponse();

    const routeData = await loadGeneratedBlogPost(slug);
    if (routeData === null) throw notFoundResponse();

    return json(routeData);
}

/**
 * Render an individual blog post route from generated loader data.
 */
export default function BlogPostRoute() {
    const {post, authors, searchIndex} = useLoaderData<typeof loader>();
    return <BlogPostPage post={post} authors={authors} searchIndex={searchIndex} />;
}
