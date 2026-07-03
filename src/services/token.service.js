const jwt = require('jsonwebtoken');
const { DEFAULTS } = require('../constants');

exports.signToken = function signToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      teacher: user.teacher?.toString(),
      student: user.student?.toString()
    },
    process.env.JWT_SECRET || DEFAULTS.JWT_SECRET_FALLBACK,
    { expiresIn: process.env.JWT_EXPIRES_IN || DEFAULTS.JWT_EXPIRES_IN }
  );
};
