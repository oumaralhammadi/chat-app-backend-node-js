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
exports.sendAttachment = exports.messages = exports.getOne = exports.list = exports.create = void 0;
const zod_1 = require("zod");
const svc = __importStar(require("../services/conversation.service"));
const message_service_1 = require("../services/message.service");
const httpError_1 = require("../middleware/httpError");
const message_service_2 = require("../services/message.service");
const emitter_1 = require("../sockets/emitter");
const delivery_1 = require("../sockets/delivery");
const push_service_1 = require("../services/push.service");
const create = async (req, res) => res
    .status(201)
    .json(await svc.getOrCreateDirect(req.auth.userId, req.body.userId));
exports.create = create;
const list = async (req, res) => {
    const { q } = zod_1.z
        .object({ q: zod_1.z.string().trim().max(50).optional() })
        .parse(req.query);
    res.json(await svc.listConversations(req.auth.userId, q || undefined));
};
exports.list = list;
const getOne = async (req, res) => res.json(await svc.getConversation(req.auth.userId, String(req.params.id)));
exports.getOne = getOne;
const messages = async (req, res) => {
    const q = zod_1.z
        .object({
        before: zod_1.z.string().uuid().optional(),
        limit: zod_1.z.coerce.number().int().min(1).max(50).default(30),
    })
        .parse(req.query);
    res.json(await (0, message_service_1.listMessages)(req.auth.userId, String(req.params.id), q.before, q.limit));
};
exports.messages = messages;
const sendAttachment = async (req, res) => {
    if (!req.file)
        throw new httpError_1.HttpError(400, 'File is required (field name: file)');
    const body = zod_1.z
        .object({
        clientId: zod_1.z.string().min(8).max(64),
        caption: zod_1.z.string().trim().max(1000).optional(),
        replyToId: zod_1.z.string().uuid().optional(),
    })
        .parse(req.body);
    const userId = req.auth.userId;
    const { message, recipientIds, duplicate } = await (0, message_service_2.sendAttachmentMessage)(userId, String(req.params.id), req.file, body);
    if (!duplicate) {
        // أجهزتي الأخرى. إن أرسل العميل x-socket-id نستثني اتصاله هو لأنه يملك الرد أصلاً
        const mine = (0, emitter_1.getIO)().to((0, emitter_1.userRoom)(userId));
        const socketId = req.header('x-socket-id');
        (socketId ? mine.except(socketId) : mine).emit('message:new', message);
        (0, delivery_1.deliver)(message, recipientIds);
        void (0, push_service_1.pushNewMessage)(message, recipientIds);
    }
    res.status(duplicate ? 200 : 201).json({ message });
};
exports.sendAttachment = sendAttachment;
