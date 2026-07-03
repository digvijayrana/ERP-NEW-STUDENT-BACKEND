const { createLogger } = require('../utils/logger');

const log = createLogger('ai-exam');

const DIFFICULTY_HINTS = {
  easy: 'basic recall and definitions suitable for beginners',
  medium: 'application and understanding of core concepts',
  hard: 'analysis, multi-step reasoning, and higher-order thinking'
};

function buildPrompt({ subject, chapter, bookReference, difficulty, questionCount, additionalContext }) {
  const levelHint = DIFFICULTY_HINTS[difficulty] || DIFFICULTY_HINTS.medium;
  return `You are an expert school teacher creating a unit test.

Subject: ${subject}
Chapter: ${chapter}
Book: ${bookReference || 'standard school textbook'}
Difficulty: ${difficulty} (${levelHint})
Number of questions: ${questionCount}
${additionalContext ? `Additional context: ${additionalContext}` : ''}

Return ONLY valid JSON array (no markdown) with this shape:
[
  {
    "text": "question text",
    "type": "mcq" | "true_false" | "short_answer",
    "options": ["A", "B", "C", "D"],
    "correctAnswer": "exact correct option or answer",
    "marks": 1,
    "difficulty": "easy" | "medium" | "hard",
    "chapter": "${chapter}",
    "explanation": "brief explanation"
  }
]

For true_false use options ["True", "False"]. For short_answer use empty options array.
Mix question types appropriately for the difficulty level.`;
}

function fallbackQuestions({ subject, chapter, difficulty, questionCount, bookReference }) {
  const count = Math.min(Math.max(questionCount, 3), 20);
  const questions = [];
  const types = difficulty === 'easy' ? ['mcq', 'true_false'] : ['mcq', 'short_answer'];

  for (let i = 1; i <= count; i += 1) {
    const type = types[i % types.length];
    const qDifficulty = difficulty === 'mixed'
      ? ['easy', 'medium', 'hard'][i % 3]
      : difficulty;

    if (type === 'true_false') {
      questions.push({
        text: `True or False: "${chapter}" is a chapter covered in ${subject}${bookReference ? ` (${bookReference})` : ''}.`,
        type: 'true_false',
        options: ['True', 'False'],
        correctAnswer: 'True',
        marks: 1,
        difficulty: qDifficulty,
        chapter,
        explanation: `This question checks awareness of the ${chapter} syllabus in ${subject}.`
      });
    } else if (type === 'short_answer') {
      questions.push({
        text: `Explain a key concept from "${chapter}" in ${subject} in 2-3 sentences.`,
        type: 'short_answer',
        options: [],
        correctAnswer: `A valid explanation of a core idea from ${chapter} in ${subject}.`,
        marks: 2,
        difficulty: qDifficulty,
        chapter,
        explanation: 'Open-ended; teacher may review manually if needed.'
      });
    } else {
      const options = [
        `Core idea ${i} from ${chapter}`,
        `Unrelated concept from another subject`,
        `Incorrect definition of ${chapter}`,
        `Opposite of the correct answer`
      ];
      questions.push({
        text: `Which option best describes topic ${i} from chapter "${chapter}" in ${subject}?`,
        type: 'mcq',
        options,
        correctAnswer: options[0],
        marks: 1,
        difficulty: qDifficulty,
        chapter,
        explanation: `Option 1 reflects the intended learning outcome for ${chapter}.`
      });
    }
  }

  return questions;
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: 'You generate school exam questions. Respond with JSON only.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '[]';
  const cleaned = content.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

function normalizeQuestions(rawQuestions, chapter) {
  if (!Array.isArray(rawQuestions)) return [];
  return rawQuestions
    .filter((q) => q && q.text && q.correctAnswer)
    .map((q) => ({
      text: String(q.text).trim(),
      type: ['mcq', 'true_false', 'short_answer'].includes(q.type) ? q.type : 'mcq',
      options: Array.isArray(q.options) ? q.options.map(String) : [],
      correctAnswer: String(q.correctAnswer).trim(),
      marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
      difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
      chapter: q.chapter || chapter,
      explanation: q.explanation ? String(q.explanation) : ''
    }));
}

async function generateExamQuestions(params) {
  const prompt = buildPrompt(params);
  log.info('Starting AI question generation', {
    subject: params.subject,
    chapter: params.chapter,
    difficulty: params.difficulty,
    count: params.questionCount
  });

  try {
    if (process.env.OPENAI_API_KEY) {
      const aiQuestions = await callOpenAI(prompt);
      const normalized = normalizeQuestions(aiQuestions, params.chapter);
      if (normalized.length > 0) {
        log.info('AI questions generated successfully', { count: normalized.length, provider: 'openai' });
        return { questions: normalized, aiGenerated: true, provider: 'openai' };
      }
      log.warn('OpenAI returned no usable questions; using fallback generator');
    } else {
      log.warn('OPENAI_API_KEY not set; using built-in question generator');
    }
  } catch (error) {
    log.error('AI generation failed; using fallback generator', { error: error.message });
  }

  const questions = fallbackQuestions(params);
  return { questions, aiGenerated: false, provider: 'fallback' };
}

function gradeAnswer(question, studentAnswer) {
  const normalizedStudent = String(studentAnswer || '').trim().toLowerCase();
  const normalizedCorrect = String(question.correctAnswer || '').trim().toLowerCase();

  if (!normalizedStudent) {
    return { isCorrect: false, marksAwarded: 0 };
  }

  if (question.type === 'short_answer') {
    const keywords = normalizedCorrect.split(/\s+/).filter((w) => w.length > 4);
    const matched = keywords.filter((word) => normalizedStudent.includes(word)).length;
    const ratio = keywords.length ? matched / keywords.length : 0;
    if (ratio >= 0.5) {
      return { isCorrect: true, marksAwarded: question.marks };
    }
    return { isCorrect: false, marksAwarded: Math.floor(question.marks * ratio) };
  }

  const isCorrect = normalizedStudent === normalizedCorrect;
  return { isCorrect, marksAwarded: isCorrect ? question.marks : 0 };
}

function calculateGrade(percentage) {
  if (percentage >= 90) return 'A+';
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B+';
  if (percentage >= 60) return 'B';
  if (percentage >= 50) return 'C';
  if (percentage >= 40) return 'D';
  return 'F';
}

module.exports = {
  generateExamQuestions,
  gradeAnswer,
  calculateGrade
};
