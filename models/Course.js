const mongoose = require("mongoose");

const courseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Course name is required"],
      trim: true,
    },
    code: {
      type: String,
      required: [true, "Course code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    department: {
      type: String,
      required: true,
      trim: true,
    },
    lecturer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    lecturerNotes: {
      type: String,
      trim: true,
    },
    noteKeywords: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    topics: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Topic",
      },
    ],
    semester: {
      type: String,
      enum: ["First", "Second", "Summer"],
      default: "First",
    },
    academicYear: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

courseSchema.virtual("questions", {
  ref: "Question",
  localField: "_id",
  foreignField: "course",
});

courseSchema.virtual("questionCount", {
  ref: "Question",
  localField: "_id",
  foreignField: "course",
  count: true,
});

module.exports = mongoose.model("Course", courseSchema);
