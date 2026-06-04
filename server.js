const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require("./routes/auth");
const courseRoutes = require("./routes/courses");
const questionRoutes = require("./routes/questions");
const topicRoutes = require("./routes/topics");
const predictionRoutes = require("./routes/predictions");
const uploadRoutes = require("./routes/upload");

// Initialize express app
const app = express();

const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  [
    "https://exam-prediction-system-pi.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
  ].join(",")
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
};

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
let mongoConnectionPromise;

const connectToDatabase = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  if (!mongoConnectionPromise) {
    mongoConnectionPromise = mongoose.connect(MONGODB_URI).then((connection) => {
      console.log("✓ Connected to MongoDB");
      return connection;
    });
  }

  return mongoConnectionPromise;
};

// Middleware
app.use(cors(corsOptions));

app.options("*", cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Static folder for uploads
app.use(
  "/uploads",
  express.static(
    process.env.VERCEL
      ? path.join("/tmp", "uploads")
      : path.join(__dirname, "uploads"),
  ),
);

app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Exam Prediction API is running" });
});

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Exam Prediction API is running" });
});

app.use("/api", async (req, res, next) => {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  try {
    await connectToDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/topics", topicRoutes);
app.use("/api/predictions", predictionRoutes);
app.use("/api/upload", uploadRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

if (!process.env.VERCEL) {
  connectToDatabase()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`✓ Server running on port ${PORT}`);
        console.log(`✓ API available at http://localhost:${PORT}/api`);
      });
    })
    .catch((error) => {
      console.error("✗ MongoDB connection error:", error.message);
      process.exitCode = 1;
    });
}

module.exports = app;
