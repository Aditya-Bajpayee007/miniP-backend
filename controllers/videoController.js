import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import googleTTS from "google-tts-api";
import { v2 as cloudinary } from "cloudinary";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import Slide from "../models/Slide.js";

ffmpeg.setFfmpegPath(ffmpegPath);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;

async function summarizeSlide(text) {
  const prompt = `Read the slide text and produce short clear sentence that summarizes it for narration and slide title.

Strict Output rules :
1) use only letters and spaces
2) do not use any punctuation symbols or special characters
3) do not add explanations or extra words
4) return only the summary sentence
5) do not add the word "Summary" or "In summary" at the beginning, just return the summary sentence directly.
6) do not add the word "Slide" or "Slide Title" at the beginning, just return the summary sentence directly.

Slide text
${text}`;

  try {
    if (
      process.env.GROQ_API_KEY &&
      (process.env.GROQ_API_URL || process.env.GROQ_ENDPOINT)
    ) {
      // prefer explicit GROQ_API_URL env, otherwise default to standard Groq chat completions endpoint
      const url =
        process.env.GROQ_API_URL ||
        process.env.GROQ_ENDPOINT ||
        "https://api.groq.com/openai/v1/chat/completions";
      const body = {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 128,
      };

      const resp = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      // Parse common chat-completion shapes (choices[0].message.content)
      const choices = resp?.data?.choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const first = choices[0];
        const msg =
          first?.message?.content ||
          first?.message ||
          first?.text ||
          first?.delta?.content;
        if (typeof msg === "string" && msg.trim()) return msg.trim();
        if (typeof msg === "object" && msg?.content)
          return String(msg.content).trim();
      }

      // Some endpoints may return top-level 'output' or similar
      const out = resp?.data?.output || resp?.data?.result || resp?.data?.text;
      if (typeof out === "string" && out.trim()) return out.trim();
      if (Array.isArray(out) && typeof out[0] === "string")
        return out[0].trim();
    }
  } catch (e) {
    console.warn("summarizeSlide failed:", e?.message || e);
  }

  // fallback: return truncated original
  return (text || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

async function ttsGoogle(text, outPath) {
  // Use unofficial google-tts-api (no credentials required)
  if ((text || "").length <= 200) {
    const base64 = await googleTTS.getAudioBase64(text, {
      lang: "en",
      slow: false,
      host: "https://translate.google.com",
    });
    const buffer = Buffer.from(base64, "base64");
    await fs.promises.writeFile(outPath, buffer);
    return outPath;
  }

  // For long text, use getAllAudioBase64 to get chunks and concatenate
  const parts = await googleTTS.getAllAudioBase64(text, {
    lang: "en",
    slow: false,
    host: "https://translate.google.com",
  });
  const extractBase64 = (p) => {
    if (!p && p !== "") return "";
    if (typeof p === "string") return p;
    if (typeof p === "object") {
      if (typeof p.base64 === "string") return p.base64;
      if (typeof p.audio === "string") return p.audio;
      if (typeof p.audioContent === "string") return p.audioContent;
      // try common nested fields
      for (const key of ["data", "content"]) {
        if (p[key] && typeof p[key] === "string") return p[key];
      }
    }
    throw new Error("Unexpected TTS part format");
  };

  const buffers = parts.map((b) => Buffer.from(extractBase64(b), "base64"));
  // Simple concat of mp3 buffers (works for many players)
  const concat = Buffer.concat(buffers);
  await fs.promises.writeFile(outPath, concat);
  return outPath;
}

async function ttsElevenLabs(text, outPath) {
  if (!ELEVEN_KEY) throw new Error("Missing ELEVENLABS_API_KEY env var");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}`;

  try {
    const resp = await axios.post(
      url,
      { text },
      {
        responseType: "arraybuffer",
        headers: {
          "xi-api-key": ELEVEN_KEY,
          "Content-Type": "application/json",
        },
      },
    );

    await fs.promises.writeFile(outPath, resp.data);
    return outPath;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401) {
      // Try Google TTS fallback
      try {
        return await ttsGoogle(text, outPath);
      } catch (gErr) {
        throw new Error(
          `ElevenLabs auth failed and Google TTS unavailable: ${gErr.message}`,
        );
      }
    }
    throw err;
  }
}

import { execFile } from "child_process";
import sharp from "sharp";

function probeDuration(filePath) {
  // Use ffmpeg binary to probe duration (parsing stderr) to avoid ffprobe dependency
  return new Promise((resolve, reject) => {
    const ffmpegBin = ffmpegPath;
    execFile(
      ffmpegBin,
      ["-i", filePath],
      { timeout: 10000 },
      (err, stdout, stderr) => {
        const out = (stderr || stdout || "").toString();
        const m = out.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (m) {
          const hours = parseInt(m[1], 10);
          const minutes = parseInt(m[2], 10);
          const seconds = parseFloat(m[3]);
          const duration = hours * 3600 + minutes * 60 + seconds;
          return resolve(duration);
        }
        // if ffmpeg returns an error code but still prints duration, we handled it; otherwise reject
        if (err)
          return reject(new Error("Could not probe duration: " + err.message));
        resolve(0);
      },
    );
  });
}

async function downloadImage(url, outPath) {
  const resp = await axios.get(url, { responseType: "arraybuffer" });
  await fs.promises.writeFile(outPath, resp.data);
  return outPath;
}

async function makeSegment(
  imagePath,
  audioPath,
  text,
  duration,
  outSegmentPath,
) {
  return new Promise((resolve, reject) => {
    try {
      const fontPath = "/Library/Fonts/Arial.ttf"; // macOS fallback

      const sanitize = (s) =>
        (s || "")
          .replace(/<[^>]*>/g, "")
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "\\'")
          .replace(/:/g, "\\:")
          .replace(/%/g, "\\%")
          .replace(/\r?\n/g, "\n");

      const escapeXml = (unsafe) =>
        (unsafe || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");

      // word-wrap helper
      const wrapText = (str, maxChars = 42) => {
        if (!str) return [""];
        const words = str.split(/\s+/);
        const lines = [];
        let cur = "";
        for (const w of words) {
          if ((cur + " " + w).trim().length <= maxChars) {
            cur = (cur + " " + w).trim();
          } else {
            if (cur) lines.push(cur);
            if (w.length > maxChars) {
              for (let i = 0; i < w.length; i += maxChars) {
                lines.push(w.slice(i, i + maxChars));
              }
              cur = "";
            } else {
              cur = w;
            }
          }
        }
        if (cur) lines.push(cur);
        return lines;
      };

      // build lines preserving explicit newlines
      const raw = sanitize(text || "");
      const paragraphs = raw.split("\n").filter((p) => p !== "");
      let lines = [];
      for (const p of paragraphs) lines = lines.concat(wrapText(p, 42));
      if (lines.length === 0) lines = [""];

      const svgW = 1280;
      const svgH = 720;
      let fontSize = 48;
      if (lines.length > 6) fontSize = 28;
      else if (lines.length > 4) fontSize = 36;
      const lineHeight = Math.round(fontSize * 1.15);
      const bottomPadding = 48;
      // top Y so block fits above bottomPadding
      let startY = svgH - bottomPadding - lines.length * lineHeight;
      if (startY < 8) startY = 8;

      const tspans = lines
        .map((ln, idx) => {
          const dy = idx === 0 ? "0" : `${lineHeight}`;
          return `<tspan x='50%' dy='${dy}'>${escapeXml(ln)}</tspan>`;
        })
        .join("");

      const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns='http://www.w3.org/2000/svg' width='${svgW}' height='${svgH}'>\n  <style>\n    .t { fill: white; font-size:${fontSize}px; font-family: Arial, Helvetica, sans-serif; }</style>\n  <rect width='100%' height='100%' fill='transparent'/>\n  <text x='50%' y='${startY}' text-anchor='middle' dominant-baseline='text-before-edge' class='t'>${tspans}</text>\n</svg>`;

      const overlayPath = outSegmentPath.replace(/\.mp4$/, "-overlay.png");

      sharp(Buffer.from(svg))
        .png()
        .toFile(overlayPath)
        .then(() => {
          const args = [
            "-y",
            "-loop",
            "1",
            "-i",
            imagePath,
            "-i",
            overlayPath,
            "-i",
            audioPath,
            "-filter_complex",
            "[0:v]scale=1280:720[bg];[1:v]scale=1280:720[ov];[bg][ov]overlay=0:0",
            "-c:v",
            "libx264",
            "-t",
            String(duration),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            outSegmentPath,
          ];

          execFile(ffmpegPath, args, (err, stdout, stderr) => {
            // cleanup overlay
            fs.promises.unlink(overlayPath).catch(() => {});
            if (err)
              return reject(
                new Error(
                  `ffmpeg exited with code ${err.code}: ${stderr || stdout}`,
                ),
              );
            resolve(outSegmentPath);
          });
        })
        .catch((err) => reject(err));
    } catch (e) {
      reject(e);
    }
  });
}

export const generateVideo = async (req, res) => {
  try {
    const { slideId } = req.body;
    if (!slideId) return res.status(400).json({ message: "Missing slideId" });

    const slide = await Slide.findById(slideId);
    if (!slide) return res.status(404).json({ message: "Slide not found" });
    if (slide.user.toString() !== req.user._id.toString())
      return res.status(401).json({ message: "Not authorized" });

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "video-"));
    const segments = [];

    for (let i = 0; i < slide.slidesData.length; i++) {
      const s = slide.slidesData[i];
      const imagePath = path.join(tmpDir, `image-${i}.jpg`);
      if (s.imageUrl) {
        await downloadImage(s.imageUrl, imagePath);
      } else {
        // create a plain background if no image (1280x720 black)
        await sharp({
          create: {
            width: 1280,
            height: 720,
            channels: 3,
            background: { r: 0, g: 0, b: 0 },
          },
        })
          .jpeg()
          .toFile(imagePath);
      }

      // Summarize slide text first, then generate narration from the summary
      const summary = await summarizeSlide(s.textContent || "");

      const audioPath = path.join(tmpDir, `audio-${i}.mp3`);
      await ttsElevenLabs(summary, audioPath);

      const duration = await probeDuration(audioPath);

      const segPath = path.join(tmpDir, `seg-${i}.mp4`);
      await makeSegment(
        imagePath,
        audioPath,
        summary || s.textContent || "",
        duration,
        segPath,
      );

      segments.push(segPath);
    }

    const listPath = path.join(tmpDir, "list.txt");
    const listContent = segments.map((p) => `file '${p}'`).join("\n");
    await fs.promises.writeFile(listPath, listContent);

    const outputPath = path.join(tmpDir, `output-${Date.now()}.mp4`);

    // concat
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions(["-c copy"]) // copy should work since segments use same codecs
        .on("end", resolve)
        .on("error", reject)
        .save(outputPath);
    });

    // upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(outputPath, {
      resource_type: "video",
      folder: `videos/${req.user._id}`,
    });

    // cleanup
    try {
      const files = await fs.promises.readdir(tmpDir);
      await Promise.all(
        files.map((f) => fs.promises.unlink(path.join(tmpDir, f))),
      );
      await fs.promises.rmdir(tmpDir);
    } catch (e) {
      console.warn("Temp cleanup failed:", e.message);
    }

    return res.json({ url: uploadResult.secure_url });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message });
  }
};
