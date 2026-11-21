// AI 一句话出题 + 判分（云 LLM，流式 JSON）。
const { cloud } = require('./cloud');

const TYPE_LABELS = {
    single: '单项选择题（只有一个正确答案）',
    multi: '多项选择题（有两个或两个以上正确答案）',
    judge: '判断题（答案只能是对 或 错）',
    blank: '填空题（答案为简短文本）',
};

// 题目 JSON 的结构约束，写进 system，防止被用户输入改写。
const SYSTEM_PROMPT = [
    '你是一位严谨的学科出题老师，按用户给定的教材版本、范围、题型和题量出题。',
    '用户可能提出额外要求（如古文翻译、计算过程、易错点等），请在题目与解析中体现。',
    '只输出一个 JSON 对象，不要输出任何解释、Markdown 或代码块标记。',
    'JSON 结构固定为：{"questions":[{"type":"题型","stem":"题干","options":["选项A","选项B",...],"answer":"答案","analysis":"简短解析","knowledgePoint":"考查的知识点"}]}。',
    '规则：',
    '1. options 只在选择题（单选/多选）时填写字符串数组；判断题和填空题的 options 必须是空数组 []。',
    '2. 单选题 answer 填正确选项字母，如 "B"；多选题 answer 填多个字母用英文逗号分隔，如 "A,C,D"，且至少两个。',
    '3. 判断题 answer 只能是 "对" 或 "错"；填空题 answer 填简短标准答案文本。',
    '4. stem/options 里的选项字母要与 options 数组顺序对应（A 对应第 1 项，B 对应第 2 项）。',
    '5. analysis 一句话说明为什么，knowledgePoint 用简短短语点明知识点。',
    '6. 题目之间不要重复，难度适中，题干清晰。',
    '7. 严格输出合法 JSON，字符串里的引号要正确转义。',
].join('\n');

let cachedModel = null;

async function pickModel() {
    if (cachedModel) return cachedModel;
    const models = await cloud.llm.models.list();
    if (!models || models.length === 0) return null;
    const usable = models.filter((m) => m.disabled !== true && m.enabled !== false);
    const preferred = usable.find((m) => m.id === 'auto')
        || usable.find((m) => typeof m.id === 'string' && m.id.indexOf('flash') >= 0)
        || usable[0];
    cachedModel = preferred || null;
    return cachedModel;
}

function sanitize(input) {
    return String(input == null ? '' : input)
        .replace(/[\x00-\x1f]/g, ' ')
        .slice(0, 200)
        .trim();
}

function extractJson(text) {
    if (!text) throw new Error('模型未返回内容');
    let s = String(text).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    return JSON.parse(s);
}

function normalizeQuestion(raw, fallbackType) {
    let type = sanitize(raw.type || fallbackType).toLowerCase();
    if (!TYPE_LABELS[type]) type = fallbackType;
    let options = Array.isArray(raw.options) ? raw.options.map((o) => sanitize(o)).filter((o) => o !== '') : [];
    let answer = sanitize(raw.answer).toUpperCase().replace(/\s+/g, '');
    if (type === 'judge') {
        answer = String(raw.answer || '').trim().indexOf('错') >= 0 ? '错' : '对';
        options = [];
    }
    if (type === 'blank') {
        answer = sanitize(raw.answer);
        options = [];
    }
    if (type === 'single' && answer.indexOf(',') >= 0) answer = answer.split(',')[0];
    if (type === 'multi') {
        const parts = answer.split(',').filter((x) => /^[A-Z]$/.test(x));
        answer = Array.from(new Set(parts)).sort().join(',');
    }
    return {
        type,
        stem: sanitize(raw.stem),
        options,
        answer: answer || (type === 'judge' ? '对' : ''),
        analysis: sanitize(raw.analysis),
        knowledgePoint: sanitize(raw.knowledgePoint),
    };
}

async function callModel(systemPrompt, userPrompt) {
    const model = await pickModel();
    if (!model) throw new Error('当前没有可用的出题模型，请稍后重试');
    let answer = '';
    for await (const chunk of cloud.llm.chat.completions.create({
        model: model.id,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        stream: true,
        response_format: { type: 'json_object' },
    })) {
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        if (delta && delta.content) answer += delta.content;
    }
    return answer;
}

// 按配置生成题目。config: { subject, textbook, types:[], questionCount, prompt }
async function generateByConfig(config) {
    const allowed = Array.isArray(config.types) && config.types.length > 0
        ? config.types.filter((t) => TYPE_LABELS[t])
        : ['single'];
    const types = allowed.length > 0 ? allowed : ['single'];
    const count = Math.max(1, Math.min(40, Number(config.questionCount) || 5));
    const subject = sanitize(config.subject) || '综合';
    const textbook = sanitize(config.textbook);
    const prompt = sanitize(config.prompt);

    const typeText = types.length === 1
        ? TYPE_LABELS[types[0]]
        : '混合题型，按此顺序轮换使用：' + types.map((t, i) => (i + 1) + ')' + TYPE_LABELS[t]).join('；');

    const userPrompt = [
        '学科：' + subject,
        textbook ? '教材/范围：' + textbook : '',
        '题型：' + typeText,
        '题量：' + count + ' 题' + (types.length > 1 ? '，请尽量均衡覆盖上述各题型' : ''),
        prompt ? '具体要求：' + prompt : '',
        '每道题的 type 字段请填写它实际所属的题型（单选/多选/判断/填空之一）。',
        '请按要求出题，只输出符合结构的 JSON。',
    ].filter(Boolean).join('\n');

    const raw = await callModel(SYSTEM_PROMPT, userPrompt);
    const parsed = extractJson(raw);
    let list = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.data || []);
    if (!Array.isArray(list)) list = [];
    let questions = list.slice(0, count).map((q, i) => {
        let rawType = String(q.type || '').toLowerCase();
        if (types.indexOf(rawType) < 0) rawType = types[i % types.length];
        const normalized = normalizeQuestion(Object.assign({}, q, { type: rawType }), rawType);
        normalized.type = rawType;
        if (rawType === 'judge') normalized.options = [];
        if (rawType === 'blank') normalized.options = [];
        return normalized;
    });
    questions = questions.filter((q) => q.stem !== '');
    if (questions.length === 0) throw new Error('未能生成有效题目，请调整描述后重试');
    return questions;
}

// 按错题生成同类考核题。mistakes: [{stem, answer, analysis, knowledgePoint, type}]
async function generateFromMistakes(mistakes, options) {
    const opts = options || {};
    const count = Math.max(1, Math.min(20, Number(opts.questionCount) || mistakes.length || 5));
    const picking = mistakes.slice(0, 12);
    const summary = picking.map((m, i) => {
        return [
            (i + 1) + '. 类型：' + (TYPE_LABELS[m.type] || m.type || '未知'),
            '   题干：' + sanitize(m.stem),
            '   正确答案：' + sanitize(m.answer),
            '   知识点：' + sanitize(m.knowledgePoint),
            '   解析：' + sanitize(m.analysis),
        ].join('\n');
    }).join('\n');

    const refType = picking.length > 0 && TYPE_LABELS[picking[0].type] ? picking[0].type : 'single';
    const userPrompt = [
        '以下是学生做错的题目（含正确答案、知识点和解析）：',
        summary,
        '',
        '请围绕这些题目涉及的知识点，重新编写 ' + count + ' 道同类考核题（不要照抄原题，要换情境或换问法但考查相同知识点）。',
        '题型统一使用：' + TYPE_LABELS[opts.questionType && TYPE_LABELS[opts.questionType] ? opts.questionType : refType],
        '只输出符合结构的 JSON。',
    ].join('\n');

    const raw = await callModel(SYSTEM_PROMPT, userPrompt);
    const parsed = extractJson(raw);
    let list = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.data || []);
    if (!Array.isArray(list)) list = [];
    const targetType = opts.questionType && TYPE_LABELS[opts.questionType] ? opts.questionType : refType;
    let questions = list.slice(0, count).map((q) => normalizeQuestion(q, targetType));
    questions = questions.filter((q) => q.stem !== '');
    if (questions.length === 0) throw new Error('未能根据错题生成题目，请重试');
    return questions;
}

// 填空答案归一化：去标点/空白/全半角差异，便于别名判定。
function normalizeAnswer(text) {
    return String(text == null ? '' : text)
        .replace(/[\s\u3000]/g, '')
        .replace(/[，。！？、；：,.!?;:'"“”‘’（）()《》〈〉—\-_·]/g, '')
        .toLowerCase();
}

function gradeQuestion(question, userAnswer) {
    const correct = String(question.answer || '').trim();
    const mine = String(userAnswer == null ? '' : userAnswer).trim();
    if (question.type === 'multi') {
        const a = correct.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).sort().join(',');
        const b = mine.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).sort().join(',');
        return a !== '' && a === b;
    }
    if (question.type === 'judge') return correct === mine;
    if (question.type === 'blank') {
        const accepts = Array.isArray(question.accepts) && question.accepts.length > 0
            ? question.accepts
            : (correct ? [correct] : []);
        const mineNorm = normalizeAnswer(mine);
        if (mineNorm === '') return false;
        return accepts.some((a) => normalizeAnswer(a) === mineNorm);
    }
    return correct.toUpperCase() === mine.toUpperCase() && mine !== '';
}

module.exports = {
    generateByConfig,
    generateFromMistakes,
    gradeQuestion,
    normalizeAnswer,
    normalizeQuestion,
    TYPE_LABELS,
};
