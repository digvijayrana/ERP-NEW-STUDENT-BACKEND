/**
 * AI Admission Assistant — rule-based conversational + CRM engine.
 *
 * Capabilities:
 *  - Lead qualification scoring (hot / warm / cold)
 *  - Age-based admission eligibility by class
 *  - Document verification checklist
 *  - FAQ answers
 *  - Fee estimation from FeeStructure
 *  - Interview booking
 *  - Scholarship suggestions
 *  - Dashboard / CRM pipeline / lead analytics
 */
const AdmissionLead = require('../models/AdmissionLead');
const FeeStructure = require('../models/FeeStructure');
const AcademicYear = require('../models/AcademicYear');
const { createLogger } = require('../utils/logger');

const log = createLogger('admission-assistant');

const CLASS_OPTIONS = ['Nursery', 'LKG', 'UKG', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Minimum age (years) typically expected at entry for each class (as of 31 Mar of academic year). */
const MIN_AGE_BY_CLASS = {
  Nursery: 2.5,
  LKG: 3.5,
  UKG: 4.5,
  I: 5.5,
  II: 6.5,
  III: 7.5,
  IV: 8.5,
  V: 9.5,
  VI: 10.5,
  VII: 11.5,
  VIII: 12.5,
  IX: 13.5,
  X: 14.5,
  XI: 15.5,
  XII: 16.5
};

const FAQ = [
  {
    id: 'fees',
    keywords: ['fee', 'fees', 'cost', 'tuition', 'charges', 'how much'],
    question: 'What are the school fees?',
    answer:
      'Fees depend on the class and academic year. Share the class you are applying for and I can estimate admission, registration, tuition and other components from the published fee structure.'
  },
  {
    id: 'documents',
    keywords: ['document', 'documents', 'papers', 'birth', 'aadhaar', 'certificate', 'photo'],
    question: 'Which documents are required for admission?',
    answer:
      'Mandatory: child passport photo and birth certificate. Recommended: Aadhaar. For transfers also bring Transfer Certificate and previous marksheet. Admins verify each document in the CRM checklist.'
  },
  {
    id: 'eligibility',
    keywords: ['eligible', 'eligibility', 'age', 'qualify', 'admission criteria'],
    question: 'What is the age eligibility?',
    answer:
      'Eligibility is based on the child’s age for the applied class (e.g. Nursery ~2.5+, Class I ~5.5+ years as of the academic year). Share date of birth and class and I will check eligibility.'
  },
  {
    id: 'process',
    keywords: ['process', 'steps', 'how to apply', 'admission process', 'procedure'],
    question: 'What is the admission process?',
    answer:
      '1) Share parent & child details  2) Check eligibility  3) Get fee estimate  4) Upload/submit documents  5) Book interview (if required)  6) Scholarship review (if eligible)  7) Confirm admission with the school office.'
  },
  {
    id: 'scholarship',
    keywords: ['scholarship', 'concession', 'discount', 'financial aid', 'waiver'],
    question: 'Are scholarships available?',
    answer:
      'Merit, sibling, and need-based concessions may be available. Tell me about sibling admissions or previous academic performance and I can suggest a scholarship category for the office to review.'
  },
  {
    id: 'interview',
    keywords: ['interview', 'meeting', 'counselling', 'appointment', 'visit', 'book'],
    question: 'Can I book an admission interview?',
    answer:
      'Yes. Share a preferred date/time (e.g. “book interview tomorrow 11am”) after creating your inquiry, and the system will schedule it in our CRM pipeline.'
  },
  {
    id: 'contact',
    keywords: ['contact', 'phone', 'email', 'office', 'timing', 'timing'],
    question: 'How can I contact the school office?',
    answer:
      'Leave your phone number in chat so our admissions team can call you back, or visit the school office during working hours. You can also continue here for fee estimates and eligibility checks.'
  },
  {
    id: 'classes',
    keywords: ['class', 'classes', 'nursery', 'lkg', 'ukg', 'grade', 'std'],
    question: 'Which classes do you offer?',
    answer: `We offer admissions for: ${CLASS_OPTIONS.join(', ')}. Tell me the class and child’s date of birth to check eligibility and fees.`
  }
];

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function ageInYears(dob, asOf = new Date()) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  let years = asOf.getFullYear() - birth.getFullYear();
  const m = asOf.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < birth.getDate())) years -= 1;
  // Keep one decimal for mid-year cutoffs
  const precise =
    (asOf.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.round(precise * 10) / 10;
}

function normalizeClass(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const upper = s.toUpperCase();
  const map = {
    NURSERY: 'Nursery',
    LKG: 'LKG',
    UKG: 'UKG',
    'CLASS 1': 'I',
    'CLASS I': 'I',
    '1': 'I',
    I: 'I',
    'CLASS 2': 'II',
    '2': 'II',
    II: 'II',
    'CLASS 3': 'III',
    '3': 'III',
    III: 'III',
    'CLASS 4': 'IV',
    '4': 'IV',
    IV: 'IV',
    'CLASS 5': 'V',
    '5': 'V',
    V: 'V',
    'CLASS 6': 'VI',
    '6': 'VI',
    VI: 'VI',
    'CLASS 7': 'VII',
    '7': 'VII',
    VII: 'VII',
    'CLASS 8': 'VIII',
    '8': 'VIII',
    VIII: 'VIII',
    'CLASS 9': 'IX',
    '9': 'IX',
    IX: 'IX',
    'CLASS 10': 'X',
    '10': 'X',
    X: 'X',
    'CLASS 11': 'XI',
    '11': 'XI',
    XI: 'XI',
    'CLASS 12': 'XII',
    '12': 'XII',
    XII: 'XII'
  };
  if (map[upper]) return map[upper];
  const found = CLASS_OPTIONS.find((c) => c.toLowerCase() === s.toLowerCase());
  return found || s;
}

function checkEligibility({ dateOfBirth, applyingClass }) {
  const className = normalizeClass(applyingClass);
  const age = ageInYears(dateOfBirth);
  const reasons = [];
  if (!className || !CLASS_OPTIONS.includes(className)) {
    return {
      eligible: false,
      reasons: ['Please choose a valid class (Nursery–XII).'],
      recommendedClass: '',
      ageYears: age
    };
  }
  if (age == null) {
    return {
      eligible: null,
      reasons: ['Share the child’s date of birth to verify age eligibility.'],
      recommendedClass: className,
      ageYears: null
    };
  }
  const minAge = MIN_AGE_BY_CLASS[className] ?? 0;
  const maxAge = minAge + 2.5;
  let eligible = true;
  if (age < minAge - 0.25) {
    eligible = false;
    reasons.push(
      `Child is about ${age} years old; typical minimum for Class ${className} is ~${minAge} years.`
    );
  } else if (age > maxAge) {
    reasons.push(
      `Child is about ${age} years old — slightly above the usual band for Class ${className}. Office may still approve as a transfer.`
    );
  } else {
    reasons.push(`Age (~${age} yrs) fits the usual band for Class ${className}.`);
  }

  // Suggest a better class if clearly off-band
  let recommendedClass = className;
  if (age < minAge - 0.5) {
    const better = CLASS_OPTIONS.find((c) => age >= (MIN_AGE_BY_CLASS[c] || 0) - 0.25);
    if (better) recommendedClass = better;
  }

  return { eligible, reasons, recommendedClass, ageYears: age };
}

function qualifyLead(leadLike) {
  let score = 20;
  const signals = [];

  if (leadLike.parentPhone && /^\d{10}$/.test(leadLike.parentPhone)) {
    score += 15;
    signals.push('Valid parent mobile');
  }
  if (leadLike.parentEmail) {
    score += 8;
    signals.push('Email on file');
  }
  if (leadLike.childName) score += 8;
  if (leadLike.applyingClass) {
    score += 12;
    signals.push(`Applying for ${leadLike.applyingClass}`);
  }
  if (leadLike.dateOfBirth) {
    score += 10;
    signals.push('DOB provided');
  }

  const eligibility = leadLike.eligibility || checkEligibility(leadLike);
  if (eligibility.eligible === true) {
    score += 18;
    signals.push('Age-eligible');
  } else if (eligibility.eligible === false) {
    score -= 20;
    signals.push('Age mismatch');
  }

  const docs = leadLike.documents || [];
  const verified = docs.filter((d) => d.status === 'verified' || d.status === 'submitted').length;
  score += Math.min(verified * 5, 20);
  if (verified >= 2) signals.push(`${verified} documents started`);

  if (leadLike.interview?.status === 'scheduled') {
    score += 10;
    signals.push('Interview booked');
  }
  if (leadLike.scholarship?.suggested) {
    score += 5;
    signals.push('Scholarship candidate');
  }
  if (leadLike.previousSchool) {
    score += 5;
    signals.push('Transfer applicant');
  }

  score = clamp(score);
  let label = 'cold';
  if (score >= 75) label = 'hot';
  else if (score >= 50) label = 'warm';
  else if (eligibility.eligible === false && score < 40) label = 'disqualified';

  return { score, label, signals, eligibility };
}

function suggestScholarship(leadLike) {
  const reasons = [];
  let type = '';
  let percent = 0;

  const age = leadLike.eligibility?.ageYears ?? ageInYears(leadLike.dateOfBirth);
  if (leadLike.tags?.includes('sibling') || /sibling/i.test(leadLike.notes || '')) {
    type = 'Sibling concession';
    percent = 10;
    reasons.push('Sibling already enrolled (or marked as sibling inquiry)');
  }
  if (/merit|topper|olympiad|rank/i.test(leadLike.notes || '')) {
    type = type || 'Merit scholarship';
    percent = Math.max(percent, 15);
    reasons.push('Merit indicators in inquiry notes');
  }
  if (/need|financial|concession|aid|widow|ews/i.test(leadLike.notes || '')) {
    type = type || 'Need-based aid';
    percent = Math.max(percent, 20);
    reasons.push('Need-based keywords detected — subject to office verification');
  }
  if (!type && leadLike.applyingClass && ['IX', 'X', 'XI', 'XII'].includes(normalizeClass(leadLike.applyingClass))) {
    if (age && age >= 14) {
      type = 'Junior excellence (review)';
      percent = 5;
      reasons.push('Senior secondary applicant — may qualify for excellence awards');
    }
  }

  return {
    suggested: percent > 0,
    type,
    percent,
    reasons: reasons.length ? reasons : ['No automatic scholarship signal — office can still offer case-by-case aid']
  };
}

function matchFaq(text) {
  const lower = String(text || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const item of FAQ) {
    let score = 0;
    for (const kw of item.keywords) {
      if (lower.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore > 0 ? best : null;
}

function detectIntent(text) {
  const lower = String(text || '').toLowerCase();
  if (/book|schedule|interview|appointment|counsell/.test(lower)) return 'interview';
  if (/fee|cost|tuition|how much|estimate/.test(lower)) return 'fee';
  if (/eligible|eligibility|age|dob|date of birth|born/.test(lower)) return 'eligibility';
  if (/document|aadhaar|birth certificate|photo|tc\b|marksheet/.test(lower)) return 'documents';
  if (/scholarship|concession|discount|financial/.test(lower)) return 'scholarship';
  if (/my name|i am|parent|child|son|daughter|apply|admission for|interested/.test(lower)) return 'lead_capture';
  if (/status|pipeline|stage|where is my/.test(lower)) return 'status';
  if (/hi|hello|hey|namaste|good morning|good evening|start/.test(lower)) return 'greeting';
  if (matchFaq(lower)) return 'faq';
  return 'general';
}

function extractPhone(text) {
  const m = String(text || '').match(/(?:\+91[-\s]?)?(\d{10})\b/);
  return m ? m[1] : '';
}

function extractEmail(text) {
  const m = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : '';
}

function extractDob(text) {
  const iso = String(text || '').match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = String(text || '').match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  return '';
}

function extractClass(text) {
  const lower = String(text || '').toLowerCase();
  for (const c of CLASS_OPTIONS) {
    if (lower.includes(c.toLowerCase())) return c;
  }
  const m = lower.match(/class\s*([0-9]{1,2}|[ivxlcdm]+)/i);
  if (m) return normalizeClass(m[1]);
  return '';
}

function extractNameAfter(text, patterns) {
  for (const p of patterns) {
    const m = String(text || '').match(p);
    if (m?.[1]) return m[1].trim().replace(/[.,].*$/, '').slice(0, 60);
  }
  return '';
}

async function activeAcademicYear() {
  const year =
    (await AcademicYear.findOne({ status: 'active' }).lean()) ||
    (await AcademicYear.findOne({ isActive: true }).lean());
  return year;
}

async function estimateFees(className, academicYearId) {
  const normalized = normalizeClass(className);
  let yearId = academicYearId;
  let yearDoc = null;
  if (yearId) {
    yearDoc = await AcademicYear.findById(yearId).lean();
  } else {
    yearDoc = await activeAcademicYear();
    yearId = yearDoc?._id;
  }
  if (!yearId || !normalized) {
    return {
      academicYearName: yearDoc?.name || '',
      className: normalized,
      total: 0,
      components: [],
      message: 'Select a class (and ensure an active academic year) to estimate fees.'
    };
  }

  const structure = await FeeStructure.findOne({
    academicYear: yearId,
    className: normalized,
    status: 'active'
  }).lean();

  const components = (structure?.components || []).map((c) => ({
    key: c.key,
    label: c.label,
    amount: c.amount,
    frequency: c.frequency,
    newAdmissionOnly: !!c.newAdmissionOnly
  }));
  const total = components.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

  return {
    academicYearName: yearDoc?.name || '',
    className: normalized,
    total,
    components,
    message: components.length
      ? `Estimated fee for Class ${normalized} (${yearDoc?.name || 'current year'}): ₹${total.toLocaleString('en-IN')}.`
      : `No fee structure published yet for Class ${normalized}. Please contact the school office.`
  };
}

async function nextLeadCode() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = await AdmissionLead.countDocuments({
    createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
  });
  return `AL-${stamp}-${String(count + 1).padStart(3, '0')}`;
}

async function upsertLeadFromChat(sessionId, patch = {}) {
  let lead = await AdmissionLead.findOne({ chatSessionId: sessionId });
  if (!lead) {
    lead = new AdmissionLead({
      leadCode: await nextLeadCode(),
      chatSessionId: sessionId,
      parentName: patch.parentName || 'Parent',
      childName: patch.childName || 'Child',
      parentPhone: patch.parentPhone || undefined,
      source: 'chatbot',
      stage: 'new'
    });
  }
  Object.assign(lead, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== '')));
  if (patch.parentPhone && /^\d{10}$/.test(patch.parentPhone)) lead.parentPhone = patch.parentPhone;
  else if (patch.parentPhone === '') lead.parentPhone = undefined;
  if (patch.dateOfBirth) lead.dateOfBirth = new Date(patch.dateOfBirth);
  if (patch.applyingClass) lead.applyingClass = normalizeClass(patch.applyingClass);

  const eligibility = checkEligibility(lead);
  lead.eligibility = eligibility;
  const qualification = qualifyLead(lead);
  lead.qualificationScore = qualification.score;
  lead.qualificationLabel = qualification.label;
  lead.scholarship = suggestScholarship(lead);
  lead.lastActivityAt = new Date();

  if (lead.applyingClass) {
    try {
      lead.feeEstimate = await estimateFees(lead.applyingClass, lead.academicYear);
    } catch (err) {
      log.warn('Fee estimate failed', { err: err.message });
    }
  }

  // Auto-advance stage based on signals
  if (lead.stage === 'new' && (lead.parentPhone || lead.parentEmail) && lead.applyingClass) {
    lead.stage = 'contacted';
  }
  if (['new', 'contacted'].includes(lead.stage) && qualification.label === 'hot') {
    lead.stage = 'qualified';
  }
  if (eligibility.eligible === true && lead.stage === 'contacted') {
    lead.stage = 'qualified';
  }

  await lead.save();
  return lead;
}

function documentSummary(lead) {
  const docs = lead.documents || [];
  const missing = docs.filter((d) => d.status === 'missing').map((d) => d.label);
  const submitted = docs.filter((d) => d.status === 'submitted' || d.status === 'verified');
  return {
    total: docs.length,
    missing,
    submittedCount: submitted.length,
    verifiedCount: docs.filter((d) => d.status === 'verified').length,
    message: missing.length
      ? `Pending documents: ${missing.join(', ')}.`
      : 'All listed documents are marked submitted/verified.'
  };
}

/**
 * Conversational turn for the landing-page chatbot.
 */
async function chat({ sessionId, message, context = {} }) {
  const text = String(message || '').trim();
  if (!text) {
    return {
      reply: 'Please type a message — ask about fees, eligibility, documents, scholarships, or say “I want admission for Class V”.',
      intent: 'empty',
      suggestions: ['Fee estimate for Class I', 'Check eligibility', 'Required documents', 'Book interview']
    };
  }

  const intent = detectIntent(text);
  const phone = extractPhone(text) || context.parentPhone || '';
  const email = extractEmail(text) || context.parentEmail || '';
  const dob = extractDob(text) || context.dateOfBirth || '';
  const className = extractClass(text) || context.applyingClass || '';
  const parentName =
    extractNameAfter(text, [/parent(?:'s)? name is ([a-zA-Z .]+)/i, /i am ([a-zA-Z .]+)/i, /my name is ([a-zA-Z .]+)/i]) ||
    context.parentName ||
    '';
  const childName =
    extractNameAfter(text, [/child(?:'s)? name is ([a-zA-Z .]+)/i, /(?:son|daughter)(?:'s)? name is ([a-zA-Z .]+)/i, /for ([a-zA-Z .]+) admission/i]) ||
    context.childName ||
    '';

  const patch = {};
  if (phone) patch.parentPhone = phone;
  if (email) patch.parentEmail = email;
  if (dob) patch.dateOfBirth = dob;
  if (className) patch.applyingClass = className;
  if (parentName) patch.parentName = parentName;
  if (childName) patch.childName = childName;
  if (/sibling/i.test(text)) {
    patch.tags = ['sibling'];
    patch.notes = (context.notes || '') + ' Sibling inquiry.';
  }

  let lead = null;
  try {
    lead = await upsertLeadFromChat(sessionId, patch);
    lead.chatHistory = [
      ...(lead.chatHistory || []).slice(-40),
      { role: 'user', text, intent, createdAt: new Date() }
    ];
  } catch (err) {
    log.warn('Lead upsert skipped', { err: err.message });
  }

  let reply = '';
  let data = {};
  const suggestions = [];

  switch (intent) {
    case 'greeting':
      reply =
        'Hello! I’m the AI Admission Assistant. I can check eligibility, estimate fees, list documents, suggest scholarships, and book an interview. How can I help?';
      suggestions.push('Fee for Class V', 'Eligibility check', 'Documents needed', 'Book interview');
      break;

    case 'fee': {
      const targetClass = className || lead?.applyingClass || context.applyingClass;
      const estimate = await estimateFees(targetClass);
      data.feeEstimate = estimate;
      reply = estimate.message;
      if (estimate.components?.length) {
        reply +=
          '\n\n' +
          estimate.components
            .map((c) => `• ${c.label}: ₹${Number(c.amount).toLocaleString('en-IN')} (${c.frequency})`)
            .join('\n');
      }
      suggestions.push('Check eligibility', 'Required documents', 'Scholarship help');
      break;
    }

    case 'eligibility': {
      const payload = {
        dateOfBirth: dob || lead?.dateOfBirth,
        applyingClass: className || lead?.applyingClass
      };
      const result = checkEligibility(payload);
      data.eligibility = result;
      reply = result.reasons.join(' ');
      if (result.recommendedClass && result.recommendedClass !== normalizeClass(payload.applyingClass)) {
        reply += ` Suggested class: ${result.recommendedClass}.`;
      }
      suggestions.push('Estimate fees', 'Book interview', 'Documents needed');
      break;
    }

    case 'documents': {
      const summary = lead ? documentSummary(lead) : null;
      reply =
        'For new admissions we need: passport photo (mandatory), birth certificate (mandatory), Aadhaar (recommended). Transfers also need TC and previous marksheet.';
      if (summary) reply += ` ${summary.message}`;
      data.documents = summary;
      suggestions.push('Fee estimate', 'Book interview');
      break;
    }

    case 'scholarship': {
      const scholarship = suggestScholarship(lead || { notes: text, applyingClass: className, tags: patch.tags });
      data.scholarship = scholarship;
      if (lead) {
        lead.scholarship = scholarship;
        if (scholarship.suggested && lead.stage === 'qualified') lead.stage = 'scholarship_review';
        await lead.save();
      }
      reply = scholarship.suggested
        ? `Suggested: ${scholarship.type} (~${scholarship.percent}%). ${scholarship.reasons.join(' ')} Final approval is by the school office.`
        : scholarship.reasons.join(' ');
      suggestions.push('Fee estimate', 'Book interview');
      break;
    }

    case 'interview': {
      const whenMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/) || text.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\b/);
      let scheduledAt = null;
      if (whenMatch) {
        const raw = whenMatch[1];
        scheduledAt = raw.includes('-') && raw.length === 10 ? new Date(raw) : new Date(extractDob(raw));
      } else if (/tomorrow/i.test(text)) {
        scheduledAt = new Date();
        scheduledAt.setDate(scheduledAt.getDate() + 1);
        scheduledAt.setHours(11, 0, 0, 0);
      } else if (/today/i.test(text)) {
        scheduledAt = new Date();
        scheduledAt.setHours(scheduledAt.getHours() + 2, 0, 0, 0);
      } else {
        scheduledAt = new Date();
        scheduledAt.setDate(scheduledAt.getDate() + 2);
        scheduledAt.setHours(11, 0, 0, 0);
      }

      if (lead) {
        lead.interview = {
          scheduledAt,
          mode: /online|zoom|google meet/i.test(text) ? 'online' : 'in_person',
          status: 'scheduled',
          notes: text
        };
        lead.stage = 'interview_scheduled';
        await lead.save();
        data.interview = lead.interview;
        reply = `Interview booked for ${scheduledAt.toLocaleString('en-IN')} (${lead.interview.mode.replace('_', ' ')}). Lead ${lead.leadCode} is now in the interview stage. Our team will confirm.`;
      } else {
        reply = `I can pencil ${scheduledAt.toLocaleString('en-IN')} — please also share parent name, phone and child class so we can save the booking.`;
      }
      suggestions.push('Fee estimate', 'Documents needed');
      break;
    }

    case 'lead_capture': {
      reply =
        'Thanks — I’ve started your admission inquiry. ' +
        (lead?.leadCode ? `Reference: ${lead.leadCode}. ` : '') +
        'You can ask for fee estimate, eligibility, documents, scholarship, or book an interview anytime.';
      if (lead) {
        data.lead = {
          leadCode: lead.leadCode,
          stage: lead.stage,
          qualificationLabel: lead.qualificationLabel,
          qualificationScore: lead.qualificationScore
        };
      }
      suggestions.push('Estimate fees', 'Check eligibility', 'Book interview');
      break;
    }

    case 'faq': {
      const faq = matchFaq(text);
      reply = faq?.answer || 'Please ask about fees, eligibility, documents, scholarships, or the admission process.';
      suggestions.push('Fee estimate', 'Documents', 'Eligibility');
      break;
    }

    case 'status': {
      if (lead) {
        reply = `Your inquiry ${lead.leadCode} is at stage “${lead.stage}” (qualification: ${lead.qualificationLabel || 'n/a'}, score ${lead.qualificationScore}).`;
        data.lead = { leadCode: lead.leadCode, stage: lead.stage, qualificationLabel: lead.qualificationLabel };
      } else {
        reply = 'I don’t have an inquiry yet. Share parent phone + child class to open a lead.';
      }
      break;
    }

    default: {
      const faq = matchFaq(text);
      if (faq) {
        reply = faq.answer;
      } else {
        reply =
          'I can help with lead qualification, eligibility, documents, fee estimation, scholarship suggestions, and interview booking. Try: “Fee for Class III” or “Check eligibility DOB 2018-04-12 Class I”.';
      }
      suggestions.push('Fee for Class I', 'Required documents', 'Book interview', 'Scholarship');
    }
  }

  if (lead) {
    lead.chatHistory = [
      ...(lead.chatHistory || []).slice(-40),
      { role: 'assistant', text: reply, intent, createdAt: new Date() }
    ];
    await lead.save();
    data.leadCode = lead.leadCode;
    data.stage = lead.stage;
    data.qualification = {
      score: lead.qualificationScore,
      label: lead.qualificationLabel
    };
  }

  return { reply, intent, suggestions, data };
}

async function listLeads({ stage, q, limit = 100 } = {}) {
  const filter = {};
  if (stage) filter.stage = stage;
  if (q) {
    const regex = new RegExp(String(q).trim(), 'i');
    filter.$or = [
      { parentName: regex },
      { childName: regex },
      { parentPhone: regex },
      { leadCode: regex },
      { applyingClass: regex }
    ];
  }
  return AdmissionLead.find(filter).sort({ lastActivityAt: -1 }).limit(Math.min(Number(limit) || 100, 300)).lean();
}

async function pipelineBoard() {
  const stages =
    AdmissionLead.PIPELINE_STAGES ||
    require('../models/AdmissionLead').PIPELINE_STAGES || [
      'new',
      'contacted',
      'qualified',
      'documents_pending',
      'interview_scheduled',
      'scholarship_review',
      'converted',
      'lost'
    ];
  const leads = await AdmissionLead.find({})
    .sort({ lastActivityAt: -1 })
    .limit(300)
    .lean();

  const columns = stages.map((stage) => ({
    stage,
    label: stage.replace(/_/g, ' '),
    leads: leads.filter((l) => l.stage === stage)
  }));

  return { columns, total: leads.length };
}

async function analytics() {
  const leads = await AdmissionLead.find({}).lean();
  const byStage = {};
  const bySource = {};
  const byClass = {};
  const byQualification = { hot: 0, warm: 0, cold: 0, disqualified: 0 };
  let interviews = 0;
  let scholarships = 0;
  let converted = 0;

  const now = new Date();
  const trendMap = new Map();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    trendMap.set(key, { label: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }), leads: 0, converted: 0 });
  }

  for (const lead of leads) {
    byStage[lead.stage] = (byStage[lead.stage] || 0) + 1;
    bySource[lead.source] = (bySource[lead.source] || 0) + 1;
    if (lead.applyingClass) byClass[lead.applyingClass] = (byClass[lead.applyingClass] || 0) + 1;
    if (lead.qualificationLabel) byQualification[lead.qualificationLabel] = (byQualification[lead.qualificationLabel] || 0) + 1;
    if (lead.interview?.status === 'scheduled' || lead.interview?.status === 'completed') interviews += 1;
    if (lead.scholarship?.suggested) scholarships += 1;
    if (lead.stage === 'converted') converted += 1;

    const created = new Date(lead.createdAt);
    const key = `${created.getFullYear()}-${created.getMonth() + 1}`;
    if (trendMap.has(key)) {
      const bucket = trendMap.get(key);
      bucket.leads += 1;
      if (lead.stage === 'converted') bucket.converted += 1;
    }
  }

  const conversionRate = leads.length ? Math.round((converted / leads.length) * 100) : 0;

  return {
    totals: {
      leads: leads.length,
      hot: byQualification.hot || 0,
      warm: byQualification.warm || 0,
      interviews,
      scholarships,
      converted,
      conversionRate
    },
    byStage,
    bySource,
    byClass,
    byQualification,
    trend: [...trendMap.values()]
  };
}

async function dashboard() {
  const [board, stats, recent] = await Promise.all([
    pipelineBoard(),
    analytics(),
    AdmissionLead.find({}).sort({ lastActivityAt: -1 }).limit(12).lean()
  ]);
  return {
    generatedAt: new Date().toISOString(),
    summary: stats.totals,
    pipeline: board,
    analytics: stats,
    recentLeads: recent,
    classOptions: CLASS_OPTIONS
  };
}

module.exports = {
  CLASS_OPTIONS,
  FAQ,
  chat,
  checkEligibility,
  qualifyLead,
  suggestScholarship,
  estimateFees,
  upsertLeadFromChat,
  listLeads,
  pipelineBoard,
  analytics,
  dashboard,
  documentSummary,
  detectIntent,
  normalizeClass
};
