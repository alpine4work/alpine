import {DocumentationImageData} from "~/shared/docs/documentation_image_data.js";

export type BlogAuthorId = "josh" | "caleb" | "rachel" | "ian";

export type BlogAuthorSocials = {
    x: string | null;
    bluesky: string | null;
    linkedin: string | null;
    email: string | null;
};

export type BlogAuthor = {
    id: BlogAuthorId;
    name: string;
    socials: BlogAuthorSocials;
    avatarUrl: string;
    avatarImage: DocumentationImageData;
};

export type BlogAuthorById = Record<BlogAuthorId, BlogAuthor>;
