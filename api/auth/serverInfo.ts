import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongodb";
import { getPublicServerConfig } from "@/lib/publicServerConfig";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const config = await getPublicServerConfig();
    return res.status(200).json(config);
  } catch (error) {
    console.error("[serverInfo] Error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
