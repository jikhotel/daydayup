// 极简 PDF 生成器：每页一张 JPEG 图片（DCTDecode 直嵌原始字节），无字体/无依赖。
// 输出合法 PDF 1.4（catalog / pages / page / image xobject / content stream / xref / trailer）。
// 全程 Uint8Array 组装，可跑在小程序与 Node。

const A4_W_PT = 595.28;   // 210mm
const A4_H_PT = 841.89;   // 297mm

function ascii(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
}

function concat(parts) {
    let len = 0;
    parts.forEach((p) => { len += p.length; });
    const out = new Uint8Array(len);
    let offset = 0;
    parts.forEach((p) => {
        out.set(p, offset);
        offset += p.length;
    });
    return out;
}

function pad10(n) {
    return ('0000000000' + n).slice(-10);
}

// pages: [{ data: Uint8Array(JPEG 字节), w, h }]
function buildPdf(pages) {
    if (!pages || pages.length === 0) throw new Error('PDF 至少需要一页');
    const n = pages.length;
    // 对象编号：1 catalog, 2 pages, 3..(2+n) page, (3+n)..(2+2n) image, 最后 content? content 并入 page 对象后追加流
    // 简化：page 对象直接带 /Contents 引用单独的 content 对象？直接把 content 流作为 page 的 /Contents 内联对象。
    // 对象列表（从 1 开始）：
    //   1: catalog
    //   2: pages
    //   3 + i: page i（含 /Contents 内联流与 /Resources 引用 image）
    //   3 + n + i: image i
    const objects = []; // { num, body: Uint8Array }
    objects.push(ascii('<< /Type /Catalog /Pages 2 0 R >>'));
    objects.push(ascii('<< /Type /Pages /Kids [' + pages.map((_, i) => (3 + i) + ' 0 R').join(' ') + '] /Count ' + n + ' >>'));
    pages.forEach((p, i) => {
        const imgRef = (3 + n + i) + ' 0 R';
        const contentText = 'q ' + A4_W_PT.toFixed(2) + ' 0 0 ' + A4_H_PT.toFixed(2) + ' 0 0 cm /Im' + i + ' Do Q\n';
        const body = ascii(
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4_W_PT.toFixed(2) + ' ' + A4_H_PT.toFixed(2) + '] ' +
            '/Resources << /XObject << /Im' + i + ' ' + imgRef + ' >> >> /Contents ' + (3 + 2 * n + i) + ' 0 R >>'
        );
        objects.push(body);
    });
    pages.forEach((p, i) => {
        const head = ascii('<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.data.length + ' >>\nstream\n');
        objects.push(concat([head, p.data, ascii('\nendstream')]));
    });
    pages.forEach((_, i) => {
        const contentText = 'q ' + A4_W_PT.toFixed(2) + ' 0 0 ' + A4_H_PT.toFixed(2) + ' 0 0 cm /Im' + i + ' Do Q\n';
        objects.push(concat([ascii('<< /Length ' + contentText.length + ' >>\nstream\n'), ascii(contentText), ascii('endstream')]));
    });

    // 组装
    const parts = [ascii('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')];
    const offsets = [];
    let pos = parts[0].length;
    objects.forEach((body, idx) => {
        const num = idx + 1;
        offsets.push(pos);
        const head = ascii(num + ' 0 obj\n');
        const tail = ascii('\nendobj\n');
        parts.push(head, body, tail);
        pos += head.length + body.length + tail.length;
    });
    const xrefStart = pos;
    let xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach((o) => { xref += pad10(o) + ' 00000 n \n'; });
    xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n';
    parts.push(ascii(xref));
    return concat(parts);
}

module.exports = {
    A4_W_PT,
    A4_H_PT,
    buildPdf,
};
