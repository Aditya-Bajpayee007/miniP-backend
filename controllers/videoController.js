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
    if (status === 401 || status === 403 || status===402) {
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

async function downloadAndNormalizeImage(url, outPath) {
  const resp = await axios.get(url, { responseType: "arraybuffer" });

  // Always convert to JPEG using sharp
  await sharp(resp.data)
    .resize(1920, 1080, { fit: "cover" })
    .sharpen()
    .jpeg({ quality: 90 })
    .toFile(outPath);

  return outPath;
}

async function makeSegment(
  imagePath,
  audioPath,
  duration,
  outSegmentPath
) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-loop", "1",
      "-i", imagePath,
      "-i", audioPath,
      "-vf", "scale=1920:1080:flags=lanczos",
      "-c:v", "libx264",
      "-t", String(duration),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      outSegmentPath,
    ];

    execFile(ffmpegPath, args, (err, stdout, stderr) => {
      if (err) {
        return reject(
          new Error(`ffmpeg failed: ${stderr || stdout}`)
        );
      }
      resolve(outSegmentPath);
    });
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

      // Determine image to use: current slide image or nearest neighbor with an image
      let imageUrlToUse = s.imageUrl || null;
      let sourceIndex = i;
      if (!imageUrlToUse) {
        // prefer previous slides
        for (let j = i - 1; j >= 0; j--) {
          if (slide.slidesData[j] && slide.slidesData[j].imageUrl) {
            imageUrlToUse = slide.slidesData[j].imageUrl;
            sourceIndex = j;
            break;
          }
        }
      }
      if (!imageUrlToUse) {
        // then try next slides
        for (let j = i + 1; j < slide.slidesData.length; j++) {
          if (slide.slidesData[j] && slide.slidesData[j].imageUrl) {
            imageUrlToUse = slide.slidesData[j].imageUrl;
            sourceIndex = j;
            break;
          }
        }
      }

      if (imageUrlToUse) {
        try {
          if (sourceIndex < i) {
            // reuse previously created/downloaded image if available
            const srcPath = path.join(tmpDir, `image-${sourceIndex}.jpg`);
            const srcExists = await fs.promises
              .access(srcPath)
              .then(() => true)
              .catch(() => false);
            if (srcExists) {
              await fs.promises.copyFile(srcPath, imagePath);
            } else {
              await downloadAndNormalizeImage(imageUrlToUse, imagePath);
            }
          } else {
            // either this slide has an image or we're using a next slide's image
            await downloadAndNormalizeImage(imageUrlToUse, imagePath);
          }

          // verify the downloaded/generated file is a readable image; if not, fallback to plain background
          try {
            await sharp(imagePath).metadata();
          } catch (err) {
            await fs.promises.unlink(imagePath).catch(() => {});
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
        } catch (err) {
          // any download/validation error -> fallback to plain background
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
      } else {
        // no image anywhere nearby, create a plain background (1280x720 black)
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
        duration,
        segPath
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
