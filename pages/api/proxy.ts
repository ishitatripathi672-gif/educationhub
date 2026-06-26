import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

function makeAbsolute(relative: string, base: string): string {
  try {
    return new URL(relative, base).href;
  } catch (e) {
    return relative;
  }
}

function rewriteM3U8(manifestText: string, baseUrl: string): string {
  const lines = manifestText.split(/\r?\n/);
  const rewrittenLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith("#")) {
      // Rewrite URI="..." attributes in tag lines
      return trimmed.replace(/(URI\s*=\s*["'])([^"']*)(["'])/g, (match, p1, p2, p3) => {
        if (p2.startsWith("http://") || p2.startsWith("https://") || p2.startsWith("data:") || p2.startsWith("blob:")) {
          return match;
        }
        const absolute = makeAbsolute(p2, baseUrl);
        return `${p1}${absolute}${p3}`;
      });
    }

    // If it's a URI line (and not absolute already)
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return line;
    }
    return makeAbsolute(trimmed, baseUrl);
  });
  return rewrittenLines.join("\n");
}

function rewriteMPD(mpdText: string, baseUrl: string): string {
  const baseDir = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
  
  // Find <MPD tag
  const mpdTagMatch = mpdText.match(/<MPD[^>]*>/i);
  if (mpdTagMatch) {
    const mpdTag = mpdTagMatch[0];
    const insertIndex = mpdText.indexOf(mpdTag) + mpdTag.length;
    // Check if BaseURL already exists as a direct child of MPD
    if (!mpdText.includes("<BaseURL>")) {
      return (
        mpdText.slice(0, insertIndex) +
        `\n  <BaseURL>${baseDir}</BaseURL>` +
        mpdText.slice(insertIndex)
      );
    }
  }
  return mpdText;
}

function fixCloudfrontDomain(url: string): string {
  try {
    if (url.includes("cloudfront.net")) {
      const urlObj = new URL(url);
      const policyBase64 = urlObj.searchParams.get("Policy");
      if (policyBase64) {
        let normalizedBase64 = policyBase64.replace(/-/g, "+").replace(/_/g, "/");
        while (normalizedBase64.length % 4) {
          normalizedBase64 += "=";
        }
        const decoded = Buffer.from(normalizedBase64, "base64").toString("utf-8");
        const policyObj = JSON.parse(decoded);
        const resource = policyObj?.Statement?.[0]?.Resource;
        if (resource && typeof resource === "string") {
          const resourceUrl = resource.replace(/\*$/, "");
          const resourceObj = new URL(resourceUrl);
          if (resourceObj.host && resourceObj.host !== urlObj.host) {
            console.log(`[proxy fixCloudfrontDomain] Rewriting host from ${urlObj.host} to ${resourceObj.host}`);
            urlObj.host = resourceObj.host;
            return urlObj.toString();
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to fix cloudfront domain in proxy:", e);
  }
  return url;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { url: queryUrl } = req.query;

  if (!queryUrl || typeof queryUrl !== "string") {
    return res.status(400).json({ error: "Missing or invalid url parameter." });
  }

  const url = fixCloudfrontDomain(queryUrl);

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://physicswallah.live/",
        Origin: "https://physicswallah.live",
      },
      timeout: 15000,
    });

    const contentType = response.headers["content-type"] || "application/octet-stream";
    res.setHeader("Content-Type", contentType);

    let data = Buffer.from(response.data);

    // If it's a manifest, convert to string, rewrite paths, and disable aggressive caching
    const isM3U8 = url.includes(".m3u8") || contentType.includes("mpegurl") || contentType.includes("mpegURL");
    const isMPD = url.includes(".mpd") || contentType.includes("dash+xml");

    if (isM3U8 || isMPD) {
      let text = data.toString("utf-8");
      if (isM3U8) {
        text = rewriteM3U8(text, url);
      } else {
        text = rewriteMPD(text, url);
      }
      data = Buffer.from(text, "utf-8");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    } else {
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    }

    return res.status(200).send(data);
  } catch (error: any) {
    console.error("Proxy error for URL:", url, error.message);
    const status = error.response?.status || 500;
    return res.status(status).json({
      error: `Proxy failed fetching target: ${error.message}`,
    });
  }
}
