/**
 * The bucket name we use for uploading user files to Cloudflare R2.
 */
export const filesBucketName = "cyberworlds-files";

/**
 * The name we use for binding our files bucket to our Cloudflare Worker. This name
 * should be the same as what we have in `wrangler.toml` under `[[r2_buckets]]`.
 *
 * Use this name when constructing a `FileStorage` since that's the path Miniflare
 * persists R2 data to.
 */
export const filesBindingName = "FilesBucket";
