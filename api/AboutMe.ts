// pages/api/getEnrolledBatches.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { authenticateUser } from "@/utils/authenticateUser";
import dbConnect from '@/lib/mongodb';
import UserModel from "@/models/User";
import Batch from "@/models/Batch";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const authUser = await authenticateUser(req, res); // just decodes JWT
    await dbConnect(); // ensure DB connection

    const user: any = await UserModel.findById(authUser._id).lean().exec();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Query batches where user is enrolled in local DB
    const dbBatches = await Batch.find({ "enrolledTokens.ownerId": user._id }).lean().exec();

    const enrolledMap = new Map();
    // 1. Add user's own enrolledBatches
    (user.enrolledBatches || []).forEach((b: any) => {
      enrolledMap.set(b.batchId, {
        _id: b._id ? b._id.toString() : b.batchId,
        batchId: b.batchId,
        name: b.name
      });
    });
    // 2. Add/override from Batch collection
    dbBatches.forEach((b: any) => {
      enrolledMap.set(b.batchId, {
        _id: b._id.toString(),
        batchId: b.batchId,
        name: b.batchName
      });
    });

    const enrolledBatches = Array.from(enrolledMap.values());

    return res.status(200).json({
      success: true,
      user: {
        userId: user._id,
        name: user.UserName,
        telegramId: user.telegramId,
        PhotoUrl: user.photoUrl,
        tag: user.tag ?? null,
      },
      enrolledBatches,
    });

  } catch (err: any) {
    return res.status(401).json({ message: err.message || "Unauthorized" });
  }
}
