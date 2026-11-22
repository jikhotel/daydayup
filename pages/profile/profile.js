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
        // 无登录页：静默登录失败（匿名）也进入，并在有会话时保留用户信息
        const user = (session && session.user) || {};
        const name = user.name || '';
        this.setData({
            authState: 'signed-in',
            user: { name, phone: user.phone || '' },
            initial: name ? name.slice(0, 1).toUpperCase() : '?',
        });
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
        // 退出后不回到登录页，直接以微信身份静默重进
        await this.restore();
        wx.showToast({ title: '已退出并自动重新登录', icon: 'none' });
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
