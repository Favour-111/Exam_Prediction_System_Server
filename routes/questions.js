const express = require("express");
const router = express.Router();
const Question = require("../models/Question");
const Topic = require("../models/Topic");
const { protect, adminOnly } = require("../middleware/auth");
const {
  getDepartmentCourseIds,
  requireDepartmentCourse,
  sendScopeError,
} = require("../middleware/departmentScope");

const requireTopicForCourse = async (topicId, courseId) => {
  if (!topicId) {
    return null;
  }

  const topic = await Topic.findOne({
    _id: topicId,
    course: courseId,
    isActive: true,
  });

  if (!topic) {
    const error = new Error("Topic not found for selected course");
    error.statusCode = 404;
    throw error;
  }

  return topic;
};

// @route   GET /api/questions
// @desc    Get all questions with filters
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const {
      course,
      topic,
      difficulty,
      questionType,
      limit = 50,
      page = 1,
    } = req.query;
    const courseIds = await getDepartmentCourseIds(req, course);

    const query = { isActive: true, course: { $in: courseIds } };

    if (topic) query.topic = topic;
    if (difficulty) query.difficulty = difficulty;
    if (questionType) query.questionType = questionType;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const questions = await Question.find(query)
      .populate("course", "name code")
      .populate("topic", "name")
      .populate("uploadedBy", "name")
      .sort({ predictedProbability: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Question.countDocuments(query);

    res.json({
      success: true,
      data: questions,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    sendScopeError(res, error, "Error fetching questions");
  }
});

// @route   GET /api/questions/predicted
// @desc    Get predicted questions sorted by probability
// @access  Private
router.get("/predicted", protect, async (req, res) => {
  try {
    const { course, limit = 20 } = req.query;
    const courseIds = await getDepartmentCourseIds(req, course);

    const query = {
      isActive: true,
      predictedProbability: { $gt: 0 },
      course: { $in: courseIds },
    };

    const questions = await Question.find(query)
      .populate("course", "name code")
      .populate("topic", "name")
      .sort({ predictedProbability: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: questions,
    });
  } catch (error) {
    sendScopeError(res, error, "Error fetching predicted questions");
  }
});

// @route   GET /api/questions/:id
// @desc    Get single question
// @access  Private
router.get("/:id", protect, async (req, res) => {
  try {
    const courseIds = await getDepartmentCourseIds(req);
    const question = await Question.findOne({
      _id: req.params.id,
      course: { $in: courseIds },
      isActive: true,
    })
      .populate("course", "name code")
      .populate("topic", "name lecturerEmphasis")
      .populate("uploadedBy", "name");

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
      });
    }

    res.json({
      success: true,
      data: question,
    });
  } catch (error) {
    sendScopeError(res, error, "Error fetching question");
  }
});

// @route   POST /api/questions
// @desc    Create new question
// @access  Private/Admin
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const course = await requireDepartmentCourse(req, req.body.course);
    await requireTopicForCourse(req.body.topic, course._id);

    const questionData = {
      ...req.body,
      course: course._id,
      uploadedBy: req.user._id,
    };

    const question = await Question.create(questionData);

    res.status(201).json({
      success: true,
      data: question,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: "Error creating question",
      error: error.message,
    });
  }
});

// @route   PUT /api/questions/:id
// @desc    Update question
// @access  Private/Admin
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const courseIds = await getDepartmentCourseIds(req);
    const question = await Question.findOne({
      _id: req.params.id,
      course: { $in: courseIds },
      isActive: true,
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
      });
    }

    const nextCourseId = req.body.course || question.course;
    const nextCourse = await requireDepartmentCourse(req, nextCourseId);
    const nextTopicId =
      req.body.topic !== undefined ? req.body.topic : question.topic;
    await requireTopicForCourse(nextTopicId, nextCourse._id);

    Object.assign(question, {
      ...req.body,
      course: nextCourse._id,
    });
    await question.save();

    res.json({
      success: true,
      data: question,
    });
  } catch (error) {
    sendScopeError(res, error, "Error updating question");
  }
});

// @route   DELETE /api/questions/:id
// @desc    Delete question (soft delete)
// @access  Private/Admin
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const courseIds = await getDepartmentCourseIds(req);
    const question = await Question.findOne({
      _id: req.params.id,
      course: { $in: courseIds },
      isActive: true,
    });

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
      });
    }

    question.isActive = false;
    await question.save();

    res.json({
      success: true,
      message: "Question deleted successfully",
    });
  } catch (error) {
    sendScopeError(res, error, "Error deleting question");
  }
});

// @route   GET /api/questions/stats/overview
// @desc    Get question statistics
// @access  Private
router.get("/stats/overview", protect, async (req, res) => {
  try {
    const { course } = req.query;
    const courseIds = await getDepartmentCourseIds(req, course);
    const matchQuery = { isActive: true, course: { $in: courseIds } };

    const stats = await Question.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalQuestions: { $sum: 1 },
          avgProbability: { $avg: "$predictedProbability" },
          difficultyBreakdown: {
            $push: "$difficulty",
          },
          typeBreakdown: {
            $push: "$questionType",
          },
        },
      },
    ]);

    res.json({
      success: true,
      data: stats[0] || { totalQuestions: 0, avgProbability: 0 },
    });
  } catch (error) {
    sendScopeError(res, error, "Error fetching statistics");
  }
});

module.exports = router;
