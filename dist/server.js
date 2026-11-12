"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const app_1 = require("./app");
const env_1 = require("./config/env");
const prisma_1 = require("./config/prisma");
const sockets_1 = require("./sockets");
const server = http_1.default.createServer(app_1.app);
(0, sockets_1.initSocket)(server);
async function main() {
    // بعد أي إعادة تشغيل لا يوجد أحد متصل فعلياً
    await prisma_1.prisma.user.updateMany({
        where: { isOnline: true },
        data: { isOnline: false },
    });
    server.listen(env_1.env.PORT, '0.0.0.0', () => console.log(`API running on http://localhost:${env_1.env.PORT}`));
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
