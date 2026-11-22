const store = require('../../utils/store');
const ai = require('../../utils/ai');
const bank = require('../../utils/bank');

const TYPE_NAMES = { single: '单选题', multi: '多选题', judge: '判断题', blank: '填空题', solve: '解答题' };

Page({
    data: {
        authState: 'checking',
        mistakes: [],          // 视图项：含 selected
        subjects: ['全部'],
        filterIndex: 0,
        hideMastered: true,    // 默认隐藏已掌握
        pendingCount: 0,
        masteredCount: 0,
        loading: false,
        reGenerating: false,
        selectedCount: 0,
        errorMsg: '',
        typeNames: TYPE_NAMES,
    },

    onShow() { this.restore(); },

    async restore() {
        this.setData({ authState: 'checking', errorMsg: '' });
        const result = await getApp().ensureSession();
        // 无登录页：静默登录失败（匿名）也直接进入程序
        const session = result && result.data;
        this.setData({ authState: 'signed-in' });
        if (!session) console.warn('[auth] 匿名模式进入（数据读写可能受限）');
        await this.loadMistakes();
    },


    async loadMistakes() {
        this.setData({ loading: true, errorMsg: '' });
        const res = await store.listMistakes();
        if (res.error) {
            this.setData({ loading: false, errorMsg: res.error.message || '加载失败' });
            return;
        }
        const raw = res.data || [];
        const subjectSet = {};
        raw.forEach((q) => { if (q.subject) subjectSet[q.subject] = true; });
        const subjects = ['全部'].concat(Object.keys(subjectSet).sort());
        this._raw = raw;
        this.setData({ subjects, loading: false });
        this._applyFilter();
    },

    onFilterChange(e) {
        this.setData({ filterIndex: Number(e.detail.value) });
        this._applyFilter();
    },

    onHideMasteredToggle(e) {
        this.setData({ hideMastered: e.detail.value });
        this._applyFilter();
    },

    _applyFilter() {
        const subject = this.data.subjects[this.data.filterIndex];
        const hideMastered = this.data.hideMastered;
        const selected = this._selected || {};
        const list = (this._raw || [])
            .filter((q) => subject === '全部' || q.subject === subject)
            .filter((q) => !hideMastered || !q.mastered)
            .map((q) => Object.assign({}, q, { selected: !!selected[q.id] }));
        const pending = (this._raw || []).filter((q) => !q.mastered).length;
        const mastered = (this._raw || []).filter((q) => q.mastered).length;
        this.setData({
            mistakes: list,
            pendingCount: pending,
            masteredCount: mastered,
            selectedCount: Object.keys(selected).filter((k) => selected[k]).length,
        });
    },

    toggleSelect(e) {
        const id = e.currentTarget.dataset.id;
        const selected = this._selected || {};
        selected[id] = !selected[id];
        this._selected = selected;
        this._applyFilter();
    },

    toggleSelectAll() {
        const current = this.data.mistakes;
        const allSelected = current.length > 0 && current.every((q) => q.selected);
        const selected = this._selected || {};
        current.forEach((q) => { selected[q.id] = !allSelected; });
        this._selected = selected;
        this._applyFilter();
    },

    // 标记/取消「已掌握」（catchtap 阻止冒泡到选题）。
    async toggleMastered(e) {
        const id = e.currentTarget.dataset.id;
        const val = e.currentTarget.dataset.val === true || e.currentTarget.dataset.val === 'true';
        const res = await store.setMistakeMastered(id, val);
        if (res.error) {
            wx.showToast({ title: res.error.message || '操作失败', icon: 'none' });
            return;
        }
        if (this._raw) {
            this._raw = this._raw.map((q) => q.id === id ? Object.assign({}, q, { mastered: val }) : q);
        }
        this._applyFilter();
        wx.showToast({ title: val ? '已标记掌握' : '已重新加入复习', icon: 'none' });
    },

    // 选中错题（未全选则用全部待复习题）按知识点生成巩固题，再计时打卡。
    async generateFromSelected() {
        if (this.data.reGenerating) return;
        const list = this.data.mistakes.filter((q) => !q.mastered);
        const chosen = list.filter((q) => q.selected);
        const source = chosen.length > 0 ? chosen : list;
        if (source.length === 0) {
            wx.showToast({ title: '错题本还是空的', icon: 'none' });
            return;
        }
        this.setData({ reGenerating: true });
        wx.showLoading({ title: '按知识点出题…', mask: true });
        try {
            const questions = await ai.generateFromMistakes(source, { questionCount: source.length });
            const first = source[0];
            const sessionRes = await store.createSession({
                subject: first.subject || '综合',
                textbook: first.textbook || '',
                questionType: Array.from(new Set(source.map((q) => q.type))).join(','),
                questionCount: questions.length,
                prompt: '根据错题本知识点生成巩固题',
                source: 'mistake',
            });
            if (sessionRes.error || !sessionRes.data) throw new Error((sessionRes.error && sessionRes.error.message) || '创建练习失败');
            const newId = sessionRes.data.id;
            const qRes = await store.createQuestions(newId, questions, {
                subject: first.subject, textbook: first.textbook,
            });
            if (qRes.error) throw new Error(qRes.error.message || '保存题目失败');

            // 巩固题同步积累进题库（source='ai'），不阻塞流程
            const code = (bank.SUBJECTS.find((s) => s.name === (first.subject || '')) || {}).code;
            if (code) bank.saveGeneratedToBank(code, questions);

            wx.hideLoading();
            this.setData({ reGenerating: false });
            wx.navigateTo({ url: '/pages/quiz/quiz?sessionId=' + newId + '&source=mistake' });
        } catch (err) {
            wx.hideLoading();
            this.setData({ reGenerating: false, errorMsg: err && err.message ? err.message : '生成失败，请重试' });
        }
    },

    goHome() {
        wx.switchTab({ url: '/pages/home/home' });
    },
});
