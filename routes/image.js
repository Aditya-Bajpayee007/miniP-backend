import express from "express";
import axios from "axios";

const router = express.Router();

router.get("/search", async (req, res) => {
  const { q } = req.query;

  if (!q) return res.status(400).json({ error: "Missing query" });

  try {
    const response = await axios.get("https://serpapi.com/search.json", {
      params: {
        engine: "google_images",
        q,
        api_key: process.env.SERPAPI_API_KEY,
        hl: "en",
        gl: "us",
        ijn: 0,
      },
    });

    const firstImage =
      response.data.images_results?.[0]?.original ||
      response.data.images_results?.[0]?.thumbnail;

    res.json({ image: firstImage || null });
  } catch (err) {
    console.error("SerpAPI error:", err.message);
    res.status(500).json({ error: "SerpAPI search failed" });
  }
});

export default router;
