const { createLogger } = require('../utils/logger');
const { DEFAULTS, EXAM } = require('../constants');
const { buildStudentInsightFromProfile } = require('./aiInsightsEngine.service');

const log = createLogger('ai-student');

function buildAnalysisPrompt(profile, engineInsight) {
  return `You are an expert school academic advisor. Analyze this student profile and respond with JSON only:
{
  "performanceRating": "excellent|good|average|needs_attention|at_risk",
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
Risk level: ${engineInsight.riskLevel.label}
Performance band: ${engineInsight.performanceBand.label}
Engine recommendations: ${engineInsight.recommendations.map((item) => item.message).join('; ')}
Recent exams: ${profile.academics.examResults.map((e) => `${e.subject} ${e.percentage}%`).join(', ') || 'none yet'}
Subject breakdown: ${profile.academics.subjectBreakdown.map((s) => `${s.subject}: ${s.average}%`).join(', ') || 'none'}`;
}

function fallbackAnalysis(profile, engineInsight) {
  const needsWork = engineInsight.recommendations
    .filter((item) => item.priority !== 'low')
    .map((item) => item.message);

  const strengths = (profile.academics.subjectBreakdown || [])
    .filter((row) => row.average >= 75)
    .map((row) => `Strong in ${row.subject} (${row.average}%)`);

  return {
    performanceRating: engineInsight.performanceRating,
    ratingScore: engineInsight.performanceScore,
    summary: `${profile.student.firstName} is classified as ${engineInsight.performanceBand.label} with a performance score of ${engineInsight.performanceScore}. Risk level is ${engineInsight.riskLevel.label}.`,
    strengths: strengths.length ? strengths : ['Consistent effort across subjects'],
    needsWork: needsWork.length ? needsWork : ['Maintain balanced performance across subjects'],
    recommendations: engineInsight.recommendations.map((item) => item.message),
    focusSubjects: (profile.academics.subjectBreakdown || [])
      .filter((row) => row.average < 60)
      .map((row) => row.subject)
      .slice(0, 3),
    parentAdvice: profile.fees.totalDue > 0
      ? 'Please clear pending fee dues and support daily homework routine.'
      : 'Encourage regular study habits and monitor exam preparation.',
    provider: 'rules-engine'
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

  const engineInsight = await buildStudentInsightFromProfile(profile);

  let narrative = null;
  try {
    if (process.env.OPENAI_API_KEY) {
      narrative = await callOpenAI(buildAnalysisPrompt(profile, engineInsight));
    }
  } catch (error) {
    log.warn('AI analysis failed, using rules engine narrative', { error: error.message });
  }

  const base = narrative?.summary ? narrative : fallbackAnalysis(profile, engineInsight);

  return {
    ...base,
    performanceRating: engineInsight.performanceRating,
    ratingScore: engineInsight.performanceScore,
    performanceBand: engineInsight.performanceBand,
    riskScore: engineInsight.riskScore,
    riskLevel: engineInsight.riskLevel,
    riskFactors: engineInsight.riskFactors,
    scoreComponents: engineInsight.components,
    studentRecommendations: engineInsight.recommendations,
    teacherRecommendations: engineInsight.teacherRecommendations,
    provider: narrative?.provider || base.provider
  };
}

module.exports = { analyzeStudentProfile };
