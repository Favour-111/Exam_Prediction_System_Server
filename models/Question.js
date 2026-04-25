const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: [true, "Question text is required"],
      trim: true,
    },
    originalText: {
      type: String,
      trim: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    topic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Topic",
    },
    conceptLabel: {
      type: String,
      trim: true,
      default: "Core Course Material",
    },
    normalizedText: {
      type: String,
      trim: true,
    },
    semanticTokens: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    similaritySignature: {
      type: String,
      trim: true,
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Medium",
    },
    questionType: {
      type: String,
      enum: ["Theory", "Objective", "Calculation", "Practical", "Case Study"],
      default: "Theory",
    },
    options: [
      {
        text: String,
        isCorrect: Boolean,
      },
    ],
    answer: {
      type: String,
      trim: true,
    },
    marks: {
      type: Number,
      default: 1,
    },
    year: {
      type: Number,
    },
    semester: {
      type: String,
      enum: ["First", "Second", "Summer"],
    },
    examType: {
      type: String,
      enum: ["Midterm", "Final", "Quiz", "Assignment"],
      default: "Final",
    },
    occurrenceCount: {
      type: Number,
      default: 1,
      description: "Number of times this question or similar appeared",
    },
    predictedProbability: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    keywords: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    sourceFile: {
      type: String,
    },
    isAiEnhanced: {
      type: Boolean,
      default: false,
    },
    aiModel: {
      type: String,
      trim: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient queries
questionSchema.index({ course: 1, topic: 1 });
questionSchema.index({ course: 1, conceptLabel: 1 });
questionSchema.index({ course: 1, similaritySignature: 1 });
questionSchema.index({ predictedProbability: -1 });
questionSchema.index({ difficulty: 1 });
questionSchema.index({ questionType: 1 });
questionSchema.index({ text: "text" }); // Text search index

module.exports = mongoose.model("Question", questionSchema);
