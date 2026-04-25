const Course = require("../models/Course");
const Topic = require("../models/Topic");
const Question = require("../models/Question");
const User = require("../models/User");
const mongoose = require("mongoose");
require("dotenv").config();

const seedData = async () => {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/exam-prediction",
    );
    console.log("Connected to MongoDB");

    // Clear existing data
    await Course.deleteMany({});
    await Topic.deleteMany({});
    await Question.deleteMany({});
    console.log("Cleared existing data");

    // Create an admin user
    let admin = await User.findOne({ email: "admin@example.com" });
    if (!admin) {
      admin = await User.create({
        name: "Admin User",
        email: "admin@example.com",
        password: "admin123",
        role: "admin",
        department: "Computer Science",
      });
      console.log("Created admin user");
    }

    let lecturer = await User.findOne({ email: "lecturer@example.com" });
    if (!lecturer) {
      lecturer = await User.create({
        name: "Lecturer User",
        email: "lecturer@example.com",
        password: "lecturer123",
        role: "lecturer",
        department: "Computer Science",
      });
      console.log("Created lecturer user");
    }

    // Create a sample course
    const course = await Course.create({
      name: "Data Structures and Algorithms",
      code: "CS201",
      description:
        "Fundamental data structures and algorithms for computer science",
      department: "Computer Science",
      lecturer: admin._id,
      semester: "First",
      academicYear: "2024-2025",
    });
    console.log("Created course:", course.name);

    // Create topics
    const topicsData = [
      {
        name: "Arrays and Strings",
        description: "Linear data structures for sequential storage",
        lecturerEmphasis: 8,
        frequency: 25,
        keywords: ["array", "string", "indexing", "iteration"],
      },
      {
        name: "Linked Lists",
        description: "Dynamic linear data structures using pointers",
        lecturerEmphasis: 9,
        frequency: 30,
        keywords: ["linked", "node", "pointer", "traversal"],
      },
      {
        name: "Stacks and Queues",
        description: "LIFO and FIFO data structures",
        lecturerEmphasis: 8,
        frequency: 22,
        keywords: ["stack", "queue", "push", "pop", "fifo", "lifo"],
      },
      {
        name: "Trees",
        description: "Hierarchical data structures",
        lecturerEmphasis: 9,
        frequency: 35,
        keywords: ["tree", "binary", "bst", "traversal", "root", "leaf"],
      },
      {
        name: "Graphs",
        description: "Non-linear data structures for networks",
        lecturerEmphasis: 7,
        frequency: 20,
        keywords: ["graph", "vertex", "edge", "bfs", "dfs"],
      },
      {
        name: "Sorting Algorithms",
        description: "Algorithms for ordering data",
        lecturerEmphasis: 9,
        frequency: 28,
        keywords: ["sort", "bubble", "quick", "merge", "heap"],
      },
      {
        name: "Searching Algorithms",
        description: "Algorithms for finding data",
        lecturerEmphasis: 7,
        frequency: 18,
        keywords: ["search", "binary", "linear", "hash"],
      },
      {
        name: "Hash Tables",
        description: "Key-value data structures",
        lecturerEmphasis: 6,
        frequency: 15,
        keywords: ["hash", "collision", "bucket", "map"],
      },
      {
        name: "Recursion",
        description: "Functions that call themselves",
        lecturerEmphasis: 8,
        frequency: 22,
        keywords: ["recursive", "base case", "call stack"],
      },
      {
        name: "Dynamic Programming",
        description: "Optimization technique using memoization",
        lecturerEmphasis: 6,
        frequency: 12,
        keywords: ["dp", "memoization", "tabulation", "optimal"],
      },
    ];

    const topics = await Promise.all(
      topicsData.map(async (t) => {
        const topic = await Topic.create({
          ...t,
          course: course._id,
          predictedProbability:
            (t.lecturerEmphasis / 10) * 0.6 + (t.frequency / 40) * 0.4,
        });
        return topic;
      }),
    );
    console.log("Created", topics.length, "topics");

    // Update course with topic references
    course.topics = topics.map((t) => t._id);
    await course.save();

    // Create sample questions
    const questionsData = [
      {
        text: "Explain the difference between an array and a linked list. When would you use each?",
        topic: topics[0],
        difficulty: "Medium",
        questionType: "Theory",
        year: 2023,
      },
      {
        text: "Implement a function to reverse a singly linked list.",
        topic: topics[1],
        difficulty: "Medium",
        questionType: "Practical",
        year: 2023,
      },
      {
        text: "What is the time complexity of binary search? Explain with an example.",
        topic: topics[6],
        difficulty: "Easy",
        questionType: "Theory",
        year: 2022,
      },
      {
        text: "Compare and contrast BFS and DFS graph traversal algorithms.",
        topic: topics[4],
        difficulty: "Medium",
        questionType: "Theory",
        year: 2023,
      },
      {
        text: "Write code to implement a stack using two queues.",
        topic: topics[2],
        difficulty: "Hard",
        questionType: "Practical",
        year: 2022,
      },
      {
        text: "Explain how quicksort works and analyze its time complexity in best, average, and worst cases.",
        topic: topics[5],
        difficulty: "Hard",
        questionType: "Theory",
        year: 2023,
      },
      {
        text: "What are the different tree traversal methods? Write code for inorder traversal.",
        topic: topics[3],
        difficulty: "Medium",
        questionType: "Practical",
        year: 2022,
      },
      {
        text: "Explain collision resolution techniques in hash tables.",
        topic: topics[7],
        difficulty: "Medium",
        questionType: "Theory",
        year: 2023,
      },
      {
        text: "Write a recursive function to calculate the nth Fibonacci number. What is its time complexity?",
        topic: topics[8],
        difficulty: "Easy",
        questionType: "Calculation",
        year: 2022,
      },
      {
        text: "Solve the coin change problem using dynamic programming.",
        topic: topics[9],
        difficulty: "Hard",
        questionType: "Calculation",
        year: 2023,
      },
      {
        text: "Implement a binary search tree with insert and search operations.",
        topic: topics[3],
        difficulty: "Medium",
        questionType: "Practical",
        year: 2023,
      },
      {
        text: "What is the difference between merge sort and heap sort?",
        topic: topics[5],
        difficulty: "Medium",
        questionType: "Theory",
        year: 2022,
      },
      {
        text: "Explain the concept of AVL trees and rotations.",
        topic: topics[3],
        difficulty: "Hard",
        questionType: "Theory",
        year: 2023,
      },
      {
        text: "Implement Dijkstra's shortest path algorithm.",
        topic: topics[4],
        difficulty: "Hard",
        questionType: "Practical",
        year: 2022,
      },
      {
        text: "What is a circular queue? Implement it using an array.",
        topic: topics[2],
        difficulty: "Medium",
        questionType: "Practical",
        year: 2023,
      },
    ];

    const questions = await Promise.all(
      questionsData.map(async (q) => {
        const question = await Question.create({
          text: q.text,
          course: course._id,
          topic: q.topic._id,
          difficulty: q.difficulty,
          questionType: q.questionType,
          year: q.year,
          semester: "First",
          examType: "Final",
          occurrenceCount: Math.floor(Math.random() * 5) + 1,
          predictedProbability: Math.random() * 0.5 + 0.3,
          uploadedBy: admin._id,
          isVerified: true,
        });
        return question;
      }),
    );
    console.log("Created", questions.length, "questions");

    // Update topic frequencies
    for (const topic of topics) {
      const count = await Question.countDocuments({ topic: topic._id });
      topic.frequency = count;
      await topic.save();
    }

    console.log("\n✓ Seed data created successfully!");
    console.log("\nTest credentials:");
    console.log("Email: admin@example.com");
    console.log("Password: admin123");
    console.log("Email: lecturer@example.com");
    console.log("Password: lecturer123");

    process.exit(0);
  } catch (error) {
    console.error("Seeding error:", error);
    process.exit(1);
  }
};

seedData();
