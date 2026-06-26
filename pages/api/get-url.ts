import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import dbConnect from "@/lib/mongodb";
import Batch from "@/models/Batch";
import User from "@/models/User";
import { getHeaders, getVideoHeaders } from "@/utils/auth";

async function dynamicallyCreateOrUpdateBatch(parentId: string, token: any, topic: string) {
  try {
    const PW_API = process.env.PW_API;
    const detailsUrl = `${PW_API}v3/batches/${parentId}/details`;
    const headers = getHeaders(token.accessToken);
    const detailsRes = await axios.get(detailsUrl, { headers });
    const details = detailsRes.data?.data;

    const batchDoc = {
      batchId: parentId,
      batchName: details?.name || topic || "Unknown Dynamic Batch",
      batchPrice: details?.fee?.total || 0,
      batchImage: details?.iosPreviewImageUrl || (details?.previewImage?.baseUrl && details?.previewImage?.key ? details.previewImage.baseUrl + details.previewImage.key : ""),
      template: details?.template || "NORMAL",
      BatchType: "FREE",
      language: details?.language || "English",
      byName: details?.byName || "Unknown",
      startDate: details?.startDate || "",
      endDate: details?.endDate || "",
      batchStatus: !details?.isBlocked,
    };

    const enrolledToken = {
      ownerId: token.ownerId,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenStatus: true,
      randomId: token.randomId,
      updatedAt: new Date(),
    };

    await Batch.findOneAndUpdate(
      { batchId: parentId },
      {
        $set: batchDoc,
        $addToSet: { enrolledTokens: enrolledToken }
      },
      { upsert: true, new: true }
    );
    console.log(`Successfully dynamically sync'd batch ${parentId}`);
  } catch (err) {
    console.error(`Failed to dynamically sync batch ${parentId}:`, err);
  }
}

// Validate if vid is a proper UUID format (Pimaxer CDN only works with UUIDs, NOT MongoDB ObjectIds)
function isValidPimaxerVid(vid: string): boolean {
  if (!vid) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vid);
}

// Build a Pimaxer stream URL - only if vid is a valid UUID
function buildPimaxerUrl(vid: string): string {
  if (!isValidPimaxerVid(vid)) return "";
  return `https://stream.pimaxer.in/${vid}/master.m3u8`;
}

function adjustPimaxerUrl(url: string): string {
  if (!url) return url;

  // 1. Rewrite stream.pimaxer.in DASH (.mpd) to HLS (.m3u8) for smooth playback
  if (url.includes("stream.pimaxer.in") && url.includes(".mpd")) {
    url = url.replace(/\.mpd/g, ".m3u8");
  }

  // 2. Fix potential Cloudfront domain mismatch between URL host and signed Policy Resource host
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
            console.log(`[adjustPimaxerUrl] Rewriting host from ${urlObj.host} to ${resourceObj.host}`);
            urlObj.host = resourceObj.host;
            url = urlObj.toString();
          }
        }
      }
    }
  } catch (e) {
    console.error("Error sanitizing Cloudfront domain:", e);
  }

  return url;
}

// Dedicated helper: fetch vid from Pimaxer APIs (Study Spark + Cloudflare worker)
async function fetchVidFromPimaxer(parentId: string, childId: string): Promise<string> {
  try {
    const [payloadRes, workerRes] = await Promise.allSettled([
      axios.get(
        `https://thestudyspark.site/api-server/v2/video-payload?batchId=${parentId}&lectureId=${childId}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 5000
        }
      ),
      axios.get(
        `https://get-url.bhanuyadav.workers.dev/?parentId=${parentId}&childId=${childId}`,
        { timeout: 5000 }
      )
    ]);

    if (payloadRes.status === "fulfilled" && payloadRes.value.data?.success && payloadRes.value.data?.vid) {
      const vid = payloadRes.value.data.vid;
      if (isValidPimaxerVid(vid)) {
        console.log(`[fetchVidFromPimaxer] Got valid UUID vid from payload: ${vid}`);
        return vid;
      } else {
        console.log(`[fetchVidFromPimaxer] payload vid is NOT a UUID (skipping): ${vid}`);
      }
    }

    if (workerRes.status === "fulfilled" && workerRes.value.data?.vid) {
      const vid = workerRes.value.data.vid;
      if (isValidPimaxerVid(vid)) {
        console.log(`[fetchVidFromPimaxer] Got valid UUID vid from worker: ${vid}`);
        return vid;
      } else {
        console.log(`[fetchVidFromPimaxer] worker vid is NOT a UUID (skipping): ${vid}`);
      }
    }
  } catch (err: any) {
    console.error("[fetchVidFromPimaxer] Failed:", err.message);
  }
  return "";
}

async function tryToken(token: any, parentId: string, childId: string, container: string) {
  const PW_API = process.env.PW_API;
  let currentAccessToken = token.accessToken;
  let currentRandomId = token.randomId || uuidv4();

  try {
    const scheduleUrl = `${PW_API}v1/batches/${parentId}/subject/dummy/schedule/${childId}/schedule-details`;
    const sHeaders = getHeaders(currentAccessToken);

    const videoUrl = `${PW_API}v1/videos/video-url-details?type=BATCHES&videoContainerType=${container}&reqType=query&childId=${childId}&parentId=${parentId}&clientVersion=201`;
    const vHeaders = getVideoHeaders(currentAccessToken, currentRandomId);

    // Fetch schedule topic and video URL in parallel
    const [scheduleResResult, videoRes] = await Promise.all([
      axios.get(scheduleUrl, { headers: sHeaders, timeout: 4000 }).catch(err => {
        console.warn("Failed to fetch schedule details in tryToken:", err.message);
        return null;
      }),
      axios.get(videoUrl, { headers: vHeaders, timeout: 5000 })
    ]);

    const topic = scheduleResResult?.data?.data?.topic || scheduleResResult?.data?.data?.videoDetails?.name || "";
    const responseData = videoRes.data?.data;
    const url = responseData?.url || "";

    console.log(`[tryToken] PW API response URL: ${url}`);
    console.log(`[tryToken] PW API response data keys: ${responseData ? Object.keys(responseData).join(', ') : 'null'}`);

    // Extract vid - check multiple sources
    let vid = "";
    
    // 1. Check if PW API response has vid/videoId/vdoCipherId directly
    if (responseData?.vid) vid = responseData.vid;
    else if (responseData?.videoId) vid = responseData.videoId;
    else if (responseData?.vdoCipherId) vid = responseData.vdoCipherId;
    
    // 2. Try UUID regex on URL path
    if (!vid && url) {
      const uuidMatch = url.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (uuidMatch) vid = uuidMatch[1];
    }

    // 3. Try UUID regex anywhere in URL (not just after slash)
    if (!vid && url) {
      const uuidAnywhere = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (uuidAnywhere) vid = uuidAnywhere[1];
    }

    // 4. Fallback: try path segment extraction
    if (!vid && url) {
      try {
        const parsedUrl = new URL(url);
        const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
        for (const segment of pathSegments) {
          if (segment !== "master.mpd" && segment !== "master.m3u8" && segment !== "index.m3u8" && !segment.includes(".")) {
            vid = segment;
            break;
          }
        }
      } catch (e) {
        // URL parsing failed, try split approach
        const parts = url.split("?")[0].split("/");
        const lastSegment = parts[parts.length - 1];
        const secondLastSegment = parts[parts.length - 2];
        vid = (lastSegment.includes("master.mpd") || lastSegment.includes("master.m3u8")) 
          ? secondLastSegment 
          : lastSegment;
      }
    }

    // Clean vid - remove any file extensions or garbage
    if (vid && (vid.includes(".m3u8") || vid.includes(".mpd") || vid.includes(".ts") || vid === "index.m3u8" || vid === "master.m3u8")) {
      vid = "";
    }

    console.log(`[tryToken] Extracted vid: "${vid}" from URL: ${url.substring(0, 80)}...`);

    return {
      success: true,
      url,
      vid,
      topic,
      token: {
        ...token,
        accessToken: currentAccessToken,
        randomId: currentRandomId
      }
    };
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 401 && token.refreshToken) {
      const newRandomId = uuidv4();
      try {
        const refreshRes = await axios.post(
          `${PW_API}v3/oauth/refresh-token`,
          {
            refresh_token: token.refreshToken,
            client_id: "system-admin",
          },
          {
            headers: {
              "Content-Type": "application/json",
              Randomid: newRandomId,
            },
            timeout: 4000
          }
        );

        if (refreshRes.data?.success && refreshRes.data?.data) {
          const newAccessToken = refreshRes.data.data.access_token;
          const newRefreshToken = refreshRes.data.data.refresh_token;

          // Update User in DB
          await User.findByIdAndUpdate(token.ownerId, {
            ActualToken: newAccessToken,
            ActualRefresh: newRefreshToken,
            randomId: newRandomId
          });

          // Update Batch enrolledToken in DB
          await Batch.updateOne(
            {
              batchId: parentId,
              "enrolledTokens.ownerId": token.ownerId,
            },
            {
              $set: {
                "enrolledTokens.$.accessToken": newAccessToken,
                "enrolledTokens.$.refreshToken": newRefreshToken,
                "enrolledTokens.$.updatedAt": new Date(),
                "enrolledTokens.$.tokenStatus": true,
                "enrolledTokens.$.randomId": newRandomId,
              },
            }
          );

          // Retry calls in parallel
          const scheduleUrl = `${PW_API}v1/batches/${parentId}/subject/dummy/schedule/${childId}/schedule-details`;
          const sHeadersRetry = getHeaders(newAccessToken);

          const videoUrl = `${PW_API}v1/videos/video-url-details?type=BATCHES&videoContainerType=${container}&reqType=query&childId=${childId}&parentId=${parentId}&clientVersion=201`;
          const vHeadersRetry = getVideoHeaders(newAccessToken, newRandomId);

          const [scheduleResRetryResult, videoResRetry] = await Promise.all([
            axios.get(scheduleUrl, { headers: sHeadersRetry, timeout: 4000 }).catch(err => {
              console.warn("Failed to fetch schedule details in tryToken retry:", err.message);
              return null;
            }),
            axios.get(videoUrl, { headers: vHeadersRetry, timeout: 4000 })
          ]);

          const topicRetry = scheduleResRetryResult?.data?.data?.topic || scheduleResRetryResult?.data?.data?.videoDetails?.name || "";
          const retryData = videoResRetry.data?.data;
          const urlRetry = retryData?.url || "";

          console.log(`[tryToken retry] PW API response URL: ${urlRetry}`);

          let vidRetry = "";
          // Check response fields first
          if (retryData?.vid) vidRetry = retryData.vid;
          else if (retryData?.videoId) vidRetry = retryData.videoId;
          else if (retryData?.vdoCipherId) vidRetry = retryData.vdoCipherId;
          
          // UUID regex on URL
          if (!vidRetry && urlRetry) {
            const uuidMatchRetry = urlRetry.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
            if (uuidMatchRetry) vidRetry = uuidMatchRetry[1];
          }
          // Path segment fallback
          if (!vidRetry && urlRetry) {
            try {
              const parsedUrl = new URL(urlRetry);
              const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
              for (const segment of pathSegments) {
                if (segment !== "master.mpd" && segment !== "master.m3u8" && segment !== "index.m3u8" && !segment.includes(".")) {
                  vidRetry = segment;
                  break;
                }
              }
            } catch (e) {
              const parts = urlRetry.split("?")[0].split("/");
              const lastSegment = parts[parts.length - 1];
              const secondLastSegment = parts[parts.length - 2];
              vidRetry = (lastSegment.includes("master.mpd") || lastSegment.includes("master.m3u8")) 
                ? secondLastSegment 
                : lastSegment;
            }
          }
          // Clean vid
          if (vidRetry && (vidRetry.includes(".m3u8") || vidRetry.includes(".mpd") || vidRetry.includes(".ts"))) {
            vidRetry = "";
          }
          console.log(`[tryToken retry] Extracted vid: "${vidRetry}"`);

          return {
            success: true,
            url: urlRetry,
            vid: vidRetry,
            topic: topicRetry,
            token: {
              ...token,
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
              randomId: newRandomId
            }
          };
        }
      } catch (refreshErr) {
        await Batch.updateOne(
          {
            batchId: parentId,
            "enrolledTokens.ownerId": token.ownerId,
          },
          {
            $set: {
              "enrolledTokens.$.tokenStatus": false,
              "enrolledTokens.$.updatedAt": new Date(),
            },
          }
        );
      }
    }
    return { success: false };
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const { parentId, childId, container = "DASH" } = req.query;

  if (!parentId || typeof parentId !== "string" || !childId || typeof childId !== "string") {
    return res.status(400).json({
      success: false,
      message: "`parentId` (batch ID) and `childId` (lecture ID) are required query parameters."
    });
  }

  // Phase 1: Pimaxer API / External Resolvers (Concurrently fetch Study Spark and Cloudflare Worker)
  try {
    console.log(`Phase 1: Querying Pimaxer APIs concurrently for parentId: ${parentId}, childId: ${childId}...`);
    const [payloadRes, liveRes, workerRes] = await Promise.allSettled([
      axios.get(
        `https://thestudyspark.site/api-server/v2/video-payload?batchId=${parentId}&lectureId=${childId}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 4500
        }
      ),
      axios.get(
        `https://thestudyspark.site/api-server/v2/get-video-url?parentid=${parentId}&childId=${childId}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 4500
        }
      ),
      axios.get(
        `https://get-url.bhanuyadav.workers.dev/?parentId=${parentId}&childId=${childId}`,
        { timeout: 4500 }
      )
    ]);

    // Check payload response first (Fast Path 1)
    if (payloadRes.status === "fulfilled" && payloadRes.value.data && payloadRes.value.data.success) {
      const { dashUrl, hlsUrl, vid, topic, drmKeyId, drmKey } = payloadRes.value.data;
      const clearKeys = (drmKeyId && drmKey) ? { [drmKeyId]: drmKey } : null;
      const pimaxerUrl = buildPimaxerUrl(vid);
      const urlToReturn = hlsUrl || dashUrl || pimaxerUrl;

      if (urlToReturn) {
        console.log(`Phase 1 success (payload): resolved URL: ${urlToReturn}`);
        return res.status(200).json({
          url: adjustPimaxerUrl(urlToReturn),
          vid,
          topic,
          clearKeys
        });
      }
    }

    // Check live response second (Fast Path 2)
    if (liveRes.status === "fulfilled" && liveRes.value.data && liveRes.value.data.success && liveRes.value.data.url) {
      const url = liveRes.value.data.url;
      // Extract vid from the URL (it may be a raw PW CDN URL with UUID in path)
      let vid = liveRes.value.data.vid || "";
      if (!vid) {
        const uuidMatch = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (uuidMatch) vid = uuidMatch[1];
      }
      const pimaxerUrl = buildPimaxerUrl(vid);
      const urlToReturn = pimaxerUrl || adjustPimaxerUrl(url);
      console.log(`Phase 1 success (live): vid=${vid}, URL: ${urlToReturn}`);
      return res.status(200).json({
        url: urlToReturn,
        vid,
        topic: liveRes.value.data.topic || ""
      });
    }

    // Check Cloudflare worker third
    if (workerRes.status === "fulfilled" && workerRes.value.data) {
      let { vid, topic, url } = workerRes.value.data;
      if (vid && (vid.includes(".m3u8") || vid.includes(".mpd") || vid === "index.m3u8" || vid === "master.m3u8")) {
        vid = "";
      }
      const pimaxerUrl = buildPimaxerUrl(vid);
      const urlToReturn = pimaxerUrl || url;
      if (urlToReturn) {
        console.log(`Phase 1 success (worker): resolved URL: ${urlToReturn}`);
        return res.status(200).json({
          url: adjustPimaxerUrl(urlToReturn),
          vid,
          topic
        });
      }
    }
  } catch (err: any) {
    console.error("Phase 1 parallel execution error:", err.message);
  }

  // Phase 2: Paid Token through Database (MASTER_DPP_TOKEN, enrolled users, other users)
  try {
    await dbConnect();

    // Priority: Try MASTER_DPP_TOKEN first before scanning database tokens
    const masterToken = process.env.MASTER_DPP_TOKEN || "";
    if (masterToken) {
      console.log(`[get-url] Trying MASTER_DPP_TOKEN first...`);
      const masterResult = await tryToken(
        { ownerId: "master", accessToken: masterToken, refreshToken: null, randomId: uuidv4() },
        parentId as string,
        childId as string,
        container as string
      );
      if (masterResult.success) {
        console.log(`[get-url] MASTER_DPP_TOKEN succeeded!`);
        let { url, vid, topic } = masterResult;
        if (!vid) {
          console.log(`[get-url] MASTER_DPP_TOKEN: vid is empty, trying Pimaxer APIs...`);
          const pimaxerVid = await fetchVidFromPimaxer(parentId as string, childId as string);
          if (pimaxerVid) vid = pimaxerVid;
        }
        const pimaxerUrl = buildPimaxerUrl(vid);
        const urlToReturn = pimaxerUrl || adjustPimaxerUrl(url);
        return res.status(200).json({ url: urlToReturn, vid, topic });
      }
      console.log(`[get-url] MASTER_DPP_TOKEN failed, falling back to database tokens...`);
    }

    // 1. Gather all potential tokens in prioritized order
    const batchTokens: any[] = [];
    const userEnrolledTokens: any[] = [];
    const otherUserTokens: any[] = [];

    // Group A: Tokens directly enrolled in the batch document
    const batch = await Batch.findOne({ batchId: parentId });
    if (batch && batch.enrolledTokens) {
      for (const t of batch.enrolledTokens) {
        if (t.tokenStatus) {
          batchTokens.push({
            ownerId: t.ownerId,
            accessToken: t.accessToken,
            refreshToken: t.refreshToken,
            randomId: t.randomId,
          });
        }
      }
    }

    // Group B: Tokens of users who have this batchId in their enrolledBatches profile (prioritize active)
    const enrolledUsers = await User.find({
      "enrolledBatches.batchId": parentId,
      ActualToken: { $exists: true, $ne: null }
    }).sort({ updatedAt: -1 });
    for (const u of enrolledUsers) {
      if (batchTokens.some(t => t.ownerId.toString() === u._id.toString())) continue;
      userEnrolledTokens.push({
        ownerId: u._id,
        accessToken: u.ActualToken,
        refreshToken: u.ActualRefresh,
        randomId: u.randomId,
      });
    }

    // Group C: All other users with an active token (prioritize active, limit to 10 to keep it fast)
    const otherUsers = await User.find({
      ActualToken: { $exists: true, $ne: null }
    }).sort({ updatedAt: -1 }).limit(10);
    for (const u of otherUsers) {
      if (batchTokens.some(t => t.ownerId.toString() === u._id.toString())) continue;
      if (userEnrolledTokens.some(t => t.ownerId.toString() === u._id.toString())) continue;
      otherUserTokens.push({
        ownerId: u._id,
        accessToken: u.ActualToken,
        refreshToken: u.ActualRefresh,
        randomId: u.randomId,
      });
    }

    let workingResult: any = null;

    // Helper to scan tokens in parallel chunks of 5
    const scanTokenGroup = async (group: any[]) => {
      for (let i = 0; i < group.length; i += 5) {
        const chunk = group.slice(i, i + 5);
        const results = await Promise.all(
          chunk.map(token => tryToken(token, parentId as string, childId as string, container as string))
        );
        const successful = results.find(r => r.success);
        if (successful) return successful;
      }
      return null;
    };

    // Scan Group A (Batch Enrolled Tokens)
    if (batchTokens.length > 0) {
      workingResult = await scanTokenGroup(batchTokens);
    }

    // Scan Group B (User Enrolled Batches Profiles)
    if (!workingResult && userEnrolledTokens.length > 0) {
      workingResult = await scanTokenGroup(userEnrolledTokens);
    }

    // Scan Group C (All Other User Tokens)
    if (!workingResult && otherUserTokens.length > 0) {
      workingResult = await scanTokenGroup(otherUserTokens);
    }

    if (workingResult) {
      const alreadyLinked = batchTokens.some(t => t.ownerId.toString() === workingResult.token.ownerId.toString());
      if (!alreadyLinked) {
        // Run dynamically in the background to not delay response
        dynamicallyCreateOrUpdateBatch(parentId as string, workingResult.token, workingResult.topic);
      }

      let { url, vid, topic } = workingResult;

      // If vid is empty from PW API, try to fetch it from Pimaxer APIs
      if (!vid) {
        console.log(`[get-url] Phase 2: vid is empty, trying to fetch vid from Pimaxer APIs...`);
        const pimaxerVid = await fetchVidFromPimaxer(parentId as string, childId as string);
        if (pimaxerVid) {
          vid = pimaxerVid;
          console.log(`[get-url] Phase 2: Got vid from Pimaxer: ${vid}`);
        }
      }

      const pimaxerUrl = buildPimaxerUrl(vid);
      const urlToReturn = pimaxerUrl || adjustPimaxerUrl(url);
      return res.status(200).json({
        url: urlToReturn,
        vid,
        topic
      });
    }

    // Phase 3: Fallback / Any other method (Retry external APIs with a longer timeout as a last resort)
    try {
      console.log(`Phase 3: Querying Fallback Resolvers (longer timeout)...`);
      const [fallbackPayload, fallbackLive, fallbackWorker] = await Promise.allSettled([
        axios.get(
          `https://thestudyspark.site/api-server/v2/video-payload?batchId=${parentId}&lectureId=${childId}`,
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout: 10000
          }
        ),
        axios.get(
          `https://thestudyspark.site/api-server/v2/get-video-url?parentid=${parentId}&childId=${childId}`,
          {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout: 10000
          }
        ),
        axios.get(
          `https://get-url.bhanuyadav.workers.dev/?parentId=${parentId}&childId=${childId}`,
          { timeout: 10000 }
        )
      ]);

      // 1. Fallback payload
      if (fallbackPayload.status === "fulfilled" && fallbackPayload.value.data && fallbackPayload.value.data.success) {
        const { dashUrl, hlsUrl, vid, topic, drmKeyId, drmKey } = fallbackPayload.value.data;
        const clearKeys = (drmKeyId && drmKey) ? { [drmKeyId]: drmKey } : null;
        const pimaxerUrl = buildPimaxerUrl(vid);
        const urlToReturn = hlsUrl || dashUrl || pimaxerUrl;

        if (urlToReturn) {
          console.log(`Phase 3 success (payload): resolved URL: ${urlToReturn}`);
          return res.status(200).json({
            url: adjustPimaxerUrl(urlToReturn),
            vid,
            topic,
            clearKeys
          });
        }
      }

      // 2. Fallback live
      if (fallbackLive.status === "fulfilled" && fallbackLive.value.data && fallbackLive.value.data.success && fallbackLive.value.data.url) {
        const url = fallbackLive.value.data.url;
        let vid = fallbackLive.value.data.vid || "";
        if (!vid) {
          const uuidMatch = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
          if (uuidMatch) vid = uuidMatch[1];
        }
        const pimaxerUrl = buildPimaxerUrl(vid);
        const urlToReturn = pimaxerUrl || adjustPimaxerUrl(url);
        console.log(`Phase 3 success (live): vid=${vid}, URL: ${urlToReturn}`);
        return res.status(200).json({
          url: urlToReturn,
          vid,
          topic: fallbackLive.value.data.topic || ""
        });
      }

      // 3. Fallback worker
      if (fallbackWorker.status === "fulfilled" && fallbackWorker.value.data) {
        let { vid, topic, url } = fallbackWorker.value.data;
        if (vid && (vid.includes(".m3u8") || vid.includes(".mpd") || vid === "index.m3u8" || vid === "master.m3u8")) {
          vid = "";
        }
        const pimaxerUrl = buildPimaxerUrl(vid);
        const urlToReturn = pimaxerUrl || url;
        if (urlToReturn) {
          console.log(`Phase 3 success (worker): resolved URL: ${urlToReturn}`);
          return res.status(200).json({
            url: adjustPimaxerUrl(urlToReturn),
            vid,
            topic
          });
        }
      }
    } catch (fallbackErr: any) {
      console.error("Parallel fallbacks execution error:", fallbackErr.message);
    }

    return res.status(403).json({
      success: false,
      message: "No active user tokens have access to this batch and fallback resolvers failed."
    });

  } catch (error: any) {
    console.error("Fatal error in get-url handler:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "An unexpected server error occurred"
    });
  }
}
