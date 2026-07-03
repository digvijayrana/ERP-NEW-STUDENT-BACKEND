const jwt = require('jsonwebtoken');

exports.signToken = function signToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      teacher: user.teacher?.toString(),
      student: user.student?.toString()
    },
    process.env.JWT_SECRET || 'change-this-secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
};
