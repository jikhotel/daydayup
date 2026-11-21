const { cloud } = require('../../utils/cloud');

Page({
    data: {
        authState: 'checking',
        user: null,
        initial: '?',
    },

    onShow() { this.restore(); },

    async restore() {
        this.setData({ authState: 'checking' });
        const result = await getApp().ensureSession();
        const session = result && result.data;
        if ((result && result.error) || !session) {
            getApp().resetSession();
            this.setData({ authState: 'signed-out', user: null, initial: '?' });
            return;
        }
        const user = session.user || {};
        const name = user.name || '';
        this.setData({
            authState: 'signed-in',
            user: { name, phone: user.phone || '' },
            initial: name ? name.slice(0, 1).toUpperCase() : '?',
        });
    },

    async onSignedIn() {
        getApp().resetSession();
        await this.restore();
    },

    async onSignOut() {
        const confirmed = await new Promise((resolve) => {
            wx.showModal({
                title: '退出登录',
                content: '确定要退出登录吗？',
                success: (r) => resolve(r.confirm),
            });
        });
        if (!confirmed) return;
        await cloud.auth.signOut();
        getApp().resetSession();
        this.setData({ authState: 'signed-out', user: null, initial: '?' });
        wx.showToast({ title: '已退出', icon: 'success' });
    },

    showAbout() {
        const app = getApp();
        wx.showModal({
            title: '关于 ' + app.globalData.appName,
            content: '覆盖九大学科的做题练习工具：题库抽题 + AI 一句话出题，支持在线答题、生成 A4 打印卷（系统打印）与错题本。练习记录云端同步。',
            showCancel: false,
        });
    },
});
