import express from "express";
import { connectDB } from "./lib/db.js";
import dotenv from "dotenv";
import cors from "cors";

import imageRoute from "./routes/image.js";
import youtubeRoute from "./routes/youtube.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import slideRoutes from "./routes/slideRoutes.js";

dotenv.config();

const app = express();

// ✅ CORS setup
const allowedOrigins = [
  "http://localhost:5173",
  "https://mini-p-frontend.vercel.app", // ✅ your main stable production URL
];

// Dynamic CORS handler
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      // Allow if origin is whitelisted
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow any Vercel preview or production deployment
      try {
        const hostname = new URL(origin).hostname;
        if (hostname.endsWith("vercel.app")) {
          return callback(null, true);
        }
      } catch (e) {
        console.error("Invalid origin URL:", origin);
      }

      console.warn("CORS blocked origin:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ❌ Remove global DB connection here
// connectDB() is now handled per-route in serverless environment

// ✅ Middleware to ensure DB connection before routes
app.use(async (req, res, next) => {
  try {
    await connectDB(); // Wait for connection before handling any request
    next();
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    res.status(500).json({ message: "Database connection failed" });
  }
});

// ✅ Routes
app.use("/api/image", imageRoute);
app.use("/api/youtube", youtubeRoute);
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/slides", slideRoutes);

// ✅ Root route
app.get("/", (req, res) => {
  res.send("Server is running...");
});

// ✅ Error middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

export default app;
