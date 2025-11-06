import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

router.get("/search", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing query" });

  const parseNumber = (val) => {
    if (!val) return 0;
    const s = val.toString().toLowerCase();
    if (s.includes("m")) return parseFloat(s) * 1_000_000;
    if (s.includes("k")) return parseFloat(s) * 1_000;
    return parseInt(s.replace(/[^\d]/g, "")) || 0;
  };

  try {
    const response = await axios.get("https://serpapi.com/search.json", {
      params: {
        engine: "youtube",
        search_query: q,
        api_key: process.env.SERPAPI_API_KEY,
        hl: "en",
        gl: "us",
      },
    });

    console.log("SERPAPI raw response:", Object.keys(response.data));

    const videos =
      response.data.video_results ||
      response.data.videos ||
      response.data.youtube_results ||
      [];

    const formatted = videos
      .map((v) => ({
        title: v.title,
        url: v.link,
        thumbnail:
          typeof v.thumbnail === "string"
            ? v.thumbnail
            : v.thumbnail?.static ||
              v.thumbnail?.link ||
              v.thumbnail?.url ||
              (Array.isArray(v.thumbnail) ? v.thumbnail[0]?.url : ""),
        views: parseNumber(v.views),
        likes: parseNumber(v.likes),
        comments: parseNumber(v.comments),
        channel: v.channel?.name || "",
        published: v.published_date || v.published || "",
      }))
      .filter((v) => v.url && v.title);

    res.json({ videos: formatted });
  } catch (err) {
    console.error("YouTube SerpAPI error:", err.message);
    res.status(500).json({ error: "YouTube SERPAPI search failed" });
  }
});

export default router;
