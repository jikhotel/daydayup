const { cloud } = require('../../utils/cloud');

Component({
    data: {
        step: 'phone',        // phone | code
        phone: '',
        code: '',
        phoneError: '',
        formError: '',
        sending: false,
        verifying: false,
        countdown: 0,
        pending: null,        // { phone, verificationId, isExistingUser }
    },

    lifetimes: {
        detached() {
            if (this._timer) clearInterval(this._timer);
        },
    },

    methods: {
        onPhoneInput(e) {
            this.setData({ phone: e.detail.value, phoneError: '', formError: '' });
        },
        onCodeInput(e) {
            this.setData({ code: e.detail.value, formError: '' });
        },

        async sendCode() {
            if (this.data.sending || this.data.countdown > 0) return;
            const phone = this.data.phone.trim();
            if (!/^1\d{10}$/.test(phone)) {
                this.setData({ phoneError: '请输入正确的 11 位手机号' });
                return;
            }
            this.setData({ sending: true, phoneError: '', formError: '' });
            const sent = await cloud.auth.sendOtp({ phone });
            this.setData({ sending: false });
            if (sent.error) {
                this.setData({ formError: sent.error.message || '验证码发送失败，请重试' });
                return;
            }
            this.setData({
                step: 'code',
                pending: {
                    phone: phone,
                    verificationId: sent.data.verificationId,
                    isExistingUser: sent.data.isExistingUser,
                },
                code: '',
                countdown: 60,
            });
            this._startCountdown();
        },

        _startCountdown() {
            if (this._timer) clearInterval(this._timer);
            this._timer = setInterval(() => {
                const next = this.data.countdown - 1;
                if (next <= 0) {
                    clearInterval(this._timer);
                    this._timer = null;
                    this.setData({ countdown: 0 });
                } else {
                    this.setData({ countdown: next });
                }
            }, 1000);
        },

        async verifyCode() {
            if (this.data.verifying) return;
            const pending = this.data.pending;
            const code = this.data.code.trim();
            if (!pending) {
                this.setData({ formError: '请先获取验证码' });
                return;
            }
            if (!code) {
                this.setData({ formError: '请输入验证码' });
                return;
            }
            this.setData({ verifying: true, formError: '' });
            const result = await cloud.auth.verifyOtp({
                phone: pending.phone,
                verificationId: pending.verificationId,
                isExistingUser: pending.isExistingUser,
                token: code,
            });
            this.setData({ verifying: false });
            if (result.error) {
                this.setData({ formError: result.error.message || '验证码不正确，请重试' });
                return;
            }
            this.triggerEvent('signedin', { user: result.data && result.data.user });
        },

        changePhone() {
            if (this._timer) { clearInterval(this._timer); this._timer = null; }
            this.setData({
                step: 'phone',
                pending: null,
                code: '',
                countdown: 0,
                formError: '',
                phoneError: '',
            });
        },
    },
});
