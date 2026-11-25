import Slide from "../models/Slide.js";
import User from "../models/User.js";
import { v2 as cloudinary } from "cloudinary";
import axios from "axios";

// Configure Cloudinary using environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// @desc    Save new slide
// @route   POST /api/slides/save
// @access  Private
export const saveSlide = async (req, res) => {
  try {
    const { topic, slidesData } = req.body;

    // Upload images to Cloudinary (if provided) and build new slidesData
    const uploadedSlidesData = await Promise.all(
      (slidesData || []).map(async (s) => {
        const imageInput = s.imageUrl || s.image || "";

        if (!imageInput) {
          // No image provided for this slide — save only textContent
          return {
            textContent: s.textContent || s.text || "",
          };
        }

        try {
          // cloudinary.uploader.upload accepts remote URLs and data URIs as well
          const uploadResult = await cloudinary.uploader.upload(imageInput, {
            folder: `slides/${req.user._id}`,
            resource_type: "image",
          });

          return {
            imageUrl: uploadResult.secure_url,
            textContent: s.textContent || s.text || "",
          };
        } catch (uploadErr) {
          console.error("Cloudinary upload failed for a slide image:", uploadErr);
          // Fallback: store original value if upload failed
          return {
            imageUrl: imageInput,
            textContent: s.textContent || s.text || "",
          };
        }
      })
    );

    const slide = await Slide.create({
      user: req.user._id,
      topic,
      slidesData: uploadedSlidesData,
    });

    // Add slide to user's slides array
    await User.findByIdAndUpdate(
      req.user._id,
      { $push: { slides: slide._id } },
      { new: true }
    );

    res.status(201).json(slide);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get slide by ID
// @route   GET /api/slides/:id
// @access  Private
export const getSlideById = async (req, res) => {
  try {
    const slide = await Slide.findById(req.params.id);

    if (slide) {
      // Check if the slide belongs to the user
      if (slide.user.toString() !== req.user._id.toString()) {
        return res.status(401).json({ message: "Not authorized" });
      }
      res.json(slide);
    } else {
      res.status(404).json({ message: "Slide not found" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get all slides for user
// @route   GET /api/slides
// @access  Private
export const getSlides = async (req, res) => {
  try {
    const slides = await Slide.find({ user: req.user._id }).sort({
      createdAt: -1,
    });

    res.json(slides);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Generate a 7-question quiz for a saved slide
// @route   POST /api/slides/:id/quiz
// @access  Private
export const generateSlideQuiz = async (req, res) => {
  try {
    const rawDifficulty = (req.body?.difficulty || "medium").toLowerCase().trim();
    const allowedDifficulties = new Set(["easy", "medium", "hard"]);

    if (!allowedDifficulties.has(rawDifficulty)) {
      return res.status(400).json({
        message: "Invalid difficulty. Must be easy, medium, or hard.",
      });
    }

    const slide = await Slide.findById(req.params.id);
    if (!slide) {
      return res.status(404).json({ message: "Slide not found" });
    }

    if (slide.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Not authorized" });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ message: "GROQ_API_KEY is not configured" });
    }

    const slideContent = (slide.slidesData || [])
      .map((s, idx) => {
        const plain = (s.textContent || "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return `Slide ${idx + 1}: ${plain}`;
      })
      .filter(Boolean)
      .join("\n");

    const difficultyGuidance = {
      easy: "Focus on foundational recall, key definitions, and direct facts from the topic and slides.",
      medium: "Focus on conceptual understanding, cause-and-effect, and connecting ideas across the slides.",
      hard: "Focus on deeper analysis, multi-step reasoning, subtle distinctions, and practical application.",
    }[rawDifficulty];

    const prompt = `Create a ${rawDifficulty.toUpperCase()} difficulty multiple-choice quiz with EXACTLY 7 questions based on the presentation topic/title and slide content below.

Topic/Title: ${slide.topic}
Difficulty: ${rawDifficulty} (${difficultyGuidance})

Slide Content:
${slideContent || slide.topic}

Strict Output Rules:
1. Return ONLY valid JSON (no markdown code fences, no commentary).
2. The JSON must match this exact schema:
{
  "questions": [
    {
      "question": "Clear question text?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Brief 1-2 sentence explanation of the correct answer."
    }
  ]
}
3. Provide EXACTLY 7 questions.
4. Each question MUST have EXACTLY 4 distinct options and a valid integer correctIndex between 0 and 3.`;

    const url =
      process.env.GROQ_API_URL ||
      process.env.GROQ_ENDPOINT ||
      "https://api.groq.com/openai/v1/chat/completions";

    const resp = await axios.post(
      url,
      {
        model: "openai/gpt-oss-120b",
        messages: [
          {
            role: "system",
            content:
              "You are an expert educational quiz generator. Output strictly valid JSON with no surrounding text.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_completion_tokens: 2500,
        top_p: 1,
        reasoning_effort: "low",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 45000,
      }
    );

    const rawContent = resp?.data?.choices?.[0]?.message?.content || "";
    const cleaned = rawContent
      .replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Quiz response was not valid JSON");
      }
      parsed = JSON.parse(jsonMatch[0]);
    }

    const questions = Array.isArray(parsed?.questions)
      ? parsed.questions
          .slice(0, 7)
          .map((q) => ({
            question: String(q.question || "").trim(),
            options: Array.isArray(q.options)
              ? q.options.slice(0, 4).map((o) => String(o).trim())
              : [],
            correctIndex:
              Number.isInteger(q.correctIndex) &&
              q.correctIndex >= 0 &&
              q.correctIndex <= 3
                ? q.correctIndex
                : 0,
            explanation: String(q.explanation || "").trim(),
          }))
          .filter((q) => q.question && q.options.length === 4)
      : [];

    if (questions.length === 0) {
      return res.status(500).json({ message: "Failed to generate quiz questions" });
    }

    return res.json({
      topic: slide.topic,
      difficulty: rawDifficulty,
      questions,
    });
  } catch (error) {
    console.error("Quiz generation error:", error?.response?.data || error?.message || error);
    return res.status(500).json({
      message: error?.response?.data?.error?.message || error.message || "Failed to generate quiz",
    });
  }
};
