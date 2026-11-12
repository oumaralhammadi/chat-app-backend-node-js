"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const zod_1 = require("zod");
const schema = zod_1.z.object({
    PORT: zod_1.z.coerce.number().default(4000),
    NODE_ENV: zod_1.z
        .enum(['development', 'production', 'test'])
        .default('development'),
    DATABASE_URL: zod_1.z.string().min(1),
    JWT_ACCESS_SECRET: zod_1.z.string().min(16),
    JWT_ACCESS_EXPIRES: zod_1.z.string().default('15m'),
    REFRESH_TOKEN_DAYS: zod_1.z.coerce.number().default(30),
    SMTP_HOST: zod_1.z.string().optional(),
    SMTP_PORT: zod_1.z.coerce.number().default(587),
    SMTP_USER: zod_1.z.string().optional(),
    SMTP_PASS: zod_1.z.string().optional(),
    MAIL_FROM: zod_1.z.string().default('Chat App <no-reply@chatapp.local>'),
    CLOUDINARY_CLOUD_NAME: zod_1.z.string().optional(),
    CLOUDINARY_API_KEY: zod_1.z.string().optional(),
    CLOUDINARY_API_SECRET: zod_1.z.string().optional(),
    EXPO_ACCESS_TOKEN: zod_1.z.string().optional(),
});
exports.env = schema.parse(process.env);
