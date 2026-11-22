const store = require('../../utils/store');
const ai = require('../../utils/ai');
const bank = require('../../utils/bank');

const TYPE_NAMES = { single: '单选题', multi: '多选题', judge: '判断题', blank: '填空题', solve: '解答题' };

function fmtDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

Page({
    data: {
        authState: 'checking',
        sessionId: null,
        session: null,
        questions: [],
        score: 0,
        duration: '00:00',
        wrongCount: 0,
        wrongList: [],
        typeNames: TYPE_NAMES,
        reGenerating: false,
        errorMsg: '',
    },

    onLoad(options) {
        this.setData({ sessionId: options.sessionId ? Number(options.sessionId) : null });
    },

    onShow() { this.restore(); },

    async restore() {
        this.setData({ authState: 'checking', errorMsg: '' });
        const result = await getApp().ensureSession();
        // 无登录页：静默登录失败（匿名）也直接进入程序
        const session = result && result.data;
        this.setData({ authState: 'signed-in' });
        if (!session) console.warn('[auth] 匿名模式进入（数据读写可能受限）');
        await this.loadResult();
    },


    async loadResult() {
        const id = this.data.sessionId;
        if (!id) { this.setData({ errorMsg: '结果会话无效' }); return; }
        const [sRes, qRes] = await Promise.all([
            store.getSession(id),
            store.listQuestions(id),
        ]);
        if (sRes.error || qRes.error) {
            this.setData({ errorMsg: (sRes.error || qRes.error).message || '加载失败' });
            return;
        }
        const session = sRes.data || {};
        const questions = qRes.data || [];
        const total = questions.length;
        const correct = session.correctCount || 0;
        const score = total > 0 ? Math.round(correct * 100 / total) : 0;
        const duration = fmtDuration(session.durationSec || 0);
        const wrongList = questions.filter((q) => q.isCorrect === false);
        this.setData({
            session,
            questions,
            score,
            duration,
            wrongCount: wrongList.length,
            wrongList,
        });
    },

    // 用本次错题生成同类考核题，创建新的 mistake 会话并进入答题。
    async redoWrong() {
        if (this.data.reGenerating) return;
        const wrong = this.data.wrongList;
        if (wrong.length === 0) {
            wx.showToast({ title: '本次没有错题，太棒了', icon: 'none' });
            return;
        }
        this.setData({ reGenerating: true });
        wx.showLoading({ title: '生成巩固题…', mask: true });
        try {
            const questions = await ai.generateFromMistakes(wrong, { questionCount: wrong.length });
            const session = this.data.session;
            const sessionRes = await store.createSession({
                subject: session.subject || '综合',
                textbook: session.textbook || '',
                questionType: Array.from(new Set(wrong.map((q) => q.type))).join(','),
                questionCount: questions.length,
                prompt: '根据错题知识点生成巩固题',
                source: 'mistake',
            });
            if (sessionRes.error || !sessionRes.data) throw new Error((sessionRes.error && sessionRes.error.message) || '创建练习失败');
            const newId = sessionRes.data.id;
            const qRes = await store.createQuestions(newId, questions, {
                subject: session.subject, textbook: session.textbook,
            });
            if (qRes.error) throw new Error(qRes.error.message || '保存题目失败');

            // 巩固题同步积累进题库（source='ai'），不阻塞流程
            const code = (bank.SUBJECTS.find((s) => s.name === (session.subject || '')) || {}).code;
            if (code) bank.saveGeneratedToBank(code, questions);

            wx.hideLoading();
            this.setData({ reGenerating: false });
            wx.redirectTo({ url: '/pages/quiz/quiz?sessionId=' + newId + '&source=mistake' });
        } catch (err) {
            wx.hideLoading();
            this.setData({ reGenerating: false, errorMsg: err && err.message ? err.message : '生成失败，请重试' });
        }
    },

    goHome() {
        wx.switchTab({ url: '/pages/home/home' });
    },

    goMistakes() {
        wx.switchTab({ url: '/pages/mistakes/mistakes' });
    },
});
