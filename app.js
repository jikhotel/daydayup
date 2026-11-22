const { cloud } = require('./utils/cloud');

App({
    globalData: {
        appName: 'DayDayUp',
        version: '0.2.7',
        // 组卷数据跨页传递（setup -> paper）
        pendingPaper: null,
    },

    // 会话缓存：登录/退出后重置，页面 onShow 统一走这里。
    ensureSession() {
        if (!this.sessionPromise) {
            this.sessionPromise = cloud.auth.getSession();
        }
        return this.sessionPromise;
    },

    resetSession() {
        this.sessionPromise = null;
    },
});
