/**
 * Format a blog publish date without shifting it across local time zones.
 */
export function formatBlogPublishDate(publishDate: string): string {
    return new Intl.DateTimeFormat("en", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(`${publishDate}T00:00:00.000Z`));
}
