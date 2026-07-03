const { createLogger } = require('../utils/logger');
const { DEFAULTS, EXAM } = require('../constants');

const log = createLogger('ai-student');

function buildAnalysisPrompt(profile) {
  return `You are an expert school academic advisor. Analyze this student profile and respond with JSON only:
{
  "performanceRating": "excellent|good|average|needs_improvement|at_risk",
  "ratingScore": 0-100,
  "summary": "2-3 sentence overview",
  "strengths": ["..."],
  "needsWork": ["subject or skill areas needing improvement"],
  "recommendations": ["actionable study recommendations"],
  "focusSubjects": ["subjects to prioritize"],
  "parentAdvice": "brief advice for parents"
}

Student: ${profile.student.firstName} ${profile.student.lastName || ''}
Class: ${profile.academic.className}
Roll: ${profile.academic.rollNumber}
Attendance: ${profile.attendance.percentage}% (${profile.attendance.present} present, ${profile.attendance.absent} absent)
Average exam score: ${profile.academics.averageScore}%
Fee due: ₹${profile.fees.totalDue}
Recent exams: ${profile.academics.examResults.map((e) => `${e.subject} ${e.percentage}%`).join(', ') || 'none yet'}
Subject breakdown: ${profile.academics.subjectBreakdown.map((s) => `${s.subject}: ${s.average}%`).join(', ') || 'none'}`;
}

function fallbackAnalysis(profile) {
  const avg = profile.academics.averageScore || 0;
  const attendance = profile.attendance.percentage || 0;
  const score = Math.round(avg * 0.6 + attendance * 0.4);

  let performanceRating = 'average';
  if (score >= 85) performanceRating = 'excellent';
  else if (score >= 70) performanceRating = 'good';
  else if (score >= 50) performanceRating = 'needs_improvement';
  else performanceRating = 'at_risk';

  const weakSubjects = profile.academics.subjectBreakdown
    .filter((s) => s.average < 60)
    .map((s) => s.subject);

  const needsWork = [];
  if (attendance < 75) needsWork.push('Attendance — aim for at least 85% presence');
  if (profile.fees.totalDue > 0) needsWork.push('Fee payments — clear pending dues');
  weakSubjects.forEach((s) => needsWork.push(`${s} — scores below 60%, needs revision`));
  if (!profile.academics.examResults.length) needsWork.push('Exam participation — attempt upcoming unit tests');

  const recommendations = [];
  if (weakSubjects.length) recommendations.push(`Revise ${weakSubjects.join(', ')} chapters with daily practice`);
  if (attendance < 85) recommendations.push('Maintain regular attendance to avoid missing key lessons');
  recommendations.push('Review recent exam mistakes and attempt practice questions');
  if (!recommendations.length) recommendations.push('Continue current study routine and attempt advanced problems');

  return {
    performanceRating,
    ratingScore: score,
    summary: `${profile.student.firstName} is currently ${performanceRating.replace('_', ' ')} with ${attendance}% attendance and ${avg}% average exam score.`,
    strengths: profile.academics.subjectBreakdown.filter((s) => s.average >= 75).map((s) => `Strong in ${s.subject} (${s.average}%)`),
    needsWork: needsWork.length ? needsWork : ['Keep consistent performance across all subjects'],
    recommendations,
    focusSubjects: weakSubjects.length ? weakSubjects : profile.academics.subjectBreakdown.map((s) => s.subject).slice(0, 2),
    parentAdvice: profile.fees.totalDue > 0
      ? 'Please clear pending fee dues and support daily homework routine.'
      : 'Encourage regular study habits and monitor exam preparation.',
    provider: 'fallback'
  };
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULTS.OPENAI_MODEL,
      temperature: EXAM.ANALYSIS_TEMPERATURE,
      messages: [
        { role: 'system', content: 'You analyze student school performance. Return JSON only.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`OpenAI error ${response.status}`);
  const data = await response.json();
  const content = (data.choices?.[0]?.message?.content || '{}').replace(/```json|```/g, '').trim();
  return { ...JSON.parse(content), provider: 'openai' };
}

async function analyzeStudentProfile(profile) {
  log.info('Analyzing student profile', { studentId: profile.student._id, name: profile.student.firstName });
  try {
    if (process.env.OPENAI_API_KEY) {
      const ai = await callOpenAI(buildAnalysisPrompt(profile));
      if (ai?.summary) {
        log.info('AI student analysis complete', { provider: 'openai', rating: ai.performanceRating });
        return ai;
      }
    }
  } catch (error) {
    log.warn('AI analysis failed, using fallback', { error: error.message });
  }
  const result = fallbackAnalysis(profile);
  log.info('Student analysis complete', { provider: 'fallback', rating: result.performanceRating });
  return result;
}

module.exports = { analyzeStudentProfile };
