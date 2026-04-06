import express from "express";
import multer from "multer";
import pdfParse from "pdf-parse";

const router = express.Router();

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only PDFs are allowed."));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// POST /pdf
// Accepts a single file in field name "pdf" and returns extracted text
router.post("/pdf", (req, res) => {
  upload.single("pdf")(req, res, async (err) => {
    if (err) {
      // Multer errors and other upload errors
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, message: err.message });
      }
      return res.status(400).json({ success: false, message: err.message || "File upload error" });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded or invalid file type" });
    }

    try {
      const data = await pdfParse(req.file.buffer);
      const text = data && data.text ? data.text : "";
      return res.json({ success: true, text });
    } catch (parseErr) {
      console.error("PDF parse error:", parseErr);
      return res.status(500).json({ success: false, message: "Failed to parse PDF" });
    }
  });
});

export default router;
