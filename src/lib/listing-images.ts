/** Use the public detail-image sizes only on the two verified image CDNs. */
export function listingImageSources(value: string | null): string[] {
  if (!value) return [];
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return [];
    if (
      url.hostname === "prod.pictures.autoscout24.net" &&
      url.pathname.startsWith("/listing-images/")
    ) {
      const size = url.pathname.match(/\/(\d+)x(\d+)\.(webp|jpg)$/);
      if (size && Number(size[1]) < 1280) {
        url.pathname = url.pathname.replace(
          /\/\d+x\d+\.(webp|jpg)$/,
          "/1280x960.webp",
        );
      }
    } else if (
      url.hostname === "img.kleinanzeigen.de" &&
      url.pathname.startsWith("/api/v1/prod-ads/images/") &&
      /^\$_(2|35)\.(AUTO|JPG)$/.test(url.searchParams.get("rule") || "")
    ) {
      url.searchParams.set("rule", "$_59.AUTO");
    }
    return [...new Set([url.href, value])];
  } catch {
    return [];
  }
}
