/**
 * Configurable scoring weights for the Student Performance Score engine.
 * Adjust these values to tune classification without code changes.
 */
module.exports = {
  weights: {
    attendance: 0.25,
    examination: 0.3,
    assignment: 0.2,
    feeRegularity: 0.15,
    behaviour: 0.1
  },
  performanceBands: [
    { min: 85, key: 'excellent', label: 'Excellent' },
    { min: 70, key: 'good', label: 'Good' },
    { min: 50, key: 'average', label: 'Average' },
    { min: 0, key: 'needs_attention', label: 'Needs Attention' }
  ],
  riskBands: [
    { min: 70, key: 'low', label: 'Low Risk' },
    { min: 40, key: 'medium', label: 'Medium Risk' },
    { min: 0, key: 'high', label: 'High Risk' }
  ],
  riskPenalties: {
    decliningAttendance: 15,
    poorExamResults: 20,
    repeatedAbsences: 10,
    unpaidFees: 15
  },
  thresholds: {
    poorExamAverage: 50,
    lowAttendance: 75,
    repeatedAbsencesPerMonth: 5,
    decliningAttendanceDelta: 5
  }
};
