"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const httpError_1 = require("./httpError");
const multer_1 = __importDefault(require("multer"));
const errorHandler = (err, _req, res, _next) => {
    if (err instanceof zod_1.ZodError) {
        return res
            .status(400)
            .json({ message: 'Validation error', issues: err.issues });
    }
    if (err instanceof httpError_1.HttpError) {
        return res.status(err.status).json({ message: err.message });
    }
    if (err instanceof multer_1.default.MulterError) {
        return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
            message: err.code === 'LIMIT_FILE_SIZE' ? 'File too large' : err.message,
        });
    }
    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002') {
        return res.status(409).json({ message: 'Value already exists' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
};
exports.errorHandler = errorHandler;
