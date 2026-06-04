const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const upload = require("../middleware/upload");
const { isImageFile } = require("../middleware/upload");
const Course = require("../models/Course");
const Question = require("../models/Question");
const Topic = require("../models/Topic");
const { protect, adminOnly } = require("../middleware/auth");
const mongoose = require("mongoose");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "with",
  "this",
  "from",
  "have",
  "your",
  "into",
  "will",
  "about",
  "what",
  "when",
  "where",
  "which",
  "their",
  "there",
  "been",
  "were",
  "also",
]);

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const EXAM_HEADER_PATTERNS = [
  /crawford\s+university/i,
  /faith\s+city/i,
  /igbesa/i,
  /ogun\s*state/i,
  /nigeria/i,
  /department\s+of/i,
  /faculty\s+of/i,
  /school\s+of/i,
  /college\s+of/i,
  /course\s+code/i,
  /course\s+title/i,
  /instructions?/i,
  /time\s+allowed/i,
  /answer\s+any/i,
  /matric/i,
  /examiner/i,
  /semester\s+examination/i,
  /first\s+semester/i,
  /second\s+semester/i,
];

const handleUploadFiles = (req, res, next) => {
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "noteFile", maxCount: 1 },
  ])(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({
        success: false,
        message: "Each file must be smaller than 10MB",
      });
      return;
    }

    res.status(400).json({
      success: false,
      message: error.message || "Invalid upload request",
    });
  });
};

// Ensure uploads directory exists
const uploadsDir = process.env.VERCEL
  ? path.join("/tmp", "uploads")
  : path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// OCR function for image processing
async function extractTextFromImage(imagePath) {
  try {
    console.log("Starting OCR for image:", imagePath);
    const {
      data: { text },
    } = await Tesseract.recognize(imagePath, "eng", {
      logger: (m) =>
        console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`),
    });
    console.log("OCR completed successfully");
    return text;
  } catch (error) {
    console.error("OCR Error:", error);
    throw new Error("Failed to extract text from image: " + error.message);
  }
}

async function extractTextFromFile(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();

  if (file.mimetype === "application/pdf") {
    const dataBuffer = fs.readFileSync(file.path);
    const pdfData = await pdfParse(dataBuffer);
    return {
      extractedText: pdfData.text,
      fileType: "pdf",
    };
  }

  if (file.mimetype === "text/plain") {
    return {
      extractedText: fs.readFileSync(file.path, "utf-8"),
      fileType: "text",
    };
  }

  if (
    isImageFile(file.mimetype) ||
    [".jpg", ".jpeg", ".png", ".webp"].includes(extension)
  ) {
    return {
      extractedText: await extractTextFromImage(file.path),
      fileType: "image",
    };
  }

  throw new Error(`Unsupported file type: ${file.mimetype}`);
}

async function resolveCourse(courseValue) {
  if (!courseValue) {
    throw new Error("Course is required");
  }

  const course = mongoose.Types.ObjectId.isValid(courseValue)
    ? await Course.findById(courseValue)
    : await Course.findOne({
        $or: [
          { code: String(courseValue).trim().toUpperCase() },
          { name: new RegExp(`^${String(courseValue).trim()}$`, "i") },
        ],
        isActive: true,
      });

  if (!course) {
    throw new Error("Selected course was not found");
  }

  return course;
}

async function resolveTopic(topicValue, courseId) {
  if (!topicValue) {
    throw new Error("Topic is required");
  }

  if (mongoose.Types.ObjectId.isValid(topicValue)) {
    const existingTopic = await Topic.findOne({
      _id: topicValue,
      course: courseId,
      isActive: true,
    });

    if (existingTopic) {
      return existingTopic;
    }
  }

  const normalizedName = String(topicValue).trim();
  if (!normalizedName) {
    throw new Error("Topic is required");
  }

  const existingTopic = await Topic.findOne({
    course: courseId,
    name: new RegExp(`^${escapeRegExp(normalizedName)}$`, "i"),
    isActive: true,
  });

  if (existingTopic) {
    return existingTopic;
  }

  return Topic.create({
    name: normalizedName,
    course: courseId,
    lecturerEmphasis: 5,
    keywords: extractKeywords(normalizedName),
  });
}

function mergeLecturerNotes(existingNotes = "", incomingNotes = "") {
  const current = String(existingNotes || "").trim();
  const next = String(incomingNotes || "").trim();

  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  if (current.toLowerCase().includes(next.toLowerCase())) {
    return current;
  }

  return `${current}\n\n${next}`;
}

function toTitleCase(value = "") {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeQuestionText(text = "") {
  return String(text)
    .replace(/\r/g, "\n")
    .replace(/[_~`]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([?.!,;:])/g, "$1")
    .trim();
}

function isHeaderLikeLine(line = "") {
  const normalizedLine = String(line).replace(/\s+/g, " ").trim();

  if (!normalizedLine) {
    return false;
  }

  if (EXAM_HEADER_PATTERNS.some((pattern) => pattern.test(normalizedLine))) {
    return true;
  }

  const alphaOnly = normalizedLine.replace(/[^a-z]/gi, "");
  const uppercaseRatio =
    alphaOnly.length > 0
      ? (normalizedLine.match(/[A-Z]/g) || []).length / alphaOnly.length
      : 0;

  return uppercaseRatio > 0.7 && normalizedLine.length <= 120;
}

function stripDocumentHeaderText(text = "") {
  const lines = String(text).replace(/\r/g, "\n").split("\n");
  const cleanedLines = [];
  let questionContentStarted = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (questionContentStarted) {
        cleanedLines.push("");
      }
      continue;
    }

    const looksLikeQuestionStart =
      /^(?:question\s*\d+|q\s*\d+|\d{1,3}[.)])/i.test(line) ||
      /(?:define|explain|discuss|differentiate|compare|solve|calculate|state|list|outline|describe)\b/i.test(
        line,
      );

    if (!questionContentStarted && looksLikeQuestionStart) {
      questionContentStarted = true;
    }

    if (!questionContentStarted && isHeaderLikeLine(line)) {
      continue;
    }

    cleanedLines.push(rawLine);
  }

  return cleanedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSemanticTokens(text = "") {
  return Array.from(
    new Set(
      normalizeQuestionText(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(
          (word) =>
            word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word),
        ),
    ),
  ).slice(0, 12);
}

function buildSimilaritySignature(tokens = []) {
  return [...tokens].sort().slice(0, 6).join("-");
}

function buildConceptLabel(text = "") {
  const keywords = extractKeywords(text).slice(0, 3);

  if (keywords.length === 0) {
    return "Core Course Material";
  }

  return toTitleCase(keywords.join(" "));
}

function buildQuestionMetadata(text = "") {
  const normalizedText = normalizeQuestionText(text);
  const semanticTokens = extractSemanticTokens(normalizedText);

  return {
    normalizedText,
    semanticTokens,
    similaritySignature: buildSimilaritySignature(semanticTokens),
    conceptLabel: buildConceptLabel(normalizedText),
  };
}

function tokenOverlapScore(firstTokens = [], secondTokens = []) {
  const first = new Set(firstTokens);
  const second = new Set(secondTokens);

  if (first.size === 0 || second.size === 0) {
    return 0;
  }

  const intersection = [...first].filter((token) => second.has(token)).length;
  const union = new Set([...first, ...second]).size;

  return union === 0 ? 0 : intersection / union;
}

function similarityScore(metadata, question) {
  const candidateNormalized =
    question.normalizedText || normalizeQuestionText(question.text || "");
  const candidateTokens =
    question.semanticTokens || extractSemanticTokens(question.text || "");
  const candidateSignature =
    question.similaritySignature || buildSimilaritySignature(candidateTokens);

  if (!candidateNormalized) {
    return 0;
  }

  if (candidateNormalized === metadata.normalizedText) {
    return 1;
  }

  if (
    metadata.similaritySignature &&
    candidateSignature &&
    metadata.similaritySignature === candidateSignature
  ) {
    return 0.94;
  }

  if (
    candidateNormalized.includes(metadata.normalizedText) ||
    metadata.normalizedText.includes(candidateNormalized)
  ) {
    return 0.8;
  }

  return tokenOverlapScore(metadata.semanticTokens, candidateTokens);
}

function findSimilarQuestions(existingQuestions, metadata) {
  return existingQuestions.filter((question) => {
    const score = similarityScore(metadata, question);
    return score >= 0.55;
  });
}

function resolveConceptLabel(metadata, similarQuestions) {
  const counts = similarQuestions.reduce((accumulator, question) => {
    const label = question.conceptLabel || metadata.conceptLabel;
    accumulator[label] = (accumulator[label] || 0) + 1;
    return accumulator;
  }, {});

  const [bestLabel] =
    Object.entries(counts).sort((first, second) => second[1] - first[1])[0] ||
    [];

  return bestLabel || metadata.conceptLabel;
}

function prepareTextForQuestionParsing(text = "") {
  return String(text)
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(
      /([a-z0-9?])\s+(?=(?:question\s*\d+|q\s*\d+|\d{1,3}[.)])\s+[A-Z(])/gi,
      "$1\n",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractNumberedQuestionBlocks(text = "") {
  const matches = text.match(
    /(?:^|\n)(?:question\s*\d+|q\s*\d+|\d{1,3}[.)])\s*[\s\S]*?(?=(?:\n(?:question\s*\d+|q\s*\d+|\d{1,3}[.)])\s*)|$)/gi,
  );

  if (!matches) {
    return [];
  }

  return matches
    .map((entry) =>
      entry.replace(/^(?:question\s*\d+|q\s*\d+|\d{1,3}[.)])\s*/i, "").trim(),
    )
    .filter(Boolean);
}

function buildFallbackQuestions(text) {
  const normalizedText = prepareTextForQuestionParsing(
    stripDocumentHeaderText(text),
  );

  if (!normalizedText || normalizedText.length < 10) {
    return [];
  }

  const chunks = normalizedText
    .split(/\n\s*\n/)
    .map((entry) => normalizeQuestionText(entry))
    .filter((entry) => entry.length > 20)
    .map((entry) => ({
      text: entry,
      type: detectQuestionType(entry),
      difficulty: detectDifficulty(entry),
    }));

  if (chunks.length > 0) {
    return chunks;
  }

  return [
    {
      text: normalizedText,
      type: detectQuestionType(normalizedText),
      difficulty: detectDifficulty(normalizedText),
    },
  ];
}

function detectYearFromFilename(filename) {
  const match = String(filename || "").match(/(19\d{2}|20\d{2})/);
  return match ? parseInt(match[1], 10) : null;
}

function cleanExtractedQuestionText(text = "") {
  return normalizeQuestionText(stripDocumentHeaderText(text));
}

function shouldRewriteQuestion(text = "") {
  const normalizedText = String(text || "").trim();

  if (!normalizedText || normalizedText.length < 20) {
    return false;
  }

  return (
    /[^\x20-\x7E\n\r\t]/.test(normalizedText) ||
    /\b[a-z]{1,2}\b\s+\b[a-z]{1,2}\b/i.test(normalizedText) ||
    /\s{2,}/.test(normalizedText) ||
    !/[?.:]$/.test(normalizedText) ||
    /(\bteh\b|\bquesion\b|\bcomparism\b|\buploades?\b|\bmodl\b)/i.test(
      normalizedText,
    )
  );
}

async function rewriteQuestionsWithGroq(questions, useAiRewrite) {
  if (!useAiRewrite || !process.env.GROQ_API_KEY || questions.length === 0) {
    return questions.map((question) => ({
      ...question,
      rewrittenText: question.text,
      wasEnhanced: false,
    }));
  }

  const questionsNeedingRewrite = questions.filter((question) =>
    shouldRewriteQuestion(question.text),
  );

  if (questionsNeedingRewrite.length === 0) {
    return questions.map((question) => ({
      ...question,
      rewrittenText: question.text,
      wasEnhanced: false,
    }));
  }

  try {
    const promptPayload = questionsNeedingRewrite.map((question, index) => ({
      id: index + 1,
      text: question.text,
    }));
    const response = await axios.post(
      GROQ_API_URL,
      {
        model: GROQ_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You improve poorly written extracted exam questions. Preserve original meaning, course intent, and exam style. Return only valid JSON.",
          },
          {
            role: "user",
            content: `Rewrite only the unclear exam questions below into clean, natural English. Keep numbering out of the text. Return JSON in the form {\"questions\":[{\"id\":1,\"rewrittenText\":\"...\"}]}. Questions: ${JSON.stringify(promptPayload)}`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );

    const content = response.data?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content || "{}");
    const rewrittenMap = new Map(
      (parsed.questions || []).map((entry) => [entry.id, entry.rewrittenText]),
    );

    let rewriteIndex = 0;
    return questions.map((question) => {
      if (!shouldRewriteQuestion(question.text)) {
        return {
          ...question,
          rewrittenText: question.text,
          wasEnhanced: false,
        };
      }

      rewriteIndex += 1;
      const rewrittenText = String(
        rewrittenMap.get(rewriteIndex) || question.text,
      )
        .trim()
        .replace(/\s+/g, " ");

      return {
        ...question,
        rewrittenText: rewrittenText || question.text,
        wasEnhanced: Boolean(rewrittenText && rewrittenText !== question.text),
      };
    });
  } catch (error) {
    return questions.map((question) => ({
      ...question,
      rewrittenText: question.text,
      wasEnhanced: false,
    }));
  }
}

// @route   POST /api/upload/questions
// @desc    Upload past questions file (PDF/TXT/Images)
// @access  Private/Admin
router.post(
  "/questions",
  protect,
  adminOnly,
  handleUploadFiles,
  async (req, res) => {
    try {
      const questionFiles = req.files?.file || [];
      const noteFiles = req.files?.noteFile || [];

      if (!questionFiles.length) {
        return res.status(400).json({
          success: false,
          message: "Please upload a file",
        });
      }

      const { course, year, semester, examType, lecturerNote, useAiRewrite } =
        req.body;

      if (!course) {
        return res.status(400).json({
          success: false,
          message: "Course is required",
        });
      }

      const resolvedCourse = await resolveCourse(course);

      let resolvedLecturerNote = String(lecturerNote || "").trim();

      if (noteFiles[0]) {
        const { extractedText: extractedNoteText } = await extractTextFromFile(
          noteFiles[0],
        );
        resolvedLecturerNote = mergeLecturerNotes(
          resolvedLecturerNote,
          extractedNoteText,
        );
      }

      if (resolvedLecturerNote) {
        resolvedCourse.lecturerNotes = mergeLecturerNotes(
          resolvedCourse.lecturerNotes,
          resolvedLecturerNote,
        );
        resolvedCourse.noteKeywords = Array.from(
          new Set([
            ...(resolvedCourse.noteKeywords || []),
            ...extractKeywords(resolvedLecturerNote),
          ]),
        );
        await resolvedCourse.save();
      }

      const existingCourseQuestions = await Question.find({
        course: resolvedCourse._id,
        isActive: true,
      })
        .select(
          "_id text occurrenceCount conceptLabel normalizedText semanticTokens similaritySignature",
        )
        .lean();

      const savedQuestions = [];
      const processedFiles = [];
      const failedFiles = [];
      let combinedPreview = "";
      let rewrittenQuestionsCount = 0;

      for (const file of questionFiles) {
        try {
          const { extractedText, fileType } = await extractTextFromFile(file);
          const cleanedExtractedText = stripDocumentHeaderText(extractedText);
          const detectedYear = detectYearFromFilename(file.originalname);
          const resolvedYear =
            detectedYear || parseInt(year, 10) || new Date().getFullYear();

          if (!cleanedExtractedText || !String(cleanedExtractedText).trim()) {
            failedFiles.push({
              originalName: file.originalname,
              reason: "No readable text was found in the file",
            });
            continue;
          }

          const questions = parseQuestionsFromText(cleanedExtractedText);
          const normalizedQuestions =
            questions.length > 0
              ? questions
              : buildFallbackQuestions(cleanedExtractedText);

          if (normalizedQuestions.length === 0) {
            failedFiles.push({
              originalName: file.originalname,
              reason:
                "No questions could be extracted. Use clearer text, numbered questions, or a more readable image/PDF.",
            });
            continue;
          }

          const rewrittenQuestions = await rewriteQuestionsWithGroq(
            normalizedQuestions,
            String(useAiRewrite) === "true",
          );

          for (const q of rewrittenQuestions) {
            const finalText = q.rewrittenText || q.text;
            const metadata = buildQuestionMetadata(finalText);
            const similarQuestions = findSimilarQuestions(
              existingCourseQuestions,
              metadata,
            );
            const conceptLabel = resolveConceptLabel(
              metadata,
              similarQuestions,
            );
            const occurrenceCount = Math.max(
              1,
              ...similarQuestions.map(
                (question) => (question.occurrenceCount || 1) + 1,
              ),
            );
            const question = await Question.create({
              text: finalText,
              originalText:
                q.wasEnhanced && finalText !== q.text ? q.text : undefined,
              course: resolvedCourse._id,
              conceptLabel,
              normalizedText: metadata.normalizedText,
              semanticTokens: metadata.semanticTokens,
              similaritySignature: metadata.similaritySignature,
              difficulty: q.difficulty || "Medium",
              questionType: q.type || "Theory",
              year: resolvedYear,
              semester: semester || undefined,
              examType: examType || undefined,
              occurrenceCount,
              keywords: extractKeywords(finalText),
              uploadedBy: req.user._id,
              sourceFile: file.filename,
              isAiEnhanced: Boolean(q.wasEnhanced),
              aiModel: q.wasEnhanced ? GROQ_MODEL : undefined,
            });
            savedQuestions.push(question);
            if (similarQuestions.length > 0) {
              await Question.updateMany(
                {
                  _id: { $in: similarQuestions.map((entry) => entry._id) },
                },
                { $inc: { occurrenceCount: 1 } },
              );
            }
            existingCourseQuestions.push({
              _id: question._id,
              text: question.text,
              occurrenceCount,
              conceptLabel,
              normalizedText: metadata.normalizedText,
              semanticTokens: metadata.semanticTokens,
              similaritySignature: metadata.similaritySignature,
            });
            if (q.wasEnhanced) {
              rewrittenQuestionsCount += 1;
            }
          }

          processedFiles.push({
            filename: file.filename,
            originalName: file.originalname,
            fileType,
            questionsCount: normalizedQuestions.length,
            rewrittenQuestionsCount: rewrittenQuestions.filter(
              (question) => question.wasEnhanced,
            ).length,
            year: resolvedYear,
          });

          if (!combinedPreview && extractedText) {
            combinedPreview = cleanedExtractedText;
          }
        } catch (fileError) {
          failedFiles.push({
            originalName: file.originalname,
            reason: fileError.message,
          });
        }
      }

      if (savedQuestions.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            failedFiles[0]?.reason ||
            "No questions could be extracted from the uploaded files",
          data: {
            failedFiles,
          },
        });
      }

      res.status(201).json({
        success: true,
        message: `Successfully uploaded and parsed ${savedQuestions.length} questions from ${questionFiles.length} file${questionFiles.length === 1 ? "" : "s"}`,
        data: {
          course: {
            _id: resolvedCourse._id,
            name: resolvedCourse.name,
            code: resolvedCourse.code,
            lecturerNotes: resolvedCourse.lecturerNotes,
          },
          files: processedFiles,
          noteFile: noteFiles[0]
            ? {
                originalName: noteFiles[0].originalname,
                filename: noteFiles[0].filename,
              }
            : null,
          failedFiles,
          questionsCount: savedQuestions.length,
          rewrittenQuestionsCount,
          extractedTextPreview:
            combinedPreview.substring(0, 500) +
            (combinedPreview.length > 500 ? "..." : ""),
          questions: savedQuestions,
        },
      });
    } catch (error) {
      console.error("Upload error:", error);
      const statusCode =
        error.name === "ValidationError" ||
        error.message === "Course is required" ||
        error.message === "Selected course was not found"
          ? 400
          : 500;

      res.status(statusCode).json({
        success: false,
        message:
          statusCode === 400 ? error.message : "Error processing uploaded file",
        error: error.message,
      });
    }
  },
);

// @route   POST /api/upload/bulk-questions
// @desc    Upload multiple questions via JSON
// @access  Private/Admin
router.post("/bulk-questions", protect, adminOnly, async (req, res) => {
  try {
    const { questions, course } = req.body;

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({
        success: false,
        message: "Questions array is required",
      });
    }

    const savedQuestions = [];
    for (const q of questions) {
      const question = await Question.create({
        text: q.text,
        course: q.course || course,
        topic: q.topic,
        difficulty: q.difficulty || "Medium",
        questionType: q.questionType || "Theory",
        options: q.options || [],
        answer: q.answer,
        marks: q.marks || 1,
        year: q.year,
        semester: q.semester,
        examType: q.examType || "Final",
        keywords: extractKeywords(q.text),
        uploadedBy: req.user._id,
      });
      savedQuestions.push(question);
    }

    res.status(201).json({
      success: true,
      message: `Successfully uploaded ${savedQuestions.length} questions`,
      data: savedQuestions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error uploading questions",
      error: error.message,
    });
  }
});

// @route   POST /api/upload/topics
// @desc    Upload course topics
// @access  Private/Admin
router.post("/topics", protect, adminOnly, async (req, res) => {
  try {
    const { topics, course } = req.body;

    if (!topics || !Array.isArray(topics)) {
      return res.status(400).json({
        success: false,
        message: "Topics array is required",
      });
    }

    const savedTopics = [];
    for (const t of topics) {
      const topic = await Topic.create({
        name: t.name,
        description: t.description,
        course,
        lecturerEmphasis: t.lecturerEmphasis || 5,
        keywords: t.keywords || [],
        subtopics: t.subtopics || [],
      });
      savedTopics.push(topic);
    }

    res.status(201).json({
      success: true,
      message: `Successfully created ${savedTopics.length} topics`,
      data: savedTopics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error creating topics",
      error: error.message,
    });
  }
});

// Helper function to parse questions from text
function parseQuestionsFromText(text) {
  const preparedText = prepareTextForQuestionParsing(text);
  const numberedBlocks = extractNumberedQuestionBlocks(preparedText);

  if (numberedBlocks.length > 0) {
    return numberedBlocks
      .map((entry) => normalizeQuestionText(entry))
      .filter((entry) => entry.length > 10)
      .map((entry) => ({
        text: entry,
        type: detectQuestionType(entry),
        difficulty: detectDifficulty(entry),
      }));
  }

  const paragraphQuestions = preparedText
    .split(/\n\s*\n|(?<=\?)\s+(?=[A-Z])/)
    .map((entry) => normalizeQuestionText(entry))
    .filter((entry) => entry.length > 20)
    .map((entry) => ({
      text: entry,
      type: detectQuestionType(entry),
      difficulty: detectDifficulty(entry),
    }));

  if (paragraphQuestions.length > 0) {
    return paragraphQuestions;
  }

  return [];
}

// Helper function to detect question type
function detectQuestionType(text) {
  const lowerText = text.toLowerCase();

  if (/calculate|compute|solve|find the value|formula/i.test(lowerText)) {
    return "Calculation";
  }
  if (
    /which of the following|select|choose|true or false|multiple choice/i.test(
      lowerText,
    )
  ) {
    return "Objective";
  }
  if (/explain|describe|discuss|define|what is|why|how/i.test(lowerText)) {
    return "Theory";
  }
  if (/implement|write code|program|algorithm/i.test(lowerText)) {
    return "Practical";
  }
  if (/case study|scenario|given the following situation/i.test(lowerText)) {
    return "Case Study";
  }

  return "Theory";
}

// Helper function to detect difficulty
function detectDifficulty(text) {
  const lowerText = text.toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // Complex questions are usually longer
  if (
    wordCount > 50 ||
    /analyze|evaluate|compare and contrast|critically/i.test(lowerText)
  ) {
    return "Hard";
  }
  if (wordCount < 15 || /define|list|name|what is/i.test(lowerText)) {
    return "Easy";
  }

  return "Medium";
}

// Helper function to extract keywords
function extractKeywords(text) {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "again",
    "further",
    "then",
    "once",
    "here",
    "there",
    "when",
    "where",
    "why",
    "how",
    "all",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "nor",
    "not",
    "only",
    "own",
    "same",
    "so",
    "than",
    "too",
    "very",
    "just",
    "and",
    "but",
    "if",
    "or",
    "because",
    "until",
    "while",
    "this",
    "that",
    "these",
    "those",
    "what",
    "which",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word));

  // Get unique words
  return [...new Set(words)].slice(0, 10);
}

// @route   POST /api/upload/extract
// @desc    Extract text from a single uploaded file (PDF/Image/TXT) without saving — returns raw text for user review/editing
// @access  Private/Admin
router.post(
  "/extract",
  protect,
  adminOnly,
  (req, res, next) => {
    upload.single("file")(req, res, (error) => {
      if (!error) return next();
      if (error.code === "LIMIT_FILE_SIZE") {
        return res
          .status(400)
          .json({ success: false, message: "File must be smaller than 10MB" });
      }
      return res
        .status(400)
        .json({ success: false, message: error.message || "Invalid upload" });
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No file provided" });
      }

      const { extractedText, fileType } = await extractTextFromFile(req.file);

      // Clean up temp file
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {}

      if (!extractedText || !String(extractedText).trim()) {
        return res.status(422).json({
          success: false,
          message:
            "No readable text found in this file. Try a clearer scan or a text-based PDF.",
        });
      }

      const cleanedText = stripDocumentHeaderText(extractedText);
      const detectedYear = detectYearFromFilename(req.file.originalname);

      return res.json({
        success: true,
        data: {
          text: cleanedText || extractedText,
          fileType,
          originalName: req.file.originalname,
          detectedYear,
        },
      });
    } catch (error) {
      // Clean up temp file on error
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {}
      }
      return res.status(500).json({
        success: false,
        message: error.message || "Text extraction failed",
      });
    }
  },
);

module.exports = router;
