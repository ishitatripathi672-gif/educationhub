"use client";

import { useEffect, useState } from "react";
import HLSPlayer from "@/app/components/HLSPlayer";
import { toast } from "sonner";

export default function LivePage() {
  const [url, seturl] = useState<string | null>(null);
  const [signedUrl, setsignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null); // 👈 track error

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const batchId = params.get("batchId");
    const subjectId = params.get("SubjectId");
    const childId = params.get("ChildId");

    if (!batchId || !subjectId || !childId) {
      const err = "Missing required query parameters.";
      toast.error(err);
      setErrorMsg(err);

      setLoading(false);
      return;
    }

    const promise = toast.promise(
      fetch(
        `/api/get-url?parentId=${batchId}&childId=${childId}&container=HLS`
      ).then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Failed to fetch video URL");
        }
        const data = await res.json();
        const fullUrl = data.url;

        if (!fullUrl) {
          throw new Error("Invalid video URL response from server");
        }

        const qIdx = fullUrl.indexOf("?");
        if (qIdx !== -1) {
          seturl(fullUrl.slice(0, qIdx));
          setsignedUrl(fullUrl.slice(qIdx));
        } else {
          seturl(fullUrl);
          setsignedUrl("");
        }
        return data;
      }),
      {
        loading: "Loading video link...",
        success: "Video link loaded!",
        error: (err) => {
          setErrorMsg(err.message || "Error loading video link");
          return err.message || "Error loading video link";
        },
      }
    );

    // unwrap returns a real Promise so you can use finally()
    promise.unwrap().finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen text-white">
        <span>Loading video...</span>
      </div>
    );
  }

  if (errorMsg || !url || !signedUrl) {
    return (
      <div className="text-red-500 text-center p-4">
        <p>{errorMsg || "Unknown error occurred."}</p>
      </div>
    );
  }

  return <HLSPlayer baseUrl={url} signedQuery={signedUrl} />;
}
