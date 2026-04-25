const express = require("express");
const router = express.Router();
const Topic = require("../models/Topic");
const Course = require("../models/Course");
const { protect, adminOnly } = require("../middleware/auth");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// @route   GET /api/topics
// @desc    Get all topics with filters
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const { course, sortBy = "predictedProbability" } = req.query;

    const query = { isActive: true };
    if (course) query.course = course;

    const sortOptions = {};
    sortOptions[sortBy] = -1;

    const topics = await Topic.find(query)
      .populate("course", "name code")
      .sort(sortOptions);

    res.json({
      success: true,
      data: topics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching topics",
      error: error.message,
    });
  }
});

// @route   GET /api/topics/probability
// @desc    Get topics ranked by prediction probability
// @access  Private
router.get("/probability", protect, async (req, res) => {
  try {
    const { course, limit = 10 } = req.query;

    const query = { isActive: true };
    if (course) query.course = course;

    const topics = await Topic.find(query)
      .populate("course", "name code")
      .sort({ predictedProbability: -1, lecturerEmphasis: -1 })
      .limit(parseInt(limit));

    // Calculate percentage for visualization
    const topicsWithPercentage = topics.map((topic) => ({
      ...topic.toObject(),
      probabilityPercentage: Math.round(topic.predictedProbability * 100),
    }));

    res.json({
      success: true,
      data: topicsWithPercentage,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching topic probabilities",
      error: error.message,
    });
  }
});

// @route   GET /api/topics/:id
// @desc    Get single topic
// @access  Private
router.get("/:id", protect, async (req, res) => {
  try {
    const topic = await Topic.findById(req.params.id).populate(
      "course",
      "name code",
    );

    if (!topic) {
      return res.status(404).json({
        success: false,
        message: "Topic not found",
      });
    }

    res.json({
      success: true,
      data: topic,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching topic",
      error: error.message,
    });
  }
});

// @route   POST /api/topics
// @desc    Create new topic
// @access  Private/Admin
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const {
      name,
      description,
      course,
      lecturerEmphasis,
      lecturerNotes,
      keywords,
      subtopics,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: "Topic name is required",
      });
    }

    if (!course) {
      return res.status(400).json({
        success: false,
        message: "Course is required",
      });
    }

    const existingCourse = await Course.findOne({
      _id: course,
      isActive: true,
    });

    if (!existingCourse) {
      return res.status(404).json({
        success: false,
        message: "Selected course was not found",
      });
    }

    const normalizedName = String(name).trim();

    const existingTopic = await Topic.findOne({
      course,
      name: new RegExp(`^${escapeRegExp(normalizedName)}$`, "i"),
    });

    if (existingTopic && existingTopic.isActive) {
      return res.status(409).json({
        success: false,
        message:
          "A topic with this name already exists for the selected course",
      });
    }

    let topic;

    if (existingTopic && !existingTopic.isActive) {
      existingTopic.name = normalizedName;
      existingTopic.description = description;
      existingTopic.lecturerEmphasis =
        lecturerEmphasis ?? existingTopic.lecturerEmphasis;
      existingTopic.lecturerNotes =
        lecturerNotes ?? existingTopic.lecturerNotes;
      existingTopic.keywords = keywords || existingTopic.keywords;
      existingTopic.subtopics = subtopics || existingTopic.subtopics;
      existingTopic.isActive = true;
      topic = await existingTopic.save();
    } else {
      topic = await Topic.create({
        name: normalizedName,
        description,
        course,
        lecturerEmphasis,
        lecturerNotes,
        keywords,
        subtopics,
      });
    }

    // Add topic to course
    await Course.findByIdAndUpdate(course, {
      $addToSet: { topics: topic._id },
    });

    res.status(201).json({
      success: true,
      data: topic,
    });
  } catch (error) {
    const statusCode = error.name === "ValidationError" ? 400 : 500;

    res.status(statusCode).json({
      success: false,
      message: "Error creating topic",
      error: error.message,
    });
  }
});

// @route   PUT /api/topics/:id
// @desc    Update topic
// @access  Private/Admin
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const topic = await Topic.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!topic) {
      return res.status(404).json({
        success: false,
        message: "Topic not found",
      });
    }

    res.json({
      success: true,
      data: topic,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating topic",
      error: error.message,
    });
  }
});

// @route   PUT /api/topics/:id/emphasis
// @desc    Update lecturer emphasis for topic
// @access  Private/Admin
router.put("/:id/emphasis", protect, adminOnly, async (req, res) => {
  try {
    const { lecturerEmphasis } = req.body;

    if (lecturerEmphasis < 0 || lecturerEmphasis > 10) {
      return res.status(400).json({
        success: false,
        message: "Lecturer emphasis must be between 0 and 10",
      });
    }

    const topic = await Topic.findByIdAndUpdate(
      req.params.id,
      { lecturerEmphasis },
      { new: true },
    );

    if (!topic) {
      return res.status(404).json({
        success: false,
        message: "Topic not found",
      });
    }

    res.json({
      success: true,
      data: topic,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating topic emphasis",
      error: error.message,
    });
  }
});

// @route   DELETE /api/topics/:id
// @desc    Delete topic (soft delete)
// @access  Private/Admin
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const topic = await Topic.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true },
    );

    if (!topic) {
      return res.status(404).json({
        success: false,
        message: "Topic not found",
      });
    }

    res.json({
      success: true,
      message: "Topic deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting topic",
      error: error.message,
    });
  }
});

// @route   GET /api/topics/stats/distribution
// @desc    Get topic distribution statistics
// @access  Private
router.get("/stats/distribution", protect, async (req, res) => {
  try {
    const { course } = req.query;

    const matchQuery = { isActive: true };
    if (course) matchQuery.course = course;

    const distribution = await Topic.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$course",
          topics: {
            $push: {
              name: "$name",
              probability: "$predictedProbability",
              emphasis: "$lecturerEmphasis",
            },
          },
          avgProbability: { $avg: "$predictedProbability" },
          totalTopics: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "courses",
          localField: "_id",
          foreignField: "_id",
          as: "courseInfo",
        },
      },
      { $unwind: "$courseInfo" },
    ]);

    res.json({
      success: true,
      data: distribution,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching distribution",
      error: error.message,
    });
  }
});

module.exports = router;
