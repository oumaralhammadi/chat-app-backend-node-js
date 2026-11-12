"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = void 0;
const validate = (schema) => (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
};
exports.validate = validate;
