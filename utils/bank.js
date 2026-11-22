// 云端统一题库（question_bank）：学科定义、按范围/题型/来源抽题、AI 题回写。
// 题库数据源 cn-math-taxonomy（16413 题，grade: 7-9=初中 10-12=高中）。
const { cloud } = require('./cloud');

// 内置 9 科（无"科学"——小学综合科不在需求内）。
const SUBJECTS = [
    { code: 'math', name: '数学', icon: '🧮', color: '#3a7afe' },
    { code: 'chinese', name: '语文', icon: '📖', color: '#eb5757' },
    { code: 'english', name: '英语', icon: '🔤', color: '#22b07d' },
    { code: 'physics', name: '物理', icon: '🔭', color: '#9b51e0' },
    { code: 'chemistry', name: '化学', icon: '🧪', color: '#00b8d4' },
    { code: 'biology', name: '生物', icon: '🌱', color: '#27ae60' },
    { code: 'geography', name: '地理', icon: '🌍', color: '#f2994a' },
    { code: 'history', name: '历史', icon: '🏛️', color: '#b9770e' },
    { code: 'politics', name: '政治', icon: '⚖️', color: '#5d6d7e' },
];

// 年级（题库 grade 字段语义：7-9=初一~初三，10-12=高一~高三）。逐级可选 + 全部。
const GRADES = [
    { key: 'g7', name: '初一', min: 7, max: 7 },
    { key: 'g8', name: '初二', min: 8, max: 8 },
    { key: 'g9', name: '初三', min: 9, max: 9 },
    { key: 'g10', name: '高一', min: 10, max: 10 },
    { key: 'g11', name: '高二', min: 11, max: 11 },
    { key: 'g12', name: '高三', min: 12, max: 12 },
    { key: 'all', name: '全部（初一~高三）', min: 7, max: 12 },
];
const GRADE_ALL = GRADES[GRADES.length - 1];

// 教材版本（题库无版本字段，版本用于 AI 出题语境与试卷页眉）。
const PUBLISHERS = ['人教版', '北师大版', '苏教版', '外研版', '译林版', '自定义'];

// 来源约定：taxonomy = 原始题库；ai = AI 生成积累。后续新题库在此注册。
const SOURCES = [
    { key: 'taxonomy', name: '原始题库', desc: 'cn-math-taxonomy 各学科题库' },
    { key: 'ai', name: 'AI 生成', desc: '出题时 AI 生成并自动积累' },
];

function safely(executor) {
    return Promise.resolve()
        .then(executor)
        .then((result) => ({ data: result && result.data !== undefined ? result.data : null, error: result && result.error ? result.error : null }))
        .catch((error) => ({ data: null, error: { code: 'CLIENT_EXCEPTION', message: error && error.message ? error.message : '' } }));
}

function parseList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

// 题库行 -> 应用答题格式（choice→single、numeric→blank、short→solve 解答题）。
function toAppQuestion(row) {
    const choices = parseList(row.choices);
    let type = row.type;
    if (type === 'choice') type = 'single';
    if (type === 'numeric') type = 'blank';
    if (type === 'short') type = 'solve';
    return {
        type,
        stem: row.prompt,
        options: choices.map((c) => (c && c.text !== undefined ? String(c.text) : String(c))),
        answer: String(row.answer || ''),
        accepts: parseList(row.accepts),
        knowledgePoint: row.knowledge_point || row.topic_name || '',
        analysis: row.explanation || '',
        subject: row.subject,
        bankId: row.id,
        source: row.source,
        poem: row.topic_name || '',
    };
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

// 应用题型 -> 题库题型：single→choice，multi→multi（AI 积累行），judge→judge（AI 积累行），
// blank→numeric，solve→short。
function appTypesToBankTypes(types) {
    const set = new Set();
    (types || []).forEach((t) => {
        if (t === 'single') set.add('choice');
        if (t === 'multi') set.add('multi');
        if (t === 'judge') set.add('judge');
        if (t === 'blank') set.add('numeric');
        if (t === 'solve') set.add('short');
    });
    return Array.from(set);
}
const ALL_BANK_TYPES = ['choice', 'multi', 'judge', 'numeric', 'short'];

// 某学科云端题量（不过滤 grade：包含 AI 积累的 grade=null 题）。
function countBySubject(code) {
    return safely(async () => {
        const res = await cloud.database.from('question_bank')
            .select('subject', { count: 'exact', head: true })
            .eq('subject', code);
        return { data: { total: (res && res.count) || 0 }, error: null };
    });
}

// 某学科知识点列表（topic_name 去重，用于出题范围选择；不过滤 grade 以含 AI 积累题）。
function listTopics(code) {
    return safely(async () => {
        const res = await cloud.database.from('question_bank')
            .select('topic_name')
            .eq('subject', code)
            .limit(1000);
        if (res.error) throw res.error;
        const seen = {};
        const topics = [];
        (res.data || []).forEach((r) => {
            const t = r.topic_name || '';
            if (t && !seen[t]) { seen[t] = true; topics.push(t); }
        });
        return { data: topics.sort(), error: null };
    });
}

// 抽题：subject + 年级区间 + 知识点范围（可多选）+ 来源（可多选）+ 题型。
function drawQuestions(config) {
    const cfg = config || {};
    const subject = cfg.subject;
    const sources = Array.isArray(cfg.sources) && cfg.sources.length > 0 ? cfg.sources : SOURCES.map((s) => s.key);
    const count = Math.max(1, Math.min(40, Number(cfg.count) || 10));
    const grade = GRADES.find((g) => g.key === cfg.grade) || GRADE_ALL;
    const topics = Array.isArray(cfg.topics) ? cfg.topics.filter(Boolean) : [];
    const bankTypes = appTypesToBankTypes(cfg.types);
    return safely(async () => {
        let query = cloud.database.from('question_bank')
            .select('id, source, subject, topic_id, topic_name, type, difficulty, prompt, choices, answer, accepts, explanation, knowledge_point')
            .eq('subject', subject)
            .in('source', sources)
            .in('type', bankTypes.length > 0 ? bankTypes : ALL_BANK_TYPES);
        // 「全部」年级不过滤 grade：AI 回写的题 grade 为 null，过滤会把它们全部排除
        if (grade.key !== 'all') {
            query = query.gte('grade', grade.min).lte('grade', grade.max);
        }
        if (topics.length > 0) query = query.in('topic_name', topics);
        const res = await query.limit(300);
        if (res.error) throw res.error;
        const pool = shuffle(res.data || []).slice(0, count);
        return { data: pool.map(toAppQuestion), error: null };
    });
}

// djb2 哈希：AI 题确定性 id 去重。
function hashId(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
        h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
}

// AI 生成的题回写题库（source='ai'，幂等去重）。
function saveGeneratedToBank(subject, questions) {
    const rows = (questions || []).map((q) => ({
        id: 'ai_' + hashId(subject + '|' + q.stem),
        source: 'ai',
        subject,
        topic_id: '',
        topic_name: q.knowledgePoint || '',
        grade: null,
        type: q.type === 'single' ? 'choice'
            : (q.type === 'multi' ? 'multi'
                : (q.type === 'judge' ? 'judge'
                    : (q.type === 'solve' ? 'short' : 'numeric'))),
        difficulty: 'basic',
        prompt: q.stem,
        choices: Array.isArray(q.options) && q.options.length > 0
            ? JSON.stringify(q.options.map((text, i) => ({ key: ['A', 'B', 'C', 'D', 'E', 'F'][i] || String(i), text })))
            : '',
        answer: q.answer || '',
        accepts: Array.isArray(q.accepts) && q.accepts.length > 0 ? JSON.stringify(q.accepts) : '',
        explanation: q.analysis || '',
        knowledge_point: q.knowledgePoint || '',
    })).filter((r) => r.prompt);
    if (rows.length === 0) return Promise.resolve({ data: { saved: 0 }, error: null });
    return safely(async () => {
        const res = await cloud.database.from('question_bank')
            .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
        return { data: { saved: rows.length }, error: res ? res.error : null };
    });
}

module.exports = {
    SUBJECTS,
    GRADES,
    GRADE_ALL,
    PUBLISHERS,
    SOURCES,
    countBySubject,
    listTopics,
    drawQuestions,
    appTypesToBankTypes,
    saveGeneratedToBank,
    toAppQuestion,
};
