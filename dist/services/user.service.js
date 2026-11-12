"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchUsers = exports.updateProfile = exports.peerSelect = exports.selfSelect = void 0;
exports.setAvatar = setAvatar;
exports.removeAvatar = removeAvatar;
const prisma_1 = require("../config/prisma");
const httpError_1 = require("../middleware/httpError");
const upload_1 = require("../middleware/upload");
const upload_service_1 = require("./upload.service");
const cloudinary_1 = require("../config/cloudinary");
exports.selfSelect = {
    id: true,
    email: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    statusText: true,
    createdAt: true,
};
exports.peerSelect = {
    id: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    statusText: true,
    isOnline: true,
    lastSeenAt: true,
};
const updateProfile = (userId, data) => prisma_1.prisma.user.update({ where: { id: userId }, data, select: exports.selfSelect });
exports.updateProfile = updateProfile;
async function setAvatar(userId, buffer) {
    if (!(0, upload_1.detectImageMime)(buffer))
        throw new httpError_1.HttpError(400, 'Invalid image (JPEG, PNG or WEBP only)');
    const result = await (0, upload_service_1.uploadAvatarImage)(buffer, userId);
    return prisma_1.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: result.secure_url },
        select: exports.selfSelect,
    });
}
const searchUsers = (userId, q) => prisma_1.prisma.user.findMany({
    where: {
        id: { not: userId },
        OR: [{ username: { contains: q } }, { displayName: { contains: q } }],
    },
    select: exports.peerSelect,
    orderBy: { displayName: 'asc' },
    take: 20,
});
exports.searchUsers = searchUsers;
async function removeAvatar(userId) {
    if (cloudinary_1.isCloudinaryConfigured) {
        await cloudinary_1.cloudinary.uploader
            .destroy(`chat-app/avatars/${userId}`, {
            resource_type: 'image',
            invalidate: true,
        })
            .catch(() => { });
    }
    return prisma_1.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: null },
        select: exports.selfSelect,
    });
}
