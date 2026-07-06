const Student = require('../models/Student');
const { HTTP_STATUS } = require('../constants');

function validationError(message, status = HTTP_STATUS.BAD_REQUEST) {
  const error = new Error(message);
  error.status = status;
  return error;
}

exports.validateAdmission = async function validateAdmission({
  studentData = {},
  guardians = [],
  classRoom,
  academicYearId,
  rollNumber,
  documents = [],
  excludeStudentId,
  skipMandatoryDocs = false
}) {
  const queryBase = excludeStudentId ? { _id: { $ne: excludeStudentId } } : {};

  if (studentData.aadhaarNumber) {
    const dupAadhaar = await Student.findOne({ ...queryBase, aadhaarNumber: studentData.aadhaarNumber });
    if (dupAadhaar) throw validationError('Aadhaar number is already registered to another student');
  }

  if (studentData.udisePenId) {
    const dupUdise = await Student.findOne({ ...queryBase, udisePenId: studentData.udisePenId });
    if (dupUdise) throw validationError('UDISE+/PEN ID is already registered to another student');
  }

  if (rollNumber && classRoom && academicYearId) {
    const dupRoll = await Student.findOne({
      ...queryBase,
      enrollments: {
        $elemMatch: {
          academicYear: academicYearId,
          classRoom: classRoom._id,
          rollNumber: String(rollNumber).trim(),
          status: 'studying'
        }
      }
    });
    if (dupRoll) {
      throw validationError(`Roll number ${rollNumber} is already assigned in ${classRoom.name}-${classRoom.section}`);
    }
  }

  if (!studentData.aadhaarNumber) {
    const primaryGuardian = guardians.find((g) => g.isPrimary) || guardians[0];
    const guardianPhone = primaryGuardian?.phone;
    if (studentData.firstName && studentData.dateOfBirth && guardianPhone) {
      const dupIdentity = await Student.findOne({
        ...queryBase,
        firstName: new RegExp(`^${studentData.firstName.trim()}$`, 'i'),
        dateOfBirth: new Date(studentData.dateOfBirth),
        'guardians.phone': guardianPhone
      });
      if (dupIdentity) {
        throw validationError('A student with the same name, date of birth, and guardian mobile already exists');
      }
    }
  }

  const hasPhoto = documents.some((d) => d.type === 'photo');
  const hasBirthCert = documents.some((d) => d.type === 'birth_certificate');
  if (!skipMandatoryDocs) {
    if (!hasPhoto) throw validationError('Student photo is mandatory for admission');
    if (!hasBirthCert) throw validationError('Birth certificate is mandatory for admission');
  }
};

const { buildActivityEntry } = require('./activityLog.service');

exports.buildActivityEntry = buildActivityEntry;
