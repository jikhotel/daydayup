// 试卷渲染器：canvas 2D 绘制 A4 版式练习卷长图（源自古诗文应用打印功能的小程序移植）。
// 用法：measureAndDraw(ctx, canvasNode, { questions, withAnswer, source }) -> 返回逻辑高度。
// 调用方负责设置 canvas 物理尺寸并按 dpr 缩放。

const A4_W = 794;              // A4 宽 210mm @96dpi
const MARGIN_X = 56;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = 72;
const CONTENT_W = A4_W - MARGIN_X * 2;

const C = {
    ink: '#1f1a14',       // 正文
    soft: '#8a8070',      // 出处/辅助
    line: '#b9b0a0',      // 分隔线
    accent: '#8c5a2b',    // 语文主题棕
    ok: '#1a7a4a',        // 答案
    blank: '#5a5248',
};

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

function setFont(ctx, size, weight) {
    ctx.font = (weight ? weight + ' ' : '') + size + 'px "PingFang SC", "Helvetica Neue", sans-serif';
}

// 逐字符换行（中英文通吃）。
function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let cur = '';
    for (const ch of String(text || '')) {
        if (ch === '\n') { lines.push(cur); cur = ''; continue; }
        const next = cur + ch;
        if (ctx.measureText(next).width > maxWidth && cur) {
            lines.push(cur);
            cur = ch;
        } else {
            cur = next;
        }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
}

// 在 (x, y) 绘制文本块，返回结束 y。
function drawLines(ctx, lines, x, y, lineH, color, maxWidth) {
    ctx.fillStyle = color || C.ink;
    lines.forEach((ln, i) => {
        ctx.fillText(ln, x, y + i * lineH);
    });
    return y + (lines.length - 1) * lineH;
}

// 计算某题占用高度（与绘制逻辑共用参数，保证 measure 与 draw 一致）。
function questionLayout(ctx, q, index, opts) {
    const lineH = 26;
    const gapAfter = 16;
    const indent = 34; // 题号悬挂缩进
    const stem = String(q.stem || '').replace(/_{2,}/g, '＿＿＿＿＿＿');
    setFont(ctx, 15, '');
    const numText = (index + 1) + '．';
    const numW = ctx.measureText(numText).width;
    const firstW = CONTENT_W - numW;
    const restW = CONTENT_W - indent;
    const rawLines = wrapText(ctx, stem, firstW);
    // 出处挂到最后一行行尾（放得下时）
    const poemText = '——《' + (q.poem || '综合') + '》';
    setFont(ctx, 12, '');
    const poemW = ctx.measureText(poemText).width;
    const lines = [];
    rawLines.forEach((ln, i) => {
        if (i === rawLines.length - 1 && ctx.measureText(ln).width + poemW + 8 <= firstW) {
            lines.push({ text: ln, poem: true });
        } else {
            lines.push({ text: ln, poem: false });
        }
    });
    let poemAlone = null;
    if (!lines[lines.length - 1].poem) {
        poemAlone = poemText;
    }
    let h = lines.length * lineH;
    if (poemAlone) h += lineH;
    // 选项
    const options = Array.isArray(q.options) ? q.options : [];
    if (q.type === 'single' && options.length > 0) {
        const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
        setFont(ctx, 14, '');
        options.forEach((o, i) => {
            const t = (keys[i] || String(i + 1)) + '．' + String(o);
            h += wrapText(ctx, t, restW).length * 22;
        });
    }
    // 解答题：预留作答横线
    const solveRules = q.type === 'solve' ? 4 : 0;
    if (solveRules > 0) h += solveRules * 34;
    h += gapAfter;
    return { h, lineH, numText, numW, indent, lines, poemText, poemAlone, options, solveRules };
}

function answerLayout(ctx, q, index) {
    const lineH = 22;
    const right = q.type === 'single'
        ? String(q.answer || '').trim() + '．' + (Array.isArray(q.options) ? (q.options[['A', 'B', 'C', 'D', 'E', 'F'].indexOf(String(q.answer).trim())] || '') : '')
        : (Array.isArray(q.accepts) && q.accepts.length ? q.accepts.join(' / ') : String(q.answer || ''));
    const head = (index + 1) + '．' + right;
    const analysis = String(q.analysis || '').trim();
    setFont(ctx, 13, 'bold');
    const headLines = wrapText(ctx, head, CONTENT_W);
    let h = headLines.length * lineH;
    let anaLines = [];
    if (analysis) {
        setFont(ctx, 12, '');
        anaLines = wrapText(ctx, '　' + analysis, CONTENT_W);
        h += anaLines.length * 20;
    }
    h += 10;
    return { h, headLines, anaLines, lineH };
}

// 主入口：先 measure 后 draw；返回总逻辑高度。
// opts: { withAnswer, title, kicker, notice } —— title/kicker 缺省为语文古诗词版式。
function renderPaper(ctx, questions, opts, W) {
    const options = opts || {};
    const withAnswer = options.withAnswer === true;
    const source = options.source || 'all';
    const title = options.title || (source === 'mistakes' ? '古诗词错题复习卷' : '古诗词默写练习卷');
    const kicker = options.kicker || '人教版（部编版）高一语文 · 必修上册 / 下册';
    const notice = options.notice || '一、补写出下列名句中的空缺部分；二、选择题请将正确答案填在括号内。';
    const contentW = W - MARGIN_X * 2;
    let y = MARGIN_TOP;

    // --- 页眉 ---
    setFont(ctx, 12, '');
    ctx.fillStyle = C.accent;
    ctx.textAlign = 'center';
    ctx.fillText(kicker, W / 2, y);
    y += 26;
    setFont(ctx, 22, 'bold');
    ctx.fillStyle = C.ink;
    ctx.fillText(title, W / 2, y);
    y += 34;
    // 姓名/班级/日期/得分（带下划线）
    setFont(ctx, 13, '');
    ctx.textAlign = 'left';
    ctx.fillStyle = C.ink;
    const metaItems = ['姓名', '班级', '日期', '得分：________（共 ' + questions.length + ' 题）'];
    let mx = MARGIN_X;
    metaItems.forEach((m, i) => {
        const label = i < 3 ? m + '：' : m;
        ctx.fillText(label, mx, y);
        mx += ctx.measureText(label).width + (i < 3 ? 44 : 0);
    });
    y += 20;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, y);
    ctx.lineTo(W - MARGIN_X, y);
    ctx.stroke();
    y += 26;

    // --- 说明 ---
    setFont(ctx, 13, '');
    ctx.fillStyle = C.blank;
    ctx.fillText(notice, MARGIN_X, y);
    y += 34;

    // --- 题目 ---
    questions.forEach((q, i) => {
        const lay = questionLayout(ctx, q, i, { contentW });
        setFont(ctx, 15, '');
        ctx.fillStyle = C.ink;
        ctx.textAlign = 'left';
        let ly = y + 18; // 基线偏移
        lay.lines.forEach((ln, li) => {
            const x = li === 0 ? MARGIN_X : MARGIN_X + lay.indent;
            ctx.fillText(ln.text, x, ly);
            if (li === lay.lines.length - 1 && ln.poem) {
                setFont(ctx, 12, '');
                ctx.fillStyle = C.soft;
                ctx.fillText(lay.poemText, x + ctx.measureText(ln.text).width + 8, ly);
                setFont(ctx, 15, '');
                ctx.fillStyle = C.ink;
            }
            ly += lay.lineH;
        });
        if (lay.poemAlone) {
            setFont(ctx, 12, '');
            ctx.fillStyle = C.soft;
            ctx.fillText(lay.poemText, MARGIN_X + lay.indent, ly);
            setFont(ctx, 15, '');
            ctx.fillStyle = C.ink;
            ly += lay.lineH;
        }
        if (q.type === 'single' && lay.options.length > 0) {
            const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
            setFont(ctx, 14, '');
            ctx.fillStyle = C.ink;
            lay.options.forEach((o, oi) => {
                const t = (keys[oi] || String(oi + 1)) + '．' + String(o);
                wrapText(ctx, t, CONTENT_W - lay.indent).forEach((ln, li2) => {
                    ctx.fillText(ln, MARGIN_X + lay.indent, ly);
                    ly += 22;
                });
            });
        }
        // 解答题：作答横线
        if (q.type === 'solve' && lay.solveRules > 0) {
            ctx.strokeStyle = C.line;
            ctx.lineWidth = 1;
            for (let r = 0; r < lay.solveRules; r++) {
                const ry = ly + 24 + r * 34;
                ctx.beginPath();
                ctx.moveTo(MARGIN_X + lay.indent, ry);
                ctx.lineTo(W - MARGIN_X, ry);
                ctx.stroke();
            }
        }
        y += lay.h;
    });

    // --- 答案页 ---
    if (withAnswer && questions.length > 0) {
        y += 24;
        // 分页线（虚线）
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = C.line;
        ctx.beginPath();
        ctx.moveTo(MARGIN_X, y);
        ctx.lineTo(W - MARGIN_X, y);
        ctx.stroke();
        ctx.setLineDash([]);
        y += 44;
        setFont(ctx, 18, 'bold');
        ctx.textAlign = 'center';
        ctx.fillStyle = C.ink;
        ctx.fillText('参考答案与解析', W / 2, y);
        ctx.textAlign = 'left';
        y += 34;
        questions.forEach((q, i) => {
            const a = answerLayout(ctx, q, i);
            setFont(ctx, 13, 'bold');
            ctx.fillStyle = C.ok;
            a.headLines.forEach((ln, li) => {
                ctx.fillText(ln, MARGIN_X, y);
                y += a.lineH;
            });
            if (a.anaLines.length) {
                setFont(ctx, 12, '');
                ctx.fillStyle = C.soft;
                a.anaLines.forEach((ln) => {
                    ctx.fillText(ln, MARGIN_X, y);
                    y += 20;
                });
            }
            y += 10;
        });
    }

    return y + MARGIN_BOTTOM;
}

// 画布物理尺寸安全上限（iOS 对 canvas 单边/面积有硬限制，超限导出失败或白图）。
const MAX_CANVAS_EDGE = 4096;
const MAX_CANVAS_PIXELS = 4096 * 4096;
function clampDpr(dpr, totalH) {
    let safe = Number(dpr) || 2;
    safe = Math.min(safe, MAX_CANVAS_EDGE / A4_W, MAX_CANVAS_EDGE / totalH,
        Math.sqrt(MAX_CANVAS_PIXELS / (A4_W * totalH)));
    // 下限 1，保证打印可读；一位小数即可
    return Math.max(1, Math.floor(safe * 10) / 10);
}

// 完整流程：传入 canvas node，自动两遍 measure/draw 并导出临时图片路径。
// opts: { withAnswer, title, kicker, notice, source }
function buildPaperImage(canvasNode, questions, opts, dpr) {
    return new Promise((resolve, reject) => {
        const ctx = canvasNode.getContext('2d');
        // 第一遍：measure
        setFont(ctx, 15, '');
        const totalH = renderPaper(ctx, questions, opts, A4_W);
        const safeDpr = clampDpr(dpr, totalH);
        // 设置物理尺寸
        canvasNode.width = Math.round(A4_W * safeDpr);
        canvasNode.height = Math.round(totalH * safeDpr);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(safeDpr, safeDpr);
        // 白底
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, A4_W, totalH);
        ctx.textBaseline = 'alphabetic';
        // 第二遍：draw
        renderPaper(ctx, questions, opts, A4_W);
        wx.canvasToTempFilePath({
            canvas: canvasNode,
            fileType: 'png',
            quality: 1,
            success: (res) => resolve({ tempFilePath: res.tempFilePath, height: totalH }),
            fail: (err) => reject(new Error((err && err.errMsg) || '导出图片失败')),
        });
    });
}

// 分页导出 JPEG：整卷绘制后按 A4 比例逐页裁剪导出（DCTDecode 直嵌 PDF 用）。
// 返回 [{ data: Uint8Array(JPEG 字节), w, h }]
function exportPageJpegs(canvasNode, questions, opts, dpr) {
    return new Promise((resolve, reject) => {
        const ctx = canvasNode.getContext('2d');
        setFont(ctx, 15, '');
        const totalH = renderPaper(ctx, questions, opts, A4_W);
        const safeDpr = clampDpr(dpr, totalH);
        console.log('[paper] 整卷绘制：totalH=' + totalH + ' dpr=' + safeDpr);
        canvasNode.width = Math.round(A4_W * safeDpr);
        canvasNode.height = Math.round(totalH * safeDpr);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(safeDpr, safeDpr);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, A4_W, totalH);
        ctx.textBaseline = 'alphabetic';
        renderPaper(ctx, questions, opts, A4_W);

        const pageH = Math.round(A4_W * 297 / 210);          // A4 页逻辑高
        const totalPxW = canvasNode.width;
        const totalPxH = canvasNode.height;
        const pagePxH = Math.round(pageH * safeDpr);
        const pageCount = Math.max(1, Math.ceil(totalPxH / pagePxH));
        console.log('[paper] 分页：' + pageCount + ' 页，物理尺寸 ' + totalPxW + 'x' + totalPxH);
        const fs = wx.getFileSystemManager();
        const pages = [];
        let i = 0;
        let failErr = null;
        function next() {
            if (failErr) { reject(failErr); return; }
            if (i >= pageCount) { resolve(pages); return; }
            const y = i * pagePxH;
            const h = Math.min(pagePxH, totalPxH - y);
            wx.canvasToTempFilePath({
                canvas: canvasNode,
                x: 0,
                y: y,
                width: totalPxW,
                height: h,
                destWidth: totalPxW,
                destHeight: h,
                fileType: 'jpg',
                quality: 0.92,
                success: (res) => {
                    fs.readFile({
                        filePath: res.tempFilePath,
                        // 关键：readFile 返回 ArrayBuffer，必须包成 Uint8Array，
                        // 否则 buildPdf 的 TypedArray.set() 在真机上抛 TypeError。
                        success: (r) => {
                            pages.push({ data: new Uint8Array(r.data), w: totalPxW, h: h });
                            console.log('[paper] 第 ' + (i + 1) + ' 页导出成功，' + r.data.byteLength + ' 字节');
                            i++;
                            next();
                        },
                        fail: (e) => { failErr = new Error('读取分页图片失败: ' + ((e && e.errMsg) || '')); next(); },
                    });
                },
                fail: (e) => { failErr = new Error('导出分页图片失败: ' + ((e && e.errMsg) || '')); next(); },
            });
        }
        next();
    });
}

module.exports = {
    A4_W,
    shuffle,
    renderPaper,
    buildPaperImage,
    exportPageJpegs,
};
