import {json} from "@remix-run/node";
import {useLoaderData} from "@remix-run/react";
import {loadGeneratedBlogPost} from "~/app/docs/load_generated_blog.server.js";
import {BlogPostPage, BlogPostPageData} from "~/client/web/docs/blog.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";

type BlogPostRouteMetaData = {post: BlogPostPageData};

/**
 * Build metadata for an individual blog post route.
 */
export function meta({data}: {data?: BlogPostRouteMetaData}) {
    const title = data?.post.title ?? "Alpine Blog";
    const description = data?.post.summary;
    return [
        {title: `${title}${metaTitlePostfix}`},
        // TODO(#public-api): Remove this robots restriction when the public API is ready.
        {name: "robots", content: "noindex,nofollow"},
        ...(description === undefined ? [] : [{name: "description", content: description}]),
    ];
}

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
