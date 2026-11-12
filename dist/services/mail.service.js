"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMail = sendMail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const env_1 = require("../config/env");
const transporter = env_1.env.SMTP_HOST
    ? nodemailer_1.default.createTransport({
        host: env_1.env.SMTP_HOST,
        port: env_1.env.SMTP_PORT,
        auth: env_1.env.SMTP_USER
            ? { user: env_1.env.SMTP_USER, pass: env_1.env.SMTP_PASS }
            : undefined,
    })
    : null;
async function sendMail(to, subject, text) {
    if (!transporter) {
        if (env_1.env.NODE_ENV === 'production')
            throw new Error('SMTP is not configured');
        // وضع التطوير فقط: يُطبع الرمز في الطرفية بدل إرسال بريد فعلي
        console.log(`\n[DEV MAIL] to=${to}\n${subject}\n${text}\n`);
        return;
    }
    await transporter.sendMail({ from: env_1.env.MAIL_FROM, to, subject, text });
}
