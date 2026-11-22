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
        // 无登录页：静默登录失败（匿名）也直接进入程序
        const session = result && result.data;
        this.setData({ authState: 'signed-in' });
        if (!session) console.warn('[auth] 匿名模式进入（数据读写可能受限）');
        await this.loadCounts();
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
