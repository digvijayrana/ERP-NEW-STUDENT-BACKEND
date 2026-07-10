module.exports = {
  AUTO_CLOSE_HOUR: Number(process.env.ATTENDANCE_AUTO_CLOSE_HOUR || 19),
  AUTO_CLOSE_TIMEZONE: process.env.ATTENDANCE_AUTO_CLOSE_TZ || 'Asia/Kolkata',
  AUTO_CLOSE_CHECK_MS: Number(process.env.ATTENDANCE_AUTO_CLOSE_CHECK_MS || 60_000),
  AUTO_ABSENT_REMARK: 'Auto-marked absent — register not submitted by 7 PM',
  AUTO_TEACHER_ABSENT_REMARK: 'Auto-marked absent — attendance not marked by 7 PM'
};
