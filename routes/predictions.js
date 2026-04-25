const express = require("express");
const router = express.Router();
const axios = require("axios");
const mongoose = require("mongoose");
const Course = require("../models/Course");
const Prediction = require("../models/Prediction");
const Question = require("../models/Question");
const Topic = require("../models/Topic");
const { protect, adminOnly } = require("../middleware/auth");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// --- Groq cross-year analysis and question generation ---
async function generateQuestionsWithGroq(questions, lecturerNotes, courseName) {
  if (!process.env.GROQ_API_KEY || questions.length === 0) {
    return null;
  }

  // Group questions by year
  const questionsByYear = {};
  for (const q of questions) {
    const year = String(q.year || "Unknown Year");
    if (!questionsByYear[year]) questionsByYear[year] = [];
    questionsByYear[year].push(String(q.text || "").trim());
  }

  const sortedYears = Object.keys(questionsByYear).sort();

  const yearSections = sortedYears
    .map((year) => {
      const qs = questionsByYear[year];
      return `--- ${year} ---\n${qs.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
    })
    .join("\n\n");

  const noteSection = lecturerNotes
    ? `\n\nLECTURER NOTES (topics the lecturer emphasizes):\n${String(lecturerNotes).slice(0, 2000)}`
    : "";

  const systemPrompt =
    "You are an expert university exam prediction AI. Analyze past exam questions across multiple years, find patterns and recurring topics, then predict the most likely questions for the upcoming exam. Return only valid JSON.";

  const userPrompt = `Course: ${courseName || "This Course"}

I am providing ${questions.length} past exam questions from ${sortedYears.length} year(s): ${sortedYears.join(", ")}.

${yearSections}${noteSection}

TASK:
1. Compare all questions across every year.
2. Identify which topics, concepts, and question styles repeat across years.
3. Spot trends — topics that are becoming more frequent in recent years.
4. Use the lecturer notes as extra weight when they match recurring topics.
5. Generate 10–15 predicted questions for the upcoming exam.

Assign each predicted question a probability (0–100) based on:
- How many years the topic appeared (more years = higher probability)
- Whether the question or a near-identical version recurred verbatim
- Whether it appeared in the most recent year (recency bonus)
- Whether the lecturer notes mention the topic

Return ONLY this JSON (no markdown, no extra text):
{
  "analysis": {
    "yearsAnalyzed": ["2020", "2021"],
    "totalQuestionsAnalyzed": 30,
    "recurringTopics": [
      {"topic": "Topic Name", "appearedInYears": ["2020", "2021"], "frequency": 2, "trend": "increasing"}
    ],
    "overallConfidence": 75,
    "summary": "2-3 sentences describing the main patterns found."
  },
  "predictedQuestions": [
    {
      "question": "Full question text here?",
      "probability": 85,
      "reasoning": "This exact question appeared in 2020 and 2021 and is mentioned in the lecturer notes.",
      "appearedInYears": ["2020", "2021"],
      "topic": "Topic Name",
      "questionType": "Theory",
      "difficulty": "Medium"
    }
  ]
}`;

  const response = await axios.post(
    GROQ_API_URL,
    {
      model: GROQ_MODEL,
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    },
  );

  const content = response.data?.choices?.[0]?.message?.content;
  return JSON.parse(content || "{}");
}

const tokenizeText = (value = "") =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 &&
        !new Set([
          "the",
          "and",
          "for",
          "that",
          "with",
          "this",
          "from",
          "into",
          "their",
          "have",
        ]).has(word),
    );

const normalize = (value, maxValue) => {
  if (!maxValue || maxValue <= 0) {
    return 0;
  }

  return Math.min(value / maxValue, 1);
};

function buildHumanInsights(
  studyAreas,
  questions,
  studyAreaPredictions,
  usingFallback,
) {
  const insights = [];
  const topStudyAreas = studyAreaPredictions
    .slice(0, 3)
    .map((item) => item.topic_name);

  if (topStudyAreas.length > 0) {
    insights.push(
      `Top study priorities are ${topStudyAreas.join(", ")}, based on repeated question patterns, concept overlap, and course notes.`,
    );
  }

  const notedStudyAreas = studyAreas.filter((area) =>
    String(area.lecturer_notes || "").trim(),
  );
  if (notedStudyAreas.length > 0) {
    insights.push(
      `${notedStudyAreas.length} study ${notedStudyAreas.length === 1 ? "area has" : "areas have"} extra course-note support in the prediction signal.`,
    );
  }

  const years = questions.map((question) => question.year).filter(Boolean);
  if (years.length > 0) {
    const earliest = Math.min(...years);
    const latest = Math.max(...years);
    insights.push(
      `The prediction is using question history from ${earliest} to ${latest}, so repeated wording and recurring concepts across years increase confidence.`,
    );
  }

  const highConfidence = studyAreaPredictions.filter(
    (item) => item.probability >= 0.7,
  ).length;
  insights.push(
    highConfidence > 0
      ? `${highConfidence} study ${highConfidence === 1 ? "area is" : "areas are"} currently high confidence, which means multiple similar questions are reinforcing the signal.`
      : "No study area is high confidence yet, so the results should be read as guidance rather than certainty.",
  );

  if (usingFallback) {
    insights.push(
      "The ML service was unavailable, so a built-in weighted heuristic was used to keep prediction generation working.",
    );
  }

  return insights;
}

function slugify(value = "") {
  return (
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "core-course-material"
  );
}

function getStudyAreaName(question) {
  return (
    question.conceptLabel || question.topic?.name || "Core Course Material"
  );
}

function buildStudyAreas(courseQuestions, lecturerNotes = "") {
  const grouped = courseQuestions.reduce((accumulator, question) => {
    const areaName = getStudyAreaName(question);

    if (!accumulator[areaName]) {
      accumulator[areaName] = {
        id: `area-${slugify(areaName)}`,
        name: areaName,
        emphasis: 5,
        frequency: 0,
        keywords: [],
        lecturer_notes: lecturerNotes,
        questionCount: 0,
      };
    }

    accumulator[areaName].frequency += question.occurrenceCount || 1;
    accumulator[areaName].questionCount += 1;
    accumulator[areaName].keywords = Array.from(
      new Set([
        ...accumulator[areaName].keywords,
        ...(question.keywords || []),
      ]),
    ).slice(0, 10);

    return accumulator;
  }, {});

  return Object.values(grouped).sort(
    (first, second) => second.frequency - first.frequency,
  );
}

function deriveQuestionIntent(text = "") {
  const lowerText = String(text).toLowerCase();

  if (/compare|contrast|difference between/.test(lowerText)) {
    return "compare";
  }

  if (/implement|write code|algorithm|program|design/.test(lowerText)) {
    return "practical";
  }

  if (/calculate|solve|determine|compute/.test(lowerText)) {
    return "calculation";
  }

  return "theory";
}

function deriveNoteFocus(lecturerNotes = "") {
  const tokens = tokenizeText(lecturerNotes)
    .filter((token) => token.length > 3)
    .slice(0, 5);

  return tokens.length > 0
    ? tokens.join(", ")
    : "core concepts and practical applications";
}

function generateSuggestedQuestions(
  studyAreas,
  courseQuestions,
  studyAreaPredictions,
) {
  const groupedQuestions = courseQuestions.reduce((accumulator, question) => {
    const studyAreaName = getStudyAreaName(question);
    accumulator[studyAreaName] = accumulator[studyAreaName] || [];
    accumulator[studyAreaName].push(question);
    return accumulator;
  }, {});
  const templates = {
    theory: [
      (topicName, focus) =>
        `Explain the main ideas in ${topicName} and show how ${focus} affects exam-style applications.`,
      (topicName, focus) =>
        `Discuss the most important principles in ${topicName}, paying attention to ${focus}.`,
    ],
    compare: [
      (topicName, focus) =>
        `Compare and contrast two major methods in ${topicName}, with attention to ${focus}.`,
      (topicName, focus) =>
        `Differentiate key approaches in ${topicName} and explain when ${focus} becomes important.`,
    ],
    practical: [
      (topicName, focus) =>
        `Design or implement a solution in ${topicName} that clearly demonstrates ${focus}.`,
      (topicName, focus) =>
        `Apply ${topicName} in a practical scenario and justify each step using ${focus}.`,
    ],
    calculation: [
      (topicName, focus) =>
        `Solve a worked problem in ${topicName} and explain each step using ${focus}.`,
      (topicName, focus) =>
        `Compute a typical ${topicName} problem and show how ${focus} guides the solution.`,
    ],
  };
  const generatedQuestions = [];
  const seen = new Set();

  for (const studyAreaPrediction of studyAreaPredictions.slice(0, 5)) {
    const studyArea = studyAreas.find(
      (item) => item.id === studyAreaPrediction.topic_id,
    );
    const focus = deriveNoteFocus(studyArea?.lecturer_notes || "");
    const relatedQuestions =
      groupedQuestions[studyAreaPrediction.topic_name] || [];

    for (const question of relatedQuestions.slice(0, 5)) {
      const intent = deriveQuestionIntent(question.text);
      const intentTemplates = templates[intent] || templates.theory;

      for (const template of intentTemplates) {
        const generatedText = template(studyAreaPrediction.topic_name, focus);

        if (seen.has(generatedText)) {
          continue;
        }

        seen.add(generatedText);
        generatedQuestions.push({
          text: generatedText,
          topicName: studyAreaPrediction.topic_name,
          questionType: question.questionType || "Theory",
          difficulty: question.difficulty || "Medium",
          rationale: `Generated from repeated ${studyAreaPrediction.topic_name} question patterns, course notes, and a study-area probability of ${Math.round(studyAreaPrediction.probability * 100)}%.`,
          probability: studyAreaPrediction.probability,
        });

        if (generatedQuestions.length >= 20) {
          return generatedQuestions.slice(0, 20);
        }
      }
    }
  }

  if (generatedQuestions.length < 10) {
    for (const studyAreaPrediction of studyAreaPredictions.slice(0, 5)) {
      const studyArea = studyAreas.find(
        (item) => item.id === studyAreaPrediction.topic_id,
      );
      const focus = deriveNoteFocus(studyArea?.lecturer_notes || "");
      const fallbackText = `Discuss likely exam issues in ${studyAreaPrediction.topic_name}, focusing on ${focus}.`;

      if (seen.has(fallbackText)) {
        continue;
      }

      seen.add(fallbackText);
      generatedQuestions.push({
        text: fallbackText,
        topicName: studyAreaPrediction.topic_name,
        questionType: "Theory",
        difficulty: "Medium",
        rationale: `Added because ${studyAreaPrediction.topic_name} is one of the strongest predicted study areas in the current run.`,
        probability: studyAreaPrediction.probability,
      });

      if (generatedQuestions.length >= 10) {
        break;
      }
    }
  }

  return generatedQuestions.slice(0, 20);
}

function buildFallbackPredictions(studyAreas, courseQuestions) {
  const latestYear = courseQuestions.reduce(
    (maxYear, question) => Math.max(maxYear, question.year || 0),
    0,
  );
  const maxFrequency = studyAreas.reduce(
    (maxValue, topic) => Math.max(maxValue, topic.frequency || 0),
    0,
  );
  const questionGroups = courseQuestions.reduce((accumulator, question) => {
    const studyAreaName = getStudyAreaName(question);
    accumulator[studyAreaName] = accumulator[studyAreaName] || [];
    accumulator[studyAreaName].push(question);
    return accumulator;
  }, {});

  const topic_predictions = studyAreas
    .map((topic) => {
      const topicId = String(topic.id);
      const questions = questionGroups[topic.name] || [];
      const latestTopicYear = questions.reduce(
        (maxYear, question) => Math.max(maxYear, question.year || 0),
        0,
      );
      const recencyScore = latestYear
        ? Math.max(0, 1 - (latestYear - latestTopicYear) / 5)
        : 0.3;
      const emphasisScore = normalize(topic.emphasis || 5, 10);
      const frequencyScore = normalize(
        topic.frequency || questions.length,
        maxFrequency || 1,
      );
      const noteTokens = tokenizeText(topic.lecturer_notes || "");
      const noteMatches = questions.reduce((count, question) => {
        const questionTokens = new Set(tokenizeText(question.text || ""));
        return (
          count + noteTokens.filter((token) => questionTokens.has(token)).length
        );
      }, 0);
      const noteScore = noteTokens.length
        ? Math.min(
            noteMatches /
              Math.max(noteTokens.length * Math.max(questions.length, 1), 1),
            1,
          )
        : 0;
      const questionDensity = normalize(
        questions.length,
        Math.max(courseQuestions.length, 1),
      );
      const probability = Math.min(
        emphasisScore * 0.35 +
          frequencyScore * 0.25 +
          recencyScore * 0.2 +
          noteScore * 0.15 +
          questionDensity * 0.05,
        1,
      );

      return {
        topic_id: topicId,
        topic_name: topic.name,
        probability,
        confidence:
          probability > 0.7 ? "High" : probability > 0.4 ? "Medium" : "Low",
      };
    })
    .sort((first, second) => second.probability - first.probability);

  const topicProbabilityMap = Object.fromEntries(
    topic_predictions.map((item) => [item.topic_id, item.probability]),
  );

  const question_predictions = courseQuestions
    .map((question) => {
      const topicName = getStudyAreaName(question);
      const topic = studyAreas.find((item) => item.name === topicName);
      const noteTokens = tokenizeText(topic?.lecturer_notes || "");
      const questionTokens = new Set(tokenizeText(question.text || ""));
      const noteMatchScore = noteTokens.length
        ? noteTokens.filter((token) => questionTokens.has(token)).length /
          noteTokens.length
        : 0;
      const recencyScore = latestYear
        ? Math.max(0, 1 - (latestYear - (question.year || latestYear)) / 5)
        : 0.3;
      const difficultyBonus =
        question.difficulty === "Hard"
          ? 0.08
          : question.difficulty === "Medium"
            ? 0.05
            : 0.02;
      const probability = Math.min(
        (topicProbabilityMap[topic?.id] || 0.45) * 0.55 +
          recencyScore * 0.2 +
          noteMatchScore * 0.15 +
          normalize(question.occurrenceCount || 1, 5) * 0.1 +
          difficultyBonus,
        1,
      );

      return {
        question_id: String(question._id),
        question_text: question.text,
        probability,
        predicted_type: question.questionType,
        predicted_difficulty: question.difficulty,
      };
    })
    .sort((first, second) => second.probability - first.probability);

  const totalQuestions = Math.max(courseQuestions.length, 1);
  const typeDistribution = courseQuestions.reduce((accumulator, question) => {
    accumulator[question.questionType] =
      (accumulator[question.questionType] || 0) + 1;
    return accumulator;
  }, {});
  const difficultyDistribution = courseQuestions.reduce(
    (accumulator, question) => {
      accumulator[question.difficulty] =
        (accumulator[question.difficulty] || 0) + 1;
      return accumulator;
    },
    {},
  );

  return {
    success: true,
    model_version: "heuristic-fallback",
    model_accuracy: null,
    topic_predictions,
    question_predictions,
    type_distribution: Object.fromEntries(
      Object.entries(typeDistribution).map(([key, value]) => [
        key,
        value / totalQuestions,
      ]),
    ),
    difficulty_distribution: Object.fromEntries(
      Object.entries(difficultyDistribution).map(([key, value]) => [
        key,
        value / totalQuestions,
      ]),
    ),
    insights: buildHumanInsights(
      studyAreas,
      courseQuestions,
      topic_predictions,
      true,
    ),
  };
}

// @route   GET /api/predictions
// @desc    Get all predictions for a course
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const { course, limit = 10 } = req.query;

    const query = {};
    if (course) query.course = course;

    const predictions = await Prediction.find(query)
      .populate("course", "name code")
      .populate("topicPredictions.topic", "name")
      .populate("questionPredictions.question", "text")
      .sort({ generatedAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: predictions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching predictions",
      error: error.message,
    });
  }
});

// @route   GET /api/predictions/latest
// @desc    Get latest prediction for a course
// @access  Private
router.get("/latest", protect, async (req, res) => {
  try {
    const { course } = req.query;

    if (!course) {
      return res.status(400).json({
        success: false,
        message: "Course ID is required",
      });
    }

    const prediction = await Prediction.findOne({ course, status: "completed" })
      .populate("course", "name code")
      .populate("topicPredictions.topic", "name lecturerEmphasis")
      .populate("questionPredictions.question", "text difficulty questionType")
      .sort({ generatedAt: -1 });

    if (!prediction) {
      return res.json({
        success: true,
        data: null,
        message: "No predictions found for this course yet",
      });
    }

    res.json({
      success: true,
      data: prediction,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching latest prediction",
      error: error.message,
    });
  }
});

// @route   GET /api/predictions/topics-probability
// @desc    Get topic probability distribution
// @access  Private
router.get("/topics-probability", protect, async (req, res) => {
  try {
    const { course } = req.query;

    const topics = await Topic.find({
      course,
      isActive: true,
    }).sort({ predictedProbability: -1 });

    const chartData = {
      labels: topics.map((t) => t.name),
      probabilities: topics.map((t) =>
        Math.round(t.predictedProbability * 100),
      ),
      emphases: topics.map((t) => t.lecturerEmphasis),
    };

    res.json({
      success: true,
      data: chartData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching topic probabilities",
      error: error.message,
    });
  }
});

// @route   POST /api/predictions/train-model
// @desc    Trigger model training
// @access  Private/Admin
router.post("/train-model", protect, adminOnly, async (req, res) => {
  try {
    const { course } = req.body;
    const courseRecord = await Course.findById(course).select(
      "lecturerNotes noteKeywords",
    );

    // Get all questions for training
    const questions = await Question.find({ course, isActive: true }).populate(
      "topic",
      "name lecturerEmphasis",
    );
    const studyAreas = buildStudyAreas(
      questions,
      courseRecord?.lecturerNotes || "",
    );

    // Prepare training data
    const trainingData = {
      course_id: course,
      questions: questions.map((q) => ({
        text: q.text,
        topic: getStudyAreaName(q),
        topic_emphasis: 5,
        lecturer_notes: courseRecord?.lecturerNotes || "",
        difficulty: q.difficulty,
        question_type: q.questionType,
        occurrence_count: q.occurrenceCount,
        year: q.year,
      })),
      topics: studyAreas.map((t) => ({
        id: t.id,
        name: t.name,
        emphasis: t.emphasis,
        frequency: t.frequency,
        keywords: t.keywords,
        lecturer_notes: t.lecturer_notes,
      })),
    };

    // Send to ML service for training
    const mlResponse = await axios.post(
      `${ML_SERVICE_URL}/api/train`,
      trainingData,
    );

    res.json({
      success: true,
      message: "Model training initiated",
      data: mlResponse.data,
    });
  } catch (error) {
    console.error("Training error:", error);
    res.status(500).json({
      success: false,
      message: "Error training model",
      error: error.message,
    });
  }
});

// @route   POST /api/predictions/generate
// @desc    Generate new predictions using Groq cross-year analysis
// @access  Private/Admin
router.post("/generate", protect, adminOnly, async (req, res) => {
  try {
    const { course } = req.body;

    if (!course) {
      return res.status(400).json({
        success: false,
        message: "Course is required",
      });
    }

    const courseRecord = await Course.findById(course).select(
      "name lecturerNotes noteKeywords",
    );

    // Create pending prediction record
    const prediction = await Prediction.create({
      course,
      status: "pending",
      generatedBy: req.user._id,
    });

    // Get all questions for the course, grouped with year info
    const questions = await Question.find({ course, isActive: true }).populate(
      "topic",
      "name lecturerEmphasis lecturerNotes",
    );
    const studyAreas = buildStudyAreas(
      questions,
      courseRecord?.lecturerNotes || "",
    );

    if (questions.length === 0) {
      await Prediction.findByIdAndUpdate(prediction._id, {
        status: "failed",
        insights: [
          "Prediction generation needs uploaded questions for the selected course.",
        ],
      });

      return res.status(400).json({
        success: false,
        message: "Upload past questions before generating predictions",
      });
    }

    // --- Step 1: Run Groq cross-year AI analysis ---
    let aiResult = null;
    try {
      aiResult = await generateQuestionsWithGroq(
        questions,
        courseRecord?.lecturerNotes || "",
        courseRecord?.name || "",
      );
    } catch (groqError) {
      console.error("Groq generation error:", groqError.message);
    }

    // --- Step 2: Build fallback topic predictions (always done for charts) ---
    let predictions;
    let usingFallback = false;

    try {
      const predictionData = {
        course_id: course,
        questions: questions.map((q) => ({
          id: q._id.toString(),
          text: q.text,
          topic: getStudyAreaName(q),
          topic_emphasis: 5,
          lecturer_notes: courseRecord?.lecturerNotes || "",
          difficulty: q.difficulty,
          question_type: q.questionType,
          occurrence_count: q.occurrenceCount,
          year: q.year,
        })),
        topics: studyAreas.map((t) => ({
          id: t.id,
          name: t.name,
          emphasis: t.emphasis,
          frequency: t.frequency,
          keywords: t.keywords,
          lecturer_notes: t.lecturer_notes || "",
        })),
      };
      const mlResponse = await axios.post(
        `${ML_SERVICE_URL}/api/predict`,
        predictionData,
        { timeout: 15000 },
      );
      predictions = mlResponse.data;
      if (
        !predictions ||
        !Array.isArray(predictions.topic_predictions) ||
        predictions.topic_predictions.length === 0
      ) {
        throw new Error("ML service returned incomplete prediction data");
      }
    } catch {
      usingFallback = true;
      predictions = buildFallbackPredictions(studyAreas, questions);
    }

    if (!predictions.insights || predictions.insights.length === 0) {
      predictions.insights = buildHumanInsights(
        studyAreas,
        questions,
        predictions.topic_predictions || [],
        usingFallback,
      );
    }

    // --- Step 3: Build legacy template questions as fallback if Groq failed ---
    const legacyGeneratedQuestions =
      aiResult?.predictedQuestions?.length > 0
        ? []
        : generateSuggestedQuestions(
            studyAreas,
            questions,
            predictions.topic_predictions || [],
          );

    // Update question-level probabilities
    if (predictions.question_predictions) {
      for (const qp of predictions.question_predictions) {
        await Question.findByIdAndUpdate(qp.question_id, {
          predictedProbability: qp.probability,
        });
      }
    }

    // --- Step 4: Build enriched insights incorporating AI analysis ---
    const finalInsights = [...(predictions.insights || [])];
    if (aiResult?.analysis?.summary) {
      finalInsights.unshift(aiResult.analysis.summary);
    }

    // --- Step 5: Save everything to the prediction record ---
    const updatePayload = {
      status: "completed",
      modelVersion:
        aiResult?.predictedQuestions?.length > 0
          ? "groq-cross-year-v1"
          : usingFallback
            ? "heuristic-fallback"
            : predictions.model_version || "1.0",
      modelAccuracy: predictions.model_accuracy,
      topicPredictions: predictions.topic_predictions?.map((tp) => ({
        topic: mongoose.Types.ObjectId.isValid(tp.topic_id)
          ? tp.topic_id
          : undefined,
        topicName: tp.topic_name,
        probability: tp.probability,
        confidence:
          tp.probability > 0.7
            ? "High"
            : tp.probability > 0.4
              ? "Medium"
              : "Low",
      })),
      questionPredictions: predictions.question_predictions
        ?.slice(0, 20)
        .map((qp) => ({
          question: qp.question_id,
          questionText: qp.question_text,
          probability: qp.probability,
          suggestedQuestionType: qp.predicted_type,
          suggestedDifficulty: qp.predicted_difficulty,
        })),
      questionTypeDistribution: predictions.type_distribution,
      difficultyDistribution: predictions.difficulty_distribution,
      insights: finalInsights,
      generatedQuestions: legacyGeneratedQuestions,
    };

    // Attach Groq AI results if available
    if (aiResult?.analysis) {
      updatePayload.aiAnalysis = {
        yearsAnalyzed: aiResult.analysis.yearsAnalyzed || [],
        totalQuestionsAnalyzed:
          aiResult.analysis.totalQuestionsAnalyzed || questions.length,
        recurringTopics: aiResult.analysis.recurringTopics || [],
        overallConfidence: aiResult.analysis.overallConfidence || 0,
        summary: aiResult.analysis.summary || "",
      };
    }
    if (Array.isArray(aiResult?.predictedQuestions)) {
      updatePayload.aiGeneratedQuestions = aiResult.predictedQuestions.map(
        (q) => ({
          question: q.question,
          probability: q.probability,
          reasoning: q.reasoning,
          appearedInYears: q.appearedInYears || [],
          topic: q.topic,
          questionType: q.questionType,
          difficulty: q.difficulty,
        }),
      );
    }

    const updatedPrediction = await Prediction.findByIdAndUpdate(
      prediction._id,
      updatePayload,
      { new: true },
    )
      .populate("course", "name code")
      .populate("topicPredictions.topic", "name")
      .populate("questionPredictions.question", "text");

    res.json({
      success: true,
      message: "Predictions generated successfully",
      data: updatedPrediction,
    });
  } catch (error) {
    console.error("Prediction error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating predictions",
      error: error.message,
    });
  }
});

// @route   GET /api/predictions/:id
// @desc    Get single prediction
// @access  Private
router.get("/:id", protect, async (req, res) => {
  try {
    const prediction = await Prediction.findById(req.params.id)
      .populate("course", "name code")
      .populate("topicPredictions.topic", "name lecturerEmphasis")
      .populate("questionPredictions.question", "text difficulty questionType")
      .populate("generatedBy", "name");

    if (!prediction) {
      return res.status(404).json({
        success: false,
        message: "Prediction not found",
      });
    }

    res.json({
      success: true,
      data: prediction,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching prediction",
      error: error.message,
    });
  }
});

// @route   POST /api/predictions/generate-from-text
// @desc    Take raw text blocks (one per year) from the user, run Groq cross-year analysis, return predicted questions
// @access  Private/Admin
router.post("/generate-from-text", protect, adminOnly, async (req, res) => {
  try {
    const { course, papers, lecturerNotes } = req.body;
    // papers: [{ year: "2022", text: "..." }, ...]

    if (!course) {
      return res
        .status(400)
        .json({ success: false, message: "Course is required" });
    }
    if (!Array.isArray(papers) || papers.length === 0) {
      return res
        .status(400)
        .json({
          success: false,
          message: "At least one paper text is required",
        });
    }

    const courseRecord =
      await Course.findById(course).select("name lecturerNotes");
    if (!courseRecord) {
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });
    }

    // Merge any passed lecturer notes with stored ones
    const combinedNotes = [
      String(courseRecord.lecturerNotes || ""),
      String(lecturerNotes || ""),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 3000);

    // Build synthetic questions array from raw text blocks (year-tagged)
    const syntheticQuestions = papers.flatMap((paper) => {
      const year = String(paper.year || "Unknown Year");
      const lines = String(paper.text || "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 15);
      return lines.map((line) => ({ text: line, year }));
    });

    if (syntheticQuestions.length === 0) {
      return res.status(422).json({
        success: false,
        message: "No readable question text found in the provided papers.",
      });
    }

    // Call Groq
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({
        success: false,
        message: "AI service is not configured. Add GROQ_API_KEY to .env.",
      });
    }

    const questionsByYear = {};
    for (const q of syntheticQuestions) {
      const yr = q.year;
      if (!questionsByYear[yr]) questionsByYear[yr] = [];
      questionsByYear[yr].push(q.text);
    }

    const sortedYears = Object.keys(questionsByYear).sort();
    const yearSections = sortedYears
      .map(
        (yr) =>
          `--- ${yr} ---\n${questionsByYear[yr].map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
      )
      .join("\n\n");

    const noteSection = combinedNotes
      ? `\n\nLECTURER NOTES:\n${combinedNotes}`
      : "";

    const systemPrompt =
      "You are an expert university exam prediction AI. You receive past exam questions organised by year and lecturer notes. Your job is to analyse patterns across the years and generate a comprehensive set of predicted exam questions with probability percentages. Return only valid JSON.";

    const userPrompt = `Course: ${courseRecord.name}

Past exam questions from ${sortedYears.length} year(s) — ${sortedYears.join(", ")}:

${yearSections}${noteSection}

INSTRUCTIONS:
1. Read through ALL questions from every year carefully.
2. Find which topics, concepts, and question phrasings repeat across years.
3. Identify trends — topics that appear more frequently in recent years get a higher bonus.
4. Cross-reference with the lecturer notes — any topic mentioned in the notes gets an extra weight boost.
5. Generate 15–25 predicted exam questions covering the likely areas.
6. For EACH question assign a probability (0–100) based on:
   - How many years that topic appeared (each extra year = +15 base points)
   - Whether a near-identical question was seen verbatim (+20 bonus)
   - Most-recent-year appearance (+10 recency bonus)
   - Mentioned in lecturer notes (+10 note bonus)
   - Cap at 97 — nothing is certain.

Return ONLY this JSON (no markdown, no explanations outside JSON):
{
  "analysis": {
    "yearsAnalyzed": ["2020","2021","2022"],
    "totalQuestionsAnalyzed": 45,
    "overallConfidence": 78,
    "summary": "2–3 sentence summary of the main patterns found across years.",
    "recurringTopics": [
      {"topic": "Topic Name", "appearedInYears": ["2020","2021"], "frequency": 2, "trend": "increasing"}
    ]
  },
  "predictedQuestions": [
    {
      "question": "Full predicted question text?",
      "probability": 85,
      "reasoning": "This topic appeared in 3 out of 3 years and is also highlighted in the lecturer notes.",
      "appearedInYears": ["2020","2021","2022"],
      "topic": "Topic Name",
      "questionType": "Theory",
      "difficulty": "Medium"
    }
  ]
}`;

    const groqResponse = await axios.post(
      GROQ_API_URL,
      {
        model: GROQ_MODEL,
        temperature: 0.3,
        max_tokens: 6000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 90000,
      },
    );

    const content = groqResponse.data?.choices?.[0]?.message?.content;
    const aiResult = JSON.parse(content || "{}");

    if (
      !Array.isArray(aiResult?.predictedQuestions) ||
      aiResult.predictedQuestions.length === 0
    ) {
      return res.status(502).json({
        success: false,
        message:
          "The AI did not return any predicted questions. Try adding more past papers.",
      });
    }

    // Persist to DB as a new prediction record
    const prediction = await Prediction.create({
      course,
      status: "completed",
      generatedBy: req.user._id,
      modelVersion: "groq-from-text-v1",
      insights: aiResult.analysis?.summary ? [aiResult.analysis.summary] : [],
      aiAnalysis: {
        yearsAnalyzed: aiResult.analysis?.yearsAnalyzed || sortedYears,
        totalQuestionsAnalyzed:
          aiResult.analysis?.totalQuestionsAnalyzed ||
          syntheticQuestions.length,
        recurringTopics: aiResult.analysis?.recurringTopics || [],
        overallConfidence: aiResult.analysis?.overallConfidence || 0,
        summary: aiResult.analysis?.summary || "",
      },
      aiGeneratedQuestions: aiResult.predictedQuestions.map((q) => ({
        question: q.question,
        probability: q.probability,
        reasoning: q.reasoning,
        appearedInYears: q.appearedInYears || [],
        topic: q.topic,
        questionType: q.questionType,
        difficulty: q.difficulty,
      })),
    });

    return res.json({
      success: true,
      message: `${aiResult.predictedQuestions.length} predicted questions generated`,
      data: prediction,
    });
  } catch (error) {
    console.error("generate-from-text error:", error.message);
    return res.status(500).json({
      success: false,
      message:
        "Failed to generate predictions: " + (error.message || "Unknown error"),
    });
  }
});

module.exports = router;
