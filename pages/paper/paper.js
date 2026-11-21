const renderer = require('../../utils/paper-renderer');
const pdfWriter = require('../../utils/pdf-writer');

// 打印卷页：由出题页组好卷后经 globalData.pendingPaper 进入，纯渲染出口
// （预览长图 / 存相册 / 生成 A4 PDF 调系统打印）。
Page({
    data: {
        authState: 'checking',
        generating: false,
        imgPath: '',
        paperMeta: '',
        pdfBusy: false,
        errorMsg: '',
        canvasW: 375,
        canvasH: 530,
        externalTip: '',
    },

    onLoad(options) {
        this._from = options.from || '';
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
        // 出题页「生成打印卷」入口：直接渲染传入的题目
        if (this._from === 'setup') {
            this._from = '';
            await this.renderExternal();
        }
    },

    async onSignedIn() {
        getApp().resetSession();
        await this.restore();
    },

    // 出题页组好的试卷：从 globalData.pendingPaper 取题直接渲染。
    async renderExternal() {
        const app = getApp();
        const pending = app.globalData && app.globalData.pendingPaper;
        if (!pending || !Array.isArray(pending.questions) || pending.questions.length === 0) {
            this.setData({ errorMsg: '没有待打印的试卷，请回到学科页重新出题' });
            return;
        }
        app.globalData.pendingPaper = null;
        this.setData({
            externalTip: '已按出题页的配置组卷（' + pending.subject + ' · ' + pending.questions.length + ' 题）',
        });
        await this.renderQuestions(pending.questions, {
            withAnswer: true,
            title: pending.subject + ' 练习卷',
            kicker: pending.textbook || '自定义范围',
            notice: '选择题请将正确答案填在括号内；判断题答「对/错」；填空题直接写出答案。',
        });
    },

    // 通用渲染：questions + 页眉参数 → canvas 长图。
    async renderQuestions(questions, opts) {
        const options = opts || {};
        this.setData({ generating: true, errorMsg: '', imgPath: '' });
        try {
            const node = await this.getCanvasNode();
            const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
            const result = await renderer.buildPaperImage(node, questions, {
                withAnswer: options.withAnswer === true,
                title: options.title,
                kicker: options.kicker,
                notice: options.notice,
            }, dpr);
            const w = 375;
            const h = Math.round(w * result.height / renderer.A4_W);
            this._lastRender = { questions, options, dpr };
            this.setData({
                generating: false,
                imgPath: result.tempFilePath,
                canvasW: w,
                canvasH: h,
                paperMeta: questions.length + ' 题' + (options.withAnswer ? ' · 附答案解析' : ''),
            });
        } catch (err) {
            this.setData({ generating: false, errorMsg: err && err.message ? err.message : '生成失败，请重试' });
        }
    },

    // 分页 JPEG → PDF → 系统文档阅读器（可打印/转发）。
    async makePdf() {
        if (this.data.pdfBusy || this.data.generating) return;
        const last = this._lastRender;
        if (!last || !last.questions || last.questions.length === 0) {
            wx.showToast({ title: '请先生成试卷', icon: 'none' });
            return;
        }
        this.setData({ pdfBusy: true, errorMsg: '' });
        wx.showLoading({ title: '正在生成 PDF…', mask: true });
        try {
            const node = await this.getCanvasNode();
            const jpegs = await renderer.exportPageJpegs(node, last.questions, {
                withAnswer: last.options.withAnswer === true,
                title: last.options.title,
                kicker: last.options.kicker,
                notice: last.options.notice,
            }, last.dpr);
            const pdfBytes = pdfWriter.buildPdf(jpegs);
            const fs = wx.getFileSystemManager();
            const filePath = wx.env.USER_DATA_PATH + '/练习卷_' + Date.now() + '.pdf';
            fs.writeFileSync(filePath, pdfBytes.buffer, 'binary');
            wx.hideLoading();
            this.setData({ pdfBusy: false });
            wx.openDocument({
                filePath: filePath,
                fileType: 'pdf',
                showMenu: true,
                success: () => {},
                fail: (err) => {
                    wx.showModal({
                        title: 'PDF 已生成',
                        content: '已保存到：' + filePath.replace(wx.env.USER_DATA_PATH, '应用目录') + '，打开预览失败：' + ((err && err.errMsg) || ''),
                        showCancel: false,
                    });
                },
            });
        } catch (err) {
            wx.hideLoading();
            this.setData({ pdfBusy: false, errorMsg: err && err.message ? err.message : 'PDF 生成失败，请重试' });
        }
    },

    getCanvasNode() {
        return new Promise((resolve, reject) => {
            const query = wx.createSelectorQuery().in(this);
            query.select('#paper')
                .fields({ node: true, size: true })
                .exec((res) => {
                    if (res && res[0] && res[0].node) resolve(res[0].node);
                    else reject(new Error('画布初始化失败'));
                });
        });
    },

    saveToAlbum() {
        if (!this.data.imgPath) return;
        wx.saveImageToPhotosAlbum({
            filePath: this.data.imgPath,
            success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
            fail: (err) => {
                const msg = (err && err.errMsg) || '';
                if (msg.indexOf('auth') >= 0 || msg.indexOf('denied') >= 0) {
                    wx.showModal({
                        title: '需要相册权限',
                        content: '请在设置中允许保存图片到相册',
                        confirmText: '去设置',
                        success: (r) => { if (r.confirm) wx.openSetting(); },
                    });
                } else {
                    wx.showToast({ title: '保存失败，请重试', icon: 'none' });
                }
            },
        });
    },
});
