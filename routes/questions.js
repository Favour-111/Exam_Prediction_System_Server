const express = require("express");
const router = express.Router();
const Question = require("../models/Question");
const { protect, adminOnly } = require("../middleware/auth");

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

    const query = { isActive: true };

    if (course) query.course = course;
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
    res.status(500).json({
      success: false,
      message: "Error fetching questions",
      error: error.message,
    });
  }
});

// @route   GET /api/questions/predicted
// @desc    Get predicted questions sorted by probability
// @access  Private
router.get("/predicted", protect, async (req, res) => {
  try {
    const { course, limit = 20 } = req.query;

    const query = { isActive: true, predictedProbability: { $gt: 0 } };
    if (course) query.course = course;

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
    res.status(500).json({
      success: false,
      message: "Error fetching predicted questions",
      error: error.message,
    });
  }
});

// @route   GET /api/questions/:id
// @desc    Get single question
// @access  Private
router.get("/:id", protect, async (req, res) => {
  try {
    const question = await Question.findById(req.params.id)
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
    res.status(500).json({
      success: false,
      message: "Error fetching question",
      error: error.message,
    });
  }
});

// @route   POST /api/questions
// @desc    Create new question
// @access  Private/Admin
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const questionData = {
      ...req.body,
      uploadedBy: req.user._id,
    };

    const question = await Question.create(questionData);

    res.status(201).json({
      success: true,
      data: question,
    });
  } catch (error) {
    res.status(500).json({
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
    const question = await Question.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

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
    res.status(500).json({
      success: false,
      message: "Error updating question",
      error: error.message,
    });
  }
});

// @route   DELETE /api/questions/:id
// @desc    Delete question (soft delete)
// @access  Private/Admin
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const question = await Question.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true },
    );

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
      });
    }

    res.json({
      success: true,
      message: "Question deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting question",
      error: error.message,
    });
  }
});

// @route   GET /api/questions/stats/overview
// @desc    Get question statistics
// @access  Private
router.get("/stats/overview", protect, async (req, res) => {
  try {
    const { course } = req.query;
    const matchQuery = { isActive: true };
    if (course) matchQuery.course = course;

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
    res.status(500).json({
      success: false,
      message: "Error fetching statistics",
      error: error.message,
    });
  }
});

module.exports = router;
