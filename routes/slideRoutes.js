import express from "express";
import {
  saveSlide,
  getSlides,
  getSlideById,
  generateSlideQuiz,
} from "../controllers/slideController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.route("/").get(protect, getSlides);
router.route("/:id").get(protect, getSlideById);
router.post("/save", protect, saveSlide);
router.post("/:id/quiz", protect, generateSlideQuiz);

export default router;
