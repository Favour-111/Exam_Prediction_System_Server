const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadsDir = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

// File filter - now includes images for OCR
const fileFilter = (req, file, cb) => {
  const allowedExtensions = [".pdf", ".txt", ".jpg", ".jpeg", ".png", ".webp"];
  const allowedTypes = [
    // Supported text sources
    "application/pdf",
    "text/plain",
    // Images (for OCR)
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
  ];
  const extension = path.extname(file.originalname || "").toLowerCase();

  if (
    allowedTypes.includes(file.mimetype) ||
    allowedExtensions.includes(extension)
  ) {
    cb(null, true);
  } else {
    cb(
      new Error("Invalid file type. Allowed: PDF, TXT, JPG, PNG, JPEG"),
      false,
    );
  }
};

// Helper to check if file is an image
const isImageFile = (mimetype) => {
  return ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
    mimetype,
  );
};

// Initialize multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

module.exports = upload;
module.exports.isImageFile = isImageFile;
