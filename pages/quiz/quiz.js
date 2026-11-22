const store = require('../../utils/store');
const ai = require('../../utils/ai');

const TYPE_NAMES = { single: '单选题', multi: '多选题', judge: '判断题', blank: '填空题', solve: '解答题' };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function fmtDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

Page({
    data: {
        authState: 'checking',
        sessionId: null,
        source: 'bank',
        session: null,
        questions: [],      // 视图题：含 myAnswer / optionView / answered
        current: 0,
        elapsed: '00:00',
        submitting: false,
        errorMsg: '',
        typeNames: TYPE_NAMES,
        letters: LETTERS,
    },

    async onLoad(options) {
        this.setData({
            sessionId: options.sessionId ? Number(options.sessionId) : null,
            source: options.source || 'bank',
        });
    },

    onShow() { this.restore(); },
    onUnload() { this._stopTimer(); },
    onHide() { this._stopTimer(); },

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
        await this.loadQuiz();
    },

    async onSignedIn() {
        getApp().resetSession();
        await this.restore();
    },

    async loadQuiz() {
        const id = this.data.sessionId;
        if (!id) {
            this.setData({ errorMsg: '答题会话无效，请重新出题' });
            return;
        }
        const [sessionRes, qRes] = await Promise.all([
            store.getSession(id),
            store.listQuestions(id),
        ]);
        if (sessionRes.error || qRes.error) {
            this.setData({ errorMsg: (sessionRes.error || qRes.error).message || '加载失败' });
            return;
        }
        if (sessionRes.data && sessionRes.data.submittedAt) {
            wx.redirectTo({ url: '/pages/result/result?sessionId=' + id });
            return;
        }
        this._raw = qRes.data || [];
        this._answers = {};
        this.setData({ session: sessionRes.data });
        this._refreshView();
        this._startTimer(sessionRes.data ? sessionRes.data.startedAt : null);
    },

    // 由原始数据 + 当前作答生成纯视图对象，WXML 只读简单字段。
    _refreshView() {
        const answers = this._answers || {};
        const questions = this._raw.map((q) => {
            const myAnswer = answers[q.id] || '';
            const isChoice = q.type === 'single' || q.type === 'multi';
            const optionView = isChoice ? q.options.map((text, i) => {
                const letter = LETTERS[i];
                let selected = false;
                if (q.type === 'multi') selected = myAnswer.split(',').indexOf(letter) >= 0;
                else selected = myAnswer === letter;
                return { letter, text, selected };
            }) : [];
            return {
                id: q.id,
                index: q.index,
                type: q.type,
                typeName: TYPE_NAMES[q.type] || '题目',
                stem: q.stem,
                hasOptions: isChoice,
                isJudge: q.type === 'judge',
                isBlank: q.type === 'blank',
                isSolve: q.type === 'solve',
                optionView,
                myAnswer,
                answered: myAnswer !== '',
            };
        });
        this.setData({ questions });
    },

    _startTimer(startedAt) {
        this._stopTimer();
        const startMs = startedAt ? new Date(startedAt).getTime() : Date.now();
        this._tick(startMs);
        this._timer = setInterval(() => this._tick(startMs), 1000);
    },

    _tick(startMs) {
        const elapsedSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
        this.setData({ elapsed: fmtDuration(elapsedSec) });
        this._elapsedSec = elapsedSec;
    },

    _stopTimer() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    // 选项点击统一入口：多选切换，其余题型单选赋值。
    onOptionTap(e) {
        const qid = Number(e.currentTarget.dataset.qid);
        const q = (this._raw || []).find((item) => item.id === qid);
        if (q && q.type === 'multi') {
            this.onToggleMulti(e);
            return;
        }
        this.onChoose(e);
    },

    onChoose(e) {
        const qid = Number(e.currentTarget.dataset.qid);
        this._answers[qid] = e.currentTarget.dataset.value;
        this._refreshView();
    },

    onToggleMulti(e) {
        const qid = Number(e.currentTarget.dataset.qid);
        const letter = e.currentTarget.dataset.value;
        let parts = this._answers[qid] ? this._answers[qid].split(',') : [];
        const pos = parts.indexOf(letter);
        if (pos >= 0) parts = parts.filter((x) => x !== letter);
        else parts.push(letter);
        parts.sort();
        this._answers[qid] = parts.join(',');
        this._refreshView();
    },

    onBlankInput(e) {
        const qid = Number(e.currentTarget.dataset.qid);
        this._answers[qid] = e.detail.value;
        this._refreshView();
    },

    goPrev() {
        if (this.data.current > 0) this.setData({ current: this.data.current - 1 });
    },
    goNext() {
        if (this.data.current < this.data.questions.length - 1) this.setData({ current: this.data.current + 1 });
    },
    jumpTo(e) {
        this.setData({ current: Number(e.currentTarget.dataset.index) });
    },

    async submit() {
        if (this.data.submitting) return;
        const raw = this._raw || [];
        const unanswered = raw.filter((q) => {
            const a = this._answers[q.id];
            return !a || String(a).trim() === '';
        }).length;
        let doSubmit = true;
        if (unanswered > 0) {
            doSubmit = await new Promise((resolve) => {
                wx.showModal({
                    title: '还有 ' + unanswered + ' 题未作答',
                    content: '未作答的题目将记为答错，确定交卷吗？',
                    confirmText: '交卷',
                    success: (r) => resolve(r.confirm),
                });
            });
        }
        if (!doSubmit) return;

        this.setData({ submitting: true });
        const hasSolve = raw.some((q) => q.type === 'solve');
        wx.showLoading({ title: hasSolve ? 'AI 阅卷判分中…' : '判分中…', mask: true });
        this._stopTimer();

        let correctCount = 0;
        for (const q of raw) {
            const userAnswer = this._answers[q.id] || '';
            // 解答题为主观题，走 AI 阅卷；其余客观题本地判分。
            const isCorrect = q.type === 'solve'
                ? await ai.judgeSolve(q, userAnswer)
                : ai.gradeQuestion(q, userAnswer);
            if (isCorrect) correctCount += 1;
            const res = await store.updateQuestionAnswer(q.id, userAnswer, isCorrect);
            if (res.error) {
                wx.hideLoading();
                this.setData({ submitting: false, errorMsg: res.error.message || '判分失败，请重试' });
                return;
            }
        }
        const updated = await store.updateSession(this.data.sessionId, {
            submittedAt: new Date().toISOString(),
            durationSec: this._elapsedSec || 0,
            totalCount: raw.length,
            correctCount,
        });
        wx.hideLoading();
        this.setData({ submitting: false });
        if (updated.error) wx.showToast({ title: updated.error.message || '保存成绩失败', icon: 'none' });
        wx.redirectTo({ url: '/pages/result/result?sessionId=' + this.data.sessionId });
    },
});
