const { createLogger } = require('../utils/logger');
const { DEFAULTS, EXAM } = require('../constants');

const log = createLogger('ai-exam');

const DIFFICULTY_HINTS = {
  easy: 'basic recall and definitions suitable for beginners',
  medium: 'application and understanding of core concepts',
  hard: 'analysis, multi-step reasoning, and higher-order thinking'
};

const PDF_CONTENT_LIMIT = 8000;

function buildPrompt({ subject, chapter, bookReference, difficulty, questionCount, additionalContext, pdfContent }) {
  const levelHint = DIFFICULTY_HINTS[difficulty] || DIFFICULTY_HINTS.medium;

  let pdfSection = '';
  if (pdfContent) {
    const truncated = pdfContent.slice(0, PDF_CONTENT_LIMIT);
    pdfSection = `\nThe following is the content from the chapter PDF. Base your questions ONLY on this content:\n---\n${truncated}\n---\n`;
  }

  return `You are an expert school teacher creating a unit test.

Subject: ${subject}
Chapter: ${chapter}
Book: ${bookReference || 'standard school textbook'}
Difficulty: ${difficulty} (${levelHint})
Number of questions: ${questionCount}
${additionalContext ? `Additional context: ${additionalContext}` : ''}
${pdfSection}
IMPORTANT RULES:
- Each question must be unique and test a different concept or skill.
- Do not repeat similar question patterns or test the same knowledge point twice.
- Vary question types: include MCQs, true/false, and short answer questions.
- All questions must be directly related to the specified chapter and book.
- Questions should test concepts that would be covered in this chapter of this textbook.
- Do not include questions from other chapters or unrelated topics.
- Frame questions using terminology and examples from the specified book.

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
  const count = Math.min(Math.max(questionCount, EXAM.MIN_QUESTIONS), EXAM.MAX_QUESTIONS);
  const questions = [];
  const allTypes = ['mcq', 'true_false', 'short_answer'];
  const bookLabel = bookReference || 'the textbook';

  const tfTemplates = [
    { text: `True or False: "${chapter}" is a chapter covered in ${subject} (${bookLabel}).`, answer: 'True', explanation: `Checks awareness of the ${chapter} syllabus.` },
    { text: `True or False: The concepts in "${chapter}" are unrelated to ${subject}.`, answer: 'False', explanation: `${chapter} is directly part of the ${subject} curriculum.` },
    { text: `True or False: A student studying ${subject} should understand the key ideas from "${chapter}".`, answer: 'True', explanation: `${chapter} is a core topic in ${subject}.` }
  ];

  const saTemplates = [
    { text: `Explain a key concept from "${chapter}" in ${subject} in 2-3 sentences.`, explanation: 'Open-ended; teacher may review manually.' },
    { text: `What is the main learning objective of "${chapter}" in ${subject}?`, explanation: 'Tests understanding of the chapter purpose.' },
    { text: `Describe how the ideas in "${chapter}" connect to real-world applications in ${subject}.`, explanation: 'Assesses practical understanding.' },
    { text: `Summarize the most important terminology introduced in "${chapter}" (${subject}).`, explanation: 'Tests vocabulary recall for the chapter.' }
  ];

  const mcqTemplates = [
    { text: `Which of the following best describes a core concept from "${chapter}" in ${subject}?`, correct: `A key idea from ${chapter}` },
    { text: `What is the primary focus of "${chapter}" in ${subject} (${bookLabel})?`, correct: `The main topic covered in ${chapter}` },
    { text: `Which statement about "${chapter}" in ${subject} is correct?`, correct: `An accurate fact from ${chapter}` },
    { text: `A student studying "${chapter}" in ${subject} should be able to:`, correct: `Demonstrate understanding of ${chapter} concepts` },
    { text: `Which example best illustrates a principle from "${chapter}" in ${subject}?`, correct: `A relevant example from ${chapter}` }
  ];

  let tfIdx = 0;
  let saIdx = 0;
  let mcqIdx = 0;

  for (let i = 0; i < count; i += 1) {
    const type = allTypes[i % allTypes.length];
    const qDifficulty = difficulty === 'mixed'
      ? ['easy', 'medium', 'hard'][i % 3]
      : difficulty;

    if (type === 'true_false') {
      const tpl = tfTemplates[tfIdx % tfTemplates.length];
      tfIdx += 1;
      questions.push({
        text: tpl.text,
        type: 'true_false',
        options: ['True', 'False'],
        correctAnswer: tpl.answer,
        marks: 1,
        difficulty: qDifficulty,
        chapter,
        explanation: tpl.explanation
      });
    } else if (type === 'short_answer') {
      const tpl = saTemplates[saIdx % saTemplates.length];
      saIdx += 1;
      questions.push({
        text: tpl.text,
        type: 'short_answer',
        options: [],
        correctAnswer: `A valid explanation of a core idea from ${chapter} in ${subject}.`,
        marks: 2,
        difficulty: qDifficulty,
        chapter,
        explanation: tpl.explanation
      });
    } else {
      const tpl = mcqTemplates[mcqIdx % mcqTemplates.length];
      mcqIdx += 1;
      const options = [
        tpl.correct,
        `A concept from a different chapter`,
        `An unrelated idea outside ${subject}`,
        `A common misconception about ${chapter}`
      ];
      questions.push({
        text: tpl.text,
        type: 'mcq',
        options,
        correctAnswer: options[0],
        marks: 1,
        difficulty: qDifficulty,
        chapter,
        explanation: `The correct option reflects the intended learning outcome for ${chapter}.`
      });
    }
  }

  return questions;
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || DEFAULTS.OPENAI_MODEL;
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: EXAM.AI_TEMPERATURE,
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
    count: params.questionCount,
    hasPdfContent: Boolean(params.pdfContent)
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
