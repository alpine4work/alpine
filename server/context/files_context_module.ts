import {TokenAgent} from "~/server/tokens/token_agent.js";
import {
    AvatarEntityPath,
    AvatarVariant,
    printAvatarEntityPathIntoCloudflareR2Key,
} from "~/shared/avatar/avatar_entity_path.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {AvatarId, FileId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Manages the URLs we need to load file content from Cloudflare R2.
 *
 * File content is returned from the `EdgeService` route `/files/:spaceId/:fileId`.
 * We use signed URLs to authorize access to this route. So `AppService` signs a
 * URL in advance, sends it to the client, then the client uses the URL to load the
 * file from `EdgeService`. This is good for performance since `EdgeService`
 * doesn't need to make a round trip to `AppService` whenever a file is requested
 * and it prevents Alpine's use as a CDN. Since it depends on client support for
 * requesting a new signed URL to view a file.
 */
export abstract class FilesContextModuleBase
    extends ContextModuleBase
    implements ForkableContextModuleBase
{
    /**
     * Create a signed URL for a file's preview. The signed URL expires after 10
     * minutes.
     *
     * If the file doesn't have preview content then this function returns null. Files
     * with an image preview will either load the file's image preview content or the
     * file itself if the file is a web safe image.
     */
    public abstract dangerouslySignFileUrlWithoutAuthorization(
        spaceId: SpaceId,
        fileId: FileId,
    ): Promise<URL>;

    public abstract dangerouslySignAvatarUrlWithoutAuthorization({
        avatarId,
        avatarEntityPath,
        variant,
        expirationMinutes,
    }: {
        avatarId: AvatarId;
        avatarEntityPath: AvatarEntityPath;
        variant: AvatarVariant;
        expirationMinutes?: number;
    }): Promise<URL>;

    public abstract fork(): FilesContextModuleBase;
}

export class FilesContextModule extends FilesContextModuleBase {
    private readonly _tokenAgent: TokenAgent;
    private readonly _resourceServiceUrl: string;

    constructor({
        tokenAgent,
        resourceServiceUrl,
    }: {
        tokenAgent: TokenAgent;
        resourceServiceUrl: string;
    }) {
        super();
        this._tokenAgent = tokenAgent;
        this._resourceServiceUrl = resourceServiceUrl;
    }

    public override async dangerouslySignFileUrlWithoutAuthorization(
        spaceId: SpaceId,
        fileId: FileId,
    ): Promise<URL> {
        return await this._tokenAgent.privateSide.dangerouslySignUrl(
            // TODO(rmtobin, 2025-10-28, #files-edge-service): Sign for both services for
            // backwards compatibility. Switch to just ResourceService when EdgeService stops
            // serving files.
            ["ResourceService", "EdgeService"],
            new URL(`${this._resourceServiceUrl}/files/${spaceId}/${fileId}`),
            // Expire the signed URL after one full day, 24 hours.
            //
            // When a file is about to expire the client needs to execute the RPC
            // `getFileSignedUrlFromAttachment()` and update the `<img>` element rendering the
            // file with the new URL (this is done in `render_content_file_preview.ts`).
            // Otherwise the user may end up seeing broken images. We set an expiration time of
            // 24 hours to make this client URL refreshing rare in practice. Since when we
            // refresh a file's URL the browser needs to go fetch the new file from our
            // servers.
            //
            // We need an expiration time so that if a user loses access to the entity the file
            // is attached to then they'll also lose access to the file (since they won't be
            // able to get a new signed URL from our servers). Setting an expiration time also
            // prevents Alpine from being used as a CDN for the user's files.
            //
            // Also, having a long expiration time is great for implementing copy/paste across
            // products. You can copy in Alpine, then paste in another product, and the image
            // should be reliably pasted in given the generous expiration time.
            //
            // ### An edge case where URL refreshing will often happen
            //
            // For post drafts we save `ContentReferences` to `localStorage`. So when the user
            // opens their draft back up we don't need to refetch all their references. This is
            // currently implemented in `post_creator.tsx`.
            //
            // If the user added a file to their post draft then `localStorage` will contain
            // the signed `signedUrlSearch` property. If the user opens their draft three days
            // later then the `signedUrlSearch` has long expired. So the client will call
            // `getFileSignedUrlFromAttachment()` to get an updated signed URL for the file.
            //
            // ### Thinking through the security implications of a long expiration time
            //
            // Let's say an attacker is temporarily granted access to a document. They grab a
            // file URL before an admin immediately revokes the attacker's document access. The
            // attacker will be able to download the file URL for 24 hours. This is fine, they
            // could have downloaded the file when they were given access to the document. Also
            // file's are immutable so the attacker doesn't get access to any future changes of
            // the file (since the file doesn't change).
            {expirationMinutes: 60 * 24},
        );
    }

    public async dangerouslySignAvatarUrlWithoutAuthorization({
        avatarId,
        avatarEntityPath,
        variant,
        expirationMinutes,
    }: {
        avatarId: AvatarId;
        avatarEntityPath: AvatarEntityPath;
        variant: AvatarVariant;
        expirationMinutes?: number;
    }): Promise<URL> {
        const keyPath = printAvatarEntityPathIntoCloudflareR2Key(
            avatarEntityPath,
            avatarId,
            variant,
        );
        return await this._tokenAgent.privateSide.dangerouslySignUrl(
            // TODO(rmtobin, 2025-10-28, #files-edge-service): Sign for both services for
            // backwards compatibility. Switch to just ResourceService when EdgeService stops
            // serving files.
            ["ResourceService", "EdgeService"],
            new URL(`${this._resourceServiceUrl}/avatars/${keyPath}`),

            // We allow long expiration times for avatars so they can be displayed in emails
            // for an extended period of time.
            {expirationMinutes},
        );
    }

    public fork() {
        return new FilesContextModule({
            tokenAgent: this._tokenAgent,
            resourceServiceUrl: this._resourceServiceUrl,
        });
    }
}

// We don't actually sign URLs in the test context module since we don't have a
// `TokenAgent`. Construct a `FilesContextModule` with a proper `TokenAgent` if you
// want signing in tests.
export class TestFilesContextModule extends FilesContextModuleBase {
    constructor() {
        super();
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    public override async dangerouslySignFileUrlWithoutAuthorization(
        spaceId: SpaceId,
        fileId: FileId,
    ): Promise<URL> {
        return new URL(`https://resources.test.cyberworlds.dev/files/${spaceId}/${fileId}`);
    }

    public async dangerouslySignAvatarUrlWithoutAuthorization({
        avatarId,
        avatarEntityPath,
        variant,
    }: {
        avatarId: AvatarId;
        avatarEntityPath: AvatarEntityPath;
        variant: AvatarVariant;
        expirationMinutes?: number;
    }): Promise<URL> {
        const keyPath = printAvatarEntityPathIntoCloudflareR2Key(
            avatarEntityPath,
            avatarId,
            variant,
        );

        return new URL(`https://resources.test.cyberworlds.dev/avatars/${keyPath}`);
    }

    public fork() {
        return new TestFilesContextModule();
    }
}
