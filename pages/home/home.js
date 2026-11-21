const bank = require('../../utils/bank');

Page({
    data: {
        authState: 'checking',
        subjects: [],
        loading: false,
        errorMsg: '',
        version: '',
    },

    onLoad() {
        this.setData({
            subjects: bank.SUBJECTS.map((s) => Object.assign({ countText: '' }, s)),
            version: getApp().globalData.version,
        });
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
        await this.loadCounts();
    },

    async onSignedIn() {
        getApp().resetSession();
        await this.restore();
    },

    // 各学科可用题量（初中+高中）。
    async loadCounts() {
        this.setData({ loading: true });
        for (const s of this.data.subjects) {
            const res = await bank.countBySubject(s.code);
            const total = res.error ? 0 : ((res.data && res.data.total) || 0);
            this.setData({
                subjects: this.data.subjects.map((x) => x.code === s.code
                    ? Object.assign({}, x, { countText: total > 0 ? total + ' 题' : '暂无题库' })
                    : x),
            });
        }
        this.setData({ loading: false });
    },

    goSetup(e) {
        const code = e.currentTarget.dataset.code;
        const name = e.currentTarget.dataset.name;
        wx.navigateTo({ url: '/pages/setup/setup?subject=' + code + '&name=' + encodeURIComponent(name) });
    },

    goMistakes() {
        wx.switchTab({ url: '/pages/mistakes/mistakes' });
    },
});
