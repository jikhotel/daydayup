// 答题记录存储：quiz_sessions / quiz_questions 直查（云 SDK）。
// owner_id 由服务端默认值与 RLS 决定，客户端一律不传。
const { cloud } = require('./cloud');

function safely(executor) {
    return Promise.resolve()
        .then(executor)
        .then((result) => ({ data: Array.isArray(result && result.data) ? result.data : (result && result.data) || null, error: result && result.error ? result.error : null }))
        .catch((error) => ({ data: null, error: { code: 'CLIENT_EXCEPTION', message: error && error.message ? error.message : '' } }));
}

const SESSION_COLUMNS = 'id, subject, textbook, question_type, question_count, prompt, source, started_at, submitted_at, duration_sec, total_count, correct_count, created_at';
const QUESTION_COLUMNS = 'id, session_id, q_index, type, stem, options, answer, analysis, knowledge_point, user_answer, is_correct, subject, textbook, accepts, mastered, created_at';

function mapSession(row) {
    if (!row) return null;
    return {
        id: row.id,
        subject: row.subject,
        textbook: row.textbook,
        questionType: row.question_type,
        questionCount: row.question_count,
        prompt: row.prompt || '',
        source: row.source || 'bank',
        startedAt: row.started_at,
        submittedAt: row.submitted_at || null,
        durationSec: row.duration_sec || 0,
        totalCount: row.total_count || 0,
        correctCount: row.correct_count || 0,
        createdAt: row.created_at,
    };
}

function parseList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

function mapQuestion(row) {
    if (!row) return null;
    return {
        id: row.id,
        sessionId: row.session_id,
        index: row.q_index,
        type: row.type,
        stem: row.stem,
        options: parseList(row.options),
        answer: row.answer,
        analysis: row.analysis || '',
        knowledgePoint: row.knowledge_point || '',
        subject: row.subject || '',
        textbook: row.textbook || '',
        accepts: parseList(row.accepts),
        userAnswer: row.user_answer || '',
        isCorrect: row.is_correct,
        mastered: row.mastered === true,
        createdAt: row.created_at,
    };
}

function createSession(payload) {
    const row = {
        subject: payload.subject,
        textbook: payload.textbook || '',
        question_type: payload.questionType,
        question_count: payload.questionCount,
        prompt: payload.prompt || '',
        source: payload.source || 'bank',
    };
    return safely(async () => {
        const res = await cloud.database.from('quiz_sessions').insert(row).select(SESSION_COLUMNS);
        return { data: res.data && res.data[0] ? mapSession(res.data[0]) : null, error: res.error };
    });
}

function updateSession(id, patch) {
    const row = {};
    if (patch.submittedAt !== undefined) row.submitted_at = patch.submittedAt;
    if (patch.durationSec !== undefined) row.duration_sec = patch.durationSec;
    if (patch.totalCount !== undefined) row.total_count = patch.totalCount;
    if (patch.correctCount !== undefined) row.correct_count = patch.correctCount;
    return safely(async () => {
        const res = await cloud.database.from('quiz_sessions').update(row).eq('id', id).select(SESSION_COLUMNS);
        return { data: res.data && res.data[0] ? mapSession(res.data[0]) : null, error: res.error };
    });
}

function getSession(id) {
    return safely(async () => {
        const res = await cloud.database.from('quiz_sessions').select(SESSION_COLUMNS).eq('id', id).maybeSingle();
        return { data: res.data ? mapSession(res.data) : null, error: res.error };
    });
}

function listSessions(limit) {
    return safely(async () => {
        const res = await cloud.database.from('quiz_sessions').select(SESSION_COLUMNS)
            .order('created_at', { ascending: false }).limit(limit || 50);
        return { data: (res.data || []).map(mapSession), error: res.error };
    });
}

function createQuestions(sessionId, questions, meta) {
    const info = meta || {};
    const rows = questions.map((q, i) => ({
        session_id: sessionId,
        q_index: i + 1,
        type: q.type,
        stem: q.stem,
        options: Array.isArray(q.options) ? JSON.stringify(q.options) : '',
        answer: q.answer,
        analysis: q.analysis || '',
        knowledge_point: q.knowledgePoint || '',
        subject: info.subject || '',
        textbook: info.textbook || '',
        accepts: Array.isArray(q.accepts) ? JSON.stringify(q.accepts) : '',
    }));
    return safely(async () => {
        const res = await cloud.database.from('quiz_questions').insert(rows).select(QUESTION_COLUMNS);
        return { data: (res.data || []).map(mapQuestion), error: res.error };
    });
}

function listQuestions(sessionId) {
    return safely(async () => {
        const res = await cloud.database.from('quiz_questions').select(QUESTION_COLUMNS)
            .eq('session_id', sessionId).order('q_index', { ascending: true });
        return { data: (res.data || []).map(mapQuestion), error: res.error };
    });
}

function updateQuestionAnswer(id, userAnswer, isCorrect) {
    return safely(async () => {
        const res = await cloud.database.from('quiz_questions')
            .update({ user_answer: userAnswer, is_correct: isCorrect })
            .eq('id', id)
            .select(QUESTION_COLUMNS);
        return { data: res.data && res.data[0] ? mapQuestion(res.data[0]) : null, error: res.error };
    });
}

// 错题本：做错过的题。
function listMistakes(subject) {
    return safely(async () => {
        let query = cloud.database.from('quiz_questions').select(QUESTION_COLUMNS).eq('is_correct', false);
        if (subject) query = query.eq('subject', subject);
        const res = await query.order('created_at', { ascending: false }).limit(200);
        return { data: (res.data || []).map(mapQuestion), error: res.error };
    });
}

// 标记/取消错题「已掌握」。
function setMistakeMastered(id, mastered) {
    return safely(async () => {
        const res = await cloud.database.from('quiz_questions')
            .update({ mastered: mastered === true })
            .eq('id', id)
            .select(QUESTION_COLUMNS);
        return { data: res.data && res.data[0] ? mapQuestion(res.data[0]) : null, error: res.error };
    });
}

module.exports = {
    createSession,
    updateSession,
    getSession,
    listSessions,
    createQuestions,
    listQuestions,
    updateQuestionAnswer,
    listMistakes,
    setMistakeMastered,
    mapQuestion,
};
