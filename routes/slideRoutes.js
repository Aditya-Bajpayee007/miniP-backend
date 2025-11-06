import express from "express";
import {
  saveSlide,
  getSlides,
  getSlideById,
} from "../controllers/slideController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.route("/").get(protect, getSlides);
router.route("/:id").get(protect, getSlideById);
router.post("/save", protect, saveSlide);

export default router;
