const mongoose = require("mongoose");
const Course = require("../models/Course");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getUserDepartment = (req) => String(req.user?.department || "").trim();

const getDepartmentFilter = (req) => {
  const department = getUserDepartment(req);

  if (!department) {
    const error = new Error("Your account is not assigned to a department");
    error.statusCode = 403;
    throw error;
  }

  return new RegExp(`^${escapeRegExp(department)}$`, "i");
};

const getScopedCourseQuery = (req, extraQuery = {}) => ({
  ...extraQuery,
  department: getDepartmentFilter(req),
});

const getDepartmentCourse = async (req, courseId, extraQuery = {}) => {
  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    return null;
  }

  return Course.findOne(
    getScopedCourseQuery(req, {
      _id: courseId,
      isActive: true,
      ...extraQuery,
    }),
  );
};

const getDepartmentCourseIds = async (req, courseId) => {
  if (courseId) {
    const course = await getDepartmentCourse(req, courseId);
    return course ? [course._id] : [];
  }

  return Course.find(getScopedCourseQuery(req, { isActive: true })).distinct(
    "_id",
  );
};

const requireDepartmentCourse = async (req, courseId) => {
  const course = await getDepartmentCourse(req, courseId);

  if (!course) {
    const error = new Error("Course not found");
    error.statusCode = 404;
    throw error;
  }

  return course;
};

const sendScopeError = (res, error, fallbackMessage) => {
  const statusCode = error.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? fallbackMessage : error.message,
    error: error.message,
  });
};

module.exports = {
  getUserDepartment,
  getDepartmentFilter,
  getScopedCourseQuery,
  getDepartmentCourse,
  getDepartmentCourseIds,
  requireDepartmentCourse,
  sendScopeError,
};
