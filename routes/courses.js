const express = require("express");
const router = express.Router();
const Course = require("../models/Course");
const Prediction = require("../models/Prediction");
const Question = require("../models/Question");
const Topic = require("../models/Topic");
const User = require("../models/User");
const { protect, adminOnly } = require("../middleware/auth");

const attachQuestionCounts = async (courses) => {
  const normalizedCourses = Array.isArray(courses) ? courses : [courses];

  if (normalizedCourses.length === 0) {
    return Array.isArray(courses) ? [] : null;
  }

  const results = await Promise.all(
    normalizedCourses.map(async (course) => {
      const [questionCount, latestPrediction] = await Promise.all([
        Question.countDocuments({ course: course._id, isActive: true }),
        Prediction.findOne({ course: course._id, status: "completed" })
          .select("aiGeneratedQuestions generatedAt")
          .sort({ generatedAt: -1 })
          .lean(),
      ]);
      return {
        id: String(course._id),
        questionCount,
        aiQuestionCount: latestPrediction?.aiGeneratedQuestions?.length || 0,
      };
    }),
  );

  const countMap = new Map(results.map((r) => [r.id, r]));
  const mapped = normalizedCourses.map((course) => {
    const counts = countMap.get(String(course._id)) || {};
    return {
      ...course.toObject(),
      questionCount: counts.questionCount || 0,
      aiQuestionCount: counts.aiQuestionCount || 0,
    };
  });

  return Array.isArray(courses) ? mapped : mapped[0];
};

// @route   POST /api/courses
// @desc    Create a new course
// @access  Private/Admin
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { name, code, description, department, semester, academicYear } =
      req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: "Course name is required",
      });
    }

    if (!code || !String(code).trim()) {
      return res.status(400).json({
        success: false,
        message: "Course code is required",
      });
    }

    if (!department || !String(department).trim()) {
      return res.status(400).json({
        success: false,
        message: "Department is required",
      });
    }

    const normalizedCode = String(code).trim().toUpperCase();
    const existingCourse = await Course.findOne({ code: normalizedCode });

    if (existingCourse && existingCourse.isActive) {
      return res.status(409).json({
        success: false,
        message: "A course with this code already exists",
      });
    }

    let course;

    if (existingCourse && !existingCourse.isActive) {
      existingCourse.name = String(name).trim();
      existingCourse.code = normalizedCode;
      existingCourse.description = description;
      existingCourse.department = String(department).trim();
      existingCourse.semester = semester || existingCourse.semester;
      existingCourse.academicYear = academicYear;
      existingCourse.lecturer = req.user._id;
      existingCourse.isActive = true;
      course = await existingCourse.save();
    } else {
      course = await Course.create({
        name: String(name).trim(),
        code: normalizedCode,
        description,
        department: String(department).trim(),
        semester,
        academicYear,
        lecturer: req.user._id,
      });
    }

    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { courses: course._id },
    });

    const populatedCourse = await Course.findById(course._id).populate(
      "lecturer",
      "name email",
    );

    const hydratedCourse = await attachQuestionCounts(populatedCourse);

    res.status(201).json({
      success: true,
      data: hydratedCourse,
    });
  } catch (error) {
    const statusCode = error.name === "ValidationError" ? 400 : 500;

    res.status(statusCode).json({
      success: false,
      message: "Error creating course",
      error: error.message,
    });
  }
});

// @route   GET /api/courses
// @desc    Get all active courses
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const courses = await Course.find({ isActive: true })
      .populate("lecturer", "name email")
      .sort({ code: 1, name: 1 });

    const hydratedCourses = await attachQuestionCounts(courses);

    res.json({
      success: true,
      data: hydratedCourses,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching courses",
      error: error.message,
    });
  }
});

// @route   GET /api/courses/:id
// @desc    Get single course
// @access  Private
router.get("/:id", protect, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate(
      "lecturer",
      "name email",
    );

    if (!course || !course.isActive) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    const hydratedCourse = await attachQuestionCounts(course);

    res.json({
      success: true,
      data: hydratedCourse,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching course",
      error: error.message,
    });
  }
});

// @route   DELETE /api/courses/:id
// @desc    Delete a course and related course data
// @access  Private/Admin
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course || !course.isActive) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    course.isActive = false;
    await course.save();

    await Promise.all([
      Question.updateMany(
        { course: course._id },
        {
          $set: {
            isActive: false,
            predictedProbability: 0,
          },
        },
      ),
      Topic.updateMany(
        { course: course._id },
        {
          $set: {
            isActive: false,
            predictedProbability: 0,
          },
        },
      ),
      Prediction.deleteMany({ course: course._id }),
      User.updateMany(
        { courses: course._id },
        { $pull: { courses: course._id } },
      ),
    ]);

    res.json({
      success: true,
      message: "Course deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting course",
      error: error.message,
    });
  }
});

module.exports = router;
