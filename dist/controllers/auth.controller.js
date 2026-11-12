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
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPassword = exports.forgotPassword = exports.me = exports.logout = exports.refresh = exports.login = exports.register = void 0;
const auth = __importStar(require("../services/auth.service"));
const emitter_1 = require("../sockets/emitter");
const register = async (req, res) => res.status(201).json(await auth.register(req.body));
exports.register = register;
const login = async (req, res) => res.json(await auth.login(req.body));
exports.login = login;
const refresh = async (req, res) => res.json(await auth.refresh(req.body.refreshToken));
exports.refresh = refresh;
const logout = async (req, res) => {
    const { sessionId } = req.auth;
    await auth.logout(sessionId);
    (0, emitter_1.getIO)().in(`session:${sessionId}`).disconnectSockets(true);
    res.status(204).end();
};
exports.logout = logout;
const me = async (req, res) => res.json(await auth.getMe(req.auth.userId));
exports.me = me;
const forgotPassword = async (req, res) => {
    await auth.forgotPassword(req.body.email);
    res.json({ message: 'If the email exists, a reset code was sent' });
};
exports.forgotPassword = forgotPassword;
const resetPassword = async (req, res) => {
    await auth.resetPassword(req.body.email, req.body.code, req.body.newPassword);
    res.json({ message: 'Password updated' });
};
exports.resetPassword = resetPassword;
