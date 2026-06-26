import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { authenticateUser } from "@/utils/authenticateUser";

const MASTER_TOKEN = process.env.MASTER_DPP_TOKEN || "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3ODE0MDcwMzAuMjIxLCJkYXRhIjp7Il9pZCI6IjY5ZTE4NWUxMWM3Y2JlZGMyNjU4ZDNhZiIsInVzZXJuYW1lIjoiOTQ1ODQzNTU2NSIsImZpcnN0TmFtZSI6IkthaXplbiIsIm9yZ2FuaXphdGlvbiI6eyJfaWQiOiI1ZWIzOTNlZTk1ZmFiNzQ2OGE3OWQxODkiLCJ3ZWJzaXRlIjoicGh5c2ljc3dhbGxhaC5jb20iLCJuYW1lIjoiUGh5c2ljc3dhbGxhaCJ9LCJyb2xlcyI6WyI1YjI3YmQ5NjU4NDJmOTUwYTc3OGM2ZWYiXSwiY291bnRyeUdyb3VwIjoiSU4iLCJ0eXBlIjoiVVNFUiJ9LCJqdGkiOiJmXzF5eU5iTlFobW9oUFJMalZ6cGhBXzY5ZTE4NWUxMWM3Y2JlZGMyNjU4ZDNhZiIsImlhdCI6MTc4MDgwMjIzMH0.uags8M_6n8f6NV84CQpVIgfM2zL0C1197KWB8d46gp8";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { batchId, isSubjective = "false" } = req.query;

  if (!batchId) {
    return res.status(400).json({ message: "Missing required parameter: batchId" });
  }

  try {
    // Authenticate user
    await authenticateUser(req, res);

    const url = `https://api.penpencil.co/v3/test-service/tests?categorySectionId=Other_Tests&batchId=${batchId}&isSubjective=${isSubjective === "true"}`;

    const response = await axios.get(url, {
      headers: {
        "Authorization": `Bearer ${MASTER_TOKEN}`,
        "client-id": "system-admin",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      timeout: 10000,
    });

    if (response.data && response.data.success) {
      return res.status(200).json({
        success: true,
        data: response.data.data || [],
      });
    } else {
      throw new Error(response.data?.message || "Failed to fetch tests");
    }
  } catch (err: any) {
    console.error("Fetch tests error:", err.response?.data || err.message);
    return res.status(err.response?.status || 500).json({
      message: err.response?.data?.message || err.message || "Error fetching tests",
    });
  }
}
