"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const zod_1 = require("zod");
const c = __importStar(require("../controllers/auth.controller"));
const httpError_1 = require("../middleware/httpError");
const validate_1 = require("../middleware/validate");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use((0, express_rate_limit_1.default)({ windowMs: 15 * 60_000, limit: 50 }));
const password = zod_1.z.string().min(8).max(72);
const perEmail = (limit) => (0, express_rate_limit_1.default)({
    windowMs: 15 * 60_000,
    limit,
    keyGenerator: (req) => `${req.path}:${String(req.body?.email ?? 'anon').toLowerCase()}`,
    message: { message: 'Too many attempts' },
});
router.post('/register', (0, validate_1.validate)(zod_1.z.object({
    email: zod_1.z.string().email().max(191),
    username: zod_1.z.string().regex(/^[a-zA-Z0-9_]{3,30}$/),
    password,
    displayName: zod_1.z.string().trim().min(1).max(60),
    deviceName: zod_1.z.string().max(100).optional(),
})), (0, httpError_1.asyncHandler)(c.register));
router.post('/login', (0, validate_1.validate)(zod_1.z.object({
    identifier: zod_1.z.string().min(1),
    password: zod_1.z.string().min(1),
    deviceName: zod_1.z.string().max(100).optional(),
})), (0, httpError_1.asyncHandler)(c.login));
router.post('/refresh', (0, validate_1.validate)(zod_1.z.object({ refreshToken: zod_1.z.string().min(1) })), (0, httpError_1.asyncHandler)(c.refresh));
router.post('/logout', auth_1.requireAuth, (0, httpError_1.asyncHandler)(c.logout));
router.get('/me', auth_1.requireAuth, (0, httpError_1.asyncHandler)(c.me));
router.post('/forgot-password', perEmail(3), (0, validate_1.validate)(zod_1.z.object({ email: zod_1.z.string().email() })), (0, httpError_1.asyncHandler)(c.forgotPassword));
router.post('/reset-password', perEmail(5), (0, validate_1.validate)(zod_1.z.object({
    email: zod_1.z.string().email(),
    code: zod_1.z.string().length(6),
    newPassword: password,
})), (0, httpError_1.asyncHandler)(c.resetPassword));
exports.default = router;
