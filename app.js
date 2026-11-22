const { cloud } = require('./utils/cloud');

App({
    globalData: {
        appName: 'DayDayUp',
        version: '0.2.8',
        // 组卷数据跨页传递（setup -> paper）
        pendingPaper: null,
    },

    // 静默会话：无登录页，进入程序即自动登录。
    // 1) 已有会话（含此前手机号登录的用户）直接复用 → 用户与数据都保留；
    // 2) 否则 wx.login() 静默换取 Genie 会话；
    // 3) 静默失败不阻塞进入程序（匿名会话，提示由各页面承载）。
    ensureSession() {
        if (!this.sessionPromise) {
            this.sessionPromise = this.resolveSession();
        }
        return this.sessionPromise;
    },

    async resolveSession() {
        const existing = await cloud.auth.getSession();
        if ((!existing || !existing.error) && existing && existing.data) {
            return existing;                     // 保留既有登录态与用户信息
        }
        try {
            const loginRes = await new Promise((resolve, reject) => {
                if (typeof wx.login !== 'function') { reject(new Error('当前环境不支持 wx.login')); return; }
                wx.login({ success: resolve, fail: reject });
            });
            if (!loginRes || !loginRes.code) throw new Error('wx.login 未返回 code');
            const appid = (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.appId) || '';
            if (!appid) throw new Error('无法获取小程序 appid');
            const res = await cloud.auth.signInWithWechat(loginRes.code, appid);
            if (res && !res.error) {
                console.log('[auth] 微信静默登录成功');
                return res;
            }
            console.warn('[auth] 微信静默登录失败:', res && res.error && res.error.message);
        } catch (e) {
            console.warn('[auth] 静默登录异常:', e && e.message);
        }
        // 不登录也进入程序：返回空会话，页面不再被登录页挡住
        return { data: null, error: null, anonymous: true };
    },

    resetSession() {
        this.sessionPromise = null;
    },
});
