const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');

// publicConfig 来自 workbuddy_cloud_service 激活结果，仅含前端可公开的配置。
const publicConfig = {
    endpoint: 'https://mp-api.app.workbuddy.host',
    publishableKey: 'wbpk_UpqjqB4h7FM0hgMavsaNw8_vATCxerkO1fXSxy1Z4O3Z0st2qnyIrEe',
    workBuddyOAuthClientId: 'cb_jq6QyEPkOkJXPcpz0JxS_wbapp_UpqjqB4h7FM0hgMavsaNw8',
};

const cloud = createMiniProgramWorkBuddyCloud({
    endpoint: publicConfig.endpoint,
    publishableKey: publicConfig.publishableKey,
    workBuddyOAuthClientId: publicConfig.workBuddyOAuthClientId,
    wx: createDiagnosticWx(wx),
});

module.exports = { cloud };
