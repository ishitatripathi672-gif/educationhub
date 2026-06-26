"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import "../globals.css";
import { toast } from "sonner";

const YouTubePlayer = dynamic(() => import("@/app/components/YouTubePlayer"), {
  ssr: false,
});

const DashPlayer = dynamic(() => import("@/app/components/dashPlayer"), {
  ssr: false,
});

export default function WatchPageClient() {
  const params = useSearchParams();
  const router = useRouter();

  const [videoType, setVideoType] = useState<"youtube" | "penpencilvdo" | null>(
    null
  );
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [clearKeys, setClearKeys] = useState<any>(null);
  const [signedUrlQuery, setSignedUrlQuery] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [Attachment, setAttachment] = useState<string | null>(null);
  const [isBatchUnavailable, setIsBatchUnavailable] = useState(false);
  const [lectureData, setLectureData] = useState<any>(null);

  // Params
  const batchId = params?.get("batchId") || "";
  const subjectId = params?.get("SubjectId") || "";
  const ContentId = params?.get("ContentId") || params?.get("ChildId") || "";

  const saveWatchHistory = (lecture: {
    id: string;
    title: string;
    thumbnail: string;
    duration: string;
    batchId: string;
    subjectId: string;
    type: string;
    videoUrl: string;
    isLocked: boolean;
  }) => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("watchHistory") || "[]";
      const history = JSON.parse(raw);

      const now = new Date();
      const timeString = now.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const dateString = now.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      });

      const historyItem = {
        ...lecture,
        formattedTime: `${dateString} at ${timeString}`,
        timestamp: now.getTime(),
      };

      const filtered = history.filter((item: any) => item.id !== lecture.id);
      filtered.unshift(historyItem);

      const limited = filtered.slice(0, 4);
      localStorage.setItem("watchHistory", JSON.stringify(limited));
    } catch (err) {
      console.error("Failed to save watch history:", err);
    }
  };

  useEffect(() => {
    if (!batchId || !subjectId || !ContentId) return;

    const controller = new AbortController();
    const signal = controller.signal;

    const fetchVideoData = async () => {
      setLoading(true);
      setIsBatchUnavailable(false);

      try {
        // Step 0: Get video type and URL
        const scheduleRes = await fetch(
          `/api/Schedule?BatchId=${batchId}&SubjectId=${subjectId}&ContentId=${ContentId}`,
          { signal }
        );
        const scheduleData = await scheduleRes.json();

        if (signal.aborted) return;

        if (!scheduleData?.success || !scheduleData?.data?.urlType) {
          throw new Error("Invalid Schedule API response");
        }

        const urlType = scheduleData.data.urlType;
        const homeworkIds = scheduleData?.data?.homeworkIds?.[0];

        if (homeworkIds?.attachmentIds?.length > 0) {
          const attachment = homeworkIds.attachmentIds[0];
          if (attachment?.baseUrl && attachment?.key) {
            setAttachment(attachment);
          }
        }

        const url = scheduleData.data.url;

        if (urlType === "youtube") {
          setVideoType("youtube");
          setVideoUrl(url);

          saveWatchHistory({
            id: ContentId,
            title: scheduleData.data.topic || scheduleData.data.videoDetails?.name || "Lecture",
            thumbnail: scheduleData.data.videoDetails?.image || "/assets/img/video-placeholder.svg",
            duration: scheduleData.data.videoDetails?.duration || "",
            batchId,
            subjectId,
            type: "youtube",
            videoUrl: url,
            isLocked: scheduleData.data.isLocked ?? false,
          });
          return;
        }

        if (urlType === "penpencilvdo") {
          setVideoType("penpencilvdo");

          // Step 1: Get proxy stream URL and metadata
          const penRes = await fetch(
            `/api/get-url?parentId=${batchId}&childId=${ContentId}`,
            { signal }
          );

          if (signal.aborted) return;

          if (penRes.status === 403 || penRes.status === 404) {
            setIsBatchUnavailable(true);
            return;
          }

          const penData = await penRes.json();
          const finalUrl = penData?.url;

          if (!finalUrl) {
            setIsBatchUnavailable(true);
            return;
          }

          // Step 2: Set player state with the decrypted stream details
          setVideoUrl(finalUrl);
          setSignedUrlQuery("");
          setClearKeys(penData?.clearKeys || null);
          setVideoType("penpencilvdo");

          const lectureMeta = {
            id: ContentId,
            title: penData.topic || scheduleData?.data?.topic || scheduleData?.data?.videoDetails?.name || "Lecture",
            thumbnail: scheduleData?.data?.videoDetails?.image || "/assets/img/video-placeholder.svg",
            duration: scheduleData?.data?.videoDetails?.duration || "",
            batchId,
            subjectId,
            type: "penpencilvdo",
            videoUrl: finalUrl,
            isLocked: scheduleData?.data?.isLocked ?? false,
          };
          saveWatchHistory(lectureMeta);
          setLectureData(lectureMeta);
        } else {
          setVideoType(null);
        }
      } catch (err: any) {
        if (err.name === "AbortError" || signal.aborted) {
          return;
        }
        console.error("Video setup failed:", err);
        let message = "Unknown error";
        if (typeof err === "string") message = err;
        else if (err && typeof err === "object" && "message" in err && typeof (err as any).message === "string") message = (err as any).message;

        if (
          message.toLowerCase().includes("unavailable") ||
          message.toLowerCase().includes("contact admin") ||
          message.toLowerCase().includes("forbidden") ||
          message.toLowerCase().includes("403")
        ) {
          setIsBatchUnavailable(true);
        } else {
          toast.error(`${message} - Try refreshing the page!`);
        }
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchVideoData();

    return () => {
      controller.abort();
    };
  }, [batchId, subjectId, ContentId]);

  // ✅ Auto-rotate to landscape for all video types
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleFullscreenChange = () => {
      const isFullscreen = !!document.fullscreenElement;

      if (isFullscreen && (screen.orientation && typeof (screen.orientation as any).lock === "function")) {
        (screen.orientation as any).lock("landscape").catch((err: unknown) => {
          console.warn("Orientation lock failed:", err);
        });
      } else if (screen.orientation?.unlock) {
        screen.orientation.unlock?.();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  return (
    <div className="h-[100%] md:overflow-auto lg:overflow-hidden select-none">
      <div className="relative" style={{ height: "100%" }}>
        {loading && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-[#eef7f0]/90 via-[#e4f6e8]/90 to-[#f5f8ff]/90 dark:from-[#0F1908]/95 dark:via-[#1C2B22]/95 dark:to-[#151D1A]/95 backdrop-blur-md transition-colors duration-300">
            <div className="p-8 rounded-2xl bg-white/85 dark:bg-[#1C2B22]/85 backdrop-blur-md border border-emerald-500/10 dark:border-emerald-400/10 shadow-spring-xl flex flex-col items-center max-w-sm w-full mx-4 text-center animate-gentle-pulse">
              
              {/* Premium Rotating Spinner */}
              <div className="relative w-16 h-16 mb-5">
                <div className="absolute inset-0 rounded-full border-4 border-emerald-500/10 dark:border-emerald-400/10" />
                <div className="absolute inset-0 rounded-full border-4 border-t-emerald-500 dark:border-t-emerald-400 border-r-transparent animate-spin" />
                <span className="absolute inset-0 flex items-center justify-center text-2xl animate-bounce">
                  🎬
                </span>
              </div>
              
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1.5 font-poppins">
                Getting Video URL
              </h3>
              
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-[240px] leading-relaxed font-inter">
                Securing a high-speed streaming channel. Please wait...
              </p>
              
              {/* Animated Progress Indicator Bar */}
              <div className="w-full bg-gray-100 dark:bg-gray-800 h-1.5 rounded-full mt-6 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 dark:from-emerald-400 dark:to-teal-300 rounded-full w-2/3 animate-pulse" style={{ animationDuration: '1.5s' }} />
              </div>
            </div>
          </div>
        )}

        {!loading && !isBatchUnavailable && videoType === "youtube" && videoUrl && (
          <YouTubePlayer videoId={extractYouTubeVideoId(videoUrl)} ContentId={ContentId} />
        )}

        {!loading && !isBatchUnavailable && videoType === "penpencilvdo" && videoUrl ? (
          <DashPlayer
            src={videoUrl}
            type="dash"
            Attachment={Attachment || undefined}
            signedUrlQuery={signedUrlQuery}
            drmConfig={clearKeys ? { clearKeys } : undefined}
            ContentId={ContentId}
          />
        ) : !loading && (videoType === null || isBatchUnavailable) ? (
          <div className="flex flex-col items-center justify-center min-h-[400px] h-full p-6 text-center bg-gradient-to-br from-[#eef7f0] via-[#e4f6e8] to-[#f5f8ff] dark:from-[#0F1908] dark:via-[#1C2B22] dark:to-[#151D1A] transition-colors duration-300">
            <div className="w-full max-w-md p-8 rounded-2xl bg-white/80 dark:bg-[#1c2b22]/80 backdrop-blur-md shadow-xl border border-red-500/10 flex flex-col items-center animate-scaleIn">
              <Heart className="w-16 h-16 text-red-500 fill-red-500 animate-pulse mb-4 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3 leading-snug">
                This batch is unavailable. Ask your friend to donate this.
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
                If your friend has this batch, then login here and that batch will be automatically added.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
                <button
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      sessionStorage.setItem("donate_batch_id", batchId);
                    }
                    router.push("/study/donate");
                  }}
                  className="px-6 py-2.5 spring-btn-primary flex items-center justify-center gap-2 shadow-md"
                >
                  <Heart size={15} fill="#ffffff" />
                  Donate Batch
                </button>
                <button
                  onClick={() => router.back()}
                  className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-xl transition-all duration-300 active:scale-95"
                >
                  Go Back
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Extract YouTube video ID helper
function extractYouTubeVideoId(url: string): string {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.hostname === "youtu.be") {
      return parsedUrl.pathname.slice(1);
    }

    const vParam = parsedUrl.searchParams.get("v");
    if (vParam && vParam.length === 11) {
      return vParam;
    }

    const match = parsedUrl.pathname.match(
      /\/(embed|v|shorts)\/([a-zA-Z0-9_-]{11})/
    );
    if (match && match[2]) {
      return match[2];
    }

    return "";
  } catch {
    return "";
  }
}
