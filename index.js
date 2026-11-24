import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";

import imageRoute from "./routes/image.js";
import youtubeRoute from "./routes/youtube.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import slideRoutes from "./routes/slideRoutes.js";
import videoRoutes from "./routes/videoRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
// import videoRoutes from "./routes/videoRoutes.js";

dotenv.config();

const app = express();

// ✅ CORS setup — allow localhost + any vercel.app origin
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    // Allow localhost and any *.vercel.app deployment
    if (
      origin.startsWith("http://localhost") ||
      origin.endsWith(".vercel.app")
    ) {
      return callback(null, true);
    }

    console.warn("CORS blocked origin:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// ✅ Handle ALL preflight OPTIONS requests FIRST — no DB needed
app.use((req, res, next) => {
  // Set CORS headers on every response
  const origin = req.headers.origin;
  if (
    origin &&
    (origin.startsWith("http://localhost") || origin.endsWith(".vercel.app"))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Immediately respond to OPTIONS preflight — skip DB, skip routes
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

// Apply cors middleware for non-preflight requests
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// connectDB() is now handled per-route in serverless environment

// ✅ Middleware to ensure DB connection before routes (skips OPTIONS — already handled above)
app.use(async (req, res, next) => {
  try {
    const { connectDB } = await import("./lib/db.js");
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
app.use("/api/upload", uploadRoutes);
app.use("/api/video", videoRoutes);

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