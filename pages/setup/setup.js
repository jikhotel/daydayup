const bank = require('../../utils/bank');
const ai = require('../../utils/ai');
const store = require('../../utils/store');

const TYPE_OPTIONS = [
    { key: 'single', name: '单选题', checked: true },
    { key: 'multi', name: '多选题', checked: false },
    { key: 'judge', name: '判断题', checked: false },
    { key: 'blank', name: '填空题', checked: false },
    { key: 'solve', name: '解答题', checked: false },
];

const SOURCE_OPTIONS = [
    { key: 'taxonomy', name: '原始题库', checked: true },
    { key: 'ai', name: 'AI 生成', checked: false },
];

Page({
    data: {
        authState: 'checking',
        subject: '',
        subjectName: '',
        topics: [],
        topicIndex: 0,
        grades: bank.GRADES.map((g) => g.name),
        gradeIndex: bank.GRADES.length - 1,     // 默认全部
        publishers: bank.PUBLISHERS,
        publisherIndex: 0,      // 默认人教版
        questionCount: 10,
        typeOptions: TYPE_OPTIONS,
        sourceOptions: SOURCE_OPTIONS,
        prompt: '',
        generating: false,
        errorMsg: '',
    },

    onLoad(options) {
        this.setData({
            subject: options.subject || 'math',
            subjectName: options.name ? decodeURIComponent(options.name) : '数学',
        });
        wx.setNavigationBarTitle({ title: this.data.subjectName + ' · 出题' });
    },

    onShow() { this.restore(); },

    async restore() {
        this.setData({ authState: 'checking', errorMsg: '' });
        const result = await getApp().ensureSession();
        const session = result && result.data;
        if ((result && result.error) || !session) {
            getApp().resetSession();
            this.setData({ authState: 'signed-out' });
            return;
        }
        this.setData({ authState: 'signed-in' });
        await this.loadTopics();
    },

    async onSignedIn() {
        getApp().resetSession();
        await this.restore();
    },

    // 知识点列表（题库 topic_name 去重）。
    async loadTopics() {
        const res = await bank.listTopics(this.data.subject);
        const topics = ['全部知识点'].concat(res.error ? [] : (res.data || []));
        this.setData({ topics });
    },

    onTopicChange(e) {
        this.setData({ topicIndex: Number(e.detail.value) });
    },
    onGradeChange(e) {
        this.setData({ gradeIndex: Number(e.detail.value) });
    },
    onPublisherChange(e) {
        this.setData({ publisherIndex: Number(e.detail.value) });
    },
    onCountChange(e) {
        this.setData({ questionCount: Number(e.detail.value) });
    },
    countMinus() {
        this.setData({ questionCount: Math.max(5, this.data.questionCount - 5) });
    },
    countPlus() {
        this.setData({ questionCount: Math.min(40, this.data.questionCount + 5) });
    },
    toggleType(e) {
        const key = e.currentTarget.dataset.key;
        this.setData({
            typeOptions: this.data.typeOptions.map((o) => o.key === key ? Object.assign({}, o, { checked: !o.checked }) : o),
        });
    },
    toggleSource(e) {
        const key = e.currentTarget.dataset.key;
        this.setData({
            sourceOptions: this.data.sourceOptions.map((o) => o.key === key ? Object.assign({}, o, { checked: !o.checked }) : o),
        });
    },
    onPromptInput(e) {
        this.setData({ prompt: e.detail.value });
    },
    useSample() {
        this.setData({ prompt: '人教版' + this.data.gradeName() + '同步练习，侧重基础与易错点，解析要详细' });
    },

    gradeName() {
        const name = this.data.grades[this.data.gradeIndex] || '中学';
        return name.indexOf('全部') === 0 ? '中学' : name;   // 「全部」在示例 prompt 里说「中学」
    },

    // 组卷：题库优先，AI 补足。
    async buildPaper() {
        const subjectName = this.data.subjectName;
        const types = this.data.typeOptions.filter((o) => o.checked).map((o) => o.key);
        if (types.length === 0) throw new Error('请至少选择一种题型');
        const sources = this.data.sourceOptions.filter((o) => o.checked).map((o) => o.key);
        if (sources.length === 0) throw new Error('请至少选择一个题目来源');
        const useAI = sources.indexOf('ai') >= 0;
        if (useAI && !this.data.prompt.trim()) throw new Error('勾选了 AI 生成，请写一句话描述出题要求');
        const count = this.data.questionCount;
        const grade = bank.GRADES[this.data.gradeIndex];
        const publisher = bank.PUBLISHERS[this.data.publisherIndex];
        const topic = this.data.topics[this.data.topicIndex];
        const textbook = (publisher === '自定义' ? '自定义教材' : publisher) + '·' + subjectName + '·' + grade.name;

        let bankQuestions = [];
        const drawRes = await bank.drawQuestions({
            subject: this.data.subject,
            grade: grade.key,
            topics: topic && topic !== '全部知识点' ? [topic] : [],
            types,
            sources: sources.filter((s) => s !== 'ai'),
            count,
        });
        if (drawRes.error) throw new Error(drawRes.error.message || '题库抽题失败');
        bankQuestions = drawRes.data || [];

        let aiQuestions = [];
        const aiCount = count - bankQuestions.length;
        if (aiCount > 0 && useAI) {
            const topicText = topic && topic !== '全部知识点' ? ('知识点范围：' + topic + '。') : '';
            aiQuestions = await ai.generateByConfig({
                subject: subjectName,
                textbook,
                types,
                questionCount: aiCount,
                prompt: topicText + this.data.prompt.trim(),
            });
        }

        const questions = bankQuestions.concat(aiQuestions);
        if (questions.length === 0) {
            throw new Error('该条件下没有可用题目：换宽范围/换题型，或勾选「AI 生成」');
        }
        return {
            questions,
            aiQuestions,
            usedBank: bankQuestions.length > 0,
            usedAI: aiQuestions.length > 0,
            subject: subjectName,
            textbook,
        };
    },

    async startQuiz() {
        if (this.data.generating) return;
        this.setData({ generating: true, errorMsg: '' });
        wx.showLoading({ title: '组卷中…', mask: true });
        try {
            const paper = await this.buildPaper();
            const sessionRes = await store.createSession({
                subject: paper.subject,
                textbook: paper.textbook,
                questionType: Array.from(new Set(paper.questions.map((q) => q.type))).join(','),
                questionCount: paper.questions.length,
                prompt: (paper.usedBank ? '题库' : '') + (paper.usedBank && paper.usedAI ? '+' : '') + (paper.usedAI ? 'AI' : '') + ' 组卷' + (this.data.prompt ? '：' + this.data.prompt.trim() : ''),
                source: paper.usedBank ? 'bank' : 'generate',
            });
            if (sessionRes.error || !sessionRes.data) throw new Error((sessionRes.error && sessionRes.error.message) || '创建答题失败');
            const sessionId = sessionRes.data.id;
            const qRes = await store.createQuestions(sessionId, paper.questions, { subject: paper.subject, textbook: paper.textbook });
            if (qRes.error) throw new Error(qRes.error.message || '保存题目失败');

            // AI 题回写题库（source='ai'），不阻塞答题
            if (paper.aiQuestions.length > 0) bank.saveGeneratedToBank(this.data.subject, paper.aiQuestions);

            wx.hideLoading();
            this.setData({ generating: false });
            wx.navigateTo({ url: '/pages/quiz/quiz?sessionId=' + sessionId + '&source=' + (paper.usedBank ? 'bank' : 'generate') });
        } catch (err) {
            wx.hideLoading();
            this.setData({ generating: false, errorMsg: err && err.message ? err.message : '出题失败，请重试' });
        }
    },

    async makePaper() {
        if (this.data.generating) return;
        this.setData({ generating: true, errorMsg: '' });
        wx.showLoading({ title: '组卷中…', mask: true });
        try {
            const paper = await this.buildPaper();
            const app = getApp();
            app.globalData.pendingPaper = {
                questions: paper.questions,
                subject: paper.subject,
                textbook: paper.textbook,
            };
            wx.hideLoading();
            this.setData({ generating: false });
            wx.navigateTo({ url: '/pages/paper/paper?from=setup' });
        } catch (err) {
            wx.hideLoading();
            this.setData({ generating: false, errorMsg: err && err.message ? err.message : '组卷失败，请重试' });
        }
    },
});
