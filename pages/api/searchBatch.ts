import type { NextApiRequest, NextApiResponse } from "next";
import { authenticateUser } from "@/utils/authenticateUser";
import dbConnect from "@/lib/mongodb";
import Batch from "@/models/Batch";
import axios from "axios";

// In-memory cache for Pimaxer batches
let cachedBatches: any[] | null = null;
let cacheExpiry = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { name, page = "1" } = req.query;

  if (!name || typeof name !== "string") {
    return res.status(400).json({ message: "Missing or invalid `name` query" });
  }

  const limit = 10;
  const currentPage = parseInt(page as string, 10);
  const skip = (currentPage - 1) * limit;

  try {
    // Keep same authentication check
    await authenticateUser(req, res);
    await dbConnect();

    const now = Date.now();
    if (!cachedBatches || now > cacheExpiry) {
      const response = await axios.get("https://api.pimaxer.in/v2/batches", {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        timeout: 15000,
      });

      if (response.data && response.data.success && Array.isArray(response.data.data)) {
        cachedBatches = response.data.data;
        cacheExpiry = now + CACHE_DURATION;
      } else {
        throw new Error("Invalid response from Pimaxer API");
      }
    }

    const searchLower = name.toLowerCase();

    // 1. Filter batches matching search keyword in Pimaxer API
    const apiFiltered = (cachedBatches || []).filter((item: any) => {
      const nameMatch = item.name?.toLowerCase().includes(searchLower);
      const idMatch = item.id?.toLowerCase().includes(searchLower);
      return nameMatch || idMatch;
    });

    const apiMapped = apiFiltered.map((item: any) => ({
      _id: item.id,
      batchId: item.id,
      batchName: item.name,
      batchPrice: item.offPrice ?? item.actualPrice ?? 0,
      batchImage: item.pngUrl || "",
      template: "NORMAL",
      BatchType: item.actualPrice === 0 ? "FREE" : "PAID",
      language: item.medium || "Hinglish",
      byName: item.exam || "PW",
      startDate: item.startsOn || new Date().toISOString().split("T")[0],
      endDate: item.startsOn || new Date().toISOString().split("T")[0],
      batchStatus: true,
    }));

    // 2. Search local DB Batch collection
    const dbResults = await Batch.find({
      $or: [
        { batchName: { $regex: searchLower, $options: "i" } },
        { batchId: { $regex: searchLower, $options: "i" } }
      ]
    }).lean().exec();

    const dbMapped = dbResults.map((item: any) => ({
      _id: item.batchId || item._id,
      batchId: item.batchId,
      batchName: item.batchName,
      batchPrice: item.batchPrice || 0,
      batchImage: item.batchImage || "",
      template: item.template || "NORMAL",
      BatchType: item.BatchType || "FREE",
      language: item.language || "Hinglish",
      byName: item.byName || "PW",
      startDate: item.startDate || new Date().toISOString().split("T")[0],
      endDate: item.endDate || new Date().toISOString().split("T")[0],
      batchStatus: item.batchStatus ?? true,
    }));

    // 3. Merge both results uniquely by batchId
    const mergedMap = new Map();
    apiMapped.forEach((b: any) => {
      mergedMap.set(b.batchId, b);
    });
    dbMapped.forEach((b: any) => {
      if (!mergedMap.has(b.batchId)) {
        mergedMap.set(b.batchId, b);
      }
    });

    const allBatches = Array.from(mergedMap.values());
    const totalItems = allBatches.length;
    const paginated = allBatches.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      data: paginated,
      currentPage,
      totalPages: Math.ceil(totalItems / limit),
      totalItems,
    });
  } catch (error: any) {
    console.error("Batch search API integration error:", error.response?.data || error.message);
    return res.status(500).json({ message: "Error While Searching Batches" });
  }
}
