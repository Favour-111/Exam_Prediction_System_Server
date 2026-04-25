const mongoose = require("mongoose");

const topicSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Topic name is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    lecturerEmphasis: {
      type: Number,
      min: 0,
      max: 10,
      default: 5,
      description:
        "Weight from 0-10 indicating lecturer emphasis on this topic",
    },
    lecturerNotes: {
      type: String,
      trim: true,
      default: "",
    },
    frequency: {
      type: Number,
      default: 0,
      description: "Number of times this topic appeared in past exams",
    },
    lastAppeared: {
      type: Date,
    },
    keywords: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    subtopics: [
      {
        name: String,
        emphasis: {
          type: Number,
          min: 0,
          max: 10,
          default: 5,
        },
      },
    ],
    predictedProbability: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
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

// Index for better query performance
topicSchema.index({ course: 1, name: 1 });
topicSchema.index({ predictedProbability: -1 });

module.exports = mongoose.model("Topic", topicSchema);
