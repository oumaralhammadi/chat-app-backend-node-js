"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateResetCode = exports.hashToken = exports.generateRefreshToken = exports.verifyAccessToken = exports.signAccessToken = void 0;
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const signAccessToken = (userId, sessionId) => jsonwebtoken_1.default.sign({ sub: userId, sid: sessionId }, env_1.env.JWT_ACCESS_SECRET, {
    expiresIn: env_1.env.JWT_ACCESS_EXPIRES,
});
exports.signAccessToken = signAccessToken;
const verifyAccessToken = (token) => jsonwebtoken_1.default.verify(token, env_1.env.JWT_ACCESS_SECRET);
exports.verifyAccessToken = verifyAccessToken;
const generateRefreshToken = () => crypto_1.default.randomBytes(48).toString('hex');
exports.generateRefreshToken = generateRefreshToken;
const hashToken = (value) => crypto_1.default.createHash('sha256').update(value).digest('hex');
exports.hashToken = hashToken;
const generateResetCode = () => crypto_1.default.randomInt(0, 1_000_000).toString().padStart(6, '0');
exports.generateResetCode = generateResetCode;
