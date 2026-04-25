const mongoose = require("mongoose");

const predictionSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    modelVersion: {
      type: String,
      default: "1.0",
    },
    modelAccuracy: {
      type: Number,
      min: 0,
      max: 1,
    },
    topicPredictions: [
      {
        topic: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Topic",
        },
        topicName: String,
        probability: {
          type: Number,
          min: 0,
          max: 1,
        },
        confidence: {
          type: String,
          enum: ["Low", "Medium", "High"],
          default: "Medium",
        },
      },
    ],
    questionPredictions: [
      {
        question: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Question",
        },
        questionText: String,
        probability: {
          type: Number,
          min: 0,
          max: 1,
        },
        suggestedQuestionType: String,
        suggestedDifficulty: String,
      },
    ],
    generatedQuestions: [
      {
        text: String,
        topicName: String,
        questionType: String,
        difficulty: String,
        rationale: String,
        probability: {
          type: Number,
          min: 0,
          max: 1,
        },
      },
    ],
    // AI (Groq) cross-year analysis and generated predictions
    aiAnalysis: {
      yearsAnalyzed: [String],
      totalQuestionsAnalyzed: Number,
      recurringTopics: [
        {
          topic: String,
          appearedInYears: [String],
          frequency: Number,
          trend: String,
        },
      ],
      overallConfidence: Number, // 0-100
      summary: String,
    },
    aiGeneratedQuestions: [
      {
        question: String,
        probability: Number, // 0-100
        reasoning: String,
        appearedInYears: [String],
        topic: String,
        questionType: String,
        difficulty: String,
      },
    ],
    questionTypeDistribution: {
      Theory: { type: Number, default: 0 },
      Objective: { type: Number, default: 0 },
      Calculation: { type: Number, default: 0 },
      Practical: { type: Number, default: 0 },
      CaseStudy: { type: Number, default: 0 },
    },
    difficultyDistribution: {
      Easy: { type: Number, default: 0 },
      Medium: { type: Number, default: 0 },
      Hard: { type: Number, default: 0 },
    },
    insights: [
      {
        type: String,
      },
    ],
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// Index for efficient queries
predictionSchema.index({ course: 1, generatedAt: -1 });

module.exports = mongoose.model("Prediction", predictionSchema);
