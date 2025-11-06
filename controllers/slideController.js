import Slide from "../models/Slide.js";
import User from "../models/User.js";
import { v2 as cloudinary } from "cloudinary";

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
