// NOTE(ifitzsimmons, 08-11-2025): Avatars will be stored according to the
// following pathing structure: Accounts
//
// - /cyberworlds-avatars/account/<account-id>/original/<avatar-id>.avif
// - /cyberworlds-avatars/account/<account-id>/alternate/<avatar-id>.avif
// - /cyberworlds-avatars/account/<account-id>/<avatar-id>.avif Spaces
// - /cyberworlds-avatars/space/<space-id>/original/<avatar-id>.avif
// - /cyberworlds-avatars/space/<space-id>/alternate/<avatar-id>.avif
// - /cyberworlds-avatars/space/<space-id>/<avatar-id>.avif

/**
 * The bucket name we use for uploading user avatars to Cloudflare R2.
 */
export const avatarsBucketName = "cyberworlds-avatars";

/**
 * The name we use for binding our avatars bucket to our Cloudflare Worker. This
 * name should be the same as what we have in `wrangler.toml` under
 * `[[r2_buckets]]`.
 *
 * Use this name when constructing a `FileStorage` since that's the path Miniflare
 * persists R2 data to.
 */
export const avatarsBindingName = "AvatarsBucket";
